// git 命令执行器
// 封装 tokio::process::Command 调用系统 git 的底层逻辑
// 依据: design.md D2/D3

use std::path::{Path, PathBuf};
use std::process::Output;

use tokio::process::Command;

use super::types::{GitError, GitResult};

/// git 命令执行器，所有 git 操作的底层入口
pub struct GitExecutor;

impl GitExecutor {
    /// 在指定仓库目录执行 git 命令，返回 stdout
    /// 失败时返回 GitError::CommandFailed
    pub async fn run_git(repo_path: &Path, args: &[&str]) -> GitResult<String> {
        let output = Self::run_git_raw(Some(repo_path), args).await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(GitError::CommandFailed {
                stderr,
                exit_code: output.status.code(),
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// 在指定仓库目录执行 git 命令，返回原始 Output（含 stdout/stderr/exit_code）
    /// 不检查 exit code，用于需要读取 stderr 的场景
    pub async fn run_git_raw(
        repo_path: Option<&Path>,
        args: &[&str],
    ) -> GitResult<Output> {
        let mut cmd = Command::new("git");
        cmd.args(args);

        if let Some(path) = repo_path {
            cmd.current_dir(path);
        }

        // 强制英文输出，避免 locale 导致解析问题
        cmd.env("LC_ALL", "C");
        cmd.env("GIT_TERMINAL_PROMPT", "0");

        cmd.output().await.map_err(Into::into)
    }

    /// 获取仓库根目录（git rev-parse --show-toplevel）
    pub async fn get_repo_root(repo_path: &Path) -> GitResult<PathBuf> {
        let output = Self::run_git(repo_path, &["rev-parse", "--show-toplevel"]).await?;
        Ok(PathBuf::from(output.trim()))
    }
}
