using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Authentication;
using Qizzone.Api.Data;
using Qizzone.Api.Features;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 10 * 1024 * 1024);
var connectionString = builder.Configuration.GetConnectionString("Qizzone");
var firebaseProjectId = builder.Configuration["Firebase:ProjectId"] ?? builder.Configuration["GOOGLE_CLOUD_PROJECT"];
var firebaseCredential = builder.Configuration["Firebase:ServiceAccountJson"] ??
    Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON") ??
    Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
var allowedHosts = builder.Configuration["AllowedHosts"];
var bootstrapAdminUids = builder.Configuration.GetSection("Admin:BootstrapUids").Get<string[]>()?
    .Select(uid => uid.Trim())
    .Where(uid => uid.Length > 0)
    .Distinct(StringComparer.Ordinal)
    .ToArray() ?? [];

if (builder.Environment.IsProduction())
{
    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException("ConnectionStrings:Qizzone must be configured in production.");
    }

    if (string.IsNullOrWhiteSpace(firebaseProjectId))
    {
        throw new InvalidOperationException("Firebase:ProjectId must be configured in production.");
    }

    if (string.IsNullOrWhiteSpace(firebaseCredential))
    {
        throw new InvalidOperationException("Configure Firebase ADC or a Firebase service account through the deployment secret store.");
    }

    if (allowedOrigins.Length == 0)
    {
        throw new InvalidOperationException("Cors:AllowedOrigins must list the production frontend origin.");
    }

    if (string.IsNullOrWhiteSpace(allowedHosts) || allowedHosts == "*")
    {
        throw new InvalidOperationException("AllowedHosts must list the production API host.");
    }

    if (bootstrapAdminUids.Length == 0)
    {
        throw new InvalidOperationException("Admin:BootstrapUids must include at least one verified Firebase UID for initial administration.");
    }
}

builder.Services.AddProblemDetails();
builder.Services.AddSingleton<ExamAttemptGateStore>();
builder.Services.AddDbContext<QizzoneDbContext>(options =>
    options.UseNpgsql(connectionString ?? "Host=localhost;Database=qizzone;Username=qizzone;Password=local-development-only"));
builder.Services.AddCors(options => options.AddPolicy("QizzoneFrontend", policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddSingleton<IFirebaseTokenVerifier, FirebaseAdminTokenVerifier>();
builder.Services.AddScoped<IClaimsTransformation, ProfileClaimsTransformation>();
builder.Services.AddAuthentication(FirebaseBearerHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, FirebaseBearerHandler>(FirebaseBearerHandler.SchemeName, _ => { });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("ActiveUser", policy => policy
        .RequireAuthenticatedUser()
        .RequireClaim("firebase:email_verified", "true")
        .RequireClaim("qizzone:role"));
    options.AddPolicy("Student", policy => policy
        .RequireAuthenticatedUser()
        .RequireClaim("firebase:email_verified", "true")
        .RequireClaim("qizzone:role", "student"));
    options.AddPolicy("Teacher", policy => policy
        .RequireAuthenticatedUser()
        .RequireClaim("firebase:email_verified", "true")
        .RequireClaim("qizzone:role", "teacher", "admin"));
    options.AddPolicy("Admin", policy => policy
        .RequireAuthenticatedUser()
        .RequireClaim("firebase:email_verified", "true")
        .RequireClaim("qizzone:role", "admin"));
});
builder.Services.AddOpenApi();

var app = builder.Build();
app.UseExceptionHandler();
app.UseCors("QizzoneFrontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new { service = "Qizzone API", status = "running" }))
    .AllowAnonymous();
app.MapGet("/health/live", () => Results.Ok(new { status = "live" }))
    .AllowAnonymous();
app.MapGet("/health/ready", async (QizzoneDbContext db, CancellationToken cancellationToken) =>
{
    try
    {
        return await db.Database.CanConnectAsync(cancellationToken)
            ? Results.Ok(new { status = "ready" })
            : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
    catch
    {
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    }
}).AllowAnonymous();

app.MapProfileEndpoints();
app.MapAdminEndpoints();
app.MapQuizEndpoints();
app.MapExamEndpoints();
app.MapPracticeEndpoints();
app.MapAiImportEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.Run();

public partial class Program;
