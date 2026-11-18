using System.Text.Json;
using Microsoft.Extensions.Options;
using Npgsql;
using Qizzone.Api.Features;

namespace Qizzone.Worker;

public sealed class AiImportWorker(
    IConfiguration configuration,
    GeminiClient gemini,
    ILogger<AiImportWorker> logger) : BackgroundService
{
    private const int MaximumAttempts = 3;
    private const int MutationRetentionDays = 30;
    private const int MutationCleanupBatchSize = 1000;
    private readonly TimeSpan _pollInterval = TimeSpan.FromSeconds(1);
    private readonly TimeSpan _leaseDuration = TimeSpan.FromMinutes(2);
    private readonly string _connectionString = ResolveConnectionString(configuration);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:Qizzone is required for the AI worker.");
        }

        await using var dataSource = NpgsqlDataSource.Create(_connectionString);
        var nextMutationCleanup = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (DateTimeOffset.UtcNow >= nextMutationCleanup)
                {
                    await CleanupExpiredAttemptMutationsAsync(dataSource, stoppingToken);
                    nextMutationCleanup = DateTimeOffset.UtcNow.AddHours(24);
                }
                await FailExpiredJobsAsync(dataSource, stoppingToken);
                var job = await ClaimAsync(dataSource, stoppingToken);
                if (job is null)
                {
                    await Task.Delay(_pollInterval, stoppingToken);
                    continue;
                }
                await ProcessAsync(dataSource, job, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError("AI import worker loop failed with {ErrorType}; will retry.", exception.GetType().Name);
                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
        }
    }

    private static async Task CleanupExpiredAttemptMutationsAsync(
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                WITH expired AS (
                    SELECT attempt_id, mutation_id
                    FROM exam_attempt_mutations
                    WHERE saved_at < now() - make_interval(days => @retention_days)
                    ORDER BY saved_at
                    LIMIT @batch_size
                )
                DELETE FROM exam_attempt_mutations AS mutation
                USING expired
                WHERE mutation.attempt_id = expired.attempt_id
                  AND mutation.mutation_id = expired.mutation_id
                RETURNING 1;
                """;
            command.Parameters.AddWithValue("retention_days", MutationRetentionDays);
            command.Parameters.AddWithValue("batch_size", MutationCleanupBatchSize);
            var removed = 0;
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken)) removed++;
            }

            if (removed < MutationCleanupBatchSize) return;
        }
    }

    private async Task<ClaimedJob?> ClaimAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            WITH next_job AS (
                SELECT id
                FROM ai_import_jobs
                WHERE attempt_count < @max_attempts
                  AND (status = 'queued' AND (lease_until IS NULL OR lease_until <= now())
                       OR status = 'processing' AND lease_until <= now())
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE ai_import_jobs AS job
            SET status = 'processing',
                attempt_count = job.attempt_count + 1,
                lease_until = @lease_until,
                updated_at = now(),
                error_code = NULL
            FROM next_job
            WHERE job.id = next_job.id
            RETURNING job.id, job.request::text, job.attempt_count, job.lease_until;
            """;
        command.Parameters.AddWithValue("max_attempts", MaximumAttempts);
        var leaseUntil = DateTimeOffset.UtcNow.Add(_leaseDuration);
        command.Parameters.AddWithValue("lease_until", leaseUntil);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new ClaimedJob(reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2), reader.GetFieldValue<DateTimeOffset>(3));
    }

    private async Task ProcessAsync(NpgsqlDataSource dataSource, ClaimedJob job, CancellationToken cancellationToken)
    {
        try
        {
            var payload = JsonSerializer.Deserialize<AiImportPayload>(job.RequestJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (payload is null || string.IsNullOrWhiteSpace(payload.Prompt))
            {
                throw new GeminiPermanentException("job_payload_invalid");
            }
            var result = await ExtractWithCancellationMonitorAsync(dataSource, job, payload, cancellationToken);
            if (await SaveSuccessAsync(dataSource, job, result, cancellationToken))
            {
                logger.LogInformation("AI import job {JobId} completed on attempt {Attempt}.", job.Id, job.AttemptCount);
            }
        }
        catch (AiImportJobCancelledException)
        {
            logger.LogInformation("AI import job {JobId} was cancelled or its lease expired.", job.Id);
        }
        catch (GeminiTransientException exception)
        {
            await SaveFailureAsync(dataSource, job, exception.Code, retry: job.AttemptCount < MaximumAttempts, cancellationToken);
            logger.LogWarning("AI import job {JobId} had retryable error {ErrorCode} on attempt {Attempt}.", job.Id, exception.Code, job.AttemptCount);
        }
        catch (GeminiPermanentException exception)
        {
            await SaveFailureAsync(dataSource, job, exception.Code, retry: false, cancellationToken);
            logger.LogWarning("AI import job {JobId} failed with {ErrorCode}.", job.Id, exception.Code);
        }
        catch (HttpRequestException)
        {
            await SaveFailureAsync(dataSource, job, "gemini_network_error", retry: job.AttemptCount < MaximumAttempts, cancellationToken);
            logger.LogWarning("AI import job {JobId} failed due to an upstream network error.", job.Id);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            await SaveFailureAsync(dataSource, job, "gemini_timeout", retry: job.AttemptCount < MaximumAttempts, cancellationToken);
            logger.LogWarning("AI import job {JobId} timed out.", job.Id);
        }
        catch (JsonException)
        {
            await SaveFailureAsync(dataSource, job, "gemini_invalid_json", retry: false, cancellationToken);
            logger.LogWarning("AI import job {JobId} returned invalid JSON.", job.Id);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            await SaveFailureAsync(dataSource, job, "worker_processing_error", retry: false, cancellationToken);
            logger.LogError("AI import job {JobId} failed with processing error type {ErrorType}.", job.Id, exception.GetType().Name);
        }
    }

    private async Task<string> ExtractWithCancellationMonitorAsync(
        NpgsqlDataSource dataSource,
        ClaimedJob job,
        AiImportPayload payload,
        CancellationToken stoppingToken)
    {
        using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        using var monitorStop = new CancellationTokenSource();
        var monitor = MonitorJobLeaseAsync(dataSource, job, operationCancellation, monitorStop.Token);
        try
        {
            return await gemini.ExtractAsync(payload, operationCancellation.Token);
        }
        catch (OperationCanceledException) when (operationCancellation.IsCancellationRequested && !stoppingToken.IsCancellationRequested)
        {
            throw new AiImportJobCancelledException();
        }
        finally
        {
            monitorStop.Cancel();
            try
            {
                await monitor;
            }
            catch (OperationCanceledException) when (monitorStop.IsCancellationRequested)
            {
                // Stop the lease watcher after extraction finishes.
            }
        }
    }

    private async Task MonitorJobLeaseAsync(
        NpgsqlDataSource dataSource,
        ClaimedJob job,
        CancellationTokenSource operationCancellation,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            try
            {
                if (!await IsClaimActiveAsync(dataSource, job, cancellationToken))
                {
                    operationCancellation.Cancel();
                    return;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                logger.LogWarning("AI import lease check failed for job {JobId} with {ErrorType}.", job.Id, exception.GetType().Name);
            }

            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        }
    }

    private static async Task<bool> IsClaimActiveAsync(
        NpgsqlDataSource dataSource,
        ClaimedJob job,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT EXISTS (
                SELECT 1 FROM ai_import_jobs
                WHERE id = @id AND status = 'processing' AND lease_until = @lease_until
            );
            """;
        command.Parameters.AddWithValue("id", job.Id);
        command.Parameters.AddWithValue("lease_until", job.LeaseUntil);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task<bool> SaveSuccessAsync(NpgsqlDataSource dataSource, ClaimedJob job, string resultJson, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE ai_import_jobs
            SET status = 'succeeded', source_file_name = '', request = '{}'::jsonb, result = jsonb_build_object('result', @result::jsonb),
                error_code = NULL, lease_until = NULL, completed_at = now(), updated_at = now()
            WHERE id = @id AND status = 'processing' AND lease_until = @lease_until;
            """;
        command.Parameters.AddWithValue("id", job.Id);
        command.Parameters.AddWithValue("lease_until", job.LeaseUntil);
        command.Parameters.AddWithValue("result", resultJson);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static async Task SaveFailureAsync(
        NpgsqlDataSource dataSource,
        ClaimedJob job,
        string errorCode,
        bool retry,
        CancellationToken cancellationToken)
    {
        var retryDelay = TimeSpan.FromSeconds(Math.Min(30, 2 * Math.Pow(2, Math.Max(0, job.AttemptCount - 1))));
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE ai_import_jobs
            SET status = @status,
                source_file_name = CASE WHEN @retry THEN source_file_name ELSE '' END,
                request = CASE WHEN @retry THEN request ELSE '{}'::jsonb END,
                result = NULL,
                error_code = @error_code,
                lease_until = CASE WHEN @retry THEN @retry_at ELSE NULL END,
                completed_at = CASE WHEN @retry THEN NULL ELSE now() END,
                updated_at = now()
            WHERE id = @id AND status = 'processing' AND lease_until = @lease_until;
            """;
        command.Parameters.AddWithValue("status", retry ? "queued" : "failed");
        command.Parameters.AddWithValue("retry", retry);
        command.Parameters.AddWithValue("retry_at", DateTimeOffset.UtcNow.Add(retryDelay));
        command.Parameters.AddWithValue("error_code", errorCode);
        command.Parameters.AddWithValue("id", job.Id);
        command.Parameters.AddWithValue("lease_until", job.LeaseUntil);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task FailExpiredJobsAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE ai_import_jobs
            SET status = 'failed', source_file_name = '', request = '{}'::jsonb, result = NULL,
                error_code = 'worker_lease_exhausted', completed_at = now(), updated_at = now(), lease_until = NULL
            WHERE status = 'processing' AND lease_until <= now() AND attempt_count >= @max_attempts;

            UPDATE ai_import_jobs
            SET status = 'failed', source_file_name = '', request = '{}'::jsonb, result = NULL,
                error_code = 'job_expired', completed_at = now(), updated_at = now(), lease_until = NULL
            WHERE status = 'queued' AND created_at <= now() - INTERVAL '24 hours';
            """;
        command.Parameters.AddWithValue("max_attempts", MaximumAttempts);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record ClaimedJob(Guid Id, string RequestJson, int AttemptCount, DateTimeOffset LeaseUntil);

    private sealed class AiImportJobCancelledException : Exception { }

    private static string ResolveConnectionString(IConfiguration configuration)
    {
        var secretFile = configuration["ConnectionStrings:QizzoneFile"];
        if (!string.IsNullOrWhiteSpace(secretFile))
        {
            return File.ReadAllText(secretFile).Trim();
        }

        return configuration.GetConnectionString("Qizzone") ??
            configuration["ConnectionStrings:Qizzone"] ?? "";
    }
}
