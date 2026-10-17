import { clamp, fmtTime } from "../lib/time";
import TimeField from "./TimeField";

interface Props {
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onSeek?: (seconds: number) => void;
}

const MIN_GAP = 1; // giây

/** Dual-slider chọn đoạn + ô nhập dạng hh:mm:ss (3 segment) cho bắt đầu/kết thúc. */
export default function RangeSlider({ duration, start, end, onChange, onSeek }: Props) {

  const setRange = (nextStart: number, nextEnd: number) => {
    const s = clamp(nextStart, 0, duration - MIN_GAP);
    const e = clamp(nextEnd, s + MIN_GAP, duration);
    onChange(Number(s.toFixed(1)), Number(e.toFixed(1)));
  };

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  return (
    <section className="range-slider">
      <div className="slider-head">
        <h3>Chọn đoạn trích xuất</h3>
        <span className="chip">
          {fmtTime(end - start)} / {fmtTime(duration)}
        </span>
      </div>

      <div
        className="slider-track-area"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          onSeek?.(clamp(frac * duration, 0, duration));
        }}
      >
        <div className="slider-rail" />
        <div className="slider-fill" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />
        <input
          type="range"
          className="range-input start"
          min={0}
          max={duration}
          step={0.1}
          value={start}
          onChange={(e) => setRange(Number(e.target.value), end)}
          onDoubleClick={() => onSeek?.(start)}
          aria-label="Điểm bắt đầu"
        />
        <input
          type="range"
          className="range-input end"
          min={0}
          max={duration}
          step={0.1}
          value={end}
          onChange={(e) => setRange(start, Number(e.target.value))}
          onDoubleClick={() => onSeek?.(end)}
          aria-label="Điểm kết thúc"
        />
      </div>

      <div className="time-inputs">
        <label className="time-input-item">
          <span>Bắt đầu</span>
          <TimeField seconds={start} onCommit={(s) => setRange(s, end)} />
        </label>
        <label className="time-input-item">
          <span>Kết thúc</span>
          <TimeField seconds={end} onCommit={(e) => setRange(start, e)} />
        </label>
      </div>
      <p className="hint">
        Kéo 2 nút tròn để chọn đoạn · click vào thanh để xem thử vị trí đó · nhập giờ:phút:giây
        (tự chuyển ô, mũi tên ↑↓ để tinh chỉnh)
      </p>
    </section>
  );
}
