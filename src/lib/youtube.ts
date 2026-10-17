/** Trích video ID từ các dạng URL YouTube phổ biến. */

const YT_RE =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

export function parseYouTubeId(url: string): string | null {
  const m = url.trim().match(YT_RE);
  return m ? m[1] : null;
}
