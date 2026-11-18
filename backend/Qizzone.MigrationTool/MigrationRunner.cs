using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using NpgsqlTypes;

namespace Qizzone.MigrationTool;

internal sealed record TableDigest(long Rows, string Sha256);

internal sealed record SourceChecks(
    long OpenExamAttempts,
    long StorageObjects,
    long SupabaseAuthUsers,
    long QuestionMediaReferences,
    long AvatarStorageReferences,
    bool QuestionImagesColumnPresent);

internal sealed record TargetInspection(
    bool HasRequiredEfMigration,
    IReadOnlyDictionary<string, TableDigest> Tables,
    IReadOnlyDictionary<string, long> TargetOnlyRows);

internal sealed record MigrationPlan(
    string SourceDigest,
    SourceChecks Checks,
    IReadOnlyDictionary<string, TableDigest> SourceTables,
    TargetInspection? Target,
    bool DatabaseDataCanBeApplied,
    string[] Conditions);

internal static class MigrationRunner
{
    private const string RequiredMigration = "20261118080000_AllowFiveOptionAnswers";
    private const string AdvisoryLockNamespace = "Qizzone.SupabaseToV2.InitialCutover.v1";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static async Task<MigrationPlan> PlanAsync(
        string sourceConnectionString,
        string? targetConnectionString,
        CancellationToken cancellationToken)
    {
        await using var source = await OpenReadOnlySnapshotAsync(sourceConnectionString, cancellationToken);
        var tables = await MigrationCatalog.CreateAsync(source.Connection, source.Transaction, cancellationToken);
        var checks = await ReadSourceChecksAsync(source.Connection, source.Transaction, cancellationToken);
        await ValidateSourceDataAsync(source.Connection, source.Transaction, cancellationToken);
        var sourceManifest = await ReadManifestAsync(source.Connection, source.Transaction, tables, true, cancellationToken);
        var digest = CreateSourceDigest(sourceManifest, checks);
        TargetInspection? target = null;

        if (!string.IsNullOrWhiteSpace(targetConnectionString))
        {
            await using var targetConnection = new NpgsqlConnection(targetConnectionString);
            await targetConnection.OpenAsync(cancellationToken);
            await using var targetTransaction = await targetConnection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
            await MakeReadOnlyUtcAsync(targetConnection, targetTransaction, cancellationToken);
            target = await InspectTargetAsync(targetConnection, targetTransaction, tables, cancellationToken);
        }

        var conditions = new List<string>();
        if (checks.StorageObjects != 0) conditions.Add("Source storage contains objects; transfer and verify those objects before importing relational data.");
        if (checks.QuestionMediaReferences != 0) conditions.Add("Source questions reference image data; storage migration and hash reconciliation are required before import.");
        if (checks.AvatarStorageReferences != 0) conditions.Add("Source profiles reference Supabase Storage avatars; transfer and verify those objects before import.");
        if (checks.SupabaseAuthUsers != 0) conditions.Add("Supabase Auth contains users; Firebase UID/account mapping must be explicitly reconciled first.");
        if (target is null)
        {
            conditions.Add("Target connection is not configured, so target migration history and emptiness have not been verified.");
        }
        else
        {
            if (!target.HasRequiredEfMigration) conditions.Add($"Target is missing EF migration {RequiredMigration}.");
            if (target.TargetOnlyRows.Any(item => item.Value != 0)) conditions.Add("Target has V2-only rows; review or clear the disposable target before import.");
            if (!ManifestMatches(sourceManifest, target.Tables) && target.Tables.Values.Any(item => item.Rows != 0))
            {
                conditions.Add("Target is non-empty and differs from the source snapshot; import is blocked to prevent merging into active data.");
            }
        }

        return new MigrationPlan(
            digest,
            checks,
            sourceManifest,
            target,
            conditions.Count == 0,
            conditions.ToArray());
    }

