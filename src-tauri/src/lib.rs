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
use std::time::Duration;

use tauri::{Emitter, Manager};

use watcher::WatcherState;

/// 后台定时 fetch 状态：记录当前激活仓库路径，供轮询任务使用
#[derive(Default)]
pub struct FetcherState {
    pub current_repo: Option<String>,
}

/// 后台 fetch 轮询间隔：10 分钟
const FETCH_INTERVAL: Duration = Duration::from_secs(600);

/// 应用启动入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(WatcherState::default()))
        .manage(Mutex::new(FetcherState::default()))
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
            commands::git_stash_changes,
            commands::git_list_stashes,
            commands::git_create_stash,
            commands::git_apply_stash,
            commands::git_drop_stash,
            commands::git_show_stash,
            commands::git_create_branch_from_remote,
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
            commands::git_push_delete_remote,
            commands::git_fetch,
            commands::git_fetch_branch_ff,
            commands::git_set_active_repo,
            commands::git_check_conflict,
            commands::git_list_conflicted_files,
            commands::git_mark_resolved,
            commands::git_abort_operation,
            commands::git_get_operation_state,
            commands::git_add,
            commands::git_unstage,
            commands::git_add_all,
            commands::git_unstage_all,
            commands::git_discard_file,
            commands::git_discard_all,
            commands::git_commit,
            commands::git_apply_hunk,
            commands::git_cherry_pick_no_commit,
            commands::git_reset_soft,
            watcher::watcher_start,
            watcher::watcher_stop
        ])
        .setup(|app| {
            // 后台定时 fetch：每 10 分钟检查当前激活仓库是否有可拉取更新，
            // 完成后 emit "repo-fetched" 事件通知前端刷新落后数
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(FETCH_INTERVAL);
                // 跳过第一次立即触发（打开仓库时前端会手动 fetch）
                interval.tick().await;
                loop {
                    interval.tick().await;
                    let path = {
                        let state = handle.state::<Mutex<FetcherState>>();
                        state.lock().ok().and_then(|s| s.current_repo.clone())
                    };
                    if let Some(path) = path {
                        let p = std::path::PathBuf::from(&path);
                        if git::GitExecutor::is_valid_repo(&p).await {
                            let _ = git::GitExecutor::fetch_repo(&p).await;
                            let _ = handle.emit("repo-fetched", ());
                        }
                    }
                }
            });

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
