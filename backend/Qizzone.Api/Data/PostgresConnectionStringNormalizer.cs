using Npgsql;

namespace Qizzone.Api.Data;

public static class PostgresConnectionStringNormalizer
{
    public static string Normalize(string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);

        var isPostgresUri = connectionString.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
            connectionString.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase);
        if (!isPostgresUri)
        {
            return connectionString;
        }

        if (!Uri.TryCreate(connectionString, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "postgres" && uri.Scheme != "postgresql"))
        {
            throw new InvalidOperationException("The PostgreSQL connection URI is invalid.");
        }

        var userInfo = uri.UserInfo.Split(':', 2);
        var database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        if (userInfo.Length != 2 || string.IsNullOrWhiteSpace(userInfo[0]) || string.IsNullOrWhiteSpace(database))
        {
            throw new InvalidOperationException("The PostgreSQL connection URI is missing required connection details.");
        }

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port < 0 ? 5432 : uri.Port,
            Database = database,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = Uri.UnescapeDataString(userInfo[1])
        };

        foreach (var parameter in ParseQuery(uri.Query))
        {
            switch (parameter.Key.ToLowerInvariant())
            {
                case "sslmode":
                    builder["SSL Mode"] = string.IsNullOrWhiteSpace(parameter.Value)
                        ? "Require"
                        : NormalizeSslMode(parameter.Value);
                    break;
                case "connect_timeout" when int.TryParse(parameter.Value, out var timeout) && timeout > 0:
                    builder.Timeout = timeout;
                    break;
                case "application_name":
                    builder.ApplicationName = parameter.Value;
                    break;
            }
        }

        return builder.ConnectionString;
    }

    private static string NormalizeSslMode(string value) => value.ToLowerInvariant() switch
    {
        "disable" => "Disable",
        "allow" => "Allow",
        "prefer" => "Prefer",
        "require" => "Require",
        "verify-ca" or "verify_ca" => "VerifyCA",
        "verify-full" or "verify_full" => "VerifyFull",
        _ => throw new InvalidOperationException("The PostgreSQL connection URI has an unsupported SSL mode.")
    };

    private static IEnumerable<KeyValuePair<string, string>> ParseQuery(string query)
    {
        foreach (var segment in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = segment.IndexOf('=');
            var encodedKey = separator < 0 ? segment : segment[..separator];
            var encodedValue = separator < 0 ? string.Empty : segment[(separator + 1)..];
            var key = DecodeQueryComponent(encodedKey);
            if (!string.IsNullOrWhiteSpace(key))
            {
                yield return new KeyValuePair<string, string>(key, DecodeQueryComponent(encodedValue));
            }
        }
    }

    private static string DecodeQueryComponent(string value) => Uri.UnescapeDataString(value);
}
