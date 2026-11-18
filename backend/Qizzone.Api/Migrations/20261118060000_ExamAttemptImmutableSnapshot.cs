using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class ExamAttemptImmutableSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "snapshot",
                table: "exam_attempts",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'{}'::jsonb");

            migrationBuilder.AddCheckConstraint(
                name: "exam_attempts_snapshot_object_check",
                table: "exam_attempts",
                sql: "jsonb_typeof(snapshot) = 'object'");

            migrationBuilder.Sql("""
                UPDATE exam_attempts AS attempt
                SET snapshot = jsonb_build_object(
                    'title', quiz.title,
                    'subject', quiz.subject,
                    'roomCode', quiz.code,
                    'questions', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', question.id,
                            'ordinal', question.ordinal,
                            'content', question.content,
                            'images', COALESCE(question.images, '[]'::jsonb),
                            'type', question.type,
                            'options', COALESCE(question.options, '[]'::jsonb),
                            'correctAnswers', COALESCE(answer_key.correct_answers, '[]'::jsonb),
                            'explanation', COALESCE(answer_key.explanation, ''),
                            'points', question.points
                        ) ORDER BY question.ordinal)
                        FROM questions AS question
                        LEFT JOIN question_answer_keys AS answer_key ON answer_key.question_id = question.id
                        WHERE question.quiz_id = attempt.quiz_id
                          AND question.id = ANY(attempt.question_order)
                    ), '[]'::jsonb)
                )
                FROM quizzes AS quiz
                WHERE quiz.id = attempt.quiz_id
                  AND attempt.snapshot = '{}'::jsonb
                  AND cardinality(attempt.question_order) > 0;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "exam_attempts_snapshot_object_check",
                table: "exam_attempts");

            migrationBuilder.DropColumn(
                name: "snapshot",
                table: "exam_attempts");
        }
    }
}
