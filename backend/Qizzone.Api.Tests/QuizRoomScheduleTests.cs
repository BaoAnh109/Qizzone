using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Qizzone.Api.Data;
using Qizzone.Api.Features;

namespace Qizzone.Api.Tests;

public sealed class QuizRoomScheduleTests
{
    [Fact]
    public void Scheduled_room_opens_at_start_and_closes_at_deadline()
    {
        var opensAt = new DateTimeOffset(2026, 11, 18, 9, 0, 0, TimeSpan.Zero);
        var quiz = new Quiz
        {
            TeacherUid = "teacher-1",
            Title = "Scheduled",
            Subject = "English",
            Code = "SCH001",
            Status = "scheduled",
            OpensAt = opensAt,
            ClosesAt = opensAt.AddHours(1),
            CreatedAt = opensAt.AddDays(-1),
            UpdatedAt = opensAt.AddDays(-1),
        };

        Assert.Equal("scheduled", QuizRoomSchedule.GetEffectiveStatus(quiz, opensAt.AddTicks(-1)));
        Assert.False(QuizRoomSchedule.IsOpenForAttempts(quiz, opensAt.AddTicks(-1)));
        Assert.Equal("published", QuizRoomSchedule.GetEffectiveStatus(quiz, opensAt));
        Assert.True(QuizRoomSchedule.IsOpenForAttempts(quiz, opensAt));
        Assert.Equal("closed", QuizRoomSchedule.GetEffectiveStatus(quiz, opensAt.AddHours(1)));
        Assert.False(QuizRoomSchedule.IsOpenForAttempts(quiz, opensAt.AddHours(1)));
    }

    [Fact]
    public void Draft_and_manually_closed_rooms_do_not_open_from_schedule_times()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var status in new[] { "draft", "closed" })
        {
            var quiz = new Quiz
            {
                TeacherUid = "teacher-1",
                Title = status,
                Subject = "English",
                Code = status == "draft" ? "DRF001" : "CLS001",
                Status = status,
                OpensAt = now.AddHours(-1),
                ClosesAt = now.AddHours(1),
                CreatedAt = now,
                UpdatedAt = now,
            };

            Assert.Equal(status, QuizRoomSchedule.GetEffectiveStatus(quiz, now));
            Assert.False(QuizRoomSchedule.IsOpenForAttempts(quiz, now));
        }
    }

    [PostgresFact]
    public async Task Scheduler_persists_due_open_and_close_transitions_with_audit_events()
    {
        using var factory = new QizzoneApiFactory();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        var now = DateTimeOffset.UtcNow;
        var quizId = Guid.NewGuid();
        db.Profiles.Add(new Profile
        {
            FirebaseUid = "schedule-teacher-1",
            Email = "schedule-teacher@example.test",
            FullName = "Schedule Teacher",
            Role = "teacher",
            ActiveRole = "teacher",
            ApprovalStatus = "approved",
            TeacherRequestStatus = "approved",
            CreatedAt = now,
            UpdatedAt = now,
        });
        db.Quizzes.Add(new Quiz
        {
            Id = quizId,
            TeacherUid = "schedule-teacher-1",
            Title = "Due room",
            Subject = "English",
            Code = $"{Guid.NewGuid():N}"[..6].ToUpperInvariant(),
            Status = "scheduled",
            OpensAt = now.AddMinutes(-1),
            ClosesAt = now.AddHours(1),
            CreatedAt = now.AddDays(-1),
            UpdatedAt = now.AddDays(-1),
        });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        Assert.Equal(1, await QuizScheduleService.ProcessDueAsync(db, now));
        var opened = await db.Quizzes.SingleAsync(item => item.Id == quizId);
        Assert.Equal("published", opened.Status);

        opened.ClosesAt = now.AddSeconds(-30);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        Assert.Equal(1, await QuizScheduleService.ProcessDueAsync(db, now));
        var closed = await db.Quizzes.SingleAsync(item => item.Id == quizId);
        Assert.Equal("closed", closed.Status);
        Assert.Equal(2, await db.AuditEvents.CountAsync(item =>
            item.TargetType == "quiz" && item.TargetId == quizId.ToString() && item.Action == "quiz.schedule_transition"));
    }
}
