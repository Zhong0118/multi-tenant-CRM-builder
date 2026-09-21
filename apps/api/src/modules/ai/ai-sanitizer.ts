const MAX_STRING_CODE_POINTS = 2000;
const STRIP_KEY_RE = /^(tokenHash|passwordHash|session|cookie|apiKey)$/i;

export class AiSanitizer {
  static sanitizeToolResult(result: unknown): unknown {
    return sanitizeValue(result);
  }

  static serializedBytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  }
}

function sanitizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'string') {
    return [...value].slice(0, MAX_STRING_CODE_POINTS).join('');
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (STRIP_KEY_RE.test(key)) continue;
      const sanitized = sanitizeValue(nested);
      if (sanitized === undefined) continue;
      output[key] = sanitized;
    }
    return output;
  }
  return undefined;
}
