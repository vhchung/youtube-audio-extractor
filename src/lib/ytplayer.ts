/** Nạp YouTube IFrame API một lần và tạo player điều khiển được. */

/* eslint-disable @typescript-eslint/no-explicit-any */

let apiPromise: Promise<any> | null = null;

export function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Không tải được YouTube IFrame API"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface PlayerControls {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  currentTime: () => number;
  destroy: () => void;
}

export async function createPlayer(
  element: HTMLElement,
  videoId: string,
  handlers: {
    onReady?: () => void;
    onStateChange?: (state: number) => void;
    onError?: (code: number) => void;
  },
): Promise<PlayerControls> {
  const YT = await loadYouTubeApi();
  return new Promise((resolve) => {
    const player = new YT.Player(element, {
      videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: () => {
          handlers.onReady?.();
          resolve({
            play: () => player.playVideo(),
            pause: () => player.pauseVideo(),
            seek: (seconds: number) => player.seekTo(seconds, true),
            currentTime: () => player.getCurrentTime?.() ?? 0,
            destroy: () => player.destroy(),
          });
        },
        onStateChange: (e: any) => handlers.onStateChange?.(e.data as number),
        onError: (e: any) => handlers.onError?.(e.data as number),
      },
    });
  });
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
