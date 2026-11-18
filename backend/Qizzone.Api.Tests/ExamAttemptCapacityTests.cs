using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Qizzone.Api.Data;

namespace Qizzone.Api.Tests;

public sealed class ExamAttemptCapacityTests
{
    [Fact]
    public async Task Start_blocks_a_new_attempt_at_the_limit_but_allows_existing_attempt_resume()
    {
        using var factory = new QizzoneApiFactory();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            db.Profiles.Add(new Profile
            {
                FirebaseUid = "teacher-1",
                Email = "teacher@example.test",
                FullName = "Test Teacher",
                Role = "teacher",
                ActiveRole = "teacher",
                ApprovalStatus = "approved",
                TeacherRequestStatus = "approved",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        using var teacherClient = AuthorizedClient(factory, "teacher-test-token");
        var quizId = await CreatePublishedQuizAsync(teacherClient, "Capacity test");
        using var firstStudentClient = AuthorizedClient(factory, "student-test-token");
        using var secondStudentClient = AuthorizedClient(factory, "other-student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await firstStudentClient.GetAsync("/api/v1/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await secondStudentClient.GetAsync("/api/v1/me")).StatusCode);

        var now = DateTimeOffset.UtcNow;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var seededStudents = Enumerable.Range(0, 19)
                .Select(index => new Profile
                {
                    FirebaseUid = $"capacity-student-{index}",
                    Email = $"capacity-student-{index}@example.test",
                    FullName = $"Capacity Student {index}",
                    CreatedAt = now,
                    UpdatedAt = now,
                })
                .ToArray();
            var existingStudent = await db.Profiles.SingleAsync(item => item.FirebaseUid == "student-1");
            db.Profiles.AddRange(seededStudents);
            db.ExamAttempts.AddRange(seededStudents.Append(existingStudent).Select(profile => new ExamAttempt
            {
                Id = Guid.NewGuid(),
                QuizId = Guid.Parse(quizId),
                StudentUid = profile.FirebaseUid,
                StudentName = profile.FullName,
                StartedAt = now.AddMinutes(-5),
                EndsAt = now.AddMinutes(25),
                DurationMinutes = 30,
                PassPercentage = 50,
                QuestionOrder = [],
                SnapshotJson = "{}",
                OptionOrderJson = "{}",
                FlaggedIdsJson = "[]",
                UpdatedAt = now,
            }));
            await db.SaveChangesAsync();
        }

        using var resumeResponse = await firstStudentClient.PostAsync(
            $"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.OK, resumeResponse.StatusCode);

        using var fullResponse = await secondStudentClient.PostAsync(
            $"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, fullResponse.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(60), fullResponse.Headers.RetryAfter?.Delta);
    }

    [PostgresFact]
    public async Task Start_enforces_global_limit_across_quizzes_and_releases_expired_capacity()
    {
        using var factory = new QizzoneApiFactory();
        using var teacherClient = AuthorizedClient(factory, "teacher-test-token");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            db.Profiles.Add(new Profile
            {
                FirebaseUid = "teacher-1",
                Email = "teacher@example.test",
                FullName = "Test Teacher",
                Role = "teacher",
                ActiveRole = "teacher",
                ApprovalStatus = "approved",
                TeacherRequestStatus = "approved",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var firstQuizId = await CreatePublishedQuizAsync(teacherClient, "Capacity test 1");
        var secondQuizId = await CreatePublishedQuizAsync(teacherClient, "Capacity test 2");
        using var firstStudentClient = AuthorizedClient(factory, "student-test-token");
        using var secondStudentClient = AuthorizedClient(factory, "other-student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await firstStudentClient.GetAsync("/api/v1/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await secondStudentClient.GetAsync("/api/v1/me")).StatusCode);

        var now = DateTimeOffset.UtcNow;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var seededStudents = Enumerable.Range(0, 19)
                .Select(index => new Profile
                {
                    FirebaseUid = $"capacity-student-{index}",
                    Email = $"capacity-student-{index}@example.test",
                    FullName = $"Capacity Student {index}",
                    CreatedAt = now,
                    UpdatedAt = now,
                })
                .ToArray();
            db.Profiles.AddRange(seededStudents);
            db.ExamAttempts.AddRange(seededStudents.Select((profile, index) => new ExamAttempt
            {
                Id = Guid.NewGuid(),
                QuizId = index < 10 ? Guid.Parse(firstQuizId) : Guid.Parse(secondQuizId),
                StudentUid = profile.FirebaseUid,
                StudentName = profile.FullName,
                StartedAt = now.AddMinutes(-5),
                EndsAt = now.AddMinutes(25),
                DurationMinutes = 30,
                PassPercentage = 50,
                QuestionOrder = [],
                SnapshotJson = "{}",
                OptionOrderJson = "{}",
                FlaggedIdsJson = "[]",
                UpdatedAt = now,
            }));
            await db.SaveChangesAsync();
        }

        var startTasks = new[]
        {
            firstStudentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{firstQuizId}", content: null),
            secondStudentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{secondQuizId}", content: null),
        };
        using var firstStartResponse = await startTasks[0];
        using var secondStartResponse = await startTasks[1];
        var startOutcomes = new[]
        {
            (Client: firstStudentClient, QuizId: firstQuizId, Response: firstStartResponse),
            (Client: secondStudentClient, QuizId: secondQuizId, Response: secondStartResponse),
        };
        var createdOutcome = Assert.Single(startOutcomes, outcome => outcome.Response.StatusCode == HttpStatusCode.Created);
        var blockedOutcome = Assert.Single(startOutcomes, outcome => outcome.Response.StatusCode == HttpStatusCode.ServiceUnavailable);
        var blockedResponse = blockedOutcome.Response;
        Assert.Equal(TimeSpan.FromSeconds(60), blockedResponse.Headers.RetryAfter?.Delta);
        var blockedBody = await blockedResponse.Content.ReadAsStringAsync();
        using var blockedProblem = JsonDocument.Parse(blockedBody);
        Assert.Contains("20 lượt thi đồng thời", blockedProblem.RootElement.GetProperty("detail").GetString(), StringComparison.Ordinal);

        using var createdAttempt = JsonDocument.Parse(await createdOutcome.Response.Content.ReadAsStringAsync());
        var createdQuizId = createdAttempt.RootElement.GetProperty("quizId").GetString();
        using var resumedResponse = await createdOutcome.Client.PostAsync(
            $"/api/v1/exam-attempts/quizzes/{createdQuizId}", content: null);
        Assert.Equal(HttpStatusCode.OK, resumedResponse.StatusCode);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var releasedAttempt = await db.ExamAttempts
                .Where(item => item.StudentUid.StartsWith("capacity-student-"))
                .OrderBy(item => item.StartedAt)
                .FirstAsync();
            releasedAttempt.EndsAt = DateTimeOffset.UtcNow.AddSeconds(-1);
            await db.SaveChangesAsync();
        }

        using var retryResponse = await blockedOutcome.Client.PostAsync(
            $"/api/v1/exam-attempts/quizzes/{blockedOutcome.QuizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, retryResponse.StatusCode);
    }

    private static HttpClient AuthorizedClient(QizzoneApiFactory factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<string> CreatePublishedQuizAsync(HttpClient teacherClient, string title)
    {
        var payload = new
        {
            title,
            subject = "Math",
            description = "Capacity test fixture",
            status = "published",
            settings = new
            {
                durationMinutes = 30,
                shuffleQuestions = false,
                shuffleOptions = false,
                allowReview = true,
                maxAttempts = 0,
                passPercentage = 50,
                practiceEnabled = false,
                assignedClasses = Array.Empty<string>(),
                assignedEmails = Array.Empty<string>(),
            },
            questions = new[]
            {
                new
                {
                    content = "What is 1 + 1?",
                    type = "single_choice",
                    options = new[]
                    {
                        new { id = "A", content = "2", images = Array.Empty<string>() },
                        new { id = "B", content = "3", images = Array.Empty<string>() },
                    },
                    correctAnswers = new[] { "A" },
                    explanation = "Add the two values.",
                    points = 1,
                    images = Array.Empty<string>(),
                },
            },
        };
        using var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", payload);
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var created = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = created.RootElement.GetProperty("id").GetString()!;
        using var publishResponse = await teacherClient.PatchAsJsonAsync(
            $"/api/v1/quizzes/{quizId}/status", new { status = "published" });
        Assert.Equal(HttpStatusCode.NoContent, publishResponse.StatusCode);
        return quizId;
    }
}
