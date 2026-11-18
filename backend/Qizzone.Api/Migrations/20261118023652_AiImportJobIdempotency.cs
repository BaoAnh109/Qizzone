using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class AiImportJobIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ai_import_jobs_owner_uid",
                table: "ai_import_jobs");

            migrationBuilder.AddColumn<string>(
                name: "idempotency_key",
                table: "ai_import_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "request_fingerprint",
                table: "ai_import_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ai_import_jobs_owner_idempotency",
                table: "ai_import_jobs",
                columns: new[] { "owner_uid", "idempotency_key" },
                unique: true,
                filter: "idempotency_key IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ai_import_jobs_owner_idempotency",
                table: "ai_import_jobs");

            migrationBuilder.DropColumn(
                name: "idempotency_key",
                table: "ai_import_jobs");

            migrationBuilder.DropColumn(
                name: "request_fingerprint",
                table: "ai_import_jobs");

            migrationBuilder.CreateIndex(
                name: "IX_ai_import_jobs_owner_uid",
                table: "ai_import_jobs",
                column: "owner_uid");
        }
    }
}
