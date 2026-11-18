using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Qizzone.Api.Data;

public sealed class QizzoneDbContextFactory : IDesignTimeDbContextFactory<QizzoneDbContext>
{
    public QizzoneDbContext CreateDbContext(string[] args)
    {
        var connectionStringFile = Environment.GetEnvironmentVariable("ConnectionStrings__QizzoneFile");
        var connectionString = !string.IsNullOrWhiteSpace(connectionStringFile)
            ? File.ReadAllText(connectionStringFile).Trim()
            : Environment.GetEnvironmentVariable("ConnectionStrings__Qizzone");

        var options = new DbContextOptionsBuilder<QizzoneDbContext>()
            .UseNpgsql(string.IsNullOrWhiteSpace(connectionString)
                ? "Host=localhost;Database=qizzone;Username=qizzone;Password=design-time-only"
                : connectionString)
            .Options;

        return new QizzoneDbContext(options);
    }
}
