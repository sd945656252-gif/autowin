export function normalizeProfilePhotoUrl(value?: string | null) {
  const trimmed = (value || '').trim();
  if (!trimmed || ['custom', 'null', 'undefined'].includes(trimmed.toLowerCase())) return '';
  return trimmed;
}
