using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Qizzone.Api.Data;

public sealed class QizzoneDbContextFactory : IDesignTimeDbContextFactory<QizzoneDbContext>
{
    public QizzoneDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<QizzoneDbContext>()
            .UseNpgsql("Host=localhost;Database=qizzone;Username=qizzone;Password=design-time-only")
            .Options;

        return new QizzoneDbContext(options);
    }
}
