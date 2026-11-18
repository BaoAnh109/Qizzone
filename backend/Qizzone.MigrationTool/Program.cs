using System.Text.Json;
using Npgsql;
using Qizzone.MigrationTool;

const string sourceVariable = "QIZZONE_MIGRATION_SOURCE_CONNECTION_STRING";
const string targetVariable = "QIZZONE_MIGRATION_TARGET_CONNECTION_STRING";

if (args.Length == 0 || args[0] is "--help" or "-h" or "help")
{
    PrintUsage();
    return args.Length == 0 ? 2 : 0;
}

using var cancellationSource = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    cancellationSource.Cancel();
};

try
{
    var source = RequiredEnvironment(sourceVariable);
    switch (args[0])
    {
        case "plan":
        {
            if (args.Length != 1) throw new MigrationToolException("The plan command takes no arguments.");
            var plan = await MigrationRunner.PlanAsync(
                source,
                ReadEnvironmentSecret(targetVariable),
                cancellationSource.Token);
            Console.WriteLine(MigrationRunner.SerializePlan(plan));
            return plan.DatabaseDataCanBeApplied ? 0 : 2;
        }
        case "apply":
        {
            if (args.Length != 3 || args[1] != "--expected-source-digest")
            {
                throw new MigrationToolException("Apply requires --expected-source-digest followed by the digest from a reviewed read-only plan.");
            }

            var digest = args[2];
            if (digest.Length != 64 || !digest.All(Uri.IsHexDigit))
            {
                throw new MigrationToolException("The expected source digest must be a 64-character SHA-256 hex value.");
            }

            var target = RequiredEnvironment(targetVariable);
            var result = await MigrationRunner.ApplyAsync(source, target, digest, cancellationSource.Token);
            Console.WriteLine(JsonSerializer.Serialize(new { success = true, result }));
            return 0;
        }
        default:
            throw new MigrationToolException("Unknown command.");
    }
}
catch (MigrationToolException exception)
{
    Console.Error.WriteLine($"NO-GO: {exception.Message}");
    return 2;
}
catch (OperationCanceledException)
{
    Console.Error.WriteLine("Cancelled. Any open target transaction was rolled back.");
    return 130;
}
catch (Exception exception)
{
    // Provider exceptions can contain infrastructure details. Never print connection strings,
    // SQL parameters, row values, or a stack trace into CI logs.
    var postgresDiagnostic = exception is PostgresException postgres
        ? $"; PostgreSQL SQLSTATE {postgres.SqlState}, constraint {postgres.ConstraintName ?? "<none>"}"
        : "";
    Console.Error.WriteLine($"Migration preflight failed ({exception.GetType().Name}{postgresDiagnostic}). Check access and schema out of band; no row values were emitted.");
    return 3;
}

static string RequiredEnvironment(string name) =>
    ReadEnvironmentSecret(name) is { Length: > 0 } value
        ? value
        : throw new MigrationToolException($"Set {name} or {name}_FILE in the process environment; do not pass credentials as command-line arguments.");

static string? ReadEnvironmentSecret(string name)
{
    var file = Environment.GetEnvironmentVariable($"{name}_FILE");
    if (!string.IsNullOrWhiteSpace(file))
    {
        return File.ReadAllText(file).Trim();
    }

    var value = Environment.GetEnvironmentVariable(name);
    return string.IsNullOrWhiteSpace(value) ? null : value;
}

static void PrintUsage()
{
    Console.WriteLine("Qizzone Supabase → V2 migration tool (database rows only; storage objects are checked and block apply if present).");
    Console.WriteLine();
    Console.WriteLine("Plan without mutation:");
    Console.WriteLine("  dotnet run --project backend/Qizzone.MigrationTool -- plan");
    Console.WriteLine();
    Console.WriteLine("Apply only after source freeze, reviewed plan, verified backup/restore and target migration:");
    Console.WriteLine("  dotnet run --project backend/Qizzone.MigrationTool -- apply --expected-source-digest <sha256>");
    Console.WriteLine();
    Console.WriteLine($"Set {sourceVariable} and {targetVariable} or their _FILE variants in the process environment. The tool emits counts/checksums only; never put connection strings in Git, logs, or command history.");
}
