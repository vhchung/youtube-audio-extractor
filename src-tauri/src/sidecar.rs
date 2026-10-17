//! Vòng đời Python sidecar: chọn port, spawn `uv run uvicorn`, health-check,
//! bắt log và dọn process khi thoát app.
//!
//! Vị trí server Python:
//! - Dev: `<repo>/server` (bên cạnh src-tauri)
//! - Packaged: resources `server/` do bundler chép vào, được mirror sang
//!   thư mục app-data để tạo `.venv` (thư mục cài đặt có thể chỉ đọc).

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const BASE_PORT: u16 = 8765;
const PORT_RANGE: u16 = 20;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(900);
const HEALTH_INTERVAL: Duration = Duration::from_millis(750);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ServerState {
    Starting,
    Ready { port: u16 },
    Failed { error: String },
}

pub struct SidecarHandle {
    child_pid: u32,
}

struct Shared {
    state: Mutex<ServerState>,
    handle: Mutex<Option<SidecarHandle>>,
}

pub struct SidecarManager {
    shared: Arc<Shared>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(ServerState::Starting),
                handle: Mutex::new(None),
            }),
        }
    }

    pub fn state(&self) -> ServerState {
        self.shared
            .state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ServerState::Starting)
    }

    /// Khởi động sidecar trên thread nền; không chặn GUI.
    pub fn start(&self, app: AppHandle) {
        let shared = Arc::clone(&self.shared);
        std::thread::spawn(move || {
            if let Err(err) = run_sidecar(&app, &shared) {
                log::error!("sidecar lỗi: {err}");
                if let Ok(mut state) = shared.state.lock() {
                    *state = ServerState::Failed { error: err };
                }
            }
        });
    }

    /// Kill process sidecar (kèm cây con) — gọi khi thoát app.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.shared.handle.lock() {
            if let Some(handle) = guard.take() {
                kill_tree(handle.child_pid);
            }
        }
    }
}

/// Nguồn server Python: dev dir nếu có, không thì bundled resources.
fn bundled_server_dir(app: &AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok()?;
    let candidate = res.join("server");
    candidate.join("pyproject.toml").is_file().then_some(candidate)
}

fn dev_server_dir() -> Option<PathBuf> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server");
    dev.join("pyproject.toml").is_file().then_some(dev)
}

/// Thư mục làm việc thực tế của sidecar.
/// - Dev: dùng luôn `server/` trong repo.
/// - Packaged: mirror resources sang app-data để có chỗ ghi `.venv`.
fn prepare_workspace(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dev) = dev_server_dir() {
        return Ok(dev);
    }
    let src = bundled_server_dir(app)
        .ok_or_else(|| "Không tìm thấy server Python (dev dir và bundled resources)".to_string())?;
    let dst = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Không xác định được app-data dir: {e}"))?
        .join("server");
    mirror_server(&src, &dst)?;
    Ok(dst)
}

/// Chép nguồn server (bỏ .venv, __pycache__) từ resources sang app-data.
fn mirror_server(src: &Path, dst: &Path) -> Result<(), String> {
    fn walk(src: &Path, dst: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
        for entry in std::fs::read_dir(src).map_err(|e| format!("readdir {}: {e}", src.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".venv" || name == "__pycache__" || name.starts_with('.') && name != ".python-version" {
                continue;
            }
            let from = entry.path();
            let to = dst.join(&name);
            if from.is_dir() {
                walk(&from, &to)?;
            } else if from.is_file() {
                std::fs::copy(&from, &to)
                    .map_err(|e| format!("copy {}: {e}", from.display()))?;
            }
        }
        Ok(())
    }
    walk(src, dst)
}

/// Dò `uv`: PATH -> ~/.local/bin (vị trí mặc định của installer chính thức).
fn find_uv() -> PathBuf {
    if let Ok(found) = which_uv_from_path() {
        return found;
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !home.is_empty() {
        let candidate = PathBuf::from(&home)
            .join(".local")
            .join("bin")
            .join(uv_binary_name());
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("uv") // hy vọng nó nằm trên PATH khi spawn
}

#[cfg(windows)]
fn uv_binary_name() -> &'static str {
    "uv.exe"
}
#[cfg(not(windows))]
fn uv_binary_name() -> &'static str {
    "uv"
}

fn which_uv_from_path() -> Result<PathBuf, ()> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(uv_binary_name());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(())
}

