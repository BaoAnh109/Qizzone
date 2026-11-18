using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    public partial class CancelAiImportJobs : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ai_import_jobs_status_check",
                table: "ai_import_jobs");

            migrationBuilder.AddCheckConstraint(
                name: "ai_import_jobs_status_check",
                table: "ai_import_jobs",
                sql: "status IN ('queued','processing','succeeded','failed','cancelled')");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE ai_import_jobs SET status = 'failed', error_code = 'job_cancelled' WHERE status = 'cancelled';");

            migrationBuilder.DropCheckConstraint(
                name: "ai_import_jobs_status_check",
                table: "ai_import_jobs");

            migrationBuilder.AddCheckConstraint(
                name: "ai_import_jobs_status_check",
                table: "ai_import_jobs",
                sql: "status IN ('queued','processing','succeeded','failed')");
        }
    }
}
