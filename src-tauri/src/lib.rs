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

use std::sync::Mutex;

use tauri::Manager;

use watcher::WatcherState;

/// 应用启动入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(WatcherState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::git_detect_version,
            commands::git_is_valid_repo,
            commands::git_get_status,
            commands::git_get_log,
            commands::git_get_commit_count,
            commands::git_get_working_diff,
            commands::git_get_staged_diff,
            commands::git_get_commit_diff,
            commands::git_list_branches,
            commands::git_list_tags,
            commands::git_get_current_branch,
            commands::git_create_branch,
            commands::git_checkout_branch,
            commands::git_delete_branch,
            commands::git_rename_branch,
            commands::git_merge_branch,
            commands::git_compare_branches,
            commands::git_cherry_pick,
            commands::git_cherry_pick_continue,
            commands::git_cherry_pick_abort,
            commands::git_pull,
            commands::git_push,
            commands::git_push_upstream,
            commands::git_check_conflict,
            commands::git_list_conflicted_files,
            commands::git_mark_resolved,
            commands::git_abort_operation,
            commands::git_get_operation_state,
            commands::git_add,
            commands::git_unstage,
            commands::git_add_all,
            commands::git_unstage_all,
            commands::git_commit,
            commands::git_apply_hunk,
            watcher::watcher_start,
            watcher::watcher_stop
        ])
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
