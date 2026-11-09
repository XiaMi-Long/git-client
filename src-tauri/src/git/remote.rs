// 远程同步、cherry-pick、冲突检测模块
// 依据: design.md D3/D8, tasks 2.7/2.8/2.9

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::branch::{BranchInfo, BranchPreviewInfo, BranchUpstreamTarget};
use super::executor::GitExecutor;
use super::status::WorkingAreaStatus;
use super::types::{GitError, GitResult};

/// 给分支网络操作留出传输时间，同时避免长时间占用前端 Git 互斥器。
const BRANCH_SYNC_TIMEOUT: Duration = Duration::from_secs(120);

/// 分支预览中由用户手动选择的远程操作。
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchSyncAction {
    Fetch,
    Pull,
    Push,
}

/// 将分支操作的校验失败归入现有 Git 错误反馈。
fn branch_sync_error(message: impl Into<String>) -> GitError {
    GitError::CommandFailed {
        stderr: message.into(),
        exit_code: None,
    }
}

/// 远程操作结果
#[derive(Debug, Clone, Serialize)]
pub struct RemoteResult {
    /// 是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 是否产生冲突
    pub has_conflict: bool,
    /// 操作后的工作区状态（可选）
    pub status: Option<WorkingAreaStatus>,
}

impl GitExecutor {
    // ===== cherry-pick（2.7） =====

    /// 对指定提交执行 cherry-pick
    pub async fn cherry_pick(repo_path: &Path, commit_hash: &str) -> GitResult<RemoteResult> {
        match Self::run_git(repo_path, &["cherry-pick", commit_hash]).await {
            Ok(output) => {
                let has_conflict = output.contains("CONFLICT")
                    || output.contains("error: could not apply");

                let message = if has_conflict {
                    format!("cherry-pick '{commit_hash}' 产生冲突，请手动解决后继续")
                } else {
                    format!("cherry-pick '{commit_hash}' 成功")
                };

                let status = if has_conflict {
                    Self::get_status(repo_path).await.ok()
                } else {
                    None
                };

                Ok(RemoteResult {
                    success: !has_conflict,
                    message,
                    has_conflict,
                    status,
                })
            }
            Err(e) => {
                // cherry-pick 失败可能是冲突，检查工作区状态
                let stderr = e.to_string();
                let has_conflict = stderr.contains("CONFLICT")
                    || stderr.contains("could not apply");

                let status = if has_conflict {
                    Self::get_status(repo_path).await.ok()
                } else {
                    None
                };

                Ok(RemoteResult {
                    success: false,
                    message: stderr,
                    has_conflict,
                    status,
                })
            }
        }
    }

    /// 中止 cherry-pick
    pub async fn cherry_pick_abort(repo_path: &Path) -> GitResult<()> {
        Self::run_git(repo_path, &["cherry-pick", "--abort"]).await?;
        Ok(())
    }

    /// 继续 cherry-pick（解决冲突后）
    pub async fn cherry_pick_continue(repo_path: &Path) -> GitResult<RemoteResult> {
        match Self::run_git(repo_path, &["cherry-pick", "--continue", "--no-edit"]).await {
            Ok(_) => {
                let status = Self::get_status(repo_path).await.ok();
                Ok(RemoteResult {
                    success: true,
                    message: "cherry-pick 已完成".to_string(),
                    has_conflict: false,
                    status,
                })
            }
            Err(e) => Ok(RemoteResult {
                success: false,
                message: e.to_string(),
                has_conflict: true,
                status: Self::get_status(repo_path).await.ok(),
            }),
        }
    }

    /// 继续已解决冲突的 merge/pull。
    /// 使用 `core.editor=true` 关闭交互式编辑器，冲突已由外部编辑器解决并 git add；
    /// 该命令会在内部自动生成合并提交，符合本次“不做手工提交 UI、允许内部 commit”的约定。
    pub async fn merge_continue(repo_path: &Path) -> GitResult<RemoteResult> {
        match Self::run_git(
            repo_path,
            &["-c", "core.editor=true", "merge", "--continue"],
        )
        .await
        {
            Ok(_) => Ok(RemoteResult {
                success: true,
                message: "合并已完成".to_string(),
                has_conflict: false,
                status: Self::get_status(repo_path).await.ok(),
            }),
            Err(e) => {
                let message = e.to_string();
                let has_conflict = Self::check_conflict(repo_path).await.unwrap_or(false);
                Ok(RemoteResult {
                    success: false,
                    message,
                    has_conflict,
                    status: Self::get_status(repo_path).await.ok(),
                })
            }
        }
    }

