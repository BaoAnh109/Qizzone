using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public sealed class QuizScheduleService(
    IServiceScopeFactory scopeFactory,
    ILogger<QuizScheduleService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
                await ProcessDueAsync(db, DateTimeOffset.UtcNow, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Scheduled quiz room transitions failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    public static async Task<int> ProcessDueAsync(
        QizzoneDbContext db,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var dueQuizzes = await db.Quizzes
            .FromSqlInterpolated($"""
                SELECT *
                FROM quizzes
                WHERE (status = 'scheduled' AND opens_at <= {now})
                   OR (status = 'published' AND closes_at IS NOT NULL AND closes_at <= {now})
                ORDER BY COALESCE(opens_at, closes_at), id
                LIMIT 100
                FOR UPDATE SKIP LOCKED
                """)
            .ToListAsync(cancellationToken);

        foreach (var quiz in dueQuizzes)
        {
            if (quiz.Status == "scheduled" && quiz.OpensAt <= now)
            {
                ChangeStatus(db, quiz, "published", quiz.OpensAt ?? now, now);
            }

            if (quiz.Status == "published" && quiz.ClosesAt is not null && quiz.ClosesAt <= now)
            {
                ChangeStatus(db, quiz, "closed", quiz.ClosesAt.Value, now);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return dueQuizzes.Count;
    }

    private static void ChangeStatus(QizzoneDbContext db, Quiz quiz, string status, DateTimeOffset scheduledAt, DateTimeOffset processedAt)
    {
        var previousStatus = quiz.Status;
        quiz.Status = status;
        quiz.UpdatedAt = processedAt;
        db.AuditEvents.Add(new AuditEvent
        {
            Id = Guid.NewGuid(),
            ActorUid = "system:quiz-scheduler",
            Action = "quiz.schedule_transition",
            TargetType = "quiz",
            TargetId = quiz.Id.ToString(),
            DetailsJson = JsonSerializer.Serialize(new
            {
                previousStatus,
                status,
                scheduledAt,
                processedAt,
            }, JsonOptions),
            CreatedAt = processedAt,
        });
    }
}
