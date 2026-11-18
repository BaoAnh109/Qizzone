using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

internal static class ExamAttemptCapacityGate
{
    public const int MaximumConcurrentAttempts = 20;

    // This database-wide key is shared by every API replica using the same PostgreSQL database.
    private const long AdvisoryLockKey = 0x515A5A4F4E45L;

    public static async Task AcquireStartLockAsync(QizzoneDbContext db, CancellationToken cancellationToken)
    {
        if (db.Database.ProviderName != "Npgsql.EntityFrameworkCore.PostgreSQL")
        {
            return;
        }

        var transaction = db.Database.CurrentTransaction
            ?? throw new InvalidOperationException("A quiz transaction is required before checking exam capacity.");
        var connection = db.Database.GetDbConnection();
        await using DbCommand command = connection.CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT pg_advisory_xact_lock(@lock_key)";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "lock_key";
        parameter.Value = AdvisoryLockKey;
        command.Parameters.Add(parameter);
        await command.ExecuteScalarAsync(cancellationToken);
    }
}
