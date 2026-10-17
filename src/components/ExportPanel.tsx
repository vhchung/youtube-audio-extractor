import { useEffect, useState } from "react";
import { fmtTime } from "../lib/time";
import { defaultQuality } from "../lib/server";
import type { AudioFormat } from "../types";

interface Props {
  start: number;
  end: number;
  disabled?: boolean;
  onExport: (format: AudioFormat, quality: string, voiceOnly: boolean) => void;
}

const FORMATS: { value: AudioFormat; label: string; note: string }[] = [
  { value: "mp3", label: "MP3", note: "tương thích nhất" },
  { value: "aac", label: "AAC", note: "nhẹ, chất lượng tốt" },
  { value: "wav", label: "WAV", note: "không nén" },
];

function qualitiesFor(format: AudioFormat): { value: string; label: string }[] {
  if (format === "wav") {
    return [
      { value: "44100", label: "44.1 kHz (chất lượng CD)" },
      { value: "48000", label: "48 kHz (chất lượng video)" },
    ];
  }
  return [
    { value: "128", label: "128 kbps — file nhỏ" },
    { value: "192", label: "192 kbps — cân bằng" },
    { value: "256", label: "256 kbps — tốt" },
    { value: "320", label: "320 kbps — tốt nhất" },
  ];
}

/** Chọn định dạng, chất lượng, tùy chọn chỉ giữ lời thoại — rồi xuất file. */
export default function ExportPanel({ start, end, disabled, onExport }: Props) {
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [quality, setQuality] = useState("192");
  const [voiceOnly, setVoiceOnly] = useState(false);

  useEffect(() => {
    setQuality(defaultQuality(format));
  }, [format]);

  return (
    <section className="export-panel">
      <h3>Xuất file âm thanh</h3>

      <div className="format-row" role="radiogroup" aria-label="Định dạng">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            role="radio"
            aria-checked={format === f.value}
            className={`format-card ${format === f.value ? "active" : ""}`}
            onClick={() => setFormat(f.value)}
          >
            <span className="fmt">{f.label}</span>
            <span className="note">{f.note}</span>
          </button>
        ))}
      </div>

      <label className="quality-row">
        <span>Chất lượng</span>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          {qualitiesFor(format).map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </label>

      <label className="voice-row">
        <input
          type="checkbox"
          checked={voiceOnly}
          onChange={(e) => setVoiceOnly(e.target.checked)}
        />
        <span className="voice-text">
          <strong>Chỉ trích xuất lời thoại</strong>
          <small>
            Loại bỏ nhạc nền, chỉ giữ lại giọng nói (Demucs). Xử lý lâu hơn — khoảng 1 giây
            cho mỗi giây âm thanh.
          </small>
        </span>
      </label>

      <div className="export-summary">
        <span>
          Đoạn: {fmtTime(start)} → {fmtTime(end)} ({fmtTime(end - start)})
        </span>
        <button
          className="btn accent big"
          disabled={disabled || end - start < 1}
          onClick={() => onExport(format, quality, voiceOnly)}
        >
          Trích xuất âm thanh
        </button>
      </div>
    </section>
  );
}
