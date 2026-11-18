using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Qizzone.Api.Data;

namespace Qizzone.Api.Tests;

public sealed class AiImportApiTests
{
    [Fact]
    public async Task Teacher_can_queue_an_image_job_and_only_the_owner_can_read_it()
    {
        using var factory = new QizzoneApiFactory();
        await SeedProfileAsync(factory, "teacher-1", "teacher");
        await SeedProfileAsync(factory, "other-teacher-1", "teacher");
        using var owner = factory.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");

        const string png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=";
        var response = await owner.PostAsJsonAsync("/api/v1/ai-import-jobs", new
        {
            sourceFileName = "C:\\temp\\exam.png",
            prompt = "Extract visible questions only.",
            idempotencyKey = Guid.NewGuid(),
            imageBase64 = $"data:image/png;base64,{png}",
            operation = "extract",
        });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        using var accepted = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var jobId = accepted.RootElement.GetProperty("jobId").GetGuid();
        Assert.Equal("queued", accepted.RootElement.GetProperty("status").GetString());

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var job = await db.AiImportJobs.SingleAsync(item => item.Id == jobId);
            Assert.Equal("exam.png", job.SourceFileName);
            Assert.Contains("Extract visible questions only.", job.RequestJson);
            Assert.DoesNotContain("data:image", job.RequestJson);
        }

        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-teacher-test-token");
        var foreignJob = await owner.GetAsync($"/api/v1/ai-import-jobs/{jobId}");
        Assert.Equal(HttpStatusCode.NotFound, foreignJob.StatusCode);

        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var ownJob = await owner.GetAsync($"/api/v1/ai-import-jobs/{jobId}");
        Assert.Equal(HttpStatusCode.OK, ownJob.StatusCode);
        using var ownBody = JsonDocument.Parse(await ownJob.Content.ReadAsStringAsync());
        Assert.Equal("queued", ownBody.RootElement.GetProperty("status").GetString());
        Assert.False(ownBody.RootElement.TryGetProperty("prompt", out _));
    }

    [Fact]
    public async Task Ai_import_rejects_invalid_image_signatures_and_non_teacher_accounts()
    {
        using var factory = new QizzoneApiFactory();
        await SeedProfileAsync(factory, "teacher-1", "teacher");
        await SeedProfileAsync(factory, "student-1", "student");
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");

        var invalidImage = await client.PostAsJsonAsync("/api/v1/ai-import-jobs", new
        {
            sourceFileName = "exam.png",
            prompt = "Extract questions.",
            idempotencyKey = Guid.NewGuid(),
            imageBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("<svg onload=alert(1) />")),
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidImage.StatusCode);

        var truncatedPng = await client.PostAsJsonAsync("/api/v1/ai-import-jobs", new
        {
            sourceFileName = "truncated.png",
            prompt = "Extract questions.",
            idempotencyKey = Guid.NewGuid(),
            imageBase64 = Convert.ToBase64String([137, 80, 78, 71, 13, 10, 26, 10]),
        });
        Assert.Equal(HttpStatusCode.BadRequest, truncatedPng.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        var studentRequest = await client.PostAsJsonAsync("/api/v1/ai-import-jobs", new
        {
            sourceFileName = "exam.txt",
            prompt = "Extract questions.",
            idempotencyKey = Guid.NewGuid(),
        });
        Assert.Equal(HttpStatusCode.Forbidden, studentRequest.StatusCode);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Empty(await db.AiImportJobs.ToListAsync());
    }

    [Fact]
    public async Task Idempotent_job_retries_return_the_same_job_without_consuming_quota()
    {
        using var factory = new QizzoneApiFactory();
        await SeedProfileAsync(factory, "teacher-1", "teacher");
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var key = Guid.NewGuid();

        var first = await PostJobAsync(client, key, "Extract this exam.");
        var retry = await PostJobAsync(client, key, "Extract this exam.");
        var reusedKey = await PostJobAsync(client, key, "A different prompt.");

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, reusedKey.StatusCode);
        using var firstBody = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        using var retryBody = JsonDocument.Parse(await retry.Content.ReadAsStringAsync());
        Assert.Equal(firstBody.RootElement.GetProperty("jobId").GetGuid(), retryBody.RootElement.GetProperty("jobId").GetGuid());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Single(await db.AiImportJobs.ToListAsync());
        Assert.Equal(1, (await db.AiRateLimits.SingleAsync()).Requests);
        first.Dispose();
        retry.Dispose();
        reusedKey.Dispose();
    }

    [Fact]
    public async Task Ai_import_quota_returns_429_after_ten_jobs_without_logging_or_returning_payloads()
    {
        using var factory = new QizzoneApiFactory();
        await SeedProfileAsync(factory, "teacher-1", "teacher");
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");

        HttpResponseMessage? finalResponse = null;
        for (var index = 0; index < 11; index++)
        {
            finalResponse?.Dispose();
            finalResponse = await client.PostAsJsonAsync("/api/v1/ai-import-jobs", new
            {
                sourceFileName = $"exam-{index}.txt",
                prompt = "Extract questions.",
                idempotencyKey = Guid.NewGuid(),
            });
            if (index < 10) Assert.Equal(HttpStatusCode.Accepted, finalResponse.StatusCode);
        }
        Assert.NotNull(finalResponse);
        using var lastResponse = finalResponse;
        Assert.Equal(HttpStatusCode.TooManyRequests, lastResponse.StatusCode);
        Assert.DoesNotContain("Extract questions.", await lastResponse.Content.ReadAsStringAsync());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Equal(10, await db.AiImportJobs.CountAsync());
        Assert.Equal(11, (await db.AiRateLimits.SingleAsync()).Requests);
    }

    private static async Task SeedProfileAsync(QizzoneApiFactory factory, string uid, string role)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        db.Profiles.Add(new Profile
        {
            FirebaseUid = uid,
            Email = $"{uid}@example.test",
            FullName = "Test account",
            Role = role,
            ActiveRole = role,
            ApprovalStatus = "approved",
            TeacherRequestStatus = role == "teacher" ? "approved" : "none",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private static Task<HttpResponseMessage> PostJobAsync(HttpClient client, Guid idempotencyKey, string prompt) =>
        client.PostAsJsonAsync("/api/v1/ai-import-jobs", new
        {
            sourceFileName = "exam.txt",
            prompt,
            idempotencyKey,
        });
}
