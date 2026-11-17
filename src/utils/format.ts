/** 字节 / 速度 / ETA / 时间 的展示格式化。 */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(digits);
  return `${fixed} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(etaMs?: number): string {
  if (!etaMs || !Number.isFinite(etaMs) || etaMs <= 0) return "—";
  if (etaMs < 1000) return "<1s";
  const totalSeconds = Math.round(etaMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** 2026-11-17 09:30 */
export function formatDateTime(date?: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

/** 11-17 09:30 */
export function formatDateShort(date?: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`;
}

const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/** 终端显示宽度：CJK 与 emoji 占 2 列。 */
export function charWidth(char: string): number {
  if (!char) return 0;
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (code >= 0x300 && code <= 0x36f) return 0; // combining marks
  return WIDE_CHAR.test(char) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** 按显示宽度截断，超长时以 … 结尾。 */
export function fitText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  const budget = maxWidth - 1;
  let result = "";
  let width = 0;
  for (const char of text) {
    const next = charWidth(char);
    if (width + next > budget) break;
    result += char;
    width += next;
  }
  return `${result}…`;
}

export function padEndDisplay(text: string, width: number): string {
  const fitted = fitText(text, width);
  return fitted + " ".repeat(Math.max(0, width - displayWidth(fitted)));
}

export function padStartDisplay(text: string, width: number): string {
  const fitted = fitText(text, width);
  return " ".repeat(Math.max(0, width - displayWidth(fitted))) + fitted;
}