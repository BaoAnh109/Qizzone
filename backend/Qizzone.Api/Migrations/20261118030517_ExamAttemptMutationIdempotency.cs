using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class ExamAttemptMutationIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "exam_attempt_mutations",
                columns: table => new
                {
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    mutation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    client_sequence = table.Column<int>(type: "integer", nullable: false),
                    writer_session_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    request_fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    result_revision = table.Column<int>(type: "integer", nullable: false),
                    saved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exam_attempt_mutations", x => new { x.attempt_id, x.mutation_id });
                    table.CheckConstraint("exam_attempt_mutations_revision_check", "result_revision >= 0");
                    table.CheckConstraint("exam_attempt_mutations_sequence_check", "client_sequence > 0");
                    table.ForeignKey(
                        name: "FK_exam_attempt_mutations_exam_attempts_attempt_id",
                        column: x => x.attempt_id,
                        principalTable: "exam_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "exam_attempt_mutations");
        }
    }
}
