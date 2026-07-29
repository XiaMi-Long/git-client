// git status 解析模块
// 解析 `git status --porcelain` 输出为结构化文件状态
// 依据: design.md D3, tasks 2.2

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::GitResult;

/// 文件变更类型
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeType {
    /// 新增
    Added,
    /// 修改
    Modified,
    /// 删除
    Deleted,
    /// 重命名
    Renamed,
    /// 复制
    Copied,
    /// 类型变更
    TypeChanged,
    /// 未跟踪
    Untracked,
    /// 冲突
    Conflicted,
}

/// 暂存状态
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    /// 已暂存
    Staged,
    /// 未暂存
    Unstaged,
    /// 同时有暂存和未暂存的改动
    Both,
}

/// 单个文件的 git 状态
#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    /// 文件路径（相对仓库根）
    pub path: String,
    /// 重命名时的旧路径
    pub old_path: Option<String>,
    /// 变更类型
    pub change_type: FileChangeType,
    /// 暂存状态
    pub stage_status: StageStatus,
    /// 是否有冲突
    pub is_conflicted: bool,
}

/// 工作区完整状态
#[derive(Debug, Clone, Serialize)]
pub struct WorkingAreaStatus {
    /// 已暂存的文件列表
    pub staged: Vec<FileStatus>,
    /// 未暂存的文件列表
    pub unstaged: Vec<FileStatus>,
    /// 未跟踪的文件列表
    pub untracked: Vec<FileStatus>,
    /// 冲突文件列表
    pub conflicted: Vec<FileStatus>,
    /// 当前分支名
    pub current_branch: Option<String>,
    /// 上游跟踪分支
    pub upstream: Option<String>,
    /// 领先上游的提交数
    pub ahead: u32,
    /// 落后上游的提交数
    pub behind: u32,
}

impl GitExecutor {
    /// 获取工作区状态（2.2）
    /// 执行 `git status --porcelain=v1 -z -b` 并解析
    pub async fn get_status(repo_path: &Path) -> GitResult<WorkingAreaStatus> {
        let output = Self::run_git(
            repo_path,
            &["status", "--porcelain=v1", "-z", "-b"],
        )
        .await?;

        Self::parse_status(&output)
    }

    /// 解析 porcelain v1 -z 格式输出
    fn parse_status(raw: &str) -> GitResult<WorkingAreaStatus> {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let mut conflicted = Vec::new();

        // -z 格式以 null 字符分隔条目
        let entries: Vec<&str> = raw.split('\0').collect();

        let mut current_branch = None;
        let mut upstream = None;
        let mut ahead = 0u32;
        let mut behind = 0u32;

        for (i, entry) in entries.iter().enumerate() {
            if entry.is_empty() {
                continue;
            }

            // 第一个条目是分支行（以 ## 开头）
            if i == 0 && entry.starts_with("## ") {
                let branch_line = &entry[3..];
                Self::parse_branch_line(branch_line, &mut current_branch, &mut upstream, &mut ahead, &mut behind);
                continue;
            }

            // porcelain v1 每条至少 2 字符状态码 + 空格 + 路径
            if entry.len() < 3 {
                continue;
            }

            let x = entry.chars().next().unwrap_or(' ');
            let y = entry.chars().nth(1).unwrap_or(' ');
            // 跳过状态码后的空格
            let rest = &entry[3..];

            let (file_path, old_path) = Self::extract_path(rest);

            // 判断是否冲突
            let is_conflicted = matches!(x, 'U' | 'D' | 'A')
                && matches!(y, 'U' | 'D' | 'A')
                || x == 'U'
                || y == 'U'
                || (x == 'D' && y == 'D')
                || (x == 'A' && y == 'A');

            if is_conflicted {
                conflicted.push(FileStatus {
                    path: file_path.clone(),
                    old_path: None,
                    change_type: FileChangeType::Conflicted,
                    stage_status: StageStatus::Both,
                    is_conflicted: true,
                });
                continue;
            }

            // 解析暂存状态（x = 暂存区状态，y = 工作区状态）
            let staged_type = Self::status_code_to_type(x);
            let unstaged_type = Self::status_code_to_type(y);

            let has_staged = x != ' ' && x != '?';
            let has_unstaged = y != ' ' && y != '?';
            let is_untracked = x == '?' && y == '?';

            if is_untracked {
                untracked.push(FileStatus {
                    path: file_path.clone(),
                    old_path: None,
                    change_type: FileChangeType::Untracked,
                    stage_status: StageStatus::Unstaged,
                    is_conflicted: false,
                });
                continue;
            }

            if has_staged {
                staged.push(FileStatus {
                    path: file_path.clone(),
                    old_path: old_path.clone(),
                    change_type: staged_type,
                    stage_status: StageStatus::Staged,
                    is_conflicted: false,
                });
            }

            if has_unstaged {
                let stage_status = if has_staged {
                    StageStatus::Both
                } else {
                    StageStatus::Unstaged
                };

                unstaged.push(FileStatus {
                    path: file_path.clone(),
                    old_path: None,
                    change_type: unstaged_type,
                    stage_status,
                    is_conflicted: false,
                });
            }
        }

        Ok(WorkingAreaStatus {
            staged,
            unstaged,
            untracked,
            conflicted,
            current_branch,
            upstream,
            ahead,
            behind,
        })
    }