    public static async Task<string> ApplyAsync(
        string sourceConnectionString,
        string targetConnectionString,
        string expectedSourceDigest,
        CancellationToken cancellationToken)
    {
        await using var source = await OpenReadOnlySnapshotAsync(sourceConnectionString, cancellationToken);
        var tables = await MigrationCatalog.CreateAsync(source.Connection, source.Transaction, cancellationToken);
        var checks = await ReadSourceChecksAsync(source.Connection, source.Transaction, cancellationToken);
        await ValidateSourceDataAsync(source.Connection, source.Transaction, cancellationToken);
        if (checks.StorageObjects != 0)
        {
            throw new MigrationToolException("Import is blocked because storage.objects contains files. Transfer and verify all objects before the database cutover.");
        }

        if (checks.QuestionMediaReferences != 0 || checks.AvatarStorageReferences != 0)
        {
            throw new MigrationToolException("Import is blocked because source records still reference storage objects. Migrate those files and verify their hashes first.");
        }

        if (checks.SupabaseAuthUsers != 0)
        {
            throw new MigrationToolException("Import is blocked because Supabase Auth users need an explicit account/UID mapping.");
        }

        var sourceManifest = await ReadManifestAsync(source.Connection, source.Transaction, tables, true, cancellationToken);
        var sourceDigest = CreateSourceDigest(sourceManifest, checks);
        if (!string.Equals(sourceDigest, expectedSourceDigest, StringComparison.OrdinalIgnoreCase))
        {
            throw new MigrationToolException("Source data changed after the approved read-only plan. Re-run plan and review the new digest before applying.");
        }

        await using var targetConnection = new NpgsqlConnection(targetConnectionString);
        await targetConnection.OpenAsync(cancellationToken);
        await using var targetTransaction = await targetConnection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        await SetTargetUtcAsync(targetConnection, targetTransaction, cancellationToken);
        await AcquireTargetAdvisoryLockAsync(targetConnection, targetTransaction, cancellationToken);
        await VerifyRequiredEfMigrationAsync(targetConnection, targetTransaction, cancellationToken);
        await LockTargetTablesAsync(targetConnection, targetTransaction, tables, cancellationToken);

        var targetOnlyRows = await ReadTargetOnlyRowsAsync(targetConnection, targetTransaction, cancellationToken);
        if (targetOnlyRows.Any(item => item.Value != 0))
        {
            throw new MigrationToolException("Target contains Qizzone V2-only data. Refusing to merge a source snapshot into an active or non-empty target.");
        }

        var targetManifest = await ReadManifestAsync(targetConnection, targetTransaction, tables, false, cancellationToken);
        if (ManifestMatches(sourceManifest, targetManifest))
        {
            await VerifySourceSnapshotUnchangedAsync(sourceConnectionString, expectedSourceDigest, cancellationToken);
            await targetTransaction.CommitAsync(cancellationToken);
            return "The target already matches this exact source snapshot; no rows were changed.";
        }

        if (targetManifest.Values.Any(item => item.Rows != 0))
        {
            throw new MigrationToolException("Target contains rows that do not match the planned source snapshot. Import only into an empty disposable/cutover target.");
        }

        var profileReviewers = new List<(string Uid, string? ReviewedBy, string? TeacherReviewedBy)>();
        foreach (var table in tables)
        {
            await CopyTableAsync(source.Connection, source.Transaction, targetConnection, targetTransaction, table, profileReviewers, cancellationToken);
        }

        await RestoreProfileReviewerReferencesAsync(targetConnection, targetTransaction, profileReviewers, cancellationToken);

        var importedManifest = await ReadManifestAsync(targetConnection, targetTransaction, tables, false, cancellationToken);
        if (!ManifestMatches(sourceManifest, importedManifest))
        {
            throw new MigrationToolException("Post-import row counts or SHA-256 checksums differ from the source snapshot. The target transaction was rolled back.");
        }

        await VerifyImportedSnapshotsAsync(targetConnection, targetTransaction, cancellationToken);
        await VerifySourceSnapshotUnchangedAsync(sourceConnectionString, expectedSourceDigest, cancellationToken);
        await targetTransaction.CommitAsync(cancellationToken);
        return $"Imported {sourceManifest.Values.Sum(item => item.Rows)} relational rows. Target row counts and SHA-256 checksums match the approved source snapshot.";
    }

