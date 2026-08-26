const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_RE = /(?<![0-9a-f])\d+(?![0-9a-f])/g;
const HEX_RE = /\b[0-9a-f]{8,}\b/gi;

export function toPattern(key: string): string {
  return key
    .replace(UUID_RE, "{id}")
    .replace(HEX_RE, "{hex}")
    .replace(NUMERIC_RE, "{n}");
}