    // ===== pull / push（2.8） =====

    /// 拉取远程更新（git pull）
    /// 鉴权通过 git credential helper（Windows 凭据管理器），零配置
    pub async fn pull(repo_path: &Path) -> GitResult<RemoteResult> {
        match Self::run_git(repo_path, &["pull"]).await {
            Ok(output) => {
                let has_conflict = output.contains("CONFLICT")
                    || output.contains("Auto-merging failed");

                let message = if has_conflict {
                    "拉取时产生冲突，请手动解决后继续".to_string()
                } else if output.contains("Already up to date") || output.contains("已经是最新") {
                    "已是最新，无需拉取".to_string()
                } else {
                    "拉取成功".to_string()
                };

                let status = if has_conflict {
                    Self::get_status(repo_path).await.ok()
                } else {
                    None
                };

                Ok(RemoteResult {
                    success: !has_conflict,
                    message,
                    has_conflict,
                    status,
                })
            }
            Err(e) => {
                let stderr = e.to_string();
                let has_conflict = stderr.contains("CONFLICT");

                Ok(RemoteResult {
                    success: false,
                    message: format!("拉取失败: {stderr}"),
                    has_conflict,
                    status: if has_conflict {
                        Self::get_status(repo_path).await.ok()
                    } else {
                        None
                    },
                })
            }
        }
    }

    /// 获取远程引用；超时后终止 Git 子进程。
    /// @param repo_path - Git 仓库目录
    /// @returns Fetch 成功时为空结果，失败或超时时返回错误
    pub async fn fetch_repo(repo_path: &Path) -> GitResult<()> {
        Self::run_git_with_timeout(repo_path, &["fetch"], Duration::from_secs(30)).await?;
        Ok(())
    }

    /// 推送本地提交到远程（git push）
    pub async fn push(repo_path: &Path) -> GitResult<RemoteResult> {
        match Self::run_git(repo_path, &["push"]).await {
            Ok(_) => {
                Ok(RemoteResult {
                    success: true,
                    message: "推送成功".to_string(),
                    has_conflict: false,
                    status: None,
                })
            }
            Err(e) => {
                let stderr = e.to_string();

                // 判断常见错误类型
                let message = if stderr.contains("rejected") && stderr.contains("non-fast-forward") {
                    "推送被拒绝：远程有新提交，请先拉取".to_string()
                } else if stderr.contains("could not read Username") || stderr.contains("Authentication failed") {
                    "鉴权失败，请检查凭据设置".to_string()
                } else {
                    format!("推送失败: {stderr}")
                };

                Ok(RemoteResult {
                    success: false,
                    message,
                    has_conflict: false,
                    status: None,
                })
            }
        }
    }

    /// 推送到指定远程分支（git push origin branch）
    pub async fn push_upstream(
        repo_path: &Path,
        remote: &str,
        branch: &str,
    ) -> GitResult<RemoteResult> {
        match Self::run_git(repo_path, &["push", "-u", remote, branch]).await {
            Ok(_) => Ok(RemoteResult {
                success: true,
                message: format!("已推送并设置上游 '{remote}/{branch}'"),
                has_conflict: false,
                status: None,
            }),
            Err(e) => Ok(RemoteResult {
                success: false,
                message: format!("推送失败: {e}"),
                has_conflict: false,
                status: None,
            }),
        }
    }

    /// 删除远程分支（git push origin --delete branch）
    /// * `remote_ref` - 形如 origin/feature，拆分为远程名与分支名
    pub async fn delete_remote_branch(repo_path: &Path, remote_ref: &str) -> GitResult<()> {
        let (remote, branch) = remote_ref
            .split_once('/')
            .ok_or_else(|| super::types::GitError::CommandFailed {
                stderr: format!("无效的远程分支名: {remote_ref}"),
                exit_code: None,
            })?;
        Self::run_git(repo_path, &["push", remote, "--delete", branch]).await?;
        Ok(())
    }

    /// 为现有分支菜单快进拉取，保留原命令参数并按真实上游解析目标。
    pub async fn fetch_branch_ff(repo_path: &Path, branch: &str, upstream: &str) -> GitResult<()> {
        let preview = Self::get_branch_info(repo_path, &format!("refs/heads/{branch}")).await?;
        if preview.branch.upstream.as_deref() != Some(upstream) {
            return Err(branch_sync_error("上游已变化，请刷新分支后重试"));
        }
        let target = preview.upstream_target.as_ref()
            .ok_or_else(|| branch_sync_error("该分支没有可用的远程上游"))?;
        Self::fast_forward_branch(repo_path, &preview.branch, target).await?;
        Ok(())
    }