fn find_free_port() -> Option<u16> {
    for port in BASE_PORT..BASE_PORT + PORT_RANGE {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    // Fallback: để OS tự chọn
    TcpListener::bind(("127.0.0.1", 0))
        .ok()?
        .local_addr()
        .ok()
        .map(|addr| addr.port())
}

fn spawn_uvicorn(uv: &Path, workspace: &Path, port: u16) -> std::io::Result<Child> {
    let mut cmd = Command::new(uv);
    cmd.args([
        "run",
        "--no-sync",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "--log-level",
        "warning",
    ])
    .current_dir(workspace)
    .env("PYTHONUNBUFFERED", "1")
    .env("PYTHONDONTWRITEBYTECODE", "1")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    apply_no_window(&mut cmd);
    cmd.spawn()
}

#[cfg(windows)]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn apply_no_window(_cmd: &mut Command) {}

fn run_sidecar(app: &AppHandle, shared: &Arc<Shared>) -> Result<(), String> {
    let workspace = prepare_workspace(app)?;
    log::info!("sidecar workspace: {}", workspace.display());

    // Lần đầu chạy cần uv sync (torch ~250MB) — Rust chỉ spawn, để uv lo
    sync_if_needed(&workspace)?;

    let port = find_free_port().ok_or("Không tìm được port trống cho sidecar")?;
    let uv = find_uv();
    let mut child = spawn_uvicorn(&uv, &workspace, port).map_err(|e| {
        format!(
            "Không khởi động được uv/uvicorn: {e}. Hãy cài uv: https://docs.astral.sh/uv/getting-started/installation/"
        )
    })?;

    let pid = child.id();
    {
        let mut handle = shared.handle.lock().map_err(|_| "lock poisoned")?;
        *handle = Some(SidecarHandle { child_pid: pid });
    }

    // Đọc log của sidecar đổ vào log của app để dễ debug
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                log::info!("[sidecar] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::warn!("[sidecar] {line}");
            }
        });
    }

    // Health check cho tới khi sẵn sàng (uv run lần đầu có thể lâu)
    let started = Instant::now();
    let health_url = format!("http://127.0.0.1:{port}/api/health");
    loop {
        if child.try_wait().ok().flatten().is_some() {
            kill_tree(pid);
            return Err(format!(
                "Sidecar thoát sớm (port {port}). Xem log [sidecar] ở trên."
            ));
        }
        if started.elapsed() > HEALTH_TIMEOUT {
            kill_tree(pid);
            return Err("Sidecar không sẵn sàng sau 15 phút (uv sync lần đầu quá lâu?)".into());
        }
        match ureq::get(&health_url).timeout(Duration::from_secs(2)).call() {
            Ok(resp) if resp.status() == 200 => break,
            _ => std::thread::sleep(HEALTH_INTERVAL),
        }
    }

    log::info!("sidecar sẵn sàng trên port {port}");
    if let Ok(mut state) = shared.state.lock() {
        *state = ServerState::Ready { port };
    }

    // Giữ child sống tới khi app thoát; reap khi kết thúc
    let _ = child.wait();
    Ok(())
}

/// Chạy `uv sync` nếu venv chưa có (lần đầu / bản mới).
fn sync_if_needed(workspace: &Path) -> Result<(), String> {
    let venv = workspace.join(".venv");
    if venv.is_dir() {
        return Ok(());
    }
    log::info!("venv chưa có — chạy uv sync (lần đầu có thể mất vài phút)...");
    let uv = find_uv();
    let mut cmd = Command::new(uv);
    cmd.args(["sync"]).current_dir(workspace).stdin(Stdio::null());
    apply_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("uv sync thất bại: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("uv sync lỗi: {}", tail(&stderr, 500)));
    }
    Ok(())
}

fn tail(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max {
        trimmed.to_string()
    } else {
        trimmed[trimmed.len() - max..].to_string()
    }
}

/// Kill process cùng toàn bộ process con (uv -> python -> ffmpeg/demucs).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        apply_no_window(&mut cmd);
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        if let Ok(st) = cmd.status() {
            log::info!("taskkill pid {pid}: {st}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill")
            .args(["-9", "-P", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        log::info!("đã kill sidecar pid {pid}");
    }
}
