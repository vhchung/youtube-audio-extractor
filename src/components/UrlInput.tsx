import { useEffect, useRef, useState } from "react";
import { parseYouTubeId } from "../lib/youtube";

interface Props {
  disabled?: boolean;
  onSubmit: (url: string) => void;
  initialValue?: string;
}

/** Ô dán URL YouTube — tự nhận diện khi URL hợp lệ. */
export default function UrlInput({ disabled, onSubmit, initialValue = "" }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const submit = (url?: string) => {
    const target = (url ?? value).trim();
    if (!target) return;
    if (!parseYouTubeId(target)) {
      setError("URL không phải liên kết YouTube hợp lệ (watch, youtu.be, shorts...)");
      return;
    }
    setError("");
    onSubmit(target);
  };

  return (
    <div className="url-input">
      <div className="url-row">
        <input
          ref={inputRef}
          type="url"
          placeholder="Dán URL YouTube vào đây... (https://www.youtube.com/watch?v=...)"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (parseYouTubeId(text)) {
              // Cho phép paste cập nhật value rồi tự submit
              setTimeout(() => submit(text), 60);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="btn accent" disabled={disabled || !value.trim()} onClick={() => submit()}>
          Xem trước
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
