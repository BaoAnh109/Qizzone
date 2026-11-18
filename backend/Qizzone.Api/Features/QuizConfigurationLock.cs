using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

internal static class QuizConfigurationLock
{
    public static async Task<IDbContextTransaction?> AcquireAsync(
        QizzoneDbContext db,
        Guid quizId,
        CancellationToken cancellationToken)
        => await AcquireCoreAsync(db, quizId, "UPDATE", cancellationToken);

    public static async Task<IDbContextTransaction?> AcquireSharedAsync(
        QizzoneDbContext db,
        Guid quizId,
        CancellationToken cancellationToken)
        => await AcquireCoreAsync(db, quizId, "SHARE", cancellationToken);

    private static async Task<IDbContextTransaction?> AcquireCoreAsync(
        QizzoneDbContext db,
        Guid quizId,
        string lockMode,
        CancellationToken cancellationToken)
    {
        // PostgreSQL row locks coordinate all API replicas. Shared locks allow concurrent
        // exam/practice readers while still conflicting with quiz edits and deletes.
        // Other providers used by tests exercise endpoint logic without this SQL lock.
        if (db.Database.ProviderName != "Npgsql.EntityFrameworkCore.PostgreSQL")
        {
            return null;
        }

        var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var connection = db.Database.GetDbConnection();
            await using DbCommand command = connection.CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = $"SELECT id FROM quizzes WHERE id = @quiz_id FOR {lockMode}";
            var parameter = command.CreateParameter();
            parameter.ParameterName = "quiz_id";
            parameter.Value = quizId;
            command.Parameters.Add(parameter);
            await command.ExecuteScalarAsync(cancellationToken);
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }
}
