using System.Text.RegularExpressions;

namespace Qizzone.Worker;

public sealed partial class GeminiOptions
{
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "";

    public static bool IsValidModel(string model) =>
        !string.IsNullOrWhiteSpace(model) && ModelIdRegex().IsMatch(model);

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", RegexOptions.CultureInvariant)]
    private static partial Regex ModelIdRegex();
}
