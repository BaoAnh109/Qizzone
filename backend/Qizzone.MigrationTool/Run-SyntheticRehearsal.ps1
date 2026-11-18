param(
    [string]$PsqlPath = $env:QIZZONE_TEST_PSQL_PATH
)

$ErrorActionPreference = 'Stop'
$environmentNames = @(
    'PGSSLMODE',
    'ConnectionStrings__Qizzone',
    'QIZZONE_MIGRATION_SOURCE_CONNECTION_STRING',
    'QIZZONE_MIGRATION_TARGET_CONNECTION_STRING'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$createdDatabases = [System.Collections.Generic.List[string]]::new()
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$backendRoot = Join-Path $repoRoot 'backend'
$apiProject = Join-Path $backendRoot 'Qizzone.Api\Qizzone.Api.csproj'
$toolProject = Join-Path $PSScriptRoot 'Qizzone.MigrationTool.csproj'
$fixturePath = Join-Path $PSScriptRoot 'fixtures\synthetic-source.sql'
$runId = [Guid]::NewGuid().ToString('N')
$targetDatabase = "qizzone_rehearsal_target_$runId"
$sourceDatabase = "qizzone_rehearsal_source_$runId"

function Restore-Environment([string]$Name, [string]$Value) {
    if ($null -eq $Value) {
        [Environment]::SetEnvironmentVariable($Name, $null, 'Process')
    } else {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($env:PGHOST) -or [string]::IsNullOrWhiteSpace($env:PGPORT) -or [string]::IsNullOrWhiteSpace($env:PGUSER)) {
        throw 'Set PGHOST, PGPORT, and PGUSER for a disposable local PostgreSQL instance.'
    }

    $parsedHost = $null
    $isLoopbackHost = $env:PGHOST -eq 'localhost' -or (
        [System.Net.IPAddress]::TryParse($env:PGHOST, [ref]$parsedHost) -and
        [System.Net.IPAddress]::IsLoopback($parsedHost)
    )
    if (-not $isLoopbackHost) {
        throw 'The rehearsal only accepts a localhost/loopback PostgreSQL host. Never point it at Supabase or a hosted database.'
    }

    if ([string]::IsNullOrWhiteSpace($PsqlPath)) {
        $psqlCommand = Get-Command 'psql' -ErrorAction SilentlyContinue
        if ($psqlCommand) { $PsqlPath = $psqlCommand.Source }
    }
    if ([string]::IsNullOrWhiteSpace($PsqlPath) -or -not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
        throw 'Set -PsqlPath or QIZZONE_TEST_PSQL_PATH to the psql executable for the disposable local server.'
    }
    if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
        throw 'The synthetic source fixture is missing.'
    }

    $env:PGSSLMODE = 'disable'

    function New-DatabaseConnectionString([string]$DatabaseName) {
        $builder = [System.Data.Common.DbConnectionStringBuilder]::new()
        $builder['Host'] = $env:PGHOST
        $builder['Port'] = [int]$env:PGPORT
        $builder['Database'] = $DatabaseName
        $builder['Username'] = $env:PGUSER
        if (-not [string]::IsNullOrEmpty($env:PGPASSWORD)) { $builder['Password'] = $env:PGPASSWORD }
        $builder['Pooling'] = $false
        return $builder.ConnectionString
    }

    function Invoke-LocalPsql([string]$DatabaseName, [string[]]$PsqlArguments) {
        $arguments = @('-h', $env:PGHOST, '-p', $env:PGPORT, '-U', $env:PGUSER, '-d', $DatabaseName, '-v', 'ON_ERROR_STOP=1') + $PsqlArguments
        $output = & $script:PsqlPath @arguments
        if ($LASTEXITCODE -ne 0) { throw "psql failed while working with disposable database '$DatabaseName'." }
        return $output
    }

    function Get-LocalScalar([string]$DatabaseName, [string]$Sql) {
        $output = Invoke-LocalPsql $DatabaseName @('-A', '-t', '-c', $Sql)
        return [long](($output -join '').Trim())
    }

    $null = Invoke-LocalPsql 'postgres' @('-c', "CREATE DATABASE $targetDatabase")
    $createdDatabases.Add($targetDatabase)

    $targetConnectionString = New-DatabaseConnectionString $targetDatabase
    $sourceConnectionString = New-DatabaseConnectionString $sourceDatabase

    Push-Location $backendRoot
    try {
        & dotnet tool restore --tool-manifest '.\dotnet-tools.json'
        if ($LASTEXITCODE -ne 0) { throw 'Restoring the repository-pinned EF tool failed.' }
        $env:ConnectionStrings__Qizzone = $targetConnectionString
        & dotnet ef database update --project $apiProject --startup-project $apiProject --configuration Release
        if ($LASTEXITCODE -ne 0) { throw 'Applying EF migrations to the disposable target failed.' }
    } finally {
        Pop-Location
    }

    $null = Invoke-LocalPsql 'postgres' @('-c', "CREATE DATABASE $sourceDatabase TEMPLATE $targetDatabase")
    $createdDatabases.Add($sourceDatabase)
    $null = Invoke-LocalPsql $sourceDatabase @('-f', $fixturePath)

    $env:QIZZONE_MIGRATION_SOURCE_CONNECTION_STRING = $sourceConnectionString
    $env:QIZZONE_MIGRATION_TARGET_CONNECTION_STRING = $targetConnectionString
    Push-Location $repoRoot
    try {
        & dotnet build $toolProject --configuration Release
        if ($LASTEXITCODE -ne 0) { throw 'Building the migration tool failed.' }

        $firstPlanLines = & dotnet run --project $toolProject --configuration Release --no-build -- plan
        if ($LASTEXITCODE -ne 0) { throw 'The first read-only migration plan failed.' }
        $firstPlan = ($firstPlanLines -join "`n") | ConvertFrom-Json
        if (-not $firstPlan.databaseDataCanBeApplied -or $firstPlan.conditions.Count -ne 0) {
            throw 'The synthetic fixture and empty target did not produce an applicable plan.'
        }
        if ($firstPlan.checks.openExamAttempts -ne 1) {
            throw 'The fixture did not report exactly one resumable open exam attempt.'
        }

        $secondPlanLines = & dotnet run --project $toolProject --configuration Release --no-build -- plan
        if ($LASTEXITCODE -ne 0) { throw 'The second read-only migration plan failed.' }
        $secondPlan = ($secondPlanLines -join "`n") | ConvertFrom-Json
        if ($firstPlan.sourceDigest -ne $secondPlan.sourceDigest -or $firstPlan.sourceDigest.Length -ne 64) {
            throw 'Repeated plans did not return the same SHA-256 digest for the unchanged fixture.'
        }

        $mediaGuardSql = @'
INSERT INTO public.profiles (
    firebase_uid, email, full_name, role, active_role, approval_status,
    teacher_request_status, teacher_request_blocked, created_at, updated_at
)
VALUES ('media-guard-fixture', 'media-guard@example.test', 'Media Guard', 'student', 'student', 'approved', 'none', false, now(), now());
INSERT INTO public.media_objects (id, owner_uid, content_type, extension, length_bytes, sha256, created_at)
VALUES ('66666666-6666-4666-8666-666666666666', 'media-guard-fixture', 'image/png', '.png', 1, repeat('a', 64), now());
'@
        $null = Invoke-LocalPsql $targetDatabase @('-c', $mediaGuardSql)
        $targetOnlyPlanLines = & dotnet run --project $toolProject --configuration Release --no-build -- plan
        if ($LASTEXITCODE -ne 2) { throw 'The plan did not return its expected blocked-plan exit code for target-only media data.' }
        $targetOnlyPlan = ($targetOnlyPlanLines -join "`n") | ConvertFrom-Json
        $mediaObjectsProperty = $targetOnlyPlan.target.targetOnlyRows.PSObject.Properties['media_objects']
        $mediaObjectsOnTarget = if ($null -eq $mediaObjectsProperty) { 0 } else { [long]$mediaObjectsProperty.Value }
        if ($mediaObjectsOnTarget -ne 1 -or $targetOnlyPlan.databaseDataCanBeApplied) {
            throw 'The plan did not identify target-only media_objects data as an import blocker.'
        }
        $previousErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $null = & dotnet run --project $toolProject --configuration Release --no-build -- apply --expected-source-digest $firstPlan.sourceDigest 2>&1
        $blockedMediaApplyExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousErrorPreference
        if ($blockedMediaApplyExitCode -ne 2) { throw 'Apply did not reject target-only media data.' }
        $targetRowsAfterBlockedMediaApply = Get-LocalScalar $targetDatabase @'
SELECT COALESCE(sum(row_count), 0)::bigint
FROM (
    SELECT count(*) AS row_count FROM public.profiles
    UNION ALL SELECT count(*) FROM public.quizzes
    UNION ALL SELECT count(*) FROM public.questions
    UNION ALL SELECT count(*) FROM public.question_answer_keys
    UNION ALL SELECT count(*) FROM public.exam_attempts
    UNION ALL SELECT count(*) FROM public.exam_answers
    UNION ALL SELECT count(*) FROM public.exam_results
    UNION ALL SELECT count(*) FROM public.practice_sessions
    UNION ALL SELECT count(*) FROM public.practice_answers
    UNION ALL SELECT count(*) FROM public.data_migrations
    UNION ALL SELECT count(*) FROM public.ai_rate_limits
    UNION ALL SELECT count(*) FROM public.media_objects
) AS target_rows
'@
        if ($targetRowsAfterBlockedMediaApply -ne 2) { throw 'The blocked media apply wrote source rows into the target.' }
        $null = Invoke-LocalPsql $targetDatabase @('-c', "DELETE FROM public.media_objects WHERE id = '66666666-6666-4666-8666-666666666666'; DELETE FROM public.profiles WHERE firebase_uid = 'media-guard-fixture';")

        $previousErrorPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $null = & dotnet run --project $toolProject --configuration Release --no-build -- apply --expected-source-digest ('0' * 64) 2>&1
        $badDigestExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousErrorPreference
        if ($badDigestExitCode -ne 2) { throw 'Apply did not reject the incorrect source digest.' }

        $targetRowsAfterRejectedDigest = Get-LocalScalar $targetDatabase @'
SELECT COALESCE(sum(row_count), 0)::bigint
FROM (
    SELECT count(*) AS row_count FROM public.profiles
    UNION ALL SELECT count(*) FROM public.quizzes
    UNION ALL SELECT count(*) FROM public.questions
    UNION ALL SELECT count(*) FROM public.question_answer_keys
    UNION ALL SELECT count(*) FROM public.exam_attempts
    UNION ALL SELECT count(*) FROM public.exam_answers
    UNION ALL SELECT count(*) FROM public.exam_results
    UNION ALL SELECT count(*) FROM public.practice_sessions
    UNION ALL SELECT count(*) FROM public.practice_answers
    UNION ALL SELECT count(*) FROM public.data_migrations
    UNION ALL SELECT count(*) FROM public.ai_rate_limits
    UNION ALL SELECT count(*) FROM public.media_objects
) AS target_rows
'@
        if ($targetRowsAfterRejectedDigest -ne 0) { throw 'The rejected digest changed target rows.' }

        & dotnet run --project $toolProject --configuration Release --no-build -- apply --expected-source-digest $firstPlan.sourceDigest
        if ($LASTEXITCODE -ne 0) { throw 'Applying the reviewed synthetic migration plan failed.' }
        & dotnet run --project $toolProject --configuration Release --no-build -- apply --expected-source-digest $firstPlan.sourceDigest
        if ($LASTEXITCODE -ne 0) { throw 'The approved synthetic migration replay was not idempotent.' }

        $profiles = Get-LocalScalar $targetDatabase 'SELECT count(*) FROM public.profiles'
        $questions = Get-LocalScalar $targetDatabase 'SELECT count(*) FROM public.questions'
        $attempts = Get-LocalScalar $targetDatabase 'SELECT count(*) FROM public.exam_attempts'
        $practiceAnswers = Get-LocalScalar $targetDatabase 'SELECT count(*) FROM public.practice_answers'
        $validSnapshots = Get-LocalScalar $targetDatabase "SELECT count(*) FROM public.exam_attempts WHERE jsonb_array_length(snapshot->'questions') = cardinality(question_order)"
        $openAttemptPreserved = Get-LocalScalar $targetDatabase @'
SELECT count(*)
FROM public.exam_attempts AS attempt
JOIN public.exam_answers AS answer ON answer.attempt_id = attempt.id
WHERE attempt.id = '33333333-3333-4333-8333-333333333334'
  AND attempt.submitted_at IS NULL
  AND attempt.ends_at IS NULL
  AND attempt.duration_minutes = 0
  AND attempt.revision = 7
  AND answer.selected_answers = '["B"]'::jsonb
'@
        if ($profiles -ne 2 -or $questions -ne 1 -or $attempts -ne 2 -or $practiceAnswers -ne 1 -or $validSnapshots -ne 2 -or $openAttemptPreserved -ne 1) {
            throw 'Imported fixture row counts or the reconstructed exam snapshot did not match expectations.'
        }

        Write-Output "Synthetic migration rehearsal passed: target-only media rows blocked plan/apply without importing source rows; bad digest rejected without writes; fixture applied; replay idempotent; submitted and resumable attempts/snapshots verified. Profiles=$profiles Questions=$questions Attempts=$attempts OpenAttempts=1 PracticeAnswers=$practiceAnswers"
    } finally {
        Pop-Location
    }
} finally {
    foreach ($databaseName in $createdDatabases) {
        try {
            $null = Invoke-LocalPsql 'postgres' @('-c', "DROP DATABASE IF EXISTS $databaseName")
        } catch {
            Write-Warning "Could not remove this run's disposable database '$databaseName'; remove it manually from the local PostgreSQL instance."
        }
    }

    foreach ($name in $environmentNames) {
        Restore-Environment $name $originalEnvironment[$name]
    }
}
