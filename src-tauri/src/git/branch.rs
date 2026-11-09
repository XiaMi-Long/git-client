// 分支与标签查询、分支操作封装
// 依据: design.md D3, tasks 2.5/2.6

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::{GitError, GitResult};

/// 列表与单分支预览共用的 Git 字段。
const BRANCH_FORMAT: &str = "--format=%(HEAD)%00%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)%00%(upstream:track)";

/// 本地分支所跟踪的远端及完整引用，用于精确限定远程命令的范围。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct BranchUpstreamTarget {
    /// 已配置的远程名称。
    pub remote: String,
    /// 远程仓库中的分支引用。
    pub remote_ref: String,
    /// 本机保存的远程跟踪引用。
    pub tracking_ref: String,
}

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

/// 单分支预览额外读取实际远程目标，分支列表仍使用原有数据格式。
#[derive(Debug, Clone, Serialize)]
pub struct BranchPreviewInfo {
    #[serde(flatten)]
    pub branch: BranchInfo,
    /// 可用于远程操作的上游目标，本地上游和未配置上游时为空。
    pub upstream_target: Option<BranchUpstreamTarget>,
    /// 已配置上游，但本机缺少其跟踪引用，领先和落后数量未知。
    pub upstream_gone: bool,
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
    /// 标签创建日期（轻量标签使用目标提交日期）
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

/// 两分支对比结果（9.6）
#[derive(Debug, Clone, Serialize)]
pub struct CompareResult {
    /// from 领先 to 的提交数
    pub ahead: u32,
    /// from 落后 to 的提交数
    pub behind: u32,
}

impl GitExecutor {
    /// 获取所有本地和远程分支（2.5）
    pub async fn list_branches(repo_path: &Path) -> GitResult<Vec<BranchInfo>> {
        let output = Self::run_git(
            repo_path,
            &[
                "for-each-ref",
                BRANCH_FORMAT,
                "refs/heads/",
                "refs/remotes/",
            ],
        )
        .await?;

        Self::parse_branches(&output)
    }

    /// 按完整引用读取单个本地或远程分支，避免同名标签及其他引用混入预览。
    pub async fn get_branch_info(repo_path: &Path, branch_ref: &str) -> GitResult<BranchPreviewInfo> {
        let missing_branch = || GitError::CommandFailed {
            stderr: format!("找不到分支 {branch_ref}，请刷新分支列表"),
            exit_code: None,
        };
        // 只允许查询分支引用，避免将标签或其他对象用作远程操作目标。
        if !branch_ref.starts_with("refs/heads/") && !branch_ref.starts_with("refs/remotes/") {
            return Err(missing_branch());
        }
        let format = format!("{BRANCH_FORMAT}%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)");
        let output = Self::run_git(repo_path, &["for-each-ref", &format, "--", branch_ref]).await?;

        for line in output.lines() {
            let fields: Vec<&str> = line.split('\0').collect();
            // for-each-ref 的过滤条件也能匹配路径前缀，只接受所选分支的完整引用。
            if fields.len() < 9 || fields[1] != branch_ref {
                continue;
            }
            let tracking_ref = fields[6];
            let remote = fields[7];
            let remote_ref = fields[8];
            // 获取远程时只写远程跟踪引用，拒绝本地上游或映射到本地工作分支的配置。
            let has_remote_upstream = tracking_ref.starts_with("refs/remotes/")
                && remote_ref.starts_with("refs/heads/")
                && !remote.is_empty()
                && remote != ".";
            let upstream_target = has_remote_upstream.then(|| BranchUpstreamTarget {
                remote: remote.to_string(),
                remote_ref: remote_ref.to_string(),
                tracking_ref: tracking_ref.to_string(),
            });
            return Ok(BranchPreviewInfo {
                branch: Self::parse_branch_fields(&fields),
                upstream_target,
                upstream_gone: fields[5] == "[gone]",
            });
        }
        Err(missing_branch())
    }

    /// 解析分支列表
    fn parse_branches(raw: &str) -> GitResult<Vec<BranchInfo>> {
        let mut branches = Vec::new();
        for line in raw.lines() {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() >= 6 {
                branches.push(Self::parse_branch_fields(&fields));
            }
        }
        Ok(branches)
    }

