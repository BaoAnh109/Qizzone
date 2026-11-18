FROM mcr.microsoft.com/dotnet/sdk:10.0.404 AS build
WORKDIR /src
COPY Qizzone.Api/Qizzone.Api.csproj Qizzone.Api/
COPY Qizzone.Worker/Qizzone.Worker.csproj Qizzone.Worker/
RUN dotnet restore Qizzone.Worker/Qizzone.Worker.csproj
COPY Qizzone.Api/ Qizzone.Api/
COPY Qizzone.Worker/ Qizzone.Worker/
WORKDIR /src/Qizzone.Worker
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/runtime:10.0.15 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Qizzone.Worker.dll"]