    /// 按预览中确认的上游操作指定本地分支。执行前重新确认仓库中的真实目标。
    pub async fn sync_branch_upstream(
        repo_path: &Path,
        branch_ref: &str,
        expected_target: &BranchUpstreamTarget,
        action: BranchSyncAction,
    ) -> GitResult<String> {
        let preview = Self::get_branch_info(repo_path, branch_ref).await?;
        Self::verify_branch_upstream(&preview, expected_target)?;
        let branch = &preview.branch;

        // 预览期间可能从外部检出该分支，此时在主界面使用当前分支操作。
        if branch.is_current && !matches!(action, BranchSyncAction::Fetch) {
            return Err(branch_sync_error("该分支已检出，请使用主界面的拉取或推送"));
        }

        match action {
            BranchSyncAction::Fetch => {
                Self::fetch_branch_tracking(repo_path, expected_target).await?;
                Ok(format!("已获取 {} 的上游", branch.name))
            }
            BranchSyncAction::Pull => Self::fast_forward_branch(repo_path, branch, expected_target).await,
            BranchSyncAction::Push => {
                if preview.upstream_gone {
                    return Err(branch_sync_error("本机缺少上游引用，请先获取远程"));
                }
                // 推送成功也可能刷新跟踪引用，因此沿用获取时的引用保护。
                Self::ensure_direct_ref(repo_path, &expected_target.tracking_ref).await?;
                // 发送操作开始时读到的 B 分支提交，避免工作区 HEAD 或默认 push 配置改变目标。
                let refspec = format!("{}:{}", branch.commit_hash, expected_target.remote_ref);
                Self::run_git_with_timeout(
                    repo_path,
                    &[
                        "push", "--no-force", "--no-follow-tags", "--recurse-submodules=no",
                        "--", expected_target.remote.as_str(), &refspec,
                    ],
                    BRANCH_SYNC_TIMEOUT,
                )
                .await?;
                Ok(format!("已将 {} 推送到上游", branch.name))
            }
        }
    }

    /// 确认分支仍跟踪弹窗中展示的远程及引用，配置变化时由用户重新检查。
    fn verify_branch_upstream(preview: &BranchPreviewInfo, target: &BranchUpstreamTarget) -> GitResult<()> {
        if preview.branch.is_remote {
            return Err(branch_sync_error("请在对应的本地分支预览中执行远程操作"));
        }
        if preview.upstream_target.as_ref() != Some(target) {
            return Err(branch_sync_error("远程上游已变化，请刷新分支信息后重试"));
        }
        Ok(())
    }

    /// 只更新指定上游的本地跟踪引用，避免仓库配置将本次获取映射到其他分支。
    async fn fetch_branch_tracking(repo_path: &Path, target: &BranchUpstreamTarget) -> GitResult<()> {
        Self::ensure_direct_ref(repo_path, &target.tracking_ref).await?;

        // 跟踪引用可以反映远程改写，本地工作分支由后续快进检查独立保护。
        let refspec = format!("+{}:{}", target.remote_ref, target.tracking_ref);
        Self::run_git_with_timeout(
            repo_path,
            &[
                "fetch", "--no-tags", "--no-prune", "--no-prune-tags", "--no-recurse-submodules",
                "--refmap=", "--", target.remote.as_str(), &refspec,
            ],
            BRANCH_SYNC_TIMEOUT,
        )
        .await?;
        Ok(())
    }

    /// 校验写入目标是直接引用。允许首次创建缺失的远程跟踪引用。
    async fn ensure_direct_ref(repo_path: &Path, reference: &str) -> GitResult<()> {
        let result = Self::run_git_raw(Some(repo_path), &["symbolic-ref", "--quiet", reference]).await?;
        match result.status.code() {
            Some(0) => Err(branch_sync_error(format!("引用 {reference} 指向其他分支，无法直接更新"))),
            Some(1) => Ok(()),
            exit_code => Err(GitError::CommandFailed {
                stderr: String::from_utf8_lossy(&result.stderr).into_owned(),
                exit_code,
            }),
        }
    }

