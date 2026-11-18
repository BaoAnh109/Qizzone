FROM mcr.microsoft.com/dotnet/sdk:10.0.404 AS build
WORKDIR /src
COPY Qizzone.Api/Qizzone.Api.csproj Qizzone.Api/
COPY Qizzone.Api/packages.lock.json Qizzone.Api/
COPY Qizzone.Worker/Qizzone.Worker.csproj Qizzone.Worker/
COPY Qizzone.Worker/packages.lock.json Qizzone.Worker/
RUN dotnet restore Qizzone.Worker/Qizzone.Worker.csproj --locked-mode
COPY Qizzone.Api/ Qizzone.Api/
COPY Qizzone.Worker/ Qizzone.Worker/
WORKDIR /src/Qizzone.Worker
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0.15 AS runtime
ARG QIZZONE_RELEASE_SHA=unknown
LABEL org.opencontainers.image.revision=$QIZZONE_RELEASE_SHA
WORKDIR /app
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Qizzone.Worker.dll"]
