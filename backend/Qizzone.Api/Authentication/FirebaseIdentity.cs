namespace Qizzone.Api.Authentication;

public sealed record FirebaseIdentity(
    string Uid,
    string? Email,
    string? DisplayName,
    bool EmailVerified);

public interface IFirebaseTokenVerifier
{
    Task<FirebaseIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken);
}
