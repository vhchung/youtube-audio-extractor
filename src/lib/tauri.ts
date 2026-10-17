/** Wrapper gọi Tauri IPC, có fallback khi chạy trong trình duyệt thường. */

import type { ServerStatusResult } from "../types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Trạng thái sidecar do Rust quản lý; trong browser tự dò port 8765+. */
export async function getServerStatus(): Promise<ServerStatusResult> {
  if (isTauri) {
    return invoke<ServerStatusResult>("server_status");
  }
  // Chế độ trình duyệt: dò server standalone trên dải port mặc định
  for (let port = 8765; port < 8785; port++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(700),
      });
      if (resp.ok) return { ready: true, port, error: null };
    } catch {
      /* thử port kế */
    }
  }
  return { ready: false, port: null, error: null };
}

/** Lưu file qua dialog native; browser thì trả về null (caller dùng link tải). */
export async function saveAudioFile(srcPath: string, suggestedName: string): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("save_audio_file", { srcPath, suggestedName });
}

export async function revealPath(path: string): Promise<void> {
  if (!isTauri) return;
  await invoke<void>("reveal_path", { path });
}
