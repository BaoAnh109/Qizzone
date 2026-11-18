using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

internal static class PracticeSessionLock
{
    public static async Task AcquireAsync(
        QizzoneDbContext db,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        if (db.Database.ProviderName != "Npgsql.EntityFrameworkCore.PostgreSQL")
        {
            return;
        }

        var transaction = db.Database.CurrentTransaction
            ?? throw new InvalidOperationException("A quiz transaction is required before locking a practice session.");
        var connection = db.Database.GetDbConnection();
        await using DbCommand command = connection.CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT id FROM practice_sessions WHERE id = @session_id FOR UPDATE";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "session_id";
        parameter.Value = sessionId;
        command.Parameters.Add(parameter);
        await command.ExecuteScalarAsync(cancellationToken);
    }
}
