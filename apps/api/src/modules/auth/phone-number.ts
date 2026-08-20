const CHINESE_MAINLAND_MOBILE = /^1[3-9]\d{9}$/;

export function normalizeChineseMobile(input: string): string {
  const compact = input.trim().replace(/[\s-]/g, '');
  const national = compact.startsWith('+86') ? compact.slice(3) : compact;

  if (!CHINESE_MAINLAND_MOBILE.test(national)) {
    throw new Error('INVALID_PHONE');
  }

  return `+86${national}`;
}
