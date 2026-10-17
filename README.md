# YouTube Audio Extract (Tauri 2.0)

Ứng dụng desktop trích xuất âm thanh từ YouTube:

- 📋 Dán URL YouTube → tự load **preview video** (YouTube IFrame Player) + metadata (tiêu đề, kênh, thời lượng)
- 🎚️ Chọn đoạn bằng **dual-slider** hoặc **nhập tay** thời điểm bắt đầu/kết thúc (`mm:ss` / `h:mm:ss`); có nút đánh dấu mốc từ vị trí player đang phát
- 🗣️ Tùy chọn **"Chỉ trích xuất lời thoại"** — loại bỏ nhạc nền, chỉ giữ giọng nói ([Demucs](https://github.com/adefossez/demucs) `htdemucs`)
- 🎵 Xuất **MP3 / AAC / WAV** với các mức chất lượng (bitrate / sample rate)
- 💾 Lưu file qua native save dialog; xem tiến trình theo từng giai đoạn; hủy job giữa chừng

## Kiến trúc

```
React + TypeScript (Vite)      ← UI: preview, slider, export panel, progress
        │ fetch http://127.0.0.1:<port>          │ Tauri IPC (invoke)
        ▼                                        ▼
Python sidecar (FastAPI/uvicorn, quản lý bằng uv)   Rust (src-tauri)
  - /api/metadata   : yt-dlp extract_info           - spawn/kill sidecar (uv run)
  - /api/extract    : job nền theo id               - chọn port tự do + health check
  - pipeline        : yt-dlp tải đúng đoạn          - server_status command
    → (Demucs tách vocals nếu chọn)                 - save dialog + copy file
    → ffmpeg encode wav/mp3/aac                     - reveal trong Explorer
```

- Sidecar chỉ tải **đúng đoạn đã chọn** (`download_ranges` + `force_keyframes_at_cuts`), không tải cả video.
- Với "chỉ lời thoại": nguồn được convert sang wav trước (Demucs không đọc mọi container), rồi `demucs --two-stems vocals`, lấy stem `vocals.wav` encode lại theo định dạng đã chọn.
- ffmpeg được dò theo thứ tự: biến `FFMPEG_PATH` → `ffmpeg` trên PATH → binary kèm theo package `imageio-ffmpeg`. Không cần cài ffmpeg hệ thống.

## Yêu cầu môi trường

| Công cụ | Dùng để | Cài |
| --- | --- | --- |
| Node.js ≥ 20, npm | frontend, Tauri CLI | [nodejs.org](https://nodejs.org) |
| Rust (stable) + MSVC Build Tools | backend Tauri | [rustup.rs](https://rustup.rs) |
| [uv](https://docs.astral.sh/uv/) | môi trường Python sidecar | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |

Windows cần WebView2 Runtime (có sẵn trên Windows 10/11).

## Chạy ứng dụng

```bash
npm install          # dependencies frontend
npx tauri dev        # build + mở cửa sổ app (lần đầu Rust build vài phút)
```

Lần khởi động **đầu tiên**, Rust sẽ chạy `uv sync` trong `server/` (tải PyTorch CPU ~250MB + Demucs ~vài trăm MB) — cửa sổ app hiển thị trạng thái chờ. Các lần sau khởi động trong vài giây.

Lần đầu bật "Chỉ trích xuất lời thoại", Demucs tải model `htdemucs` (~80MB, có cache).

### Chạy sidecar độc lập (debug)

```bash
cd server
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
# UI dev-mode (npm run dev) sẽ tự dò port này khi chạy ngoài Tauri
```

## Đóng gói & phân phối (Windows / Linux / macOS)

### Cách hoạt động khi đã cài

Installer không nhúng Python — thay vào đó app bundle **mã nguồn server** làm Tauri resource. Lần đầu chạy, app:

1. Mirror `server/` từ thư mục cài đặt sang **app-data** (Windows: `%APPDATA%\com.ytaudio.extract\server`, macOS: `~/Library/Application Support/...`, Linux: `~/.local/share/...`) — chỗ ghi được `.venv`
2. Chạy `uv sync` (tải PyTorch CPU + Demucs, ~600MB, một lần duy nhất)
3. Spawn `uv run uvicorn` và health-check như khi dev

→ **Máy cài app cần có [uv](https://docs.astral.sh/uv/getting-started/installation/)** và mạng lần đầu. uv tự tải Python 3.12 managed, không đụng Python hệ thống.

### Build trên máy tương ứng với OS

```bash
npm install
npx tauri build
```

Sản phẩm trong `src-tauri/target/release/bundle/`:

| OS | Output |
| --- | --- |
| Windows | `bundle/nsis/*.exe` (setup) và `bundle/msi/*.msi` |
| Linux | `bundle/deb/*.deb`, `bundle/appimage/*.AppImage` |
| macOS | `bundle/dmg/*.dmg`, `bundle/macos/*.app` |

Linux cần các thư viện build: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`. macOS cần Xcode Command Line Tools.

### Build cả 3 OS bằng GitHub Actions (không cần máy Mac/Linux)

Cross-compile Tauri giữa các OS không khả thi (macOS cần Xcode, Linux cần toolchain riêng). Repo có sẵn `.github/workflows/release.yml` — đẩy repo lên GitHub rồi:

- **Build thủ công**: tab Actions → *Release build* → *Run workflow*
- **Build + tạo Release**: tạo tag rồi push: `git tag v0.1.0 && git push origin v0.1.0` → workflow build cả 3 OS và đăng draft Release kèm installer

### Ghi chú đóng gói

- `server/uv.lock` được bundle → máy cài nhận đúng phiên bản dependency đã test
- App không tìm thấy uv sẽ hiện lỗi kèm link cài đặt ở màn hình khởi động
- Muốn installer tự chứa Python (không cần uv, ~2GB vì torch): hướng đi là PyInstaller `--onedir` + khai báo `externalBin` — xem phần dưới

## Ghi chú

- Tốc độ Demucs trên CPU ≈ 1 giây xử lý cho 1 giây âm thanh; GPU NVIDIA sẽ nhanh hơn nhiều.
- **Video báo "This video is not available"**: một số video (VD nội dung bản quyền như POPS Kids) chặn phát trên web/TV client của YouTube. Sidecar tự động thử lại bằng client `android` khi gặp lỗi này — không cần cấu hình gì thêm.
- Nếu YouTube yêu cầu **"Đăng nhập để xác nhận bạn không phải là robot"** (IP bị bot-check tạm thời): thường tự hết sau một khoảng thời gian; có thể thử nâng cấp yt-dlp (`cd server && uv sync --upgrade-package yt-dlp`). Hướng đi tiếp theo nếu cần: tích hợp chọn nguồn cookie (cookies.txt / trình duyệt) trong UI.
- yt-dlp cần một JS runtime (đã cài **Deno** qua winget) để giải JS challenge của YouTube — thiếu nó nhiều format sẽ thiếu.
- Một số video không cho phép nhúng preview — app vẫn trích xuất bình thường (hiện thumbnail thay player).
- Chỉ dùng để trích xuất nội dung bạn có quyền sử dụng.
