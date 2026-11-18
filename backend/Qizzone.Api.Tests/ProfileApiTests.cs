using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Json;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Qizzone.Api.Authentication;
using Qizzone.Api.Data;
using Qizzone.Api.Features;

namespace Qizzone.Api.Tests;

public sealed class ProfileApiTests
{
    [Fact]
    public async Task Authenticated_first_login_creates_a_student_profile()
    {
        using var factory = new QizzoneApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "valid-test-token");

        var response = await client.GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("student", body.RootElement.GetProperty("role").GetString());
        Assert.Equal("approved", body.RootElement.GetProperty("approvalStatus").GetString());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        var profile = await db.Profiles.SingleAsync();
        Assert.Equal("firebase-user-1", profile.FirebaseUid);
        Assert.Equal("student@example.test", profile.Email);
        Assert.Equal("student", profile.Role);
    }

    [Fact]
    public async Task Configured_admin_uid_requires_verified_email_and_is_audited_on_first_profile_creation()
    {
        using var factory = new QizzoneApiFactory(configureBootstrapAdmin: true);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "unverified-bootstrap-admin-test-token");

        var unverifiedResponse = await client.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.OK, unverifiedResponse.StatusCode);
        using (var unverifiedBody = JsonDocument.Parse(await unverifiedResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal("student", unverifiedBody.RootElement.GetProperty("role").GetString());
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "bootstrap-admin-test-token");
        var verifiedResponse = await client.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.OK, verifiedResponse.StatusCode);
        using var body = JsonDocument.Parse(await verifiedResponse.Content.ReadAsStringAsync());
        Assert.Equal("admin", body.RootElement.GetProperty("role").GetString());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Contains(await db.AuditEvents.ToListAsync(), item => item.Action == "admin.bootstrap_completed");
    }

    [Fact]
    public async Task Invalid_firebase_token_is_rejected()
    {
        using var factory = new QizzoneApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "invalid-test-token");

        var response = await client.GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Unverified_firebase_email_can_bootstrap_profile_but_cannot_use_quiz_api()
    {
        using var factory = new QizzoneApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "unverified-test-token");

        var profileResponse = await client.GetAsync("/api/v1/me");
        var quizResponse = await client.GetAsync("/api/v1/quizzes");

        Assert.Equal(HttpStatusCode.OK, profileResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, quizResponse.StatusCode);
    }

    [Fact]
    public async Task Teacher_capability_is_derived_from_the_database_profile()
    {
        using var factory = new QizzoneApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        db.Profiles.Add(CreateProfile(teacherRequestStatus: "pending"));
        await db.SaveChangesAsync();
        var transformation = scope.ServiceProvider.GetRequiredService<IClaimsTransformation>();

        var pendingClaims = await transformation.TransformAsync(CreatePrincipal());
        Assert.Contains(pendingClaims.FindAll("qizzone:role"), claim => claim.Value == "student");
        Assert.DoesNotContain(pendingClaims.FindAll("qizzone:role"), claim => claim.Value == "teacher");

        var profile = await db.Profiles.SingleAsync();
        profile.TeacherRequestStatus = "approved";
        await db.SaveChangesAsync();

        var approvedClaims = await transformation.TransformAsync(CreatePrincipal());
        Assert.Contains(approvedClaims.FindAll("qizzone:role"), claim => claim.Value == "teacher");
    }

    [Fact]
    public async Task Teacher_request_is_persisted_and_blocked_requests_are_denied()
    {
        using var factory = new QizzoneApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "valid-test-token");
        await client.GetAsync("/api/v1/me");

        var firstRequest = await client.PostAsync("/api/v1/teacher-requests", content: null);
        Assert.Equal(HttpStatusCode.Accepted, firstRequest.StatusCode);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var profile = await db.Profiles.SingleAsync();
            Assert.Equal("pending", profile.TeacherRequestStatus);
            profile.TeacherRequestBlocked = true;
            await db.SaveChangesAsync();
        }

        var blockedRequest = await client.PostAsync("/api/v1/teacher-requests", content: null);
        Assert.Equal(HttpStatusCode.Conflict, blockedRequest.StatusCode);
    }

    [Fact]
    public async Task Approved_student_can_switch_active_role_without_changing_database_capabilities()
    {
        using var factory = new QizzoneApiFactory();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var profile = CreateProfile("approved");
            profile.TeacherRequestStatus = "approved";
            await db.Profiles.AddAsync(profile);
            await db.SaveChangesAsync();
        }

        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "valid-test-token");
        var teacherResponse = await client.PostAsJsonAsync("/api/v1/me/role", new { role = "teacher" });

        Assert.Equal(HttpStatusCode.OK, teacherResponse.StatusCode);
        using var teacherBody = JsonDocument.Parse(await teacherResponse.Content.ReadAsStringAsync());
        Assert.Equal("teacher", teacherBody.RootElement.GetProperty("activeRole").GetString());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var profile = await db.Profiles.SingleAsync();
            Assert.Equal("student", profile.Role);
            Assert.Equal("teacher", profile.ActiveRole);
        }

        var studentResponse = await client.PostAsJsonAsync("/api/v1/me/role", new { role = "student" });
        Assert.Equal(HttpStatusCode.OK, studentResponse.StatusCode);
        using var studentBody = JsonDocument.Parse(await studentResponse.Content.ReadAsStringAsync());
        Assert.Equal("student", studentBody.RootElement.GetProperty("activeRole").GetString());
    }

    [Fact]
    public async Task Admin_can_approve_teacher_access_and_students_cannot_use_admin_endpoints()
    {
        using var factory = new QizzoneApiFactory();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var admin = CreateProfile("none");
            admin.FirebaseUid = "admin-1";
            admin.Email = "admin@example.test";
            admin.FullName = "Test Admin";
            admin.Role = "admin";
            admin.ActiveRole = "admin";
            var student = CreateProfile("pending");
            student.FirebaseUid = "student-1";
            student.Email = "student@example.test";
            var teacher = CreateProfile("approved");
            teacher.FirebaseUid = "teacher-1";
            teacher.Email = "teacher@example.test";
            teacher.FullName = "Test Teacher";
            teacher.Role = "teacher";
            teacher.ActiveRole = "teacher";
            teacher.TeacherRequestStatus = "approved";
            var quiz = new Quiz
            {
                Id = Guid.NewGuid(),
                TeacherUid = "teacher-1",
                Title = "Teacher account quiz",
                Subject = "Math",
                Code = "QZTEST",
                Status = "published",
                SettingsJson = "{}",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            var submittedAttempt = new ExamAttempt
            {
                Id = Guid.NewGuid(),
                QuizId = quiz.Id,
                StudentUid = "teacher-1",
                StudentName = "Test Teacher",
                StartedAt = DateTimeOffset.UtcNow,
                SubmittedAt = DateTimeOffset.UtcNow,
            };
            db.Profiles.AddRange(admin, student, teacher);
            db.Quizzes.Add(quiz);
            db.ExamAttempts.Add(submittedAttempt);
            await db.SaveChangesAsync();
        }

        using var adminClient = factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "admin-test-token");
        var requestList = await adminClient.GetAsync("/api/v1/admin/teacher-requests");
        Assert.Equal(HttpStatusCode.OK, requestList.StatusCode);
        using var requestListBody = JsonDocument.Parse(await requestList.Content.ReadAsStringAsync());
        Assert.Equal("student-1", requestListBody.RootElement.GetProperty("requests")[0].GetProperty("firebaseUid").GetString());

        var accountsResponse = await adminClient.GetAsync("/api/v1/admin/accounts?role=teacher");
        Assert.Equal(HttpStatusCode.OK, accountsResponse.StatusCode);
        using (var accountsBody = JsonDocument.Parse(await accountsResponse.Content.ReadAsStringAsync()))
        {
            var teacherAccount = Assert.Single(accountsBody.RootElement.GetProperty("accounts").EnumerateArray());
            Assert.Equal(1, teacherAccount.GetProperty("quizCount").GetInt32());
            Assert.Equal(1, teacherAccount.GetProperty("submissionCount").GetInt32());
        }

        var approveResponse = await adminClient.PatchAsJsonAsync("/api/v1/admin/teacher-requests/student-1", new { action = "approve" });
        Assert.Equal(HttpStatusCode.OK, approveResponse.StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            Assert.Equal("approved", (await db.Profiles.SingleAsync(item => item.FirebaseUid == "student-1")).TeacherRequestStatus);
            Assert.Contains(await db.AuditEvents.ToListAsync(), item => item.Action == "approve");
        }

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.Forbidden, (await studentClient.GetAsync("/api/v1/admin/teacher-requests")).StatusCode);
    }

    [Fact]
    public async Task Teacher_can_create_quiz_and_students_never_receive_answer_keys_from_quiz_reads()
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

        var write = CreateQuizPayload();
        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", write);

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var createdBody = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = createdBody.RootElement.GetProperty("id").GetString();
        Assert.Equal("teacher-1", createdBody.RootElement.GetProperty("teacherId").GetString());
        Assert.Equal("A", createdBody.RootElement.GetProperty("questions")[0].GetProperty("correctAnswers")[0].GetString());

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        var bootstrapResponse = await studentClient.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.OK, bootstrapResponse.StatusCode);
        var listResponse = await studentClient.GetAsync("/api/v1/quizzes");

        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listBody = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var studentQuiz = Assert.Single(listBody.RootElement.EnumerateArray());
        Assert.Equal(0, studentQuiz.GetProperty("questions")[0].GetProperty("correctAnswers").GetArrayLength());
        Assert.Equal(0, studentQuiz.GetProperty("settings").GetProperty("assignedEmails").GetArrayLength());

        using var forbiddenResponse = await studentClient.PostAsJsonAsync("/api/v1/quizzes", write);
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenResponse.StatusCode);

        using var teacherRead = await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}");
        using var teacherReadBody = JsonDocument.Parse(await teacherRead.Content.ReadAsStringAsync());
        Assert.Equal("A", teacherReadBody.RootElement.GetProperty("questions")[0].GetProperty("correctAnswers")[0].GetString());
    }

    [Fact]
    public async Task Quiz_validation_rejects_null_items_and_media_owned_by_another_user()
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

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");

        var nullQuestion = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", new
        {
            title = "Null question",
            subject = "Math",
            settings = new { durationMinutes = 30, passPercentage = 50 },
            questions = new object?[] { null },
        });
        Assert.Equal(HttpStatusCode.BadRequest, nullQuestion.StatusCode);

        var foreignMedia = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        foreignMedia["questions"]![0]!["images"] = new JsonArray("storage://qizzone-question-media/another-user/question.png");
        var foreignMediaResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", foreignMedia);
        Assert.Equal(HttpStatusCode.BadRequest, foreignMediaResponse.StatusCode);

        var ownedMedia = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        ownedMedia["questions"]![0]!["images"] = new JsonArray("storage://qizzone-question-media/teacher-1/question.png");
        var ownedMediaResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", ownedMedia);
        Assert.Equal(HttpStatusCode.Created, ownedMediaResponse.StatusCode);
    }

    [Fact]
    public async Task Exam_attempt_uses_server_timer_revisioned_saves_and_server_grading()
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

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var created = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = created.RootElement.GetProperty("id").GetString();

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        await studentClient.GetAsync("/api/v1/me");

        var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var startBody = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = startBody.RootElement.GetProperty("id").GetString();
        var question = startBody.RootElement.GetProperty("questions")[0];
        var questionId = question.GetProperty("id").GetString()!;
        Assert.Equal(0, startBody.RootElement.GetProperty("revision").GetInt32());
        Assert.DoesNotContain("correctAnswers", question.EnumerateObject().Select(property => property.Name));
        Assert.InRange(
            startBody.RootElement.GetProperty("endsAt").GetDateTimeOffset(),
            DateTimeOffset.UtcNow.AddMinutes(29),
            DateTimeOffset.UtcNow.AddMinutes(31));

        var resumedResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.OK, resumedResponse.StatusCode);
        using var resumedBody = JsonDocument.Parse(await resumedResponse.Content.ReadAsStringAsync());
        Assert.Equal(attemptId, resumedBody.RootElement.GetProperty("id").GetString());

        var answers = new Dictionary<string, string[]> { [questionId] = ["A"] };
        var mutationId = Guid.NewGuid();
        var writerSessionId = Guid.NewGuid().ToString();
        HttpRequestMessage AutosaveRequest(int revision, string[] flags) => new(HttpMethod.Put,
            $"/api/v1/exam-attempts/{attemptId}/autosave")
        {
            Content = JsonContent.Create(new
            {
                revision,
                answers,
                flaggedQuestionIds = flags,
                currentQuestionIndex = 0,
                mutationId,
                clientSequence = 1,
                writerSessionId,
            }),
            Headers = { { "Idempotency-Key", mutationId.ToString() } },
        };

        using var staleSaveRequest = AutosaveRequest(1, []);
        var staleSave = await studentClient.SendAsync(staleSaveRequest);
        Assert.Equal(HttpStatusCode.Conflict, staleSave.StatusCode);

        using var firstSaveRequest = AutosaveRequest(0, [questionId]);
        using var duplicateSaveRequest = AutosaveRequest(0, [questionId]);
        var saveResponses = await Task.WhenAll(
            studentClient.SendAsync(firstSaveRequest),
            studentClient.SendAsync(duplicateSaveRequest));
        Assert.All(saveResponses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        using var savedBody = JsonDocument.Parse(await saveResponses[0].Content.ReadAsStringAsync());
        Assert.Equal(1, savedBody.RootElement.GetProperty("revision").GetInt32());
        Assert.Equal(mutationId.ToString(), savedBody.RootElement.GetProperty("mutationId").GetString());

        var repeatedSave = await studentClient.SendAsync(AutosaveRequest(0, [questionId]));
        Assert.Equal(HttpStatusCode.OK, repeatedSave.StatusCode);
        using var repeatedBody = JsonDocument.Parse(await repeatedSave.Content.ReadAsStringAsync());
        Assert.Equal(1, repeatedBody.RootElement.GetProperty("revision").GetInt32());
        Assert.Equal(mutationId.ToString(), repeatedBody.RootElement.GetProperty("mutationId").GetString());

        using var mismatchedRetry = AutosaveRequest(0, []);
        var mismatchedResponse = await studentClient.SendAsync(mismatchedRetry);
        Assert.Equal(HttpStatusCode.Conflict, mismatchedResponse.StatusCode);

        var submitResponses = await Task.WhenAll(Enumerable.Range(0, 100)
            .Select(_ => studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null)));
        var submissionOutcomes = await Task.WhenAll(submitResponses.Select(async response => new
        {
            response.StatusCode,
            Body = await response.Content.ReadAsStringAsync(),
        }));
        Assert.All(submissionOutcomes, outcome => Assert.True(outcome.StatusCode == HttpStatusCode.OK, outcome.Body));
        var resultJson = await submitResponses[0].Content.ReadAsStringAsync();
        using var resultBody = JsonDocument.Parse(resultJson);
        Assert.True(resultBody.RootElement.TryGetProperty("percentage", out _), resultJson);
        Assert.Equal(100, resultBody.RootElement.GetProperty("percentage").GetDecimal());
        Assert.True(resultBody.RootElement.GetProperty("isPassed").GetBoolean());
        Assert.Single(resultBody.RootElement.GetProperty("details").EnumerateArray());

        var repeatedSubmit = await studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null);
        Assert.Equal(HttpStatusCode.OK, repeatedSubmit.StatusCode);
        var exhaustedAttempt = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Conflict, exhaustedAttempt.StatusCode);
    }

    [PostgresFact]
    public async Task Exam_submission_is_idempotent_across_independent_api_hosts()
    {
        using var firstFactory = new QizzoneApiFactory();
        using var secondFactory = new QizzoneApiFactory(
            postgresSchema: firstFactory.PostgresSchema,
            createPostgresSchema: false,
            migratePostgres: false);

        using var teacherClient = firstFactory.CreateClient();
        Assert.NotSame(
            firstFactory.Services.GetRequiredService<ExamAttemptGateStore>(),
            secondFactory.Services.GetRequiredService<ExamAttemptGateStore>());

        using (var scope = firstFactory.Services.CreateScope())
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

        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var created = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = created.RootElement.GetProperty("id").GetString();

        using var firstStudentClient = firstFactory.CreateClient();
        using var secondStudentClient = secondFactory.CreateClient();
        firstStudentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        secondStudentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await firstStudentClient.GetAsync("/api/v1/me")).StatusCode);

        var startResponse = await firstStudentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var started = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = started.RootElement.GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await secondStudentClient.GetAsync("/api/v1/me")).StatusCode);

        var submitResponses = await Task.WhenAll(Enumerable.Range(0, 100)
            .Select(index => (index % 2 == 0 ? firstStudentClient : secondStudentClient)
                .PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null)));
        var outcomes = await Task.WhenAll(submitResponses.Select(async response => new
        {
            response.StatusCode,
            Body = await response.Content.ReadAsStringAsync(),
        }));
        Assert.All(outcomes, outcome => Assert.True(outcome.StatusCode == HttpStatusCode.OK, outcome.Body));

        var resultIds = outcomes.Select(outcome =>
        {
            using var body = JsonDocument.Parse(outcome.Body);
            return body.RootElement.GetProperty("id").GetString();
        }).Distinct().ToArray();
        Assert.Single(resultIds);

        using var verificationScope = firstFactory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        var attemptGuid = Guid.Parse(attemptId);
        Assert.Equal(1, await verificationDb.ExamResults.CountAsync(item => item.AttemptId == attemptGuid));
        Assert.Equal(1, await verificationDb.AuditEvents.CountAsync(item => item.Action == "exam.submitted"));
        var submittedAttempt = await verificationDb.ExamAttempts.SingleAsync(item => item.Id == attemptGuid);
        Assert.Equal(1, submittedAttempt.Revision);
        Assert.NotNull(submittedAttempt.SubmittedAt);
    }

    [PostgresFact]
    public async Task Quiz_reports_are_owner_scoped_paged_filterable_and_aggregated()
    {
        using var factory = new QizzoneApiFactory();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            db.Profiles.AddRange(
                new Profile
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
                },
                new Profile
                {
                    FirebaseUid = "other-teacher-1",
                    Email = "other-teacher@example.test",
                    FullName = "Other Test Teacher",
                    Role = "teacher",
                    ActiveRole = "teacher",
                    ApprovalStatus = "approved",
                    TeacherRequestStatus = "approved",
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            await db.SaveChangesAsync();
        }

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var createQuizResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, createQuizResponse.StatusCode);
        using var createdQuiz = JsonDocument.Parse(await createQuizResponse.Content.ReadAsStringAsync());
        var quizId = createdQuiz.RootElement.GetProperty("id").GetString()!;

        await SubmitQuizResultAsync("student-test-token", "A");
        await SubmitQuizResultAsync("other-student-test-token", "B");

        var reportResponse = await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}/reports?page=1&pageSize=1&sortBy=score_desc");
        Assert.Equal(HttpStatusCode.OK, reportResponse.StatusCode);
        using var report = JsonDocument.Parse(await reportResponse.Content.ReadAsStringAsync());
        var reportRoot = report.RootElement;
        Assert.Equal(2, reportRoot.GetProperty("totalItems").GetInt32());
        Assert.Equal(2, reportRoot.GetProperty("totalPages").GetInt32());
        Assert.Single(reportRoot.GetProperty("items").EnumerateArray());
        Assert.Equal(10m, reportRoot.GetProperty("items")[0].GetProperty("score").GetDecimal());
        var summary = reportRoot.GetProperty("summary");
        Assert.Equal(2, summary.GetProperty("totalSubmissions").GetInt32());
        Assert.Equal(2, summary.GetProperty("gradedSubmissions").GetInt32());
        Assert.Equal(5m, summary.GetProperty("averageScore").GetDecimal());
        Assert.Equal(10m, summary.GetProperty("maxScore").GetDecimal());
        Assert.Equal(0m, summary.GetProperty("minScore").GetDecimal());
        Assert.Equal(1, summary.GetProperty("passedCount").GetInt32());
        Assert.Equal(50m, summary.GetProperty("passRate").GetDecimal());
        var question = Assert.Single(reportRoot.GetProperty("questionAnalytics").EnumerateArray());
        Assert.Equal(2, question.GetProperty("attemptCount").GetInt32());
        Assert.Equal(2, question.GetProperty("answeredCount").GetInt32());
        Assert.Equal(1, question.GetProperty("correctCount").GetInt32());
        Assert.Equal(1, question.GetProperty("optionCounts").GetProperty("A").GetInt32());
        Assert.Equal(1, question.GetProperty("optionCounts").GetProperty("B").GetInt32());

        var filteredResponse = await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}/reports?search=Other&status=failed&pageSize=10");
        Assert.Equal(HttpStatusCode.OK, filteredResponse.StatusCode);
        using var filteredReport = JsonDocument.Parse(await filteredResponse.Content.ReadAsStringAsync());
        var filteredItem = Assert.Single(filteredReport.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("Other Test Student", filteredItem.GetProperty("studentName").GetString());
        Assert.Equal(0m, filteredItem.GetProperty("score").GetDecimal());

        using var nonOwnerClient = factory.CreateClient();
        nonOwnerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-teacher-test-token");
        Assert.Equal(HttpStatusCode.NotFound,
            (await nonOwnerClient.GetAsync($"/api/v1/quizzes/{quizId}/reports")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}/reports?page=0")).StatusCode);

        async Task SubmitQuizResultAsync(string studentToken, string answer)
        {
            using var studentClient = factory.CreateClient();
            studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", studentToken);
            Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
            var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
            Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
            using var attemptBody = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
            var attemptId = attemptBody.RootElement.GetProperty("id").GetString();
            var questionId = attemptBody.RootElement.GetProperty("questions")[0].GetProperty("id").GetString()!;
            var mutationId = Guid.NewGuid();
            using var saveRequest = new HttpRequestMessage(HttpMethod.Put,
                $"/api/v1/exam-attempts/{attemptId}/autosave")
            {
                Content = JsonContent.Create(new
                {
                    revision = 0,
                    answers = new Dictionary<string, string[]> { [questionId] = [answer] },
                    flaggedQuestionIds = Array.Empty<string>(),
                    currentQuestionIndex = 0,
                    mutationId,
                    clientSequence = 1,
                    writerSessionId = Guid.NewGuid().ToString(),
                }),
            };
            saveRequest.Headers.Add("Idempotency-Key", mutationId.ToString());
            Assert.Equal(HttpStatusCode.OK, (await studentClient.SendAsync(saveRequest)).StatusCode);
            Assert.Equal(HttpStatusCode.OK,
                (await studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null)).StatusCode);
        }
    }

    [Fact]
    public async Task Practice_session_checks_answers_once_hides_question_keys_and_supports_wrong_answer_retry()
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

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var quizResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, quizResponse.StatusCode);
        using var quizBody = JsonDocument.Parse(await quizResponse.Content.ReadAsStringAsync());
        var quizId = quizBody.RootElement.GetProperty("id").GetString();

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        var startResponse = await studentClient.PostAsJsonAsync("/api/v1/practice-sessions/", new
        {
            quizId,
            questionCount = (int?)null,
            showExplanation = true,
        });
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var startBody = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var sessionId = startBody.RootElement.GetProperty("id").GetString();
        var questionId = startBody.RootElement.GetProperty("questionOrder")[0].GetString();

        var openResponse = await studentClient.GetAsync($"/api/v1/practice-sessions/{sessionId}");
        Assert.Equal(HttpStatusCode.OK, openResponse.StatusCode);
        using (var openBody = JsonDocument.Parse(await openResponse.Content.ReadAsStringAsync()))
        {
            var question = Assert.Single(openBody.RootElement.GetProperty("questions").EnumerateArray());
            Assert.DoesNotContain("correctAnswers", question.EnumerateObject().Select(property => property.Name));
        }

        var firstCheck = await studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{sessionId}/answers/{questionId}", new { selectedAnswers = new[] { "B" } });
        Assert.Equal(HttpStatusCode.OK, firstCheck.StatusCode);
        using (var answerBody = JsonDocument.Parse(await firstCheck.Content.ReadAsStringAsync()))
        {
            Assert.False(answerBody.RootElement.GetProperty("isCorrect").GetBoolean());
            Assert.Equal("A", answerBody.RootElement.GetProperty("correctAnswers")[0].GetString());
        }

        // A retry with a different payload must return the immutable first check.
        var duplicateCheck = await studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{sessionId}/answers/{questionId}", new { selectedAnswers = new[] { "A" } });
        using (var duplicateBody = JsonDocument.Parse(await duplicateCheck.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, duplicateCheck.StatusCode);
            Assert.False(duplicateBody.RootElement.GetProperty("isCorrect").GetBoolean());
            Assert.Equal("B", duplicateBody.RootElement.GetProperty("selectedAnswers")[0].GetString());
        }

        var finishResponse = await studentClient.PostAsync($"/api/v1/practice-sessions/{sessionId}/finish", content: null);
        Assert.Equal(HttpStatusCode.OK, finishResponse.StatusCode);
        using (var finishBody = JsonDocument.Parse(await finishResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(0, finishBody.RootElement.GetProperty("percentage").GetDecimal());
            Assert.Equal(1, finishBody.RootElement.GetProperty("incorrectCount").GetInt32());
            Assert.Equal(0, finishBody.RootElement.GetProperty("skippedCount").GetInt32());
        }

        var retryResponse = await studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{sessionId}/retry", new { mode = "wrong" });
        Assert.Equal(HttpStatusCode.Created, retryResponse.StatusCode);
        using var retryBody = JsonDocument.Parse(await retryResponse.Content.ReadAsStringAsync());
        var retrySessionId = retryBody.RootElement.GetProperty("id").GetString();
        var retryQuestionId = retryBody.RootElement.GetProperty("questionOrder")[0].GetString();
        Assert.Equal(questionId, retryQuestionId);

        var retryCheck = await studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{retrySessionId}/answers/{retryQuestionId}", new { selectedAnswers = new[] { "A" } });
        using (var retryAnswerBody = JsonDocument.Parse(await retryCheck.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, retryCheck.StatusCode);
            Assert.True(retryAnswerBody.RootElement.GetProperty("isCorrect").GetBoolean());
        }

        var historyResponse = await studentClient.GetAsync("/api/v1/practice-sessions/history");
        using (var historyBody = JsonDocument.Parse(await historyResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(HttpStatusCode.OK, historyResponse.StatusCode);
            Assert.Equal(2, historyBody.RootElement.GetArrayLength());
        }

        using var otherStudentClient = factory.CreateClient();
        otherStudentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await otherStudentClient.GetAsync("/api/v1/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await otherStudentClient.GetAsync($"/api/v1/practice-sessions/{sessionId}")).StatusCode);
    }

    [Fact]
    public async Task Teacher_can_read_owned_quiz_results_while_student_review_setting_is_respected()
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

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var payload = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        payload["settings"]!["allowReview"] = false;
        var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", payload);
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var quizBody = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = quizBody.RootElement.GetProperty("id").GetString();

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        await studentClient.GetAsync("/api/v1/me");
        var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var startBody = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = startBody.RootElement.GetProperty("id").GetString();
        var questionId = startBody.RootElement.GetProperty("questions")[0].GetProperty("id").GetString()!;

        var mutationId = Guid.NewGuid();
        using var saveRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/exam-attempts/{attemptId}/autosave")
        {
            Content = JsonContent.Create(new
            {
                revision = 0,
                answers = new Dictionary<string, string[]> { [questionId] = ["A"] },
                flaggedQuestionIds = Array.Empty<string>(),
                currentQuestionIndex = 0,
                mutationId,
                clientSequence = 1,
                writerSessionId = Guid.NewGuid().ToString(),
            }),
        };
        saveRequest.Headers.Add("Idempotency-Key", mutationId.ToString());
        var saveResponse = await studentClient.SendAsync(saveRequest);
        Assert.Equal(HttpStatusCode.OK, saveResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null)).StatusCode);

        var studentResultsResponse = await studentClient.GetAsync("/api/v1/exam-attempts/results");
        Assert.Equal(HttpStatusCode.OK, studentResultsResponse.StatusCode);
        using (var studentResults = JsonDocument.Parse(await studentResultsResponse.Content.ReadAsStringAsync()))
        {
            var result = Assert.Single(studentResults.RootElement.EnumerateArray());
            Assert.Equal(0, result.GetProperty("details").GetArrayLength());
        }

        var teacherResultsResponse = await teacherClient.GetAsync("/api/v1/exam-attempts/results");
        Assert.Equal(HttpStatusCode.OK, teacherResultsResponse.StatusCode);
        using var teacherResults = JsonDocument.Parse(await teacherResultsResponse.Content.ReadAsStringAsync());
        var teacherResult = Assert.Single(teacherResults.RootElement.EnumerateArray());
        Assert.Single(teacherResult.GetProperty("details").EnumerateArray());
    }

    private static object CreateQuizPayload() => new
    {
        title = "Secure quiz",
        subject = "Math",
        description = "Created through the API",
        teacherId = "forged-client-value",
        status = "published",
        settings = new
        {
            durationMinutes = 30,
            shuffleQuestions = false,
            shuffleOptions = false,
            allowReview = true,
            maxAttempts = 1,
            passPercentage = 50,
            practiceEnabled = true,
            assignedClasses = Array.Empty<string>(),
            assignedEmails = new[] { "private-student@example.test" },
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

    private static ClaimsPrincipal CreatePrincipal() => new(
        new ClaimsIdentity([new Claim("firebase:uid", "firebase-user-1")], "FirebaseBearer"));

    private static Profile CreateProfile(string teacherRequestStatus) => new()
    {
        FirebaseUid = "firebase-user-1",
        Email = "student@example.test",
        FullName = "Test Student",
        Role = "student",
        ApprovalStatus = "approved",
        TeacherRequestStatus = teacherRequestStatus,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };
}

internal sealed class QizzoneApiFactory(
    bool configureBootstrapAdmin = false,
    string? postgresSchema = null,
    bool createPostgresSchema = true,
    bool migratePostgres = true) : WebApplicationFactory<Program>
{
    private readonly string _databaseName = $"qizzone-tests-{Guid.NewGuid():N}";
    private readonly string? _postgresConnectionString = Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES");
    private readonly string _postgresSchema = postgresSchema ?? $"qizzone_test_{Guid.NewGuid():N}";

    internal string PostgresSchema => _postgresSchema;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (configureBootstrapAdmin)
        {
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Admin:BootstrapUids:0"] = "bootstrap-admin-1",
            }));
        }

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<QizzoneDbContext>>();
            services.RemoveAll<QizzoneDbContext>();
            services.RemoveAll<IDbContextOptionsConfiguration<QizzoneDbContext>>();
            if (!string.IsNullOrWhiteSpace(_postgresConnectionString))
            {
                if (createPostgresSchema)
                {
                    using var connection = new NpgsqlConnection(_postgresConnectionString);
                    connection.Open();
                    using var createSchema = new NpgsqlCommand($"CREATE SCHEMA \"{_postgresSchema}\"", connection);
                    createSchema.ExecuteNonQuery();
                }

                var schemaConnectionString = new NpgsqlConnectionStringBuilder(_postgresConnectionString)
                {
                    SearchPath = _postgresSchema,
                    MaxPoolSize = 32,
                }.ConnectionString;
                services.AddDbContext<QizzoneDbContext>(options => options.UseNpgsql(schemaConnectionString));
                if (migratePostgres) services.AddHostedService<PostgresTestDatabaseMigrator>();
            }
            else
            {
                services.AddDbContext<QizzoneDbContext>(options => options.UseInMemoryDatabase(_databaseName));
            }
            services.RemoveAll<IFirebaseTokenVerifier>();
            services.AddSingleton<IFirebaseTokenVerifier, TestFirebaseTokenVerifier>();
        });
    }
}

