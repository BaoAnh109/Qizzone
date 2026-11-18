using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class QuizResultReportColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_passed",
                table: "exam_results",
                type: "boolean",
                nullable: true,
                computedColumnSql: "NULLIF(payload ->> 'isPassed', '')::boolean",
                stored: true);

            migrationBuilder.AddColumn<decimal>(
                name: "percentage",
                table: "exam_results",
                type: "numeric",
                nullable: true,
                computedColumnSql: "NULLIF(payload ->> 'percentage', '')::numeric",
                stored: true);

            migrationBuilder.AddColumn<decimal>(
                name: "score",
                table: "exam_results",
                type: "numeric",
                nullable: true,
                computedColumnSql: "NULLIF(payload ->> 'score', '')::numeric",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "exam_results_is_passed",
                table: "exam_results",
                column: "is_passed");

            migrationBuilder.CreateIndex(
                name: "exam_results_score",
                table: "exam_results",
                column: "score");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "exam_results_is_passed",
                table: "exam_results");

            migrationBuilder.DropIndex(
                name: "exam_results_score",
                table: "exam_results");

            migrationBuilder.DropColumn(
                name: "is_passed",
                table: "exam_results");

            migrationBuilder.DropColumn(
                name: "percentage",
                table: "exam_results");

            migrationBuilder.DropColumn(
                name: "score",
                table: "exam_results");

        }
    }
}
