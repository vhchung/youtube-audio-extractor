import type { JobState } from "../types";

interface Props {
  job: JobState;
  onCancel: () => void;
}

const STAGE_LABEL: Record<string, string> = {
  downloading: "Đang tải đoạn đã chọn",
  separating: "Đang tách lời thoại khỏi nhạc nền (Demucs)",
  converting: "Đang chuyển đổi định dạng",
};

/** Thanh tiến trình cho job đang chạy. */
export default function JobProgress({ job, onCancel }: Props) {
  const pct = Math.round(job.progress * 100);
  const label = STAGE_LABEL[job.stage] ?? "Đang xử lý";

  return (
    <section className="job-progress">
      <div className="progress-head">
        <span className="stage">
          {job.status === "queued" ? "Đang chờ..." : label}
          <span className="pct">{pct}%</span>
        </span>
        <button className="btn ghost danger" onClick={onCancel}>
          Hủy
        </button>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {job.detail && <p className="detail">{job.detail}</p>}
    </section>
  );
}
