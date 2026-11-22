export function extractClassroomCode(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  try {
    const parsedUrl = new URL(trimmed, window.location.origin);
    const joinMatch = parsedUrl.pathname.match(/\/class\/join\/([^/?#]+)/i);
    if (joinMatch?.[1]) {
      return decodeURIComponent(joinMatch[1]).trim().toUpperCase();
    }
    const queryCode = parsedUrl.searchParams.get("code");
    if (queryCode) {
      return queryCode.trim().toUpperCase();
    }
  } catch {
    // Not a URL; fall through to path/raw parsing
  }

  const pathMatch = trimmed.match(/\/class\/join\/([^/?#\s]+)/i);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]).trim().toUpperCase();
  }

  return trimmed.toUpperCase();
}
