using System.Security.Claims;
using System.Text.Encodings.Web;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Qizzone.Api.Authentication;

public sealed class FirebaseBearerHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IFirebaseTokenVerifier tokenVerifier)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "FirebaseBearer";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorization = Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(authorization))
        {
            return AuthenticateResult.NoResult();
        }

        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.Fail("A bearer token is required.");
        }

        var idToken = authorization["Bearer ".Length..].Trim();
        if (idToken.Length == 0)
        {
            return AuthenticateResult.Fail("A bearer token is required.");
        }

        try
        {
            var identity = await tokenVerifier.VerifyAsync(idToken, Context.RequestAborted);
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, identity.Uid),
                new("firebase:uid", identity.Uid),
                new("firebase:email_verified", identity.EmailVerified ? "true" : "false"),
            };

            if (!string.IsNullOrWhiteSpace(identity.Email))
            {
                claims.Add(new Claim(ClaimTypes.Email, identity.Email));
            }

            if (!string.IsNullOrWhiteSpace(identity.DisplayName))
            {
                claims.Add(new Claim(ClaimTypes.Name, identity.DisplayName));
            }

            var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
            return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
        }
        catch (FirebaseAuthException)
        {
            return AuthenticateResult.Fail("The Firebase ID token is invalid or expired.");
        }
        catch (ArgumentException)
        {
            return AuthenticateResult.Fail("The Firebase ID token is invalid or expired.");
        }
    }
}
