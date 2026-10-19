import { useEffect, useRef, useState } from "react";
import type { PlayerControls } from "../lib/ytplayer";
import { createPlayer } from "../lib/ytplayer";
import { fmtTime } from "../lib/time";
import type { VideoMeta } from "../types";

interface Props {
  meta: VideoMeta;
  onPlayerReady: (controls: PlayerControls | null) => void;
  onNewVideo?: () => void;
}

/** YouTube embed player + thông tin video + nút đánh dấu mốc thời gian. */
export default function VideoPreview({ meta, onPlayerReady, onNewVideo }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<PlayerControls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [embedFailed, setEmbedFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let controls: PlayerControls | null = null;
    setEmbedFailed(false);
    setLoading(true);
    setCurrent(0);
    setPlaying(false);

    const mount = holderRef.current?.querySelector("div");
    if (!mount) return;

    createPlayer(mount, meta.id, {
      onReady: () => setLoading(false),
      onStateChange: (state) => {
        // 1 = playing, 2 = paused, 0 = ended
        setPlaying(state === 1);
      },
      onError: () => setEmbedFailed(true),
    })
      .then((c) => {
        if (cancelled) {
          c.destroy();
          return;
        }
        controls = c;
        controlsRef.current = c;
        onPlayerReady(c);
      })
      .catch(() => setEmbedFailed(true));

    const timer = window.setInterval(() => {
      const c = controlsRef.current;
      if (c) setCurrent(c.currentTime());
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      onPlayerReady(null);
      try {
        controls?.destroy();
      } catch {
        /* player có thể đã bị thay thế */
      }
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  const markTime = (kind: "start" | "end") => {
    const c = controlsRef.current;
    if (!c) return;
    const t = c.currentTime();
    const ev = new CustomEvent("yt-mark", { detail: { kind, time: t } });
    window.dispatchEvent(ev);
  };

  return (
    <section className="preview">
      <div className="preview-media">
        {embedFailed ? (
          <div className="embed-fallback">
            <img src={meta.thumbnail} alt={meta.title} />
            <p>Video không cho phép nhúng preview — vẫn trích xuất được bình thường.</p>
          </div>
        ) : (
          <div className="player-box">
            {loading && <div className="player-loading">Đang tải player...</div>}
            <div ref={holderRef} className="player-holder">
              <div />
            </div>
          </div>
        )}
      </div>

      <div className="preview-info">
        <div className="preview-head">
          <h2 title={meta.title}>{meta.title}</h2>
          {onNewVideo && (
            <button className="btn ghost small" onClick={onNewVideo}>
              🎬 Đổi video
            </button>
          )}
        </div>
        <p className="sub">
          {meta.uploader && <span>{meta.uploader} · </span>}
          <span>Thời lượng: {meta.duration ? fmtTime(meta.duration) : "không rõ"}</span>
        </p>
        {!embedFailed && (
          <div className="player-toolbar">
            <button
              className="btn ghost"
              onClick={() => (playing ? controlsRef.current?.pause() : controlsRef.current?.play())}
            >
              {playing ? "❚❚ Tạm dừng" : "▶ Phát"}
            </button>
            <span className="time-now">{fmtTime(current)}</span>
            <span className="spacer" />
            <button className="btn ghost" onClick={() => markTime("start")}>
              ⟵ Đặt bắt đầu tại đây
            </button>
            <button className="btn ghost" onClick={() => markTime("end")}>
              Đặt kết thúc tại đây ⟶
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
