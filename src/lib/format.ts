export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64 || '');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

export function bytesToText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Bytes that no terminal would print — a decent "this is binary" signal. */
export function looksBinary(bytes: Uint8Array): boolean {
  const scan = Math.min(bytes.length, 512);
  for (let i = 0; i < scan; i += 1) {
    const byte = bytes[i] ?? 0;
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) return true;
  }
  return false;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ParsedJson = { ok: true; value: JsonValue } | { ok: false };

export function parseJson(text: string): ParsedJson {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{"\-0-9tfn]/.test(trimmed)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonValue };
  } catch {
    return { ok: false };
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export function clockTime(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function fullTime(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export interface HexRow {
  offset: string;
  hex: string;
  ascii: string;
}

export function hexDump(bytes: Uint8Array, maxRows = 512): { rows: HexRow[]; truncated: boolean } {
  const rows: HexRow[] = [];
  for (let offset = 0; offset < bytes.length && rows.length < maxRows; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, '0'));
    const gapped = `${hex.slice(0, 8).join(' ').padEnd(23, ' ')}  ${hex.slice(8).join(' ')}`;
    const ascii = Array.from(slice, (byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '·')).join('');
    rows.push({ offset: offset.toString(16).padStart(8, '0'), hex: gapped.trimEnd(), ascii });
  }
  return { rows, truncated: bytes.length > maxRows * 16 };
}

export function topicSegments(topic: string): string[] {
  return String(topic).split('/');
}

export function isWildcard(segment: string): boolean {
  return segment === '+' || segment === '#';
}
