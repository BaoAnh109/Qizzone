using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Qizzone.Api.Data;
using Qizzone.Api.Features;
using Qizzone.Worker;

namespace Qizzone.Worker.Tests;

public sealed class AiImportWorkerTests
{
    [PostgresWorkerFact]
    public async Task Cancelling_a_processing_job_stops_the_in_flight_provider_request()
    {
        var baseConnectionString = Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES")!;
        var schema = $"qizzone_worker_cancel_{Guid.NewGuid():N}";
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var providerCancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var httpClient = new HttpClient(new BlockingProviderHandler(started, providerCancelled))
        {
            Timeout = TimeSpan.FromMinutes(5),
        };

        await using (var adminConnection = new NpgsqlConnection(baseConnectionString))
        {
            await adminConnection.OpenAsync();
            await using var createSchema = adminConnection.CreateCommand();
            createSchema.CommandText = $"CREATE SCHEMA \"{schema}\"";
            await createSchema.ExecuteNonQueryAsync();
        }

        var connectionString = new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            SearchPath = schema,
            MaxPoolSize = 8,
        }.ConnectionString;
        var options = new DbContextOptionsBuilder<QizzoneDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        var workerConfiguration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Qizzone"] = connectionString,
            })
            .Build();
        var gemini = new GeminiClient(httpClient, Options.Create(new GeminiOptions
        {
            ApiKey = "worker-cancellation-test-key",
            Model = "gemini-test",
        }));
        var worker = new AiImportWorker(
            workerConfiguration,
            gemini,
            NullLogger<AiImportWorker>.Instance);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var stopped = false;

        try
        {
            Guid jobId;
            await using (var db = new QizzoneDbContext(options))
            {
                await db.Database.MigrateAsync(timeout.Token);
                db.Profiles.Add(new Profile
                {
                    FirebaseUid = "worker-cancellation-owner",
                    Email = "worker-cancellation@example.test",
                    FullName = "Worker cancellation test",
                    Role = "teacher",
                    ActiveRole = "teacher",
                    ApprovalStatus = "approved",
                    TeacherRequestStatus = "approved",
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
                var job = new AiImportJob
                {
                    Id = Guid.NewGuid(),
                    OwnerUid = "worker-cancellation-owner",
                    SourceFileName = "exam.pdf",
                    Status = "queued",
                    AttemptCount = 0,
                    RequestJson = "{\"prompt\":\"extract this fixture\",\"imageBase64\":null,\"imageMimeType\":null,\"operation\":\"extract\"}",
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                jobId = job.Id;
                db.AiImportJobs.Add(job);
                await db.SaveChangesAsync(timeout.Token);
            }

            await worker.StartAsync(timeout.Token);
            await started.Task.WaitAsync(timeout.Token);

            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync(timeout.Token);
                await using var cancel = connection.CreateCommand();
                cancel.CommandText = """
                    UPDATE ai_import_jobs
                    SET status = 'cancelled',
                        request = '{}'::jsonb,
                        source_file_name = '',
                        error_code = 'job_cancelled',
                        lease_until = NULL,
                        completed_at = now(),
                        updated_at = now()
                    WHERE id = @id AND status = 'processing';
                    """;
                cancel.Parameters.AddWithValue("id", jobId);
                Assert.Equal(1, await cancel.ExecuteNonQueryAsync(timeout.Token));
            }

            await providerCancelled.Task.WaitAsync(timeout.Token);
            await worker.StopAsync(timeout.Token);
            stopped = true;

            await using var verification = new QizzoneDbContext(options);
            var stored = await verification.AiImportJobs.SingleAsync(item => item.Id == jobId, timeout.Token);
            Assert.Equal("cancelled", stored.Status);
            Assert.Equal("job_cancelled", stored.ErrorCode);
            Assert.Equal(1, stored.AttemptCount);
            Assert.Null(stored.LeaseUntil);
            Assert.Null(stored.ResultJson);
        }
        finally
        {
            if (!stopped) await worker.StopAsync(CancellationToken.None);
            await using var cleanupConnection = new NpgsqlConnection(baseConnectionString);
            await cleanupConnection.OpenAsync();
            await using var cleanup = cleanupConnection.CreateCommand();
            cleanup.CommandText = $"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE";
            await cleanup.ExecuteNonQueryAsync();
        }
    }

    private sealed class BlockingProviderHandler(
        TaskCompletionSource started,
        TaskCompletionSource cancelled) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Assert.Equal("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent", request.RequestUri?.ToString());
            Assert.Equal("worker-cancellation-test-key", request.Headers.GetValues("x-goog-api-key").Single());
            started.TrySetResult();
            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json"),
                };
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                cancelled.TrySetResult();
                throw;
            }
        }
    }
}

internal sealed class PostgresWorkerFactAttribute : FactAttribute
{
    public PostgresWorkerFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES")))
        {
            Skip = "This integration test requires QIZZONE_TEST_POSTGRES; CI runs it against PostgreSQL.";
        }
    }
}
