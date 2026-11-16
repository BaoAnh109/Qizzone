var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health/live");
app.MapGet("/api/v2/status", () => Results.Ok(new
{
    service = "qizzone-api",
    status = "bootstrap",
    message = "Business APIs are not yet migrated."
}));

app.Run();

public partial class Program;
