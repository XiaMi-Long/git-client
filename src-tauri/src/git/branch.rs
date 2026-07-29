// 分支与标签查询、分支操作封装
// 依据: design.md D3, tasks 2.5/2.6

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::GitResult;

/// 分支信息
#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    /// 分支名
    pub name: String,
    /// 完整 ref 名称（如 refs/heads/main）
    pub full_name: String,
    /// 最新提交哈希
    pub commit_hash: String,
    /// 最新提交摘要
    pub subject: String,
    /// 是否为当前分支
    pub is_current: bool,
    /// 是否为远程分支
    pub is_remote: bool,
    /// 上游跟踪分支（仅本地分支）
    pub upstream: Option<String>,
    /// 领先上游提交数
    pub ahead: u32,
    /// 落后上游提交数
    pub behind: u32,
}

/// 标签信息
#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    /// 标签名
    pub name: String,
    /// 指向的提交哈希
    pub commit_hash: String,
    /// 提交摘要
    pub subject: String,
    /// 是否为附注标签（annotated）
    pub is_annotated: bool,
    /// 标签创建日期（仅附注标签）
    pub date: Option<String>,
}

/// 分支操作结果
#[derive(Debug, Clone, Serialize)]
pub struct BranchOperationResult {
    /// 是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 新的当前分支名
    pub current_branch: Option<String>,
}

