FROM mcr.microsoft.com/dotnet/sdk:10.0.404 AS build
WORKDIR /src
COPY Qizzone.Api/Qizzone.Api.csproj Qizzone.Api/
COPY Qizzone.Api/packages.lock.json Qizzone.Api/
RUN dotnet restore Qizzone.Api/Qizzone.Api.csproj --locked-mode
COPY Qizzone.Api/ Qizzone.Api/
WORKDIR /src/Qizzone.Api
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0.15 AS runtime
ARG QIZZONE_RELEASE_SHA=unknown
LABEL org.opencontainers.image.revision=$QIZZONE_RELEASE_SHA
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl \
    && mkdir -p /data/media \
    && chown "$APP_UID:$APP_UID" /data/media \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Qizzone.Api.dll"]
