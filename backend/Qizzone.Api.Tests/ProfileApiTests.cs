using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
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
        Assert.Equal(HttpStatusCode.Forbidden, (await studentClient.PatchAsJsonAsync(
            "/api/v1/admin/teacher-requests/student-1", new { action = "reject" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await studentClient.PatchAsJsonAsync(
            "/api/v1/admin/accounts/student-1/access", new { isBlocked = true })).StatusCode);

        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        Assert.Equal(HttpStatusCode.Forbidden, (await teacherClient.GetAsync("/api/v1/admin/accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await teacherClient.PatchAsJsonAsync(
            "/api/v1/admin/teacher-requests/student-1", new { action = "approve" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await teacherClient.PatchAsJsonAsync(
            "/api/v1/admin/accounts/student-1/access", new { isBlocked = true })).StatusCode);
    }

    [Fact]
    public async Task Admin_teacher_request_list_paginates_with_a_stable_order()
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
            db.Profiles.Add(admin);

            var requestedAtBase = DateTimeOffset.UtcNow.AddDays(-1);
            for (var index = 0; index < 27; index++)
            {
                var profile = CreateProfile("pending");
                profile.FirebaseUid = $"student-{index:D2}";
                profile.Email = $"student-{index:D2}@example.test";
                profile.FullName = $"Student {index:D2}";
                profile.TeacherRequestedAt = requestedAtBase.AddMinutes(index);
                db.Profiles.Add(profile);
            }

            await db.SaveChangesAsync();
        }

        using var adminClient = factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "admin-test-token");
        var response = await adminClient.GetAsync("/api/v1/admin/teacher-requests?page=2&pageSize=10");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        Assert.Equal(2, root.GetProperty("page").GetInt32());
        Assert.Equal(10, root.GetProperty("pageSize").GetInt32());
        Assert.Equal(27, root.GetProperty("totalItems").GetInt32());
        Assert.Equal(3, root.GetProperty("totalPages").GetInt32());
        var requests = root.GetProperty("requests").EnumerateArray().ToArray();
        Assert.Equal(10, requests.Length);
        Assert.Equal("student-10", requests[0].GetProperty("firebaseUid").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await adminClient.GetAsync("/api/v1/admin/teacher-requests?page=0&pageSize=10")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await adminClient.GetAsync("/api/v1/admin/teacher-requests?page=1&pageSize=101")).StatusCode);
    }

    [Fact]
    public async Task Admin_account_list_filters_and_paginates_without_exposing_other_roles()
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

            var firstTeacher = CreateProfile("approved");
            firstTeacher.FirebaseUid = "teacher-1";
            firstTeacher.Email = "alpha.teacher@example.test";
            firstTeacher.FullName = "Alpha Teacher";
            firstTeacher.Role = "teacher";
            firstTeacher.ActiveRole = "teacher";

            var secondTeacher = CreateProfile("approved");
            secondTeacher.FirebaseUid = "teacher-2";
            secondTeacher.Email = "beta.teacher@example.test";
            secondTeacher.FullName = "Beta Teacher";
            secondTeacher.Role = "teacher";
            secondTeacher.ActiveRole = "teacher";

            var blockedStudent = CreateProfile("none");
            blockedStudent.FirebaseUid = "blocked-student";
            blockedStudent.Email = "blocked@example.test";
            blockedStudent.FullName = "Blocked Student";
            blockedStudent.ApprovalStatus = "rejected";

            var activeStudent = CreateProfile("none");
            activeStudent.FirebaseUid = "active-student";
            activeStudent.Email = "active@example.test";
            activeStudent.FullName = "Active Student";

            db.Profiles.AddRange(admin, firstTeacher, secondTeacher, blockedStudent, activeStudent);
            await db.SaveChangesAsync();
        }

        using var adminClient = factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "admin-test-token");

        using var firstPageResponse = await adminClient.GetAsync(
            "/api/v1/admin/accounts?role=teacher&status=active&search=TEACHER&page=1&pageSize=1");
        Assert.Equal(HttpStatusCode.OK, firstPageResponse.StatusCode);
        using var firstPageBody = JsonDocument.Parse(await firstPageResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, firstPageBody.RootElement.GetProperty("accounts").GetArrayLength());
        Assert.Equal(2, firstPageBody.RootElement.GetProperty("totalItems").GetInt32());
        Assert.Equal(2, firstPageBody.RootElement.GetProperty("totalPages").GetInt32());
        Assert.Equal(2, firstPageBody.RootElement.GetProperty("teacherCount").GetInt32());
        Assert.Equal(2, firstPageBody.RootElement.GetProperty("studentCount").GetInt32());
        var firstUid = firstPageBody.RootElement.GetProperty("accounts")[0].GetProperty("firebaseUid").GetString();

        using var secondPageResponse = await adminClient.GetAsync(
            "/api/v1/admin/accounts?role=teacher&status=active&search=teacher&page=2&pageSize=1");
        Assert.Equal(HttpStatusCode.OK, secondPageResponse.StatusCode);
        using var secondPageBody = JsonDocument.Parse(await secondPageResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, secondPageBody.RootElement.GetProperty("accounts").GetArrayLength());
        Assert.NotEqual(firstUid, secondPageBody.RootElement.GetProperty("accounts")[0].GetProperty("firebaseUid").GetString());

        using var blockedResponse = await adminClient.GetAsync(
            "/api/v1/admin/accounts?role=student&status=blocked&search=blocked");
        Assert.Equal(HttpStatusCode.OK, blockedResponse.StatusCode);
        using var blockedBody = JsonDocument.Parse(await blockedResponse.Content.ReadAsStringAsync());
        Assert.Equal("blocked-student", blockedBody.RootElement.GetProperty("accounts")[0].GetProperty("firebaseUid").GetString());

        Assert.Equal(HttpStatusCode.BadRequest,
            (await adminClient.GetAsync("/api/v1/admin/accounts?pageSize=101")).StatusCode);
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

        var write = CreateQuizPayload(["12a1"]);
        using var teacherClient = factory.CreateClient();
        teacherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "teacher-test-token");
        var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", write);

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var createdBody = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = createdBody.RootElement.GetProperty("id").GetString();
        Assert.Equal("teacher-1", createdBody.RootElement.GetProperty("teacherId").GetString());
        Assert.Equal("A", createdBody.RootElement.GetProperty("questions")[0].GetProperty("correctAnswers")[0].GetString());

        var unassignedPayload = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        unassignedPayload["settings"]!["assignedClasses"] = new JsonArray();
        unassignedPayload["settings"]!["assignedEmails"] = new JsonArray();
        using var unassignedCreate = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", unassignedPayload);
        Assert.Equal(HttpStatusCode.Created, unassignedCreate.StatusCode);
        using var unassignedCreatedBody = JsonDocument.Parse(await unassignedCreate.Content.ReadAsStringAsync());
        var unassignedCode = unassignedCreatedBody.RootElement.GetProperty("code").GetString();

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        var bootstrapResponse = await studentClient.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.OK, bootstrapResponse.StatusCode);
        using var classUpdateResponse = await studentClient.PatchAsJsonAsync("/api/v1/me", new
        {
            fullName = "Test Student",
            studentClass = " 12A1 ",
        });
        Assert.Equal(HttpStatusCode.OK, classUpdateResponse.StatusCode);

        var code = createdBody.RootElement.GetProperty("code").GetString();
        using var byCodeResponse = await studentClient.GetAsync($"/api/v1/quizzes/by-code/{code?.ToLowerInvariant()}");
        Assert.Equal(HttpStatusCode.OK, byCodeResponse.StatusCode);
        using var byCodeBody = JsonDocument.Parse(await byCodeResponse.Content.ReadAsStringAsync());
        Assert.Equal(0, byCodeBody.RootElement.GetProperty("questions")[0].GetProperty("correctAnswers").GetArrayLength());
        Assert.Equal(0, byCodeBody.RootElement.GetProperty("settings").GetProperty("assignedEmails").GetArrayLength());
        Assert.True(byCodeBody.RootElement.GetProperty("isAssignedToCurrentUser").GetBoolean());

        var listResponse = await studentClient.GetAsync("/api/v1/quizzes");

        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listBody = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var studentQuiz = Assert.Single(listBody.RootElement.EnumerateArray());
        Assert.Equal(quizId, studentQuiz.GetProperty("id").GetString());
        Assert.Equal(0, studentQuiz.GetProperty("questions")[0].GetProperty("correctAnswers").GetArrayLength());
        Assert.Equal(0, studentQuiz.GetProperty("settings").GetProperty("assignedEmails").GetArrayLength());
        Assert.True(studentQuiz.GetProperty("isAssignedToCurrentUser").GetBoolean());

        using var unassignedByCode = await studentClient.GetAsync($"/api/v1/quizzes/by-code/{unassignedCode}");
        Assert.Equal(HttpStatusCode.OK, unassignedByCode.StatusCode);

        using var otherStudentClient = factory.CreateClient();
        otherStudentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await otherStudentClient.GetAsync("/api/v1/me")).StatusCode);
        using var otherStudentList = await otherStudentClient.GetAsync("/api/v1/quizzes");
        Assert.Equal(HttpStatusCode.OK, otherStudentList.StatusCode);
        using var otherStudentListBody = JsonDocument.Parse(await otherStudentList.Content.ReadAsStringAsync());
        Assert.Empty(otherStudentListBody.RootElement.EnumerateArray());
        using var otherStudentRead = await otherStudentClient.GetAsync($"/api/v1/quizzes/by-code/{code}");
        Assert.Equal(HttpStatusCode.OK, otherStudentRead.StatusCode);
        using var otherStudentBody = JsonDocument.Parse(await otherStudentRead.Content.ReadAsStringAsync());
        Assert.False(otherStudentBody.RootElement.GetProperty("isAssignedToCurrentUser").GetBoolean());

        using var forbiddenResponse = await studentClient.PostAsJsonAsync("/api/v1/quizzes", write);
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenResponse.StatusCode);

        using var teacherRead = await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}");
        using var teacherReadBody = JsonDocument.Parse(await teacherRead.Content.ReadAsStringAsync());
        Assert.Equal("A", teacherReadBody.RootElement.GetProperty("questions")[0].GetProperty("correctAnswers")[0].GetString());
    }

    [PostgresFact]
    public async Task Student_quiz_list_filters_room_codes_by_assignment_in_postgresql()
    {
        using var factory = new QizzoneApiFactory();
        var now = DateTimeOffset.UtcNow;
        var classQuizId = Guid.NewGuid();
        var emailQuizId = Guid.NewGuid();
        var unassignedQuizId = Guid.NewGuid();
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
                CreatedAt = now,
                UpdatedAt = now,
            });
            db.Quizzes.AddRange(
                new Quiz
                {
                    Id = classQuizId,
                    TeacherUid = "teacher-1",
                    Title = "Class assigned",
                    Subject = "English",
                    Code = "CLA001",
                    Status = "published",
                    SettingsJson = JsonSerializer.Serialize(new
                    {
                        assignedClasses = new[] { "12A1" },
                        assignedEmails = Array.Empty<string>(),
                    }),
                    CreatedAt = now,
                    UpdatedAt = now,
                },
                new Quiz
                {
                    Id = emailQuizId,
                    TeacherUid = "teacher-1",
                    Title = "Email assigned",
                    Subject = "English",
                    Code = "EML001",
                    Status = "published",
                    SettingsJson = JsonSerializer.Serialize(new
                    {
                        assignedClasses = Array.Empty<string>(),
                        assignedEmails = new[] { "student@example.test" },
                    }),
                    CreatedAt = now,
                    UpdatedAt = now,
                },
                new Quiz
                {
                    Id = unassignedQuizId,
                    TeacherUid = "teacher-1",
                    Title = "Code only",
                    Subject = "English",
                    Code = "OPN001",
                    Status = "published",
                    SettingsJson = JsonSerializer.Serialize(new
                    {
                        assignedClasses = Array.Empty<string>(),
                        assignedEmails = Array.Empty<string>(),
                    }),
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            await db.SaveChangesAsync();
        }

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        using var profileUpdate = await studentClient.PatchAsJsonAsync("/api/v1/me", new
        {
            fullName = "Test Student",
            studentClass = " 12a1 ",
        });
        Assert.Equal(HttpStatusCode.OK, profileUpdate.StatusCode);

        using var listResponse = await studentClient.GetAsync("/api/v1/quizzes");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listBody = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var visibleIds = listBody.RootElement.EnumerateArray()
            .Select(item => Guid.Parse(item.GetProperty("id").GetString()!))
            .ToHashSet();
        Assert.Equal(2, visibleIds.Count);
        Assert.Contains(classQuizId, visibleIds);
        Assert.Contains(emailQuizId, visibleIds);
        Assert.DoesNotContain(unassignedQuizId, visibleIds);

        using var codeJoin = await studentClient.GetAsync("/api/v1/quizzes/by-code/OPN001");
        Assert.Equal(HttpStatusCode.OK, codeJoin.StatusCode);
    }

    [Fact]
    public async Task Scheduled_quiz_is_hidden_until_open_and_rejects_invalid_times()
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
        using var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var createdBody = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = createdBody.RootElement.GetProperty("id").GetString();
        var code = createdBody.RootElement.GetProperty("code").GetString();
        var opensAt = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).AddHours(1);
        var closesAt = opensAt.AddHours(1);

        using var scheduledResponse = await teacherClient.PatchAsJsonAsync($"/api/v1/quizzes/{quizId}/status", new
        {
            status = "scheduled",
            opensAt,
            closesAt,
        });
        Assert.Equal(HttpStatusCode.NoContent, scheduledResponse.StatusCode);

        using var teacherRead = await teacherClient.GetAsync($"/api/v1/quizzes/{quizId}");
        Assert.Equal(HttpStatusCode.OK, teacherRead.StatusCode);
        using var teacherBody = JsonDocument.Parse(await teacherRead.Content.ReadAsStringAsync());
        Assert.Equal("scheduled", teacherBody.RootElement.GetProperty("status").GetString());
        Assert.Equal(opensAt, teacherBody.RootElement.GetProperty("opensAt").GetDateTimeOffset());
        Assert.Equal(closesAt, teacherBody.RootElement.GetProperty("closesAt").GetDateTimeOffset());

        using var editScheduledQuiz = await teacherClient.PutAsJsonAsync($"/api/v1/quizzes/{quizId}", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.OK, editScheduledQuiz.StatusCode);
        using var editedBody = JsonDocument.Parse(await editScheduledQuiz.Content.ReadAsStringAsync());
        Assert.Equal("scheduled", editedBody.RootElement.GetProperty("status").GetString());
        Assert.Equal(opensAt, editedBody.RootElement.GetProperty("opensAt").GetDateTimeOffset());

        using var invalidSchedule = await teacherClient.PatchAsJsonAsync($"/api/v1/quizzes/{quizId}/status", new
        {
            status = "scheduled",
            opensAt,
            closesAt = opensAt,
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidSchedule.StatusCode);

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await studentClient.GetAsync($"/api/v1/quizzes/by-code/{code}")).StatusCode);
        using var blockedStart = await studentClient.PostAsJsonAsync($"/api/v1/exam-attempts/quizzes/{quizId}", new { });
        Assert.Equal(HttpStatusCode.Conflict, blockedStart.StatusCode);

        using var publishResponse = await teacherClient.PatchAsJsonAsync($"/api/v1/quizzes/{quizId}/status", new
        {
            status = "published",
            closesAt,
        });
        Assert.Equal(HttpStatusCode.NoContent, publishResponse.StatusCode);
        using var studentRead = await studentClient.GetAsync($"/api/v1/quizzes/by-code/{code}");
        Assert.Equal(HttpStatusCode.OK, studentRead.StatusCode);
        using var studentBody = JsonDocument.Parse(await studentRead.Content.ReadAsStringAsync());
        Assert.Equal("published", studentBody.RootElement.GetProperty("status").GetString());
        Assert.Equal(closesAt, studentBody.RootElement.GetProperty("closesAt").GetDateTimeOffset());
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
    public async Task Profile_update_accepts_owned_avatar_media_and_rejects_another_users_media()
    {
        using var factory = new QizzoneApiFactory();
        byte[] jpegBytes = [0xFF, 0xD8, 0xFF, 0x01, 0x02];
        Guid mediaId = Guid.Empty;

        try
        {
            using var ownerClient = factory.CreateClient();
            ownerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "valid-test-token");
            Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/v1/me")).StatusCode);

            using var form = new MultipartFormDataContent();
            var file = new ByteArrayContent(jpegBytes);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            form.Add(file, "file", "avatar.jpg");
            using var uploadResponse = await ownerClient.PostAsync("/api/v1/media", form);
            Assert.Equal(HttpStatusCode.Created, uploadResponse.StatusCode);
            using var uploadBody = JsonDocument.Parse(await uploadResponse.Content.ReadAsStringAsync());
            var reference = uploadBody.RootElement.GetProperty("reference").GetString();
            Assert.True(MediaEndpoints.TryParseReference(reference, out mediaId));

            using var ownerUpdate = await ownerClient.PatchAsJsonAsync("/api/v1/me", new
            {
                fullName = "Updated Test Student",
                avatarUrl = reference,
            });
            Assert.Equal(HttpStatusCode.OK, ownerUpdate.StatusCode);
            using var ownerBody = JsonDocument.Parse(await ownerUpdate.Content.ReadAsStringAsync());
            Assert.Equal(reference, ownerBody.RootElement.GetProperty("avatarUrl").GetString());

            using var otherClient = factory.CreateClient();
            otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-student-test-token");
            Assert.Equal(HttpStatusCode.OK, (await otherClient.GetAsync("/api/v1/me")).StatusCode);
            using var foreignUpdate = await otherClient.PatchAsJsonAsync("/api/v1/me", new
            {
                fullName = "Other Test Student",
                avatarUrl = reference,
            });
            Assert.Equal(HttpStatusCode.BadRequest, foreignUpdate.StatusCode);
        }
        finally
        {
            if (mediaId != Guid.Empty)
            {
                factory.Services.GetRequiredService<LocalMediaStore>().Delete(mediaId, ".jpg");
            }
        }
    }

    [Fact]
    public async Task Media_upload_checks_signature_persists_owner_and_hash_and_can_be_read_anonymously()
    {
        using var factory = new QizzoneApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "valid-test-token");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/me")).StatusCode);

        byte[] jpegBytes = [0xFF, 0xD8, 0xFF, 0x01, 0x02];
        using (var invalidForm = new MultipartFormDataContent())
        {
            var invalidFile = new ByteArrayContent(jpegBytes);
            invalidFile.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            invalidForm.Add(invalidFile, "file", "mismatch.png");
            using var invalidResponse = await client.PostAsync("/api/v1/media", invalidForm);
            Assert.Equal(HttpStatusCode.BadRequest, invalidResponse.StatusCode);
        }

        Guid mediaId = Guid.Empty;
        try
        {
            using var form = new MultipartFormDataContent();
            var file = new ByteArrayContent(jpegBytes);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            form.Add(file, "file", "question.jpg");

            using var uploadResponse = await client.PostAsync("/api/v1/media", form);
            Assert.Equal(HttpStatusCode.Created, uploadResponse.StatusCode);
            using var uploadBody = JsonDocument.Parse(await uploadResponse.Content.ReadAsStringAsync());
            var reference = uploadBody.RootElement.GetProperty("reference").GetString();
            Assert.True(MediaEndpoints.TryParseReference(reference, out mediaId));

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
                var media = await db.MediaObjects.SingleAsync(item => item.Id == mediaId);
                Assert.Equal("firebase-user-1", media.OwnerUid);
                Assert.Equal("image/jpeg", media.ContentType);
                Assert.Equal(".jpg", media.Extension);
                Assert.Equal(jpegBytes.Length, media.LengthBytes);
                Assert.Equal(Convert.ToHexString(SHA256.HashData(jpegBytes)).ToLowerInvariant(), media.Sha256);
            }

            using var anonymousClient = factory.CreateClient();
            using var imageResponse = await anonymousClient.GetAsync($"/api/v1/media/{mediaId:N}");
            Assert.Equal(HttpStatusCode.OK, imageResponse.StatusCode);
            Assert.Equal("image/jpeg", imageResponse.Content.Headers.ContentType?.MediaType);
            Assert.Contains("immutable", imageResponse.Headers.CacheControl?.ToString());
            Assert.Equal(jpegBytes, await imageResponse.Content.ReadAsByteArrayAsync());
        }
        finally
        {
            if (mediaId != Guid.Empty)
            {
                factory.Services.GetRequiredService<LocalMediaStore>().Delete(mediaId, ".jpg");
            }
        }
    }

    [Fact]
    public async Task Closing_room_blocks_new_attempts_but_preserves_existing_attempt_resume()
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
        var quizPayload = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        quizPayload["settings"]!["durationMinutes"] = 0;
        using var createResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", quizPayload);
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var created = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var quizId = created.RootElement.GetProperty("id").GetString()!;

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        using var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var started = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = started.RootElement.GetProperty("id").GetString();
        var questionId = started.RootElement.GetProperty("questions")[0].GetProperty("id").GetString()!;
        Assert.Equal(JsonValueKind.Null, started.RootElement.GetProperty("endsAt").ValueKind);
        Assert.Equal(created.RootElement.GetProperty("code").GetString(), started.RootElement.GetProperty("roomCode").GetString());

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
            Headers = { { "Idempotency-Key", mutationId.ToString() } },
        };
        using var saveResponse = await studentClient.SendAsync(saveRequest);
        Assert.Equal(HttpStatusCode.OK, saveResponse.StatusCode);

        using var closeResponse = await teacherClient.PatchAsJsonAsync($"/api/v1/quizzes/{quizId}/status", new { status = "closed" });
        Assert.Equal(HttpStatusCode.NoContent, closeResponse.StatusCode);

        using var resumeResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.OK, resumeResponse.StatusCode);
        using (var resumed = JsonDocument.Parse(await resumeResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal(attemptId, resumed.RootElement.GetProperty("id").GetString());
            Assert.Equal(JsonValueKind.Null, resumed.RootElement.GetProperty("endsAt").ValueKind);
            Assert.Equal(1, resumed.RootElement.GetProperty("revision").GetInt32());
            Assert.Equal("A", resumed.RootElement.GetProperty("answers").GetProperty(questionId)[0].GetString());
        }

        using var otherStudentClient = factory.CreateClient();
        otherStudentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "other-student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await otherStudentClient.GetAsync("/api/v1/me")).StatusCode);
        using var newAttemptResponse = await otherStudentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Conflict, newAttemptResponse.StatusCode);

        using var verifyScope = factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Single(await verifyDb.ExamAttempts.ToListAsync());
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

        var editAfterAttempt = await teacherClient.PutAsJsonAsync($"/api/v1/quizzes/{quizId}", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Conflict, editAfterAttempt.StatusCode);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var quiz = await db.Quizzes.Include(item => item.Questions)
                .ThenInclude(item => item.AnswerKey)
                .SingleAsync(item => item.Id == Guid.Parse(quizId!));
            quiz.Title = "Edited after the attempt started";
            quiz.Subject = "English";
            var editedQuestion = Assert.Single(quiz.Questions);
            editedQuestion.Content = "Changed after the attempt started";
            editedQuestion.OptionsJson = JsonSerializer.Serialize(new[]
            {
                new { id = "A", content = "Not two", images = Array.Empty<string>() },
                new { id = "B", content = "Not three", images = Array.Empty<string>() },
            });
            editedQuestion.Points = 5;
            editedQuestion.AnswerKey!.CorrectAnswersJson = "[\"B\"]";
            editedQuestion.AnswerKey.Explanation = "Changed answer explanation";
            await db.SaveChangesAsync();
        }

        var afterEditResponse = await studentClient.GetAsync($"/api/v1/exam-attempts/{attemptId}");
        Assert.Equal(HttpStatusCode.OK, afterEditResponse.StatusCode);
        using (var afterEditBody = JsonDocument.Parse(await afterEditResponse.Content.ReadAsStringAsync()))
        {
            var frozenQuestion = afterEditBody.RootElement.GetProperty("questions")[0];
            Assert.Equal("Secure quiz", afterEditBody.RootElement.GetProperty("quizTitle").GetString());
            Assert.Equal("Math", afterEditBody.RootElement.GetProperty("subject").GetString());
            Assert.Equal("What is 1 + 1?", frozenQuestion.GetProperty("content").GetString());
            Assert.Equal("2", frozenQuestion.GetProperty("options")[0].GetProperty("content").GetString());
            Assert.Equal(1, frozenQuestion.GetProperty("points").GetDecimal());
        }

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
        var resultDetail = Assert.Single(resultBody.RootElement.GetProperty("details").EnumerateArray());
        Assert.Equal("What is 1 + 1?", resultDetail.GetProperty("content").GetString());
        Assert.Equal("A", resultDetail.GetProperty("correctAnswers")[0].GetString());
        Assert.Equal("2", resultDetail.GetProperty("options")[0].GetProperty("content").GetString());
        Assert.Equal(1, resultDetail.GetProperty("maxPoints").GetDecimal());

        var repeatedSubmit = await studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null);
        Assert.Equal(HttpStatusCode.OK, repeatedSubmit.StatusCode);
        var exhaustedAttempt = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Conflict, exhaustedAttempt.StatusCode);
    }

    [Fact]
    public async Task Exam_attempt_with_missing_legacy_questions_cannot_save_or_be_graded()
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
        var quizId = created.RootElement.GetProperty("id").GetString()!;

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var started = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = started.RootElement.GetProperty("id").GetString()!;

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var attempt = await db.ExamAttempts.SingleAsync(item => item.Id == Guid.Parse(attemptId));
            attempt.SnapshotJson = "{}";
            var question = await db.Questions.SingleAsync(item => item.QuizId == Guid.Parse(quizId));
            db.Questions.Remove(question);
            await db.SaveChangesAsync();
        }

        var mutationId = Guid.NewGuid();
        using var autosave = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/exam-attempts/{attemptId}/autosave")
        {
            Content = JsonContent.Create(new
            {
                revision = 0,
                answers = new Dictionary<string, string[]>(),
                flaggedQuestionIds = Array.Empty<string>(),
                currentQuestionIndex = 0,
                mutationId,
                clientSequence = 1,
                writerSessionId = Guid.NewGuid().ToString(),
            }),
            Headers = { { "Idempotency-Key", mutationId.ToString() } },
        };
        Assert.Equal(HttpStatusCode.Conflict, (await studentClient.SendAsync(autosave)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await studentClient.PostAsync($"/api/v1/exam-attempts/{attemptId}/submit", content: null)).StatusCode);

        using var scopeAfterSubmit = factory.Services.CreateScope();
        var verificationDb = scopeAfterSubmit.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Empty(await verificationDb.ExamResults.ToListAsync());
    }

    [Fact]
    public async Task Finalize_expired_reports_failed_attempts_that_cannot_be_graded()
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
        using var quizResponse = await teacherClient.PostAsJsonAsync("/api/v1/quizzes", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Created, quizResponse.StatusCode);
        using var quizBody = JsonDocument.Parse(await quizResponse.Content.ReadAsStringAsync());
        var quizId = quizBody.RootElement.GetProperty("id").GetString()!;

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);
        using var startResponse = await studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        using var startBody = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var attemptId = Guid.Parse(startBody.RootElement.GetProperty("id").GetString()!);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var attempt = await db.ExamAttempts.SingleAsync(item => item.Id == attemptId);
            attempt.EndsAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            attempt.QuestionOrder = [.. attempt.QuestionOrder, Guid.NewGuid()];
            await db.SaveChangesAsync();
        }

        using var finalizeResponse = await studentClient.PostAsync("/api/v1/exam-attempts/finalize-expired", content: null);
        Assert.Equal(HttpStatusCode.OK, finalizeResponse.StatusCode);
        using var finalizeBody = JsonDocument.Parse(await finalizeResponse.Content.ReadAsStringAsync());
        Assert.Equal(0, finalizeBody.RootElement.GetProperty("finalized").GetInt32());
        Assert.Equal(1, finalizeBody.RootElement.GetProperty("failed").GetInt32());

        using var verificationScope = factory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        Assert.Empty(await verificationDb.ExamResults.ToListAsync());
        Assert.Null((await verificationDb.ExamAttempts.SingleAsync(item => item.Id == attemptId)).SubmittedAt);
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
    public async Task Quiz_edit_and_exam_start_serialize_on_the_quiz_row()
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
        var quizId = created.RootElement.GetProperty("id").GetString()!;

        using var studentClient = factory.CreateClient();
        studentClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "student-test-token");
        Assert.Equal(HttpStatusCode.OK, (await studentClient.GetAsync("/api/v1/me")).StatusCode);

        var connectionString = new NpgsqlConnectionStringBuilder(
            Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES"))
        {
            SearchPath = factory.PostgresSchema,
        }.ConnectionString;
        await using var blockerConnection = new NpgsqlConnection(connectionString);
        await blockerConnection.OpenAsync();
        await using var blockerTransaction = await blockerConnection.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand(
            "SELECT id FROM quizzes WHERE id = @quiz_id FOR UPDATE",
            blockerConnection,
            blockerTransaction))
        {
            lockCommand.Parameters.AddWithValue("quiz_id", Guid.Parse(quizId));
            Assert.NotNull(await lockCommand.ExecuteScalarAsync());
        }

        var changedPayload = JsonNode.Parse(JsonSerializer.Serialize(CreateQuizPayload()))!.AsObject();
        changedPayload["title"] = "Concurrent edit";
        changedPayload["questions"]![0]!["content"] = "Concurrent edit question";
        changedPayload["questions"]![0]!["id"] =
            created.RootElement.GetProperty("questions")[0].GetProperty("id").GetString();
        var startTask = studentClient.PostAsync($"/api/v1/exam-attempts/quizzes/{quizId}", content: null);
        var editTask = teacherClient.PutAsJsonAsync($"/api/v1/quizzes/{quizId}", changedPayload);

        var blockedRequests = 0L;
        for (var attempt = 0; attempt < 100 && blockedRequests < 2; attempt++)
        {
            await using (var clearSnapshotCommand = new NpgsqlCommand(
                "SELECT pg_stat_clear_snapshot()",
                blockerConnection,
                blockerTransaction))
            {
                await clearSnapshotCommand.ExecuteNonQueryAsync();
            }

            await using var activityCommand = new NpgsqlCommand(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM quizzes WHERE id = % FOR %'",
                blockerConnection,
                blockerTransaction);
            blockedRequests = (long)(await activityCommand.ExecuteScalarAsync() ?? 0L);
            if (blockedRequests < 2) await Task.Delay(50);
        }

        var blockedRequestDetails = "<not captured>";
        if (blockedRequests < 2)
        {
            await using var detailsCommand = new NpgsqlCommand(
                "SELECT coalesce(string_agg(format('pid=%s state=%s wait=%s/%s query=%s', pid, state, wait_event_type, wait_event, query), E'\\n'), '<none>') FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
                blockerConnection,
                blockerTransaction);
            blockedRequestDetails = (string?)await detailsCommand.ExecuteScalarAsync() ?? "<none>";
        }

        Assert.True(blockedRequests >= 2, $"Both exam start and quiz edit must block on the shared quiz row lock. Active sessions: {blockedRequestDetails}");
        await blockerTransaction.CommitAsync();

        var startResponse = await startTask;
        var editResponse = await editTask;
        Assert.Equal(HttpStatusCode.Created, startResponse.StatusCode);
        var editResponseBody = await editResponse.Content.ReadAsStringAsync();
        Assert.True(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }.Contains(editResponse.StatusCode),
            $"Unexpected quiz edit response: {(int)editResponse.StatusCode} {editResponseBody}");

        using var started = JsonDocument.Parse(await startResponse.Content.ReadAsStringAsync());
        var expectedTitle = editResponse.StatusCode == HttpStatusCode.OK ? "Concurrent edit" : "Secure quiz";
        var expectedContent = editResponse.StatusCode == HttpStatusCode.OK
            ? "Concurrent edit question"
            : "What is 1 + 1?";
        Assert.Equal(expectedTitle, started.RootElement.GetProperty("quizTitle").GetString());
        var question = Assert.Single(started.RootElement.GetProperty("questions").EnumerateArray());
        Assert.Equal(expectedContent, question.GetProperty("content").GetString());

        var questionId = question.GetProperty("id").GetString()!;
        var mutationId = Guid.NewGuid();
        using var autosave = new HttpRequestMessage(
            HttpMethod.Put,
            $"/api/v1/exam-attempts/{started.RootElement.GetProperty("id").GetString()}/autosave")
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
            Headers = { { "Idempotency-Key", mutationId.ToString() } },
        };
        Assert.Equal(HttpStatusCode.OK, (await studentClient.SendAsync(autosave)).StatusCode);
    }

    [PostgresFact]
    public async Task Practice_check_and_finish_serialize_on_the_session_row()
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
        var quizId = quizBody.RootElement.GetProperty("id").GetString()!;

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
        var sessionId = Guid.Parse(startBody.RootElement.GetProperty("id").GetString()!);
        var questionId = startBody.RootElement.GetProperty("questionOrder")[0].GetString()!;

        var connectionString = new NpgsqlConnectionStringBuilder(
            Environment.GetEnvironmentVariable("QIZZONE_TEST_POSTGRES"))
        {
            SearchPath = factory.PostgresSchema,
        }.ConnectionString;
        await using var blockerConnection = new NpgsqlConnection(connectionString);
        await blockerConnection.OpenAsync();
        await using var blockerTransaction = await blockerConnection.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand(
            "SELECT id FROM practice_sessions WHERE id = @session_id FOR UPDATE",
            blockerConnection,
            blockerTransaction))
        {
            lockCommand.Parameters.AddWithValue("session_id", sessionId);
            Assert.Equal(sessionId, await lockCommand.ExecuteScalarAsync());
        }

        var checkTask = studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{sessionId}/answers/{questionId}",
            new { selectedAnswers = new[] { "A" } });
        var finishTask = studentClient.PostAsync($"/api/v1/practice-sessions/{sessionId}/finish", content: null);

        var blockedRequests = 0L;
        for (var attempt = 0; attempt < 100 && blockedRequests < 2; attempt++)
        {
            await using (var clearSnapshotCommand = new NpgsqlCommand(
                "SELECT pg_stat_clear_snapshot()",
                blockerConnection,
                blockerTransaction))
            {
                await clearSnapshotCommand.ExecuteNonQueryAsync();
            }

            await using var activityCommand = new NpgsqlCommand(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM practice_sessions WHERE id = % FOR UPDATE%'",
                blockerConnection,
                blockerTransaction);
            blockedRequests = (long)(await activityCommand.ExecuteScalarAsync() ?? 0L);
            if (blockedRequests < 2) await Task.Delay(50);
        }

        var blockedRequestDetails = "<not captured>";
        if (blockedRequests < 2)
        {
            await using var detailsCommand = new NpgsqlCommand(
                "SELECT coalesce(string_agg(format('pid=%s state=%s wait=%s/%s query=%s', pid, state, wait_event_type, wait_event, query), E'\\n'), '<none>') FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
                blockerConnection,
                blockerTransaction);
            blockedRequestDetails = (string?)await detailsCommand.ExecuteScalarAsync() ?? "<none>";
        }

        Assert.True(blockedRequests >= 2, $"Both practice operations must block on the same session row lock. Active sessions: {blockedRequestDetails}");
        await blockerTransaction.CommitAsync();

        var checkResponse = await checkTask;
        var finishResponse = await finishTask;
        Assert.Contains(checkResponse.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });
        Assert.Equal(HttpStatusCode.OK, finishResponse.StatusCode);
        using var finishBody = JsonDocument.Parse(await finishResponse.Content.ReadAsStringAsync());

        using var verifyScope = factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        var savedSession = await verifyDb.PracticeSessions.SingleAsync(item => item.Id == sessionId);
        var savedAnswerCount = await verifyDb.PracticeAnswers.CountAsync(item => item.SessionId == sessionId);
        Assert.Equal("completed", savedSession.Status);
        Assert.Equal(savedAnswerCount, finishBody.RootElement.GetProperty("answeredCount").GetInt32());
        if (checkResponse.StatusCode == HttpStatusCode.OK)
        {
            Assert.Equal(1, savedAnswerCount);
        }
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

        var editWithPracticeHistory = await teacherClient.PutAsJsonAsync(
            $"/api/v1/quizzes/{quizId}", CreateQuizPayload());
        Assert.Equal(HttpStatusCode.Conflict, editWithPracticeHistory.StatusCode);

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
    public async Task Practice_session_cannot_check_or_finish_after_quiz_version_changes()
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
        var quizId = quizBody.RootElement.GetProperty("id").GetString()!;

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
        var sessionId = startBody.RootElement.GetProperty("id").GetString()!;
        var questionId = startBody.RootElement.GetProperty("questionOrder")[0].GetString()!;

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
            var quiz = await db.Quizzes.SingleAsync(item => item.Id == Guid.Parse(quizId));
            quiz.UpdatedAt = quiz.UpdatedAt.AddSeconds(1);
            await db.SaveChangesAsync();
        }

        var checkResponse = await studentClient.PostAsJsonAsync(
            $"/api/v1/practice-sessions/{sessionId}/answers/{questionId}",
            new { selectedAnswers = new[] { "A" } });
        Assert.Equal(HttpStatusCode.Conflict, checkResponse.StatusCode);

        var getResponse = await studentClient.GetAsync($"/api/v1/practice-sessions/{sessionId}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        using (var getBody = JsonDocument.Parse(await getResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal("invalidated", getBody.RootElement.GetProperty("status").GetString());
        }

        Assert.Equal(HttpStatusCode.Conflict,
            (await studentClient.PostAsync($"/api/v1/practice-sessions/{sessionId}/finish", content: null)).StatusCode);
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

    [PostgresFact]
    public async Task PostgreSQL_accepts_five_correct_options_and_five_practice_selections()
    {
        using var factory = new QizzoneApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QizzoneDbContext>();
        var now = DateTimeOffset.UtcNow;
        const string uid = "five-option-user";
        var quizId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var allOptions = new[] { "A", "B", "C", "D", "E" };
        var profile = new Profile
        {
            FirebaseUid = uid,
            Email = "five-option@example.test",
            FullName = "Five Option Student",
            Role = "student",
            ApprovalStatus = "approved",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var quiz = new Quiz
        {
            Id = quizId,
            TeacherUid = uid,
            Title = "Five option question",
            Subject = "Test",
            Code = "FIVE01",
            Status = "draft",
            SettingsJson = "{}",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var question = new Question
        {
            Id = questionId,
            QuizId = quizId,
            Ordinal = 1,
            Content = "Select every answer.",
            Type = "multiple_choice",
            OptionsJson = JsonSerializer.Serialize(allOptions.Select(id => new { id, content = id })),
            Points = 1,
            CreatedAt = now,
            UpdatedAt = now,
            AnswerKey = new QuestionAnswerKey
            {
                QuestionId = questionId,
                CorrectAnswersJson = JsonSerializer.Serialize(allOptions),
                CreatedAt = now,
                UpdatedAt = now,
            },
        };
        var session = new PracticeSession
        {
            Id = sessionId,
            QuizId = quizId,
            QuizTitle = quiz.Title,
            Subject = quiz.Subject,
            StudentUid = uid,
            StartedAt = now,
            QuizUpdatedAt = now,
            QuestionOrder = [questionId],
            ShowExplanation = true,
        };
        var answer = new PracticeAnswer
        {
            SessionId = sessionId,
            QuestionId = questionId,
            SelectedAnswersJson = JsonSerializer.Serialize(allOptions),
            IsCorrect = true,
            CorrectAnswersJson = JsonSerializer.Serialize(allOptions),
            CheckedAt = now,
        };

        db.Profiles.Add(profile);
        db.Quizzes.Add(quiz);
        db.Questions.Add(question);
        db.QuestionAnswerKeys.Add(question.AnswerKey);
        db.PracticeSessions.Add(session);
        db.PracticeAnswers.Add(answer);
        await db.SaveChangesAsync();

        Assert.Equal(5, JsonSerializer.Deserialize<string[]>(question.AnswerKey.CorrectAnswersJson)!.Length);
        Assert.Equal(5, JsonSerializer.Deserialize<string[]>(answer.SelectedAnswersJson)!.Length);
    }

    private static object CreateQuizPayload(string[]? assignedClasses = null) => new
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
            assignedClasses = assignedClasses ?? Array.Empty<string>(),
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
        builder.UseEnvironment("Testing");
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
                    MaxPoolSize = 8,
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
