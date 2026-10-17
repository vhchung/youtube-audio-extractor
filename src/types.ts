export interface VideoMeta {
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string;
  uploader: string;
  is_live: boolean;
}

export type AudioFormat = "wav" | "mp3" | "aac";

export interface ExtractOptions {
  url: string;
  start: number;
  end: number;
  format: AudioFormat;
  quality: string;
  voiceOnly: boolean;
  title: string;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobStage = "downloading" | "separating" | "converting" | "";

export interface JobState {
  id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number; // 0..1
  detail: string;
  error: string;
  output_path: string;
  output_name: string;
  voice_only: boolean;
  cancel_requested: boolean;
}

export interface ServerStatusResult {
  ready: boolean;
  port: number | null;
  error: string | null;
}
