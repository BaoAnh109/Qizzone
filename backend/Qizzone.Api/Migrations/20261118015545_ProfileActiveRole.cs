using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProfileActiveRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "active_role",
                table: "profiles",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "student");

            migrationBuilder.Sql("UPDATE profiles SET active_role = role WHERE role IN ('teacher','admin');");

            migrationBuilder.AddCheckConstraint(
                name: "profiles_active_role_check",
                table: "profiles",
                sql: "(role = 'student' AND active_role IN ('student','teacher')) OR (role = 'teacher' AND active_role = 'teacher') OR (role = 'admin' AND active_role = 'admin')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "profiles_active_role_check",
                table: "profiles");

            migrationBuilder.DropColumn(
                name: "active_role",
                table: "profiles");
        }
    }
}
