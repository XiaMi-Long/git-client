// 远程同步、cherry-pick、冲突检测模块
// 依据: design.md D3/D8, tasks 2.7/2.8/2.9

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::status::WorkingAreaStatus;
use super::types::GitResult;

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

    // ===== 获取远程更新（fetch） =====

    /// 获取远程更新（git fetch）
    /// 只更新远程引用（origin/*），不动工作区；之后才能算出分支落后数
    pub async fn fetch_repo(repo_path: &Path) -> GitResult<()> {
        Self::run_git(repo_path, &["fetch"]).await?;
        Ok(())
    }

    /// 快进更新指定本地分支到其上游（git fetch <remote> <branch>:refs/heads/<branch>）
    /// * `branch` - 本地分支名
    /// * `upstream` - 上游如 origin/main，拆分为远程名与分支名
    /// 仅允许 fast-forward：本地分支没有独有提交时直接快进到远端最新；
    /// 有本地提交（non-fast-forward）时 git 拒绝，避免覆盖本地历史
    pub async fn fetch_branch_ff(repo_path: &Path, branch: &str, upstream: &str) -> GitResult<()> {
        let (remote, _remote_branch) = upstream
            .split_once('/')
            .ok_or_else(|| super::types::GitError::CommandFailed {
                stderr: format!("无效的上游: {upstream}"),
                exit_code: None,
            })?;
        Self::run_git(
            repo_path,
            &["fetch", remote, &format!("{branch}:refs/heads/{branch}")],
        )
        .await?;
        Ok(())
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
