// 存储（stash）功能封装
// 依据: 交互设计 - 存储管理（侧栏分组 + 右键操作 + 工具栏储藏按钮）
// scope: all(含未跟踪) / staged(仅暂存) / unstaged(仅未暂存)

use std::path::Path;

use serde::Serialize;

use super::diff::FileDiff;
use super::executor::GitExecutor;
use super::types::GitResult;

/// 存储条目信息
#[derive(Debug, Clone, Serialize)]
pub struct StashInfo {
    /// stash 引用名，如 "stash@{0}"
    pub index: String,
    /// 存储消息（去掉了 "On branch: " 前缀）
    pub message: String,
    /// 来源分支
    pub branch: String,
    /// 提交哈希
    pub hash: String,
}

impl GitExecutor {
    /// 列出所有存储条目（git stash list）
    pub async fn list_stashes(repo_path: &Path) -> GitResult<Vec<StashInfo>> {
        let output =
            Self::run_git(repo_path, &["stash", "list", "--format=%H|%gd|%gs"]).await?;
        let mut stashes = Vec::new();
        for line in output.lines() {
            let mut parts = line.splitn(3, '|');
            let hash = parts.next().unwrap_or("").trim().to_string();
            let index = parts.next().unwrap_or("").trim().to_string();
            let subject = parts.next().unwrap_or("").trim().to_string();
            if hash.is_empty() || index.is_empty() {
                continue;
            }
            let (branch, message) = parse_subject(&subject);
            stashes.push(StashInfo {
                index,
                message,
                branch,
                hash,
            });
        }
        Ok(stashes)
    }

    /// 创建存储
    /// * `scope` - all: 全部（含未跟踪）/ staged: 仅暂存 / unstaged: 仅未暂存
    /// * `message` - 存储名称（用户自定义或默认时间模板）
    pub async fn create_stash(repo_path: &Path, message: &str, scope: &str) -> GitResult<()> {
        let args: Vec<String> = match scope {
            // --staged: 只藏已暂存（git ≥ 2.35）
            "staged" => vec!["stash", "push", "--staged", "-m", message],
            // --keep-index: 保留暂存区，只藏未暂存
            "unstaged" => vec!["stash", "push", "--keep-index", "-m", message],
            // 默认全部：含未跟踪文件
            _ => vec!["stash", "push", "-u", "-m", message],
        }
        .into_iter()
        .map(String::from)
        .collect();
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        Self::run_git(repo_path, &refs).await?;
        Ok(())
    }

    /// 应用存储
    /// * `pop` - true: 应用并删除（git stash pop）/ false: 仅应用（git stash apply）
    pub async fn apply_stash(repo_path: &Path, index: &str, pop: bool) -> GitResult<()> {
        if pop {
            Self::run_git(repo_path, &["stash", "pop", index]).await?;
        } else {
            Self::run_git(repo_path, &["stash", "apply", index]).await?;
        }
        Ok(())
    }

    /// 删除存储
    pub async fn drop_stash(repo_path: &Path, index: &str) -> GitResult<()> {
        Self::run_git(repo_path, &["stash", "drop", index]).await?;
        Ok(())
    }

    /// 查看存储的文件改动（git stash show -p，解析为 FileDiff）
    pub async fn show_stash(repo_path: &Path, index: &str) -> GitResult<Vec<FileDiff>> {
        let output =
            Self::run_git(repo_path, &["stash", "show", "-p", "--no-color", index]).await?;
        Self::parse_diff(&output)
    }
}

/// 解析 stash subject： "On main: 消息" / "WIP on main: 消息" → (branch, message)
fn parse_subject(subject: &str) -> (String, String) {
    let subject = subject.trim();
    for prefix in ["WIP on ", "On "] {
        if let Some(rest) = subject.strip_prefix(prefix) {
            if let Some(idx) = rest.find(": ") {
                return (rest[..idx].to_string(), rest[idx + 2..].to_string());
            }
            return (rest.to_string(), String::new());
        }
    }
    (String::new(), subject.to_string())
}
