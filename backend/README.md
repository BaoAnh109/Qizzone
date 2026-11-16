# Qizzone V2 API — bootstrap only

This is the initial .NET 10 ASP.NET Core API scaffold created from `main` on branch `ref/Repo`.

**Not production ready:** No Firebase verification, authorization, PostgreSQL persistence, exams, autosave, grading, or AI migration is implemented yet. Do not route production traffic to this service.

Local checks when .NET 10 SDK is available:

```bash
dotnet restore backend/Qizzone.Api/Qizzone.Api.csproj
dotnet build backend/Qizzone.Api/Qizzone.Api.csproj -c Release
docker build -t qizzone-api:bootstrap ./backend
```

This scaffold deliberately leaves the existing Supabase implementation untouched until parity and migration tests are available.
