using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class QuizRoomSchedule
{
    public static string GetEffectiveStatus(Quiz quiz, DateTimeOffset now)
    {
        if (quiz.Status is "draft" or "closed") return quiz.Status;
        if (quiz.ClosesAt is not null && quiz.ClosesAt <= now) return "closed";
        if (quiz.Status == "scheduled" && quiz.OpensAt <= now) return "published";
        return quiz.Status;
    }

    public static bool IsOpenForAttempts(Quiz quiz, DateTimeOffset now) =>
        GetEffectiveStatus(quiz, now) == "published";
}
