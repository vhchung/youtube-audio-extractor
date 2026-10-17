//! Tauri commands gọi từ frontend.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::sidecar::{ServerState, SidecarManager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ServerStatus {
    pub ready: bool,
    pub port: Option<u16>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn server_status(manager: State<'_, SidecarManager>) -> ServerStatus {
    match manager.state() {
        ServerState::Starting => ServerStatus { ready: false, port: None, error: None },
        ServerState::Ready { port } => ServerStatus { ready: true, port: Some(port), error: None },
        ServerState::Failed { error } => ServerStatus { ready: false, port: None, error: Some(error) },
    }
}

/// Mở hộp thoại lưu file, copy file kết quả từ temp sang nơi user chọn.
/// Trả về đường dẫn đã lưu, hoặc None nếu user hủy.
#[tauri::command]
pub async fn save_audio_file(
    app: AppHandle,
    src_path: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let src = PathBuf::from(&src_path);
    if !src.is_file() {
        return Err(format!("File nguồn không tồn tại: {src_path}"));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("audio")
        .to_lowercase();
    let ext_label = match ext.as_str() {
        "wav" => "WAV audio",
        "mp3" => "MP3 audio",
        "aac" => "AAC audio",
        _ => "Audio file",
    }
    .to_string();

    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Lưu file âm thanh")
            .set_file_name(suggested_name)
            .add_filter(ext_label, &[&ext])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(target) = chosen else {
        return Ok(None);
    };
    let target_path: PathBuf = target
        .into_path()
        .map_err(|e| format!("Đường dẫn không hợp lệ: {e}"))?;

    std::fs::copy(&src, &target_path)
        .map_err(|e| format!("Không copy được file: {e}"))?;
    Ok(Some(target_path.to_string_lossy().into_owned()))
}

/// Mở Explorer/Files tại vị trí file.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}
