mod commands;
mod sidecar;

use sidecar::SidecarManager;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let manager = SidecarManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(manager)
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<SidecarManager>().start(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::server_status,
            commands::save_audio_file,
            commands::reveal_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(manager) = app.try_state::<SidecarManager>() {
                    manager.shutdown();
                }
            }
        });
}
