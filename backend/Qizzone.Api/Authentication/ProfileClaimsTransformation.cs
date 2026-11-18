using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Authentication;

public sealed class ProfileClaimsTransformation(QizzoneDbContext db) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var identity = principal.Identities.FirstOrDefault(item => item.IsAuthenticated);
        var uid = principal.FindFirst("firebase:uid")?.Value;
        if (identity is null || string.IsNullOrWhiteSpace(uid) ||
            identity.HasClaim("qizzone:profile_checked", "true"))
        {
            return principal;
        }

        var profile = await db.Profiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.FirebaseUid == uid);

        identity.AddClaim(new Claim("qizzone:profile_checked", "true"));
        if (profile is null || profile.ApprovalStatus != "approved")
        {
            return principal;
        }

        if (profile.Role == "admin")
        {
            identity.AddClaim(new Claim("qizzone:role", "admin"));
            identity.AddClaim(new Claim("qizzone:active_role", "admin"));
        }
        else if (profile.Role == "teacher")
        {
            identity.AddClaim(new Claim("qizzone:role", "teacher"));
            identity.AddClaim(new Claim("qizzone:active_role", "teacher"));
        }
        else if (profile.Role == "student")
        {
            identity.AddClaim(new Claim("qizzone:role", "student"));
            var hasTeacherCapability = profile.TeacherRequestStatus == "approved" && !profile.TeacherRequestBlocked;
            if (hasTeacherCapability)
            {
                identity.AddClaim(new Claim("qizzone:role", "teacher"));
            }

            var activeRole = profile.ActiveRole == "teacher" && hasTeacherCapability ? "teacher" : "student";
            identity.AddClaim(new Claim("qizzone:active_role", activeRole));
        }

        return principal;
    }
}
