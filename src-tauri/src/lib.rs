/**
 * Tauri 后端入口库
 * 负责应用启动与插件注册
 */

// git 命令封装模块
pub mod git;
// Tauri command 处理模块
pub mod commands;
// 文件监听模块
pub mod watcher;

use tauri::Manager;

/**
 * 应用启动入口
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                // 开发模式自动打开 DevTools
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
