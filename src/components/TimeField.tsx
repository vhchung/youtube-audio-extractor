import { useEffect, useRef, useState } from "react";

interface Props {
  /** Giá trị hiện tại (giây) */
  seconds: number;
  /** Gọi khi người dùng thay đổi — giá trị đã kẹp ở mức segment (mm/ss ≤ 59) */
  onCommit: (seconds: number) => void;
}

const SEGS = ["giờ", "phút", "giây"] as const;

function split(seconds: number): [string, string, string] {
  const s = Math.max(0, Math.floor(seconds));
  return [
    String(Math.floor(s / 3600)).padStart(2, "0"),
    String(Math.floor((s % 3600) / 60)).padStart(2, "0"),
    String(s % 60).padStart(2, "0"),
  ];
}

/** Ô nhập thời lượng dạng 3 segment hh:mm:ss: chỉ nhận số, tự chuyển ô,
 * tự kẹp phút/giây ≤ 59, hỗ trợ mũi tên ±1 và paste "h:mm:ss". */
export default function TimeField({ seconds, onCommit }: Props) {
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const [focused, setFocused] = useState(false);
  const [segs, setSegs] = useState<[string, string, string]>(() => split(seconds));

  // Đồng bộ hiển thị từ prop khi không đang focus
  useEffect(() => {
    if (!focused) setSegs(split(seconds));
  }, [seconds, focused]);

  const commit = (next: [string, string, string]) => {
    const nums = next.map((x) => parseInt(x || "0", 10) || 0) as [number, number, number];
    onCommit(nums[0] * 3600 + nums[1] * 60 + nums[2]);
  };

  const setSeg = (idx: number, raw: string) => {
    let digits = raw.replace(/\D/g, "").slice(0, 2);
    if (idx > 0 && digits !== "" && parseInt(digits, 10) > 59) digits = "59";
    const next: [string, string, string] = [...segs];
    next[idx] = digits;
    setSegs(next);
    commit(next);
    if (digits.length === 2 && idx < 2) {
      const el = refs[idx + 1].current;
      el?.focus();
      el?.select();
    }
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? 1 : -1;
      const cap = idx === 0 ? 99 : 59;
      const val = parseInt(segs[idx] || "0", 10) || 0;
      const bounded = Math.min(Math.max(val + delta, 0), cap);
      const next: [string, string, string] = [...segs];
      next[idx] = String(bounded).padStart(2, "0");
      setSegs(next);
      commit(next);
      el.select();
      return;
    }
    if (e.key === "Backspace" && segs[idx] === "" && idx > 0) {
      e.preventDefault();
      const prev = refs[idx - 1].current;
      prev?.focus();
      prev?.select();
      return;
    }
    if (e.key === "Enter") {
      el.blur();
    }
  };

  const onPaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    // Nhận "mm:ss" hoặc "h:mm:ss"
    const m = text.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})$/);
    if (!m) return; // để trình duyệt xử lý như input thường
    e.preventDefault();
    const parts = [m[1] ?? "0", m[2] ?? "0", m[3] ?? "0"].map((x) =>
      String(Math.min(parseInt(x, 10) || 0, 59)).padStart(2, "0"),
    ) as unknown as [string, string, string];
    // paste vào ô hiện tại trở đi: nếu đang ở ô 0 thì phân bổ cả 3
    const next: [string, string, string] = [...segs];
    if (idx === 0) {
      next[0] = String(Math.min(parseInt(parts[0], 10) || 0, 99)).padStart(2, "0");
      next[1] = parts[1];
      next[2] = parts[2];
    } else {
      next[idx] = parts[0];
    }
    setSegs(next);
    commit(next);
  };

  return (
    <div className="time-field">
      {segs.map((seg, idx) => (
        <span key={SEGS[idx]} className="seg-wrap">
          {idx > 0 && <span className="seg-colon">:</span>}
          <input
            ref={refs[idx]}
            className="seg"
            value={seg}
            inputMode="numeric"
            placeholder="00"
            maxLength={2}
            onFocus={(e) => {
              setFocused(true);
              e.currentTarget.select();
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => setSeg(idx, e.target.value)}
            onKeyDown={(e) => onKeyDown(idx, e)}
            onPaste={(e) => onPaste(idx, e)}
            aria-label={SEGS[idx]}
          />
        </span>
      ))}
    </div>
  );
}
