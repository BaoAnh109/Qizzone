import { qizzoneApiAssetUrl } from '@/lib/cloud';

const QIZZONE_MEDIA_REFERENCE_PREFIX = 'media://qizzone/';
const MEDIA_ID_PATTERN = /^[0-9a-f]{32}$/i;

export function resolveMediaUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(QIZZONE_MEDIA_REFERENCE_PREFIX)) return value;

  const id = value.slice(QIZZONE_MEDIA_REFERENCE_PREFIX.length);
  if (!MEDIA_ID_PATTERN.test(id)) return undefined;
  return qizzoneApiAssetUrl(`/api/v1/media/${id}`);
}