    /// 从已校验的六个基础字段读取分支，扩展字段由预览单独处理。
    fn parse_branch_fields(fields: &[&str]) -> BranchInfo {
        let full_name = fields[1];
        let upstream = fields[4];
        let is_remote = full_name.starts_with("refs/remotes/");
        let prefix = if is_remote { "refs/remotes/" } else { "refs/heads/" };
        let (ahead, behind) = Self::parse_track(fields[5]);
        BranchInfo {
            name: full_name.strip_prefix(prefix).unwrap_or(full_name).to_string(),
            full_name: full_name.to_string(),
            commit_hash: fields[2].to_string(),
            subject: fields[3].to_string(),
            is_current: fields[0] == "*",
            is_remote,
            upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
            ahead,
            behind,
        }
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
                "--format=%(refname:short)%00%(objectname)%00%(*objectname)%00%(subject)%00%(objecttype)%00%(creatordate:iso8601)",
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
            if fields.len() < 6 {
                continue;
            }

            let name = fields[0].to_string();
            let object_hash = fields[1].to_string();
            let peeled_hash = fields[2].to_string();
            let subject = fields[3].to_string();
            let object_type = fields[4].to_string();
            let date_str = fields[5].to_string();

            let is_annotated = object_type == "tag";
            let commit_hash = if is_annotated && !peeled_hash.is_empty() {
                peeled_hash
            } else {
                object_hash
            };
            let date = if !date_str.is_empty() {
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

    /// 基于远程分支创建本地分支并切换（含 tracking）
    /// * `local_name` - 本地分支名（可自定义）
    /// * `remote_ref` - 远程 ref，如 origin/feature
    /// 两步：git branch --track <local> <remote> 创建并设置上游，再 git checkout 切换
    pub async fn create_branch_from_remote(
        repo_path: &Path,
        local_name: &str,
        remote_ref: &str,
    ) -> GitResult<BranchOperationResult> {
        // 第一步：创建本地分支并自动设置 upstream（git branch --track）
        Self::run_git(repo_path, &["branch", "--track", local_name, remote_ref]).await?;
        // 第二步：切换到新分支
        match Self::run_git(repo_path, &["checkout", local_name]).await {
            Ok(_) => Ok(BranchOperationResult {
                success: true,
                message: format!("已创建本地分支 '{local_name}' 并切换（跟踪 {remote_ref}）"),
                current_branch: Some(local_name.to_string()),
            }),
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: format!("本地分支 '{local_name}' 已创建，但切换失败: {e}"),
                current_branch: None,
            }),
        }
    }

    /// 暂存工作区改动（git stash push，检出前防止 git 拒绝切换）
    /// * `message` - stash 备注，便于用户识别
    pub async fn stash_changes(repo_path: &Path, message: &str) -> GitResult<()> {
        Self::run_git(repo_path, &["stash", "push", "-m", message]).await?;
        Ok(())
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
            Err(e) => {
                // git merge 冲突时退出码为 1，run_git 会走 Err 分支；
                // 识别冲突标记，返回友好提示（而不是裸抛 git stderr）
                let err_text = e.to_string();
                let is_conflict = err_text.contains("CONFLICT")
                    || err_text.contains("Automatic merge failed")
                    || err_text.contains("fix conflicts");
                let message = if is_conflict {
                    "合并产生冲突：请在右侧冲突文件列表中查看并解决冲突文件，然后点击状态栏 [继续] 完成合并，或 [中止] 撤销合并".to_string()
                } else {
                    err_text
                };
                Ok(BranchOperationResult {
                    success: false,
                    message,
                    current_branch: None,
                })
            }
        }
    }

    /// 设置本地分支的上游跟踪分支。
    /// * `branch` - 本地分支名
    /// * `upstream` - 远程分支引用，如 origin/main
    pub async fn set_upstream(
        repo_path: &Path,
        branch: &str,
        upstream: &str,
    ) -> GitResult<BranchOperationResult> {
        let target = format!("--set-upstream-to={upstream}");
        match Self::run_git(repo_path, &["branch", &target, branch]).await {
            Ok(_) => Ok(BranchOperationResult {
                success: true,
                message: format!("分支 '{branch}' 的上游已设为 '{upstream}'"),
                current_branch: Self::get_current_branch(repo_path).await.ok().flatten(),
            }),
            Err(e) => Ok(BranchOperationResult {
                success: false,
                message: e.to_string(),
                current_branch: None,
            }),
        }
    }

    /// 比较两分支的领先/落后提交数（9.6）
    /// ahead = from 领先 to（to..from 的提交数），behind = from 落后 to（from..to 的提交数）
    pub async fn compare_branches(repo_path: &Path, from: &str, to: &str) -> GitResult<CompareResult> {
        let ahead_str = Self::run_git(
            repo_path,
            &["rev-list", "--count", &format!("{to}..{from}")],
        )
        .await?;
        let behind_str = Self::run_git(
            repo_path,
            &["rev-list", "--count", &format!("{from}..{to}")],
        )
        .await?;
        let ahead = ahead_str.trim().parse().unwrap_or(0);
        let behind = behind_str.trim().parse().unwrap_or(0);
        Ok(CompareResult { ahead, behind })
    }
}
