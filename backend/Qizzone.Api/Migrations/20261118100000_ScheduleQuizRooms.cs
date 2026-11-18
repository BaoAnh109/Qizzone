using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class ScheduleQuizRooms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "quizzes_status_check",
                table: "quizzes");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "closes_at",
                table: "quizzes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "opens_at",
                table: "quizzes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "quizzes_schedule_close",
                table: "quizzes",
                columns: new[] { "status", "closes_at" });

            migrationBuilder.CreateIndex(
                name: "quizzes_schedule_open",
                table: "quizzes",
                columns: new[] { "status", "opens_at" });

            migrationBuilder.AddCheckConstraint(
                name: "quizzes_schedule_check",
                table: "quizzes",
                sql: "(status <> 'scheduled' OR opens_at IS NOT NULL) AND (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)");

            migrationBuilder.AddCheckConstraint(
                name: "quizzes_status_check",
                table: "quizzes",
                sql: "status IN ('draft','scheduled','published','closed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "quizzes_schedule_close",
                table: "quizzes");

            migrationBuilder.DropIndex(
                name: "quizzes_schedule_open",
                table: "quizzes");

            migrationBuilder.DropCheckConstraint(
                name: "quizzes_schedule_check",
                table: "quizzes");

            migrationBuilder.DropCheckConstraint(
                name: "quizzes_status_check",
                table: "quizzes");

            migrationBuilder.DropColumn(
                name: "closes_at",
                table: "quizzes");

            migrationBuilder.DropColumn(
                name: "opens_at",
                table: "quizzes");

            migrationBuilder.AddCheckConstraint(
                name: "quizzes_status_check",
                table: "quizzes",
                sql: "status IN ('draft','published','closed')");
        }
    }
}