    /// 校验目标分支未被任何工作区检出，防止更新引用后工作区内容与 HEAD 脱节。
    async fn ensure_branch_not_checked_out(repo_path: &Path, branch: &BranchInfo) -> GitResult<()> {
        let worktrees = Self::run_git(repo_path, &["worktree", "list", "--porcelain"]).await?;
        let is_in_use = branch.is_current || worktrees.lines().any(|line| {
            line.strip_prefix("branch ") == Some(branch.full_name.as_str())
        });
        if is_in_use {
            return Err(branch_sync_error(format!("分支 {} 已在工作区检出，请在对应工作区拉取", branch.name)));
        }
        Ok(())
    }

    /// 按实际退出码判断两个提交的祖先关系，查询失败时停止快进。
    async fn branch_commit_is_ancestor(repo_path: &Path, ancestor: &str, descendant: &str) -> GitResult<bool> {
        let result = Self::run_git_raw(
            Some(repo_path),
            &["merge-base", "--is-ancestor", ancestor, descendant],
        )
        .await?;
        match result.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            exit_code => Err(GitError::CommandFailed {
                stderr: String::from_utf8_lossy(&result.stderr).into_owned(),
                exit_code,
            }),
        }
    }

    /// 手动获取上游后，仅在确认为快进时更新目标本地分支引用。
    async fn fast_forward_branch(
        repo_path: &Path,
        branch: &BranchInfo,
        target: &BranchUpstreamTarget,
    ) -> GitResult<String> {
        // 1. 获取远端到跟踪引用，保留本地工作分支，等待实际提交关系确定。
        Self::ensure_branch_not_checked_out(repo_path, branch).await?;
        Self::fetch_branch_tracking(repo_path, target).await?;
        let preview = Self::get_branch_info(repo_path, &branch.full_name).await?;
        Self::verify_branch_upstream(&preview, target)?;
        let current = &preview.branch;
        let upstream_commit = format!("{}^{{commit}}", target.tracking_ref);
        let upstream_oid = Self::run_git(repo_path, &["rev-parse", "--verify", &upstream_commit]).await?;
        let upstream_oid = upstream_oid.trim();

        // 2. 本地已包含上游时直接结束。两边都有独立提交时保留本地分支。
        if Self::branch_commit_is_ancestor(repo_path, upstream_oid, &current.commit_hash).await? {
            return Ok(format!("{} 已包含上游提交", current.name));
        }
        if !Self::branch_commit_is_ancestor(repo_path, &current.commit_hash, upstream_oid).await? {
            return Err(branch_sync_error(format!("分支 {} 与上游已分叉，无法快进拉取", current.name)));
        }

        // 3. 网络请求结束后再次检查工作区，旧提交不匹配时由 Git 拒绝写入。
        Self::ensure_direct_ref(repo_path, &current.full_name).await?;
        Self::ensure_branch_not_checked_out(repo_path, current).await?;
        Self::run_git(
            repo_path,
            &[
                "update-ref", "--no-deref", "-m", "GitTrail: fast-forward from upstream",
                current.full_name.as_str(), upstream_oid, current.commit_hash.as_str(),
            ],
        )
        .await?;
        Ok(format!("已快进更新 {}", current.name))
    }

    // ===== 冲突检测（2.9） =====

    /// 检测当前是否处于冲突状态
    /// 通过检查 git status 是否有冲突文件来判断
    pub async fn check_conflict(repo_path: &Path) -> GitResult<bool> {
        let status = Self::get_status(repo_path).await?;
        Ok(!status.conflicted.is_empty())
    }

    /// 获取冲突文件列表
    pub async fn list_conflicted_files(repo_path: &Path) -> GitResult<Vec<String>> {
        let status = Self::get_status(repo_path).await?;
        Ok(status.conflicted.into_iter().map(|f| f.path).collect())
    }

    /// 标记冲突文件为已解决（git add）
    pub async fn mark_resolved(repo_path: &Path, file_path: &str) -> GitResult<()> {
        Self::run_git(repo_path, &["add", file_path]).await?;
        Ok(())
    }

    /// 中止合并操作（git merge --abort）
    pub async fn abort_merge(repo_path: &Path) -> GitResult<()> {
        Self::run_git(repo_path, &["merge", "--abort"]).await?;
        Ok(())
    }

    /// 中止操作（merge / rebase / cherry-pick / 中间态 unmerged）
    pub async fn abort_operation(repo_path: &Path) -> GitResult<()> {
        // 检查是否在 rebase 状态
        let is_rebasing = Self::run_git_raw(Some(repo_path), &["status"])
            .await
            .map(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.contains("rebase in progress")
            })
            .unwrap_or(false);
        let is_cherry_picking = Self::is_cherry_picking(repo_path).await?;
        let is_merging = Self::is_merging(repo_path).await?;

        if is_rebasing {
            Self::run_git(repo_path, &["rebase", "--abort"]).await?;
        } else if is_cherry_picking {
            Self::run_git(repo_path, &["cherry-pick", "--abort"]).await?;
        } else if is_merging {
            Self::run_git(repo_path, &["merge", "--abort"]).await?;
        } else {
            // 无操作标记文件，但可能存在 unmerged 残留（如 stash 应用冲突 / 外部合并后标记被清理）：
            // 完全放弃本次应用：恢复 unmerged 到 HEAD + 取消暂存 + 删除未跟踪文件（回到应用前状态）
            let unmerged_output = Self::run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
                .await
                .unwrap_or_default();
            let unmerged: Vec<&str> = unmerged_output
                .lines()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            if unmerged.is_empty() {
                return Err(super::types::GitError::CommandFailed {
                    stderr: "没有进行中的合并 / cherry-pick 操作".to_string(),
                    exit_code: None,
                });
            }
            // 1. 恢复冲突文件到 HEAD（清除 unmerged 标记）
            for file in &unmerged {
                Self::run_git(repo_path, &["checkout", "HEAD", "--", file]).await?;
            }
            // 2. 取消所有暂存（stash 部分应用的内容退回未跟踪）
            let _ = Self::run_git(repo_path, &["reset"]).await;
            // 3. 删除未跟踪文件（含 stash 部分应用产生的文件，回到应用前状态）
            let _ = Self::run_git(repo_path, &["clean", "-fd"]).await;
        }
        Ok(())
    }

    /// 检查是否正在进行 rebase
    pub async fn is_rebasing(repo_path: &Path) -> GitResult<bool> {
        let _output = Self::run_git_raw(Some(repo_path), &["rev-parse", "--verify", "HEAD"]).await;
        // 检查 .git 目录中是否有 rebase 相关文件（用绝对路径避免检查错目录）
        let git_dir = Self::run_git(repo_path, &["rev-parse", "--absolute-git-dir"]).await?;
        let git_dir = git_dir.trim();

        let rebase_apply = Path::new(git_dir).join("rebase-apply");
        let rebase_merge = Path::new(git_dir).join("rebase-merge");

        Ok(rebase_apply.exists() || rebase_merge.exists())
    }

    /// 检查是否正在进行 merge
    pub async fn is_merging(repo_path: &Path) -> GitResult<bool> {
        // 用 --absolute-git-dir：--git-dir 返回相对路径，exists() 会检查错目录
        let git_dir = Self::run_git(repo_path, &["rev-parse", "--absolute-git-dir"]).await?;
        let merge_head = Path::new(git_dir.trim()).join("MERGE_HEAD");
        Ok(merge_head.exists())
    }

    /// 检查是否正在进行 cherry-pick
    pub async fn is_cherry_picking(repo_path: &Path) -> GitResult<bool> {
        // 用 --absolute-git-dir：--git-dir 返回相对路径，exists() 会检查错目录
        let git_dir = Self::run_git(repo_path, &["rev-parse", "--absolute-git-dir"]).await?;
        let cherry_head = Path::new(git_dir.trim()).join("CHERRY_PICK_HEAD");
        Ok(cherry_head.exists())
    }

    /// 获取当前操作状态（冲突/rebase/merge/cherry-pick）
    pub async fn get_operation_state(repo_path: &Path) -> GitResult<OperationState> {
        let is_rebasing = Self::is_rebasing(repo_path).await?;
        let is_merging = Self::is_merging(repo_path).await?;
        let is_cherry_picking = Self::is_cherry_picking(repo_path).await?;
        let has_conflict = Self::check_conflict(repo_path).await?;

        let state = if is_rebasing {
            OperationState::Rebasing
        } else if is_cherry_picking {
            OperationState::CherryPicking
        } else if is_merging {
            OperationState::Merging
        } else if has_conflict {
            OperationState::Conflict
        } else {
            OperationState::Normal
        };

        Ok(state)
    }
}

/// 当前 git 操作状态
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OperationState {
    /// 正常状态
    Normal,
    /// 合并中
    Merging,
    /// rebase 中
    Rebasing,
    /// cherry-pick 中
    CherryPicking,
    /// 有冲突
    Conflict,
}
