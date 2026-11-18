using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class AllowFiveOptionAnswers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "question_answer_keys_answers_array_check",
                table: "question_answer_keys");

            migrationBuilder.DropCheckConstraint(
                name: "practice_answers_selected_array_check",
                table: "practice_answers");

            migrationBuilder.AddCheckConstraint(
                name: "question_answer_keys_answers_array_check",
                table: "question_answer_keys",
                sql: "jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 5");

            migrationBuilder.AddCheckConstraint(
                name: "practice_answers_selected_array_check",
                table: "practice_answers",
                sql: "jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 5");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "question_answer_keys_answers_array_check",
                table: "question_answer_keys");

            migrationBuilder.DropCheckConstraint(
                name: "practice_answers_selected_array_check",
                table: "practice_answers");

            migrationBuilder.AddCheckConstraint(
                name: "question_answer_keys_answers_array_check",
                table: "question_answer_keys",
                sql: "jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 4");

            migrationBuilder.AddCheckConstraint(
                name: "practice_answers_selected_array_check",
                table: "practice_answers",
                sql: "jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 4");
        }
    }
}