    private static async Task VerifySourceSnapshotUnchangedAsync(
        string sourceConnectionString,
        string expectedSourceDigest,
        CancellationToken cancellationToken)
    {
        await using var latestSource = await OpenReadOnlySnapshotAsync(sourceConnectionString, cancellationToken);
        var tables = await MigrationCatalog.CreateAsync(latestSource.Connection, latestSource.Transaction, cancellationToken);
        var checks = await ReadSourceChecksAsync(latestSource.Connection, latestSource.Transaction, cancellationToken);
        await ValidateSourceDataAsync(latestSource.Connection, latestSource.Transaction, cancellationToken);
        var manifest = await ReadManifestAsync(latestSource.Connection, latestSource.Transaction, tables, true, cancellationToken);
        var actualDigest = CreateSourceDigest(manifest, checks);
        if (!string.Equals(actualDigest, expectedSourceDigest, StringComparison.OrdinalIgnoreCase))
        {
            throw new MigrationToolException("Source changed while the import was running. The target transaction was rolled back; freeze source writes and create a fresh plan.");
        }
    }

    public static string SerializePlan(MigrationPlan plan) => JsonSerializer.Serialize(plan, JsonOptions);

    private static async Task<ReadOnlySnapshot> OpenReadOnlySnapshotAsync(string connectionString, CancellationToken cancellationToken)
    {
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
            await MakeReadOnlyUtcAsync(connection, transaction, cancellationToken);
            return new ReadOnlySnapshot(connection, transaction);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private static async Task MakeReadOnlyUtcAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, transaction);
        await readOnly.ExecuteNonQueryAsync(cancellationToken);
        await using var utc = new NpgsqlCommand("SET LOCAL TIME ZONE 'UTC'", connection, transaction);
        await utc.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SetTargetUtcAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SET LOCAL TIME ZONE 'UTC'", connection, transaction);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<SourceChecks> ReadSourceChecksAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        var questionColumns = await ReadColumnNamesAsync(connection, transaction, "public", "questions", cancellationToken);
        var questionImages = questionColumns.Contains("images") ? "q.images" : "'[]'::jsonb";
        var mediaReferences = await ReadLongAsync(
            connection,
            transaction,
            $"SELECT count(*) FROM public.questions q WHERE CASE WHEN jsonb_typeof({questionImages}) = 'array' THEN jsonb_array_length({questionImages}) ELSE 0 END > 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.options) = 'array' THEN q.options ELSE '[]'::jsonb END) AS option(data) WHERE CASE WHEN jsonb_typeof(option.data->'images') = 'array' THEN jsonb_array_length(option.data->'images') ELSE 0 END > 0)",
            cancellationToken);
        var avatarReferences = await ReadLongAsync(connection, transaction, "SELECT count(*) FROM public.profiles WHERE avatar_url LIKE '%/storage/v1/object/%' OR avatar_url LIKE '%supabase.co/storage/%'", cancellationToken);
        return new SourceChecks(
            await ReadLongAsync(connection, transaction, "SELECT count(*) FROM public.exam_attempts WHERE submitted_at IS NULL", cancellationToken),
            await CountOptionalRelationAsync(connection, transaction, "storage.objects", cancellationToken),
            await CountOptionalRelationAsync(connection, transaction, "auth.users", cancellationToken),
            mediaReferences,
            avatarReferences,
            questionColumns.Contains("images"));
    }

    private static async Task ValidateSourceDataAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        var checks = new (string Name, string Sql)[]
        {
            ("quiz owners", "SELECT count(*) FROM public.quizzes q LEFT JOIN public.profiles p ON p.firebase_uid = q.teacher_uid WHERE p.firebase_uid IS NULL"),
            ("question answer keys", "SELECT count(*) FROM public.questions q LEFT JOIN public.question_answer_keys k ON k.question_id = q.id WHERE k.question_id IS NULL"),
            ("invalid answer keys", "SELECT count(*) FROM public.question_answer_keys k JOIN public.questions q ON q.id = k.question_id WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(k.correct_answers) AS correct(answer_id) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) AS option(data) WHERE option.data->>'id' = correct.answer_id)) OR (q.type <> 'multiple_choice' AND jsonb_array_length(k.correct_answers) <> 1)"),
            ("exam attempt snapshots", "SELECT count(*) FROM public.exam_attempts a WHERE cardinality(a.question_order) = 0 OR cardinality(a.question_order) <> (SELECT count(DISTINCT selected.question_id) FROM unnest(a.question_order) AS selected(question_id)) OR cardinality(a.question_order) <> (SELECT count(*) FROM unnest(a.question_order) AS selected(question_id) JOIN public.questions q ON q.id = selected.question_id AND q.quiz_id = a.quiz_id JOIN public.question_answer_keys k ON k.question_id = q.id)"),
            ("exam result relationships", "SELECT count(*) FROM public.exam_attempts attempt LEFT JOIN public.exam_results result ON result.attempt_id = attempt.id WHERE (attempt.submitted_at IS NULL AND result.attempt_id IS NOT NULL) OR (attempt.submitted_at IS NOT NULL AND result.attempt_id IS NULL)"),
            ("exam answer relationships", "SELECT count(*) FROM public.exam_answers answer JOIN public.exam_attempts attempt ON attempt.id = answer.attempt_id LEFT JOIN public.questions q ON q.id = answer.question_id AND q.quiz_id = attempt.quiz_id WHERE q.id IS NULL OR NOT (answer.question_id = ANY(attempt.question_order)) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(answer.selected_answers) AS selected(option_id) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) AS option(data) WHERE option.data->>'id' = selected.option_id))"),
            ("practice session questions", "SELECT count(*) FROM public.practice_sessions s WHERE cardinality(s.question_order) = 0 OR cardinality(s.question_order) <> (SELECT count(DISTINCT selected.question_id) FROM unnest(s.question_order) AS selected(question_id)) OR cardinality(s.question_order) <> (SELECT count(*) FROM unnest(s.question_order) AS selected(question_id) JOIN public.questions q ON q.id = selected.question_id AND q.quiz_id = s.quiz_id)"),
            ("practice answer relationships", "SELECT count(*) FROM public.practice_answers answer JOIN public.practice_sessions session ON session.id = answer.session_id LEFT JOIN public.questions q ON q.id = answer.question_id AND q.quiz_id = session.quiz_id WHERE q.id IS NULL OR NOT (answer.question_id = ANY(session.question_order)) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(answer.selected_answers) AS selected(option_id) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) AS option(data) WHERE option.data->>'id' = selected.option_id)) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(answer.correct_answers) AS correct(option_id) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) AS option(data) WHERE option.data->>'id' = correct.option_id))"),
        };

        foreach (var check in checks)
        {
            if (await ReadLongAsync(connection, transaction, check.Sql, cancellationToken) != 0)
            {
                throw new MigrationToolException($"Source integrity check failed for {check.Name}; no migration data was changed.");
            }
        }
    }

    private static async Task<long> CountOptionalRelationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string relation,
        CancellationToken cancellationToken)
    {
        await using var existsCommand = new NpgsqlCommand("SELECT to_regclass(@relation) IS NOT NULL", connection, transaction);
        existsCommand.Parameters.AddWithValue("relation", relation);
        if ((bool)(await existsCommand.ExecuteScalarAsync(cancellationToken) ?? false))
        {
            return await ReadLongAsync(connection, transaction, $"SELECT count(*) FROM {relation}", cancellationToken);
        }

        return 0;
    }

    private static async Task<TargetInspection> InspectTargetAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyList<MigrationTable> tables,
        CancellationToken cancellationToken)
    {
        var hasMigration = await HasRequiredEfMigrationAsync(connection, transaction, cancellationToken);
        var manifest = await ReadManifestAsync(connection, transaction, tables, false, cancellationToken);
        var targetOnly = await ReadTargetOnlyRowsAsync(connection, transaction, cancellationToken);
        return new TargetInspection(hasMigration, manifest, targetOnly);
    }

    private static async Task<bool> HasRequiredEfMigrationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT EXISTS (SELECT 1 FROM public.\"__EFMigrationsHistory\" WHERE \"MigrationId\" = @migration)",
            connection,
            transaction);
        command.Parameters.AddWithValue("migration", RequiredMigration);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task VerifyRequiredEfMigrationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        try
        {
            if (!await HasRequiredEfMigrationAsync(connection, transaction, cancellationToken))
            {
                throw new MigrationToolException($"Target PostgreSQL is missing required EF migration {RequiredMigration}; apply reviewed migrations first.");
            }
        }
        catch (PostgresException)
        {
            throw new MigrationToolException("Target EF migration history is missing or inaccessible; apply reviewed migrations first.");
        }
    }

    private static async Task LockTargetTablesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyList<MigrationTable> tables,
        CancellationToken cancellationToken)
    {
        var names = tables.Select(table => $"public.\"{table.Name}\"")
            .Concat(MigrationCatalog.TargetOnlyTables.Select(table => $"public.\"{table}\""));
        var sql = $"LOCK TABLE {string.Join(", ", names)} IN ACCESS EXCLUSIVE MODE";
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task AcquireTargetAdvisoryLockAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtextextended(@key, 0))", connection, transaction);
        command.Parameters.AddWithValue("key", AdvisoryLockNamespace);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<IReadOnlyDictionary<string, TableDigest>> ReadManifestAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyList<MigrationTable> tables,
        bool source,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, TableDigest>(StringComparer.Ordinal);
        foreach (var table in tables)
        {
            result[table.Name] = await HashRowsAsync(connection, transaction, source ? table.SourceQuery : table.TargetQuery, cancellationToken);
        }

        return result;
    }

    private static async Task<TableDigest> HashRowsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string query,
        CancellationToken cancellationToken)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long count = 0;
        await using var command = new NpgsqlCommand(query, connection, transaction) { CommandTimeout = 180 };
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = Encoding.UTF8.GetBytes(reader.GetString(0));
            hash.AppendData(row);
            hash.AppendData([0x0a]);
            count++;
        }

        return new TableDigest(count, Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }

    private static string CreateSourceDigest(IReadOnlyDictionary<string, TableDigest> manifest, SourceChecks checks)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var table in manifest.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
            Append(hash, $"{table.Key}\0{table.Value.Rows}\0{table.Value.Sha256}\n");
        }

        Append(hash, $"open={checks.OpenExamAttempts}\nstorage={checks.StorageObjects}\nauth={checks.SupabaseAuthUsers}\nquestionMedia={checks.QuestionMediaReferences}\navatarStorage={checks.AvatarStorageReferences}\nquestionImages={checks.QuestionImagesColumnPresent}\n");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static async Task CopyTableAsync(
        NpgsqlConnection source,
        NpgsqlTransaction sourceTransaction,
        NpgsqlConnection target,
        NpgsqlTransaction targetTransaction,
        MigrationTable table,
        List<(string Uid, string? ReviewedBy, string? TeacherReviewedBy)> profileReviewers,
        CancellationToken cancellationToken)
    {
        var insertColumns = string.Join(", ", table.Columns.Select(QuoteIdentifier));
        var selectColumns = string.Join(", ", table.Columns.Select(column => $"row_data.{QuoteIdentifier(column)}"));
        var insertSql = $"INSERT INTO public.{QuoteIdentifier(table.Name)} ({insertColumns}) SELECT {selectColumns} FROM jsonb_populate_record(NULL::public.{QuoteIdentifier(table.Name)}, @row::jsonb) AS row_data";
        await using var readCommand = new NpgsqlCommand(table.SourceQuery, source, sourceTransaction) { CommandTimeout = 180 };
        await using var reader = await readCommand.ExecuteReaderAsync(cancellationToken);
        await using var insertCommand = new NpgsqlCommand(insertSql, target, targetTransaction);
        insertCommand.Parameters.Add("row", NpgsqlDbType.Jsonb);
        await insertCommand.PrepareAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            var json = reader.GetString(0);
            if (table.Name == "profiles")
            {
                var profile = JsonNode.Parse(json)?.AsObject()
                    ?? throw new MigrationToolException("A source profile could not be represented as JSON.");
                profileReviewers.Add((
                    profile["firebase_uid"]?.GetValue<string>() ?? throw new MigrationToolException("A source profile has no Firebase UID."),
                    profile["reviewed_by"]?.GetValue<string>(),
                    profile["teacher_reviewed_by"]?.GetValue<string>()));
                profile["reviewed_by"] = null;
                profile["teacher_reviewed_by"] = null;
                json = profile.ToJsonString();
            }

            insertCommand.Parameters[0].Value = json;
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task RestoreProfileReviewerReferencesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyList<(string Uid, string? ReviewedBy, string? TeacherReviewedBy)> reviewers,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "UPDATE public.profiles SET reviewed_by = @reviewed_by, teacher_reviewed_by = @teacher_reviewed_by WHERE firebase_uid = @uid",
            connection,
            transaction);
        command.Parameters.Add("uid", NpgsqlDbType.Text);
        command.Parameters.Add("reviewed_by", NpgsqlDbType.Text);
        command.Parameters.Add("teacher_reviewed_by", NpgsqlDbType.Text);
        await command.PrepareAsync(cancellationToken);
        foreach (var reviewer in reviewers)
        {
            command.Parameters["uid"].Value = reviewer.Uid;
            command.Parameters["reviewed_by"].Value = (object?)reviewer.ReviewedBy ?? DBNull.Value;
            command.Parameters["teacher_reviewed_by"].Value = (object?)reviewer.TeacherReviewedBy ?? DBNull.Value;
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task VerifyImportedSnapshotsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        var invalidAttempts = await ReadLongAsync(connection, transaction,
            "SELECT count(*) FROM public.exam_attempts a WHERE jsonb_typeof(a.snapshot) <> 'object' OR COALESCE(jsonb_array_length(a.snapshot->'questions'), 0) <> cardinality(a.question_order)", cancellationToken);
        if (invalidAttempts != 0)
        {
            throw new MigrationToolException("Imported exam snapshots do not contain the exact question set recorded by each legacy attempt.");
        }
    }

    private static async Task<IReadOnlyDictionary<string, long>> ReadTargetOnlyRowsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var table in MigrationCatalog.TargetOnlyTables)
        {
            result[table] = await ReadLongAsync(connection, transaction, $"SELECT count(*) FROM public.{QuoteIdentifier(table)}", cancellationToken);
        }

        return result;
    }

    private static bool ManifestMatches(
        IReadOnlyDictionary<string, TableDigest> left,
        IReadOnlyDictionary<string, TableDigest> right) =>
        left.Count == right.Count && left.All(item =>
            right.TryGetValue(item.Key, out var other) &&
            item.Value.Rows == other.Rows &&
            string.Equals(item.Value.Sha256, other.Sha256, StringComparison.Ordinal));

    private static async Task<long> ReadLongAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task<HashSet<string>> ReadColumnNamesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = @schema AND table_name = @table",
            connection,
            transaction);
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var columns = new HashSet<string>(StringComparer.Ordinal);
        while (await reader.ReadAsync(cancellationToken)) columns.Add(reader.GetString(0));
        if (columns.Count == 0) throw new MigrationToolException($"Required source table {schema}.{table} is missing or inaccessible.");
        return columns;
    }

    private static string QuoteIdentifier(string value) => $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static void Append(IncrementalHash hash, string value) => hash.AppendData(Encoding.UTF8.GetBytes(value));

    private sealed class ReadOnlySnapshot(NpgsqlConnection connection, NpgsqlTransaction transaction) : IAsyncDisposable
    {
        public NpgsqlConnection Connection { get; } = connection;
        public NpgsqlTransaction Transaction { get; } = transaction;

        public async ValueTask DisposeAsync()
        {
            await Transaction.DisposeAsync();
            await Connection.DisposeAsync();
        }
    }
}

internal sealed class MigrationToolException(string message) : Exception(message);
