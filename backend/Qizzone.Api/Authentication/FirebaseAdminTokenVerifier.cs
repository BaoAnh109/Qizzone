using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Apis.Auth.OAuth2;

namespace Qizzone.Api.Authentication;

public sealed class FirebaseAdminTokenVerifier : IFirebaseTokenVerifier
{
    private readonly FirebaseAuth _auth;

    public FirebaseAdminTokenVerifier(IConfiguration configuration)
    {
        var projectId = configuration["Firebase:ProjectId"]
            ?? configuration["GOOGLE_CLOUD_PROJECT"];

        if (string.IsNullOrWhiteSpace(projectId))
        {
            throw new InvalidOperationException("Firebase:ProjectId must be configured.");
        }

        var serviceAccountJson = configuration["Firebase:ServiceAccountJson"] ??
            Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON");
        var credential = string.IsNullOrWhiteSpace(serviceAccountJson)
            ? GoogleCredential.GetApplicationDefault()
            : CredentialFactory.FromJson<ServiceAccountCredential>(serviceAccountJson).ToGoogleCredential();

        var app = FirebaseApp.Create(new AppOptions
        {
            Credential = credential,
            ProjectId = projectId,
        }, "qizzone-api");

        _auth = FirebaseAuth.GetAuth(app);
    }

    public async Task<FirebaseIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        var decoded = await _auth.VerifyIdTokenAsync(idToken, checkRevoked: true, cancellationToken);
        var claims = decoded.Claims;

        return new FirebaseIdentity(
            decoded.Uid,
            GetStringClaim(claims, "email"),
            GetStringClaim(claims, "name"),
            GetBooleanClaim(claims, "email_verified"));
    }

    private static string? GetStringClaim(IReadOnlyDictionary<string, object> claims, string key) =>
        claims.TryGetValue(key, out var value) ? Convert.ToString(value) : null;

    private static bool GetBooleanClaim(IReadOnlyDictionary<string, object> claims, string key) =>
        claims.TryGetValue(key, out var value) &&
        (value is true || bool.TryParse(Convert.ToString(value), out var parsed) && parsed);
}