    /// 解析分支行，如 "main...origin/main [ahead 2, behind 1]"
    fn parse_branch_line(
        line: &str,
        current_branch: &mut Option<String>,
        upstream: &mut Option<String>,
        ahead: &mut u32,
        behind: &mut u32,
    ) {
        // 处理 detached HEAD: "HEAD (no branch)"
        if line.starts_with("HEAD (no branch)") {
            *current_branch = Some("(分离 HEAD)".to_string());
            return;
        }

        // 分割 "branch...upstream [ahead N, behind M]" 或 "branch...upstream [gone]" 或 "branch...upstream"
        let (branch_part, tracking_part) = match line.split_once(' ') {
            Some((a, b)) => (a, Some(b)),
            None => (line, None),
        };

        if let Some((branch, up)) = branch_part.split_once("...") {
            *current_branch = Some(branch.trim().to_string());
            *upstream = Some(up.trim().to_string());
        } else {
            *current_branch = Some(branch_part.trim().to_string());
        }

        // 解析 [ahead N, behind M]
        if let Some(tracking) = tracking_part {
            let tracking = tracking.trim().trim_matches(|c| c == '[' || c == ']');

            for part in tracking.split(',') {
                let part = part.trim();
                if part.starts_with("ahead ") {
                    *ahead = part[6..].parse().unwrap_or(0);
                } else if part.starts_with("behind ") {
                    *behind = part[7..].parse().unwrap_or(0);
                }
            }
        }
    }

    /// 从路径条目提取文件路径和旧路径（重命名场景）
    /// porcelain 格式重命名为 "new_path\0old_path" 或 "old_path -> new_path"
    fn extract_path(rest: &str) -> (String, Option<String>) {
        if let Some(idx) = rest.find(" -> ") {
            let old = rest[..idx].to_string();
            let new = rest[idx + 4..].to_string();
            (new, Some(old))
        } else {
            (rest.to_string(), None)
        }
    }

    /// 将 porcelain 状态码转换为变更类型
    fn status_code_to_type(code: char) -> FileChangeType {
        match code {
            'A' => FileChangeType::Added,
            'M' => FileChangeType::Modified,
            'D' => FileChangeType::Deleted,
            'R' => FileChangeType::Renamed,
            'C' => FileChangeType::Copied,
            'T' => FileChangeType::TypeChanged,
            '?' => FileChangeType::Untracked,
            '!' => FileChangeType::Untracked, // 已忽略
            _ => FileChangeType::Modified,
        }
    }
}
