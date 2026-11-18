namespace Qizzone.Api.Features;

public sealed class LocalMediaStore
{
    private readonly string _rootPath;

    public LocalMediaStore(string rootPath)
    {
        if (string.IsNullOrWhiteSpace(rootPath))
        {
            throw new ArgumentException("A persistent media directory is required.", nameof(rootPath));
        }

        _rootPath = Path.GetFullPath(rootPath);
        Directory.CreateDirectory(_rootPath);
    }

    public async Task WriteAsync(Guid id, string extension, ReadOnlyMemory<byte> content, CancellationToken cancellationToken)
    {
        if (!IsAllowedExtension(extension)) throw new ArgumentException("Unsupported media extension.", nameof(extension));

        var destination = GetPath(id, extension);
        var temporary = Path.Combine(_rootPath, $".{id:N}.{Guid.NewGuid():N}.partial");
        try
        {
            await using (var stream = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await stream.WriteAsync(content, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            File.Move(temporary, destination, overwrite: false);
        }
        catch
        {
            TryDelete(temporary);
            throw;
        }
    }

    public Stream? OpenRead(Guid id, string extension)
    {
        if (!IsAllowedExtension(extension)) return null;
        var path = GetPath(id, extension);
        return File.Exists(path)
            ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan)
            : null;
    }

    public void Delete(Guid id, string extension)
    {
        if (IsAllowedExtension(extension)) TryDelete(GetPath(id, extension));
    }

    private string GetPath(Guid id, string extension) => Path.Combine(_rootPath, $"{id:N}{extension}");

    private static bool IsAllowedExtension(string extension) => extension is ".jpg" or ".png" or ".webp";

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
            // Keep the original storage or database error as the reported failure.
        }
        catch (UnauthorizedAccessException)
        {
            // Keep the original storage or database error as the reported failure.
        }
    }
}
