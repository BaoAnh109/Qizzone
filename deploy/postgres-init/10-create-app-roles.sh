#!/bin/sh
set -eu

case "$POSTGRES_USER" in
    qizzone_app|qizzone_migrator)
        echo "POSTGRES_ADMIN_USER must be separate from the application roles." >&2
        exit 1
        ;;
esac

case "$POSTGRES_DB" in
    ''|*[!a-z0-9_]*)
        echo "POSTGRES_DB may contain lowercase letters, digits, and underscores only." >&2
        exit 1
        ;;
esac

app_password="$(cat /run/secrets/qizzone_app_db_password)"
migrator_password="$(cat /run/secrets/qizzone_migrator_db_password)"

for password in "$app_password" "$migrator_password"; do
    if ! printf '%s' "$password" | grep -Eq '^[0-9a-f]{64}$'; then
        echo "Database role passwords must be 64 lowercase hexadecimal characters." >&2
        exit 1
    fi
done

{
    printf '%s\n' "\set app_password '$app_password'"
    printf '%s\n' "\set migrator_password '$migrator_password'"
    printf '%s\n' "\set database_name '$POSTGRES_DB'"
    cat <<'SQL'
CREATE ROLE qizzone_app LOGIN PASSWORD :'app_password';
CREATE ROLE qizzone_migrator LOGIN PASSWORD :'migrator_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO qizzone_app, qizzone_migrator;
GRANT USAGE ON SCHEMA public TO qizzone_app;
GRANT USAGE, CREATE ON SCHEMA public TO qizzone_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE qizzone_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qizzone_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qizzone_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qizzone_app;
SQL
} | psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1

unset app_password migrator_password password
