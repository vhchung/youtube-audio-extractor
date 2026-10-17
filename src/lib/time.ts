/** Định dạng và phân tích thời lượng (giây ↔ mm:ss / h:mm:ss). */

export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Nhận "ss", "mm:ss" hoặc "h:mm:ss" (chấp nhận số thập phân ở giây). */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,3}(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  const secs = parts.pop() ?? 0;
  const mins = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  if (mins >= 60 || secs >= 60) return null;
  const total = hours * 3600 + mins * 60 + secs;
  return Number.isFinite(total) ? total : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