impl GitExecutor {
    /// 获取所有本地和远程分支（2.5）
    pub async fn list_branches(repo_path: &Path) -> GitResult<Vec<BranchInfo>> {
        let output = Self::run_git(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(HEAD)%00%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)%00%(upstream:track,nocrumbs)",
                "refs/heads/",
                "refs/remotes/",
            ],
        )
        .await?;

        Self::parse_branches(&output)
    }

    /// 解析分支列表
    fn parse_branches(raw: &str) -> GitResult<Vec<BranchInfo>> {
        let mut branches = Vec::new();

        for line in raw.lines() {
            if line.is_empty() {
                continue;
            }

            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() < 6 {
                continue;
            }

            let head_marker = fields[0]; // "*" 表示当前分支，" " 表示非当前
            let full_name = fields[1].to_string();
            let commit_hash = fields[2].to_string();
            let subject = fields[3].to_string();
            let upstream = fields[4].to_string();
            let track = fields[5].to_string();

            let is_current = head_marker == "*";
            let is_remote = full_name.starts_with("refs/remotes/");

            // 从完整 ref 名提取短名
            let name = if is_remote {
                full_name
                    .strip_prefix("refs/remotes/")
                    .unwrap_or(&full_name)
                    .to_string()
            } else {
                full_name
                    .strip_prefix("refs/heads/")
                    .unwrap_or(&full_name)
                    .to_string()
            };

            // 解析 ahead/behind
            let (ahead, behind) = Self::parse_track(&track);

            branches.push(BranchInfo {
                name,
                full_name,
                commit_hash,
                subject,
                is_current,
                is_remote,
                upstream: if upstream.is_empty() { None } else { Some(upstream) },
                ahead,
                behind,
            });
        }

        Ok(branches)
    }

    /// 解析 upstream:track 输出，如 "ahead 2, behind 1"
    fn parse_track(track: &str) -> (u32, u32) {
        let mut ahead = 0u32;
        let mut behind = 0u32;

        if track.is_empty() || track == "[gone]" {
            return (0, 0);
        }

        let trimmed = track.trim_matches(|c| c == '[' || c == ']');
        for part in trimmed.split(',') {
            let part = part.trim();
            if part.starts_with("ahead ") {
                ahead = part[6..].parse().unwrap_or(0);
            } else if part.starts_with("behind ") {
                behind = part[7..].parse().unwrap_or(0);
            }
        }

        (ahead, behind)
    }

    /// 获取所有标签（2.5）
    pub async fn list_tags(repo_path: &Path) -> GitResult<Vec<TagInfo>> {
        let output = Self::run_git(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(refname:short)%00%(objectname)%00%(subject)%00%(objecttype)%00%(creatordate)",
                "refs/tags/",
            ],
        )
        .await?;

        Self::parse_tags(&output)
    }

    /// 解析标签列表
    fn parse_tags(raw: &str) -> GitResult<Vec<TagInfo>> {
        let mut tags = Vec::new();

        for line in raw.lines() {
            if line.is_empty() {
                continue;
            }

            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() < 5 {
                continue;
            }

            let name = fields[0].to_string();
            let commit_hash = fields[1].to_string();
            let subject = fields[2].to_string();
            let object_type = fields[3].to_string();
            let date_str = fields[4].to_string();

            let is_annotated = object_type == "tag";
            let date = if is_annotated && !date_str.is_empty() {
                Some(date_str)
            } else {
                None
            };

            tags.push(TagInfo {
                name,
                commit_hash,
                subject,
                is_annotated,
                date,
            });
        }

        Ok(tags)
    }

    /// 获取当前分支名
    pub async fn get_current_branch(repo_path: &Path) -> GitResult<Option<String>> {
        let output = Self::run_git(repo_path, &["branch", "--show-current"]).await?;
        let branch = output.trim().to_string();
        if branch.is_empty() {
            // 可能是 detached HEAD
            let head = Self::run_git(repo_path, &["rev-parse", "--short", "HEAD"]).await?;
            Ok(Some(format!("({})", head.trim())))
        } else {
            Ok(Some(branch))
        }
    }

    // ===== 分支操作（2.6） =====

    /// 新建分支
    /// * `name` - 新分支名
    /// * `checkout` - 是否立即检出
    pub async fn create_branch(
        repo_path: &Path,
        name: &str,
        checkout: bool,
    ) -> GitResult<BranchOperationResult> {
        let args: Vec<&str> = if checkout {
            vec!["checkout", "-b", name]
        } else {
            vec!["branch", name]
        };

        match Self::run_git(repo_path, &args).await {
            Ok(_) => {
                let current = if checkout {
                    Some(name.to_string())
                } else {
                    Self::get_current_branch(repo_path).await.ok().flatten()
                };
                Ok(BranchOperationResult {
                    success: true,
                    message: format!("分支 '{name}' 创建成功"),
                    current_branch: current,
                })
            }
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }

    /// 检出分支
    pub async fn checkout_branch(
        repo_path: &Path,
        name: &str,
    ) -> GitResult<BranchOperationResult> {
        match Self::run_git(repo_path, &["checkout", name]).await {
            Ok(_) => Ok(BranchOperationResult {
                success: true,
                message: format!("已切换到分支 '{name}'"),
                current_branch: Some(name.to_string()),
            }),
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }

    /// 删除分支
    /// * `force` - true 使用 -D（强制删除），false 使用 -d（安全删除）
    pub async fn delete_branch(
        repo_path: &Path,
        name: &str,
        force: bool,
    ) -> GitResult<BranchOperationResult> {
        let flag = if force { "-D" } else { "-d" };
        match Self::run_git(repo_path, &["branch", flag, name]).await {
            Ok(_) => Ok(BranchOperationResult {
                success: true,
                message: format!("分支 '{name}' 已删除"),
                current_branch: None,
            }),
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }

    /// 重命名分支
    pub async fn rename_branch(
        repo_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> GitResult<BranchOperationResult> {
        match Self::run_git(repo_path, &["branch", "-m", old_name, new_name]).await {
            Ok(_) => Ok(BranchOperationResult {
                success: true,
                message: format!("分支 '{old_name}' 已重命名为 '{new_name}'"),
                current_branch: Some(new_name.to_string()),
            }),
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }

    /// 合并指定分支到当前分支
    pub async fn merge_branch(
        repo_path: &Path,
        source: &str,
        no_ff: bool,
    ) -> GitResult<BranchOperationResult> {
        let mut args = vec!["merge"];
        if no_ff {
            args.push("--no-ff");
        }
        args.push(source);

        match Self::run_git(repo_path, &args).await {
            Ok(output) => {
                // 检查是否有冲突
                let has_conflict = output.contains("CONFLICT") || output.contains("Auto-merging failed");
                let message = if has_conflict {
                    format!("合并 '{source}' 时产生冲突，请手动解决")
                } else {
                    format!("分支 '{source}' 已合并到当前分支")
                };
                Ok(BranchOperationResult {
                    success: !has_conflict,
                    message,
                    current_branch: Self::get_current_branch(repo_path).await.ok().flatten(),
                })
            }
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }
}
