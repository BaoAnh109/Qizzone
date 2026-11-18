# Qizzone relational migration tool

The tool creates a read-only, count/checksum plan from a Supabase-compatible PostgreSQL source, then allows a digest-gated relational import into an empty target after the required EF migrations are applied. It imports open exam attempts, their saved answers, ordering, and deadlines so students can resume in V2; the attempt count remains part of the source digest. `apply` rechecks the source immediately before commit and rolls back the target if the source changed during import. It never migrates Firebase Auth users or Storage objects and blocks when source data still depends on those systems. Target-only V2 tables, including `media_objects`, must be empty before the source import; the plan reports their counts and `apply` checks them under a transaction lock.

## Synthetic rehearsal

Run `Run-SyntheticRehearsal.ps1` only with a disposable PostgreSQL instance on `localhost` or a loopback IP. It refuses remote database hosts, generates unique source/target database names, applies the current EF migrations to the target, seeds synthetic rows, verifies that a target-only `media_objects` row blocks both planning and apply without importing source rows, checks digest rejection, imports and replays the fixture, then removes only the databases it created. The script requires `psql`, `dotnet`, the repository-pinned EF tool, and PostgreSQL `CREATEDB` permission. Standard `PGHOST`, `PGPORT`, `PGUSER`, and optional `PGPASSWORD` variables must already be set for that disposable local instance. Nothing prints connection values or fixture row contents.

```powershell
pwsh -NoProfile -File .\backend\Qizzone.MigrationTool\Run-SyntheticRehearsal.ps1 -PsqlPath 'C:\path\to\psql.exe'
```

The synthetic rehearsal verifies importer mechanics against fabricated data, including a saved open attempt with no deadline and exact answer/revision preservation. It is not a backup, production export, migration of live Supabase, account mapping, business reconciliation, or restore proof.

## Manual plan and apply

Set `QIZZONE_MIGRATION_SOURCE_CONNECTION_STRING` and optionally `QIZZONE_MIGRATION_TARGET_CONNECTION_STRING` in the process environment (or use their `_FILE` variants), then run:

```powershell
dotnet run --project backend/Qizzone.MigrationTool -- plan
```

`apply` requires a separately reviewed source digest from an applicable plan. Use it only after write freeze, verified backup/restore, target migration, account/storage reconciliation, and an approved cutover window. Open attempts are copied and remain resumable; ensure clients have synchronized their answers before freezing writes:

```powershell
dotnet run --project backend/Qizzone.MigrationTool -- apply --expected-source-digest <sha256>
```

Never put a production connection string in command arguments, shell history, source control, or logs. The tool does not make deployment or cutover decisions for the operator.
