using Microsoft.Extensions.Options;
using Qizzone.Worker;

var builder = Host.CreateApplicationBuilder(args);
var geminiApiKeyFile = builder.Configuration["Gemini:ApiKeyFile"];
builder.Services.AddOptions<GeminiOptions>()
    .Bind(builder.Configuration.GetSection("Gemini"))
    .Configure(options =>
    {
        if (!string.IsNullOrWhiteSpace(geminiApiKeyFile))
        {
            options.ApiKey = File.ReadAllText(geminiApiKeyFile).Trim();
        }
    })
    .Validate(options => !string.IsNullOrWhiteSpace(options.ApiKey), "Gemini:ApiKey is required.")
    .Validate(options => GeminiOptions.IsValidModel(options.Model), "Gemini:Model must be a model ID, not a URL.")
    .ValidateOnStart();
builder.Services.AddHttpClient<GeminiClient>(client => client.Timeout = TimeSpan.FromSeconds(75));
builder.Services.AddHostedService<AiImportWorker>();

await builder.Build().RunAsync();
