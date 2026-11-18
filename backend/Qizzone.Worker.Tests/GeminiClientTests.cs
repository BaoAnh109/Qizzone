using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Qizzone.Api.Features;
using Qizzone.Worker;

namespace Qizzone.Worker.Tests;

public sealed class GeminiClientTests
{
    [Fact]
    public async Task Extraction_sends_server_key_inline_image_and_returns_only_structural_fields()
    {
        string? uri = null;
        string? apiKey = null;
        string? requestJson = null;
        using var http = new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            uri = request.RequestUri?.ToString();
            apiKey = request.Headers.GetValues("x-goog-api-key").Single();
            requestJson = await request.Content!.ReadAsStringAsync(cancellationToken);
            return JsonResponse("""
                {"candidates":[{"content":{"parts":[{"text":"{\"questions\":[{\"order\":1,\"content\":\"What is HTTP?\",\"options\":[{\"id\":\"A\",\"content\":\"Protocol\"},{\"id\":\"B\",\"content\":\"Browser\"}],\"correctAnswers\":[\"B\"]}]}"}]}}]}
                """);
        }));
        var client = CreateClient(http);

        var result = await client.ExtractAsync(new AiImportPayload(
            "Extract visible questions.", Convert.ToBase64String([1, 2, 3]), "image/png"), CancellationToken.None);

        Assert.Equal("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent", uri);
        Assert.Equal("server-only-test-key", apiKey);
        using var request = JsonDocument.Parse(requestJson!);
        var parts = request.RootElement.GetProperty("contents")[0].GetProperty("parts");
        Assert.Equal("Extract visible questions.", parts[0].GetProperty("text").GetString());
        Assert.Equal("image/png", parts[1].GetProperty("inlineData").GetProperty("mimeType").GetString());
        Assert.Equal(Convert.ToBase64String([1, 2, 3]), parts[1].GetProperty("inlineData").GetProperty("data").GetString());
        Assert.Contains("untrusted data", request.RootElement.GetProperty("systemInstruction").GetProperty("parts")[0].GetProperty("text").GetString());
        var generationConfig = request.RootElement.GetProperty("generationConfig");
        Assert.Equal("application/json", generationConfig.GetProperty("responseMimeType").GetString());
        Assert.False(generationConfig.TryGetProperty("temperature", out _));

        using var response = JsonDocument.Parse(result);
        var question = response.RootElement.GetProperty("questions")[0];
        Assert.Equal("What is HTTP?", question.GetProperty("content").GetString());
        Assert.False(question.TryGetProperty("correctAnswers", out _));
    }

    [Fact]
    public async Task Solve_operation_returns_only_valid_answers()
    {
        using var http = new HttpClient(new StubHandler((_, _) => Task.FromResult(JsonResponse(
            """
            {"candidates":[{"content":{"parts":[{"text":"{\"solutions\":[{\"order\":2,\"correctAnswer\":\"b\",\"explanation\":\"The choice is supported.\"}]}"}]}}]}
            """))));

        var result = await CreateClient(http).ExtractAsync(
            new AiImportPayload("Solve question.", null, null, "solve"), CancellationToken.None);

        using var document = JsonDocument.Parse(result);
        Assert.Equal("B", document.RootElement.GetProperty("solutions")[0].GetProperty("correctAnswer").GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.RequestTimeout)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task Provider_throttle_and_server_errors_are_retryable(HttpStatusCode status)
    {
        using var http = new HttpClient(new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(status))));
        var error = await Assert.ThrowsAsync<GeminiTransientException>(() =>
            CreateClient(http).ExtractAsync(new AiImportPayload("prompt", null, null), CancellationToken.None));
        Assert.Equal("gemini_transient", error.Code);
    }

    [Fact]
    public async Task Provider_client_errors_are_terminal_and_model_setting_cannot_contain_a_url()
    {
        using var http = new HttpClient(new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest))));
        var error = await Assert.ThrowsAsync<GeminiPermanentException>(() =>
            CreateClient(http).ExtractAsync(new AiImportPayload("prompt", null, null), CancellationToken.None));

        Assert.Equal("gemini_rejected_request", error.Code);
        Assert.True(GeminiOptions.IsValidModel("gemini-test-model"));
        Assert.False(GeminiOptions.IsValidModel("https://example.test/model"));
    }

    private static GeminiClient CreateClient(HttpClient http) => new(http, Options.Create(new GeminiOptions
    {
        ApiKey = "server-only-test-key",
        Model = "gemini-test",
    }));

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            respond(request, cancellationToken);
    }
}
