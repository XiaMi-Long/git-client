// git 命令执行器
// 封装 tokio::process::Command 调用系统 git 的底层逻辑
// 依据: design.md D2/D3

use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};

use tokio::io::AsyncWriteExt;
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

    /// 应用 hunk patch 到暂存区（git apply --cached，patch 从 stdin 传入）
    /// 用于 hunk 级暂存（7.5）：只暂存单个 hunk 而非整个文件
    pub async fn apply_hunk(repo_path: &Path, patch: &str) -> GitResult<()> {
        let mut cmd = Command::new("git");
        cmd.args(&["apply", "--cached"]);
        cmd.current_dir(repo_path);
        // 强制英文输出，避免 locale 导致解析问题
        cmd.env("LC_ALL", "C");
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| GitError::Io(e.to_string()))?;
        // 将 patch 写入 stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(patch.as_bytes())
                .await
                .map_err(|e| GitError::Io(e.to_string()))?;
        }
        let output = child
            .wait_with_output()
            .await
            .map_err(|e| GitError::Io(e.to_string()))?;
        if !output.status.success() {
            return Err(GitError::CommandFailed {
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code(),
            });
        }
        Ok(())
    }
}
