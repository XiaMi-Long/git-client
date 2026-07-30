// git 命令封装模块
// 通过 tokio::process::Command 调用系统 git，解析输出为结构化数据
// 依据: design.md D2/D3

pub mod types;
pub mod executor;
pub mod status;
pub mod log;
pub mod diff;
pub mod branch;
pub mod remote;

use std::path::PathBuf;

use serde::Serialize;
use types::GitError;

pub use executor::GitExecutor;
pub use status::{FileStatus, WorkingAreaStatus, FileChangeType, StageStatus};
pub use log::{CommitInfo, LogQuery, PAGE_SIZE};
pub use diff::{DiffHunk, DiffLine, DiffLineType, FileDiff};
pub use branch::{BranchInfo, TagInfo, BranchOperationResult, CompareResult};
pub use remote::{RemoteResult, OperationState};

/// git 版本检测结果
#[derive(Debug, Clone, Serialize)]
pub struct GitVersionInfo {
    /// git 版本号字符串，如 "2.43.0"
    pub version: String,
    /// 主版本号
    pub major: u32,
    /// 次版本号
    pub minor: u32,
    /// 补丁号
    pub patch: u32,
    /// 是否低于最低要求版本
    pub is_outdated: bool,
}

/// 最低支持的 git 版本
const MIN_GIT_VERSION: (u32, u32, u32) = (2, 20, 0);

impl GitExecutor {
    /// 检测系统 git 版本（2.1）
    pub async fn detect_version() -> Result<GitVersionInfo, GitError> {
        let output = Self::run_git_raw(None, &["--version"]).await?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        Self::parse_version(&stdout)
    }

    /// 解析 git 版本字符串
    fn parse_version(raw: &str) -> Result<GitVersionInfo, GitError> {
        let line = raw.lines().next().unwrap_or("").trim();
        let version_str = line
            .strip_prefix("git version ")
            .or_else(|| line.strip_prefix("git-version "))
            .unwrap_or("");

        let parts: Vec<&str> = version_str.split('.').collect();
        if parts.len() < 3 {
            return Err(GitError::VersionParse(format!(
                "无法解析版本号: {raw}"
            )));
        }

        let major = parts[0].parse().unwrap_or(0);
        let minor = parts[1].parse().unwrap_or(0);
        let patch_str = parts[2];
        let patch = patch_str
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);

        let is_outdated =
            (major, minor, patch) < MIN_GIT_VERSION;

        Ok(GitVersionInfo {
            version: format!("{major}.{minor}.{patch}"),
            major,
            minor,
            patch,
            is_outdated,
        })
    }

    /// 验证目录是否为有效 git 仓库
    pub async fn is_valid_repo(path: &PathBuf) -> bool {
        Self::run_git(path, &["rev-parse", "--is-inside-work-tree"])
            .await
            .is_ok()
    }
}
