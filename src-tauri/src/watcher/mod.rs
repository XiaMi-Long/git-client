// 文件监听模块
// 使用 notify crate 递归监听工作区文件变更，遵守 .gitignore，排除 .git 目录，
// 500ms 防抖后通过 Tauri 事件 "repo-changed" 通知前端刷新。
// 依据: design.md D5, tasks 3.1 / 3.2 / 3.3

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::event::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::git::GitExecutor;

/// 监听器状态，持有当前活跃的 watcher 实例以保活
pub struct WatcherState {
    watcher: Option<RecommendedWatcher>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self { watcher: None }
    }
}

/// 构建 .gitignore 匹配器
/// 加载仓库根 .gitignore 与常见全局 excludesfile，用于过滤监听事件
fn build_ignore_matcher(repo_root: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(repo_root);

    // 仓库根 .gitignore
    let local_ignore = repo_root.join(".gitignore");
    if local_ignore.is_file() {
        let _ = builder.add(local_ignore);
    }

    // 全局 gitignore（常见路径，简化处理）
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let candidates = [
            PathBuf::from(&home).join(".config").join("git").join("ignore"),
            PathBuf::from(&home).join(".gitignore_global"),
        ];
        for c in candidates {
            if c.is_file() {
                let _ = builder.add(c);
            }
        }
    }

    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

/// 判断路径是否位于 .git 目录内（需排除，避免 git 自身操作频繁触发）
fn is_inside_git(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == ".git")
}

/// 启动文件监听（Tauri command）
/// 在仓库工作区递归监听，过滤 .gitignore 与 .git 目录，500ms 防抖后 emit "repo-changed"
#[tauri::command]
pub async fn watcher_start(
    app: AppHandle,
    state: State<'_, Mutex<WatcherState>>,
    path: String,
) -> Result<(), String> {
    let input_path = PathBuf::from(path);

    // 校验仓库并取根目录
    if !GitExecutor::is_valid_repo(&input_path).await {
        return Err("无效的 Git 仓库".into());
    }
    let repo_root = GitExecutor::get_repo_root(&input_path)
        .await
        .map_err(|e| e.to_string())?;

    // 若已有 watcher，先停止释放旧实例
    {
        let mut s = state.lock().map_err(|e| format!("状态锁失败: {e}"))?;
        s.watcher = None;
    }

    let matcher = Arc::new(build_ignore_matcher(&repo_root));

    // notify 事件 -> channel -> 防抖 task -> emit
    let (tx, mut rx) = mpsc::channel::<()>(64);

    let matcher_clone = matcher.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            // 只关心文件创建 / 修改 / 删除类事件
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            for path in &event.paths {
                if is_inside_git(path) {
                    continue;
                }
                let is_dir = path.is_dir();
                // 命中 .gitignore 则跳过
                if let ignore::Match::Ignore(_) = matcher_clone.matched(path, is_dir) {
                    continue;
                }
                // 有效变更，发信号（防抖在 task 内合并）
                let _ = tx.try_send(());
                break;
            }
        }
    })
    .map_err(|e| format!("启动监听失败: {e}"))?;

    watcher
        .watch(&repo_root, RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败: {e}"))?;

    // 防抖 task：500ms 窗口内合并事件，窗口结束后 emit 一次
    tokio::spawn(async move {
        loop {
            // 等待首个事件
            if rx.recv().await.is_none() {
                break; // channel 关闭（watcher drop），退出
            }
            // 防抖窗口：500ms 内有新事件则重置
            loop {
                tokio::select! {
                    _ = rx.recv() => continue,
                    _ = tokio::time::sleep(Duration::from_millis(500)) => break,
                }
            }
            // 触发前端刷新
            let _ = app.emit("repo-changed", ());
        }
    });

    // 存入 state 保活
    let mut s = state.lock().map_err(|e| format!("状态锁失败: {e}"))?;
    s.watcher = Some(watcher);
    Ok(())
}

/// 停止文件监听（Tauri command）
#[tauri::command]
pub fn watcher_stop(state: State<'_, Mutex<WatcherState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| format!("状态锁失败: {e}"))?;
    s.watcher = None; // drop watcher，停止监听与防抖 task
    Ok(())
}