internal sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES")))
        {
            Skip = "This integration test requires QIZZONE_TEST_POSTGRES; CI runs it against PostgreSQL.";
        }
    }
}

internal sealed class PostgresTestDatabaseMigrator(IServiceScopeFactory serviceScopeFactory) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = serviceScopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        await db.Database.MigrateAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

internal sealed class TestFirebaseTokenVerifier : IFirebaseTokenVerifier
{
    public Task<FirebaseIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        if (idToken == "invalid-test-token")
        {
            throw new ArgumentException("Invalid test token.");
        }

        if (idToken == "teacher-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "teacher-1",
                "teacher@example.test",
                "Test Teacher",
                EmailVerified: true));
        }

        if (idToken == "other-teacher-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "other-teacher-1",
                "other-teacher@example.test",
                "Other Test Teacher",
                EmailVerified: true));
        }

        if (idToken == "admin-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "admin-1",
                "admin@example.test",
                "Test Admin",
                EmailVerified: true));
        }

        if (idToken == "bootstrap-admin-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "bootstrap-admin-1",
                "bootstrap-admin@example.test",
                "Bootstrap Admin",
                EmailVerified: true));
        }

        if (idToken == "unverified-bootstrap-admin-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "bootstrap-admin-1",
                "bootstrap-admin@example.test",
                "Bootstrap Admin",
                EmailVerified: false));
        }

        if (idToken == "student-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "student-1",
                "student@example.test",
                "Test Student",
                EmailVerified: true));
        }

        if (idToken == "other-student-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "other-student-1",
                "other-student@example.test",
                "Other Test Student",
                EmailVerified: true));
        }

        if (idToken == "unverified-test-token")
        {
            return Task.FromResult(new FirebaseIdentity(
                "unverified-user-1",
                "unverified@example.test",
                "Unverified User",
                EmailVerified: false));
        }

        return Task.FromResult(new FirebaseIdentity(
            "firebase-user-1",
            "student@example.test",
            "Test Student",
            EmailVerified: true));
    }
}
