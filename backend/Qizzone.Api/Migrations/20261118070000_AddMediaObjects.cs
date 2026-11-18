using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMediaObjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "media_objects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    content_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    extension = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    length_bytes = table.Column<long>(type: "bigint", nullable: false),
                    sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_media_objects", x => x.id);
                    table.CheckConstraint("media_objects_content_type_check", "content_type IN ('image/jpeg','image/png','image/webp')");
                    table.CheckConstraint("media_objects_extension_check", "extension IN ('.jpg','.png','.webp')");
                    table.CheckConstraint("media_objects_length_check", "length_bytes > 0 AND length_bytes <= 2097152");
                    table.ForeignKey(
                        name: "FK_media_objects_profiles_owner_uid",
                        column: x => x.owner_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "media_objects_owner_created",
                table: "media_objects",
                columns: new[] { "owner_uid", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "media_objects");
        }
    }
}
