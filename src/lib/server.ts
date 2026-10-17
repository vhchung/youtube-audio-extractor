/** HTTP client cho Python sidecar. */

import type { AudioFormat, ExtractOptions, JobState, VideoMeta } from "../types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(resp: Response): Promise<never> {
  let detail = `Lỗi server (${resp.status})`;
  try {
    const body = await resp.json();
    if (body?.detail) detail = String(body.detail);
  } catch {
    /* giữ thông báo mặc định */
  }
  throw new ApiError(resp.status, detail);
}

export class ServerClient {
  constructor(public base: string) {}

  async health(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.base}/api/health`, { signal: AbortSignal.timeout(4000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async metadata(url: string): Promise<VideoMeta> {
    const resp = await fetch(`${this.base}/api/metadata?url=${encodeURIComponent(url)}`);
    if (!resp.ok) await parseError(resp);
    return resp.json();
  }

  async extract(opts: ExtractOptions): Promise<string> {
    const resp = await fetch(`${this.base}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: opts.url,
        start: opts.start,
        end: opts.end,
        format: opts.format,
        quality: opts.quality,
        voice_only: opts.voiceOnly,
        title: opts.title,
      }),
    });
    if (!resp.ok) await parseError(resp);
    const data = await resp.json();
    return data.job_id as string;
  }

  async job(id: string): Promise<JobState> {
    const resp = await fetch(`${this.base}/api/jobs/${id}`);
    if (!resp.ok) await parseError(resp);
    return resp.json();
  }

  async cancel(id: string): Promise<JobState> {
    const resp = await fetch(`${this.base}/api/jobs/${id}/cancel`, { method: "POST" });
    if (!resp.ok) await parseError(resp);
    return resp.json();
  }

  fileUrl(id: string): string {
    return `${this.base}/api/jobs/${id}/file`;
  }
}

export function defaultQuality(format: AudioFormat): string {
  return format === "wav" ? "44100" : "192";
}
