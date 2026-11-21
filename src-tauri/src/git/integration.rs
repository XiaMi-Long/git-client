//! 撤销当前分支最近一次尚未推送的合入。
//!
//! 从分支 reflog 识别实际操作和回退点，不根据提交标题或父提交数量猜测操作来源。
//! @changeLog
//! - 2026-11-21: Created. 校验合入来源、远程上游和工作区后撤销本地合入。
//! - 2026-11-21: Updated. 阻止回退覆盖同名或路径冲突的本地忽略文件。

use std::{path::Path, time::Duration};

use serde::{Deserialize, Serialize};

use super::{
    executor::GitExecutor,
    types::{GitError, GitResult},
    BranchUpstreamTarget,
};

/// 旧版 Git 不会向管道及时回报 prepare，不能用以下流程锁住引用再更新文件。
const MIN_UNDO_GIT_VERSION: (u32, u32) = (2, 34);
/// 只读查询上游的超时；网络或认证异常不能一直阻塞撤销。
const UPSTREAM_CHECK_TIMEOUT: Duration = Duration::from_secs(8);

/// 用户确认时绑定实际分支、合入前后提交和上游，避免将已确认的操作用到新的仓库状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrationUndoTarget {
    branch_ref: String,
    head_hash: String,
    previous_hash: String,
    upstream: BranchUpstreamTarget,
    upstream_hash: String,
}

/// Git 的 reflog 可区分最新一次移动是挑拣、合并提交还是快进合并。
enum IntegrationKind {
    CherryPick,
    MergeCommit,
    FastForward,
}

impl IntegrationKind {
    /// 从 Git 记录的操作识别合入类型；普通提交标题即使写着 merge 也不会匹配。
    fn from_reflog(message: &str) -> Option<Self> {
        let (action, subject) = message.split_once(':')?;
        match action {
            "cherry-pick" | "commit (cherry-pick)" => Some(Self::CherryPick),
            "commit (merge)" => Some(Self::MergeCommit),
            _ if action == "merge" || action.starts_with("merge ") => {
                if subject.trim() == "Fast-forward" {
                    Some(Self::FastForward)
                } else {
                    Some(Self::MergeCommit)
                }
            }
            _ => None,
        }
    }
}

/// 用户确认的状态失效时，沿用分支操作的刷新提示。
pub(super) fn stale_undo_target() -> GitError {
    GitError::CommandFailed {
        stderr: "请刷新分支信息后重试".to_owned(),
        exit_code: None,
    }
}

impl GitExecutor {
    /// 读取选中提交的撤销对象。无法核实任一条件时，不提供撤销入口。
    pub async fn get_integration_undo_target(
        repo_path: &Path,
        branch_ref: &str,
        head_hash: &str,
    ) -> GitResult<Option<IntegrationUndoTarget>> {
        // 1. 选中提交必须仍是当前本地分支顶端，并且有可核对的远程上游。
        if !branch_ref.starts_with("refs/heads/") {
            return Ok(None);
        }
        let preview = Self::get_branch_info(repo_path, branch_ref).await?;
        let is_selected_head = preview.branch.is_current && preview.branch.commit_hash == head_hash;
        let has_unpushed_commits = !preview.upstream_gone && preview.branch.ahead > 0;
        if !is_selected_head || !has_unpushed_commits {
            return Ok(None);
        }
        let Some(upstream) = preview.upstream_target else {
            return Ok(None);
        };
        let head_ref = Self::run_git(repo_path, &["symbolic-ref", "--quiet", "--no-recurse", "HEAD"]).await?;
        if head_ref.trim_end() != branch_ref {
            return Ok(None);
        }

        // 2. 从当前分支的记录确定回退位置，并排除无法安全更新文件的情形。
        let Some(previous_hash) = Self::integration_undo_base(repo_path, branch_ref, head_hash).await? else {
            return Ok(None);
        };
        let git_version = Self::detect_version().await?;
        if (git_version.major, git_version.minor) < MIN_UNDO_GIT_VERSION {
            return Ok(None);
        }
        if !Self::is_integration_undo_worktree_clean(repo_path, branch_ref).await? {
            return Ok(None);
        }
        if Self::integration_changes_submodules(repo_path, head_hash, &previous_hash).await? {
            // 撤销只操作当前仓库，不能同时移动子模块的 HEAD，也不能留下错位的子模块状态。
            return Ok(None);
        }

        // 3. 未推送标记可能滞后于其他客户端的推送；只读核对服务器上游，不更新任何远程引用。
        let Some(upstream_hash) =
            Self::unpublished_integration_upstream(repo_path, head_hash, &previous_hash, &upstream).await?
        else {
            return Ok(None);
        };
        Ok(Some(IntegrationUndoTarget {
            branch_ref: branch_ref.to_owned(),
            head_hash: head_hash.to_owned(),
            previous_hash,
            upstream,
            upstream_hash,
        }))
    }

    /// 按用户确认的对象撤销合入，写入前再次核对状态，不能将旧确认用于新提交。
    pub async fn undo_integration(repo_path: &Path, target: &IntegrationUndoTarget) -> GitResult<()> {
        let current = Self::get_integration_undo_target(repo_path, &target.branch_ref, &target.head_hash).await?;
        if current.as_ref() != Some(target) {
            return Err(stale_undo_target());
        }
        Self::update_head_for_integration_undo(
            repo_path,
            &target.branch_ref,
            &target.head_hash,
            &target.previous_hash,
            &target.upstream.tracking_ref,
            &target.upstream_hash,
        )
        .await
    }

    /// 只接受当前分支最后一条移动记录，并核对合入前哈希确实属于同一条历史。
    async fn integration_undo_base(
        repo_path: &Path,
        branch_ref: &str,
        head_hash: &str,
    ) -> GitResult<Option<String>> {
        // 1. 读取分支自己的 reflog，避免普通的分支切换记录干扰判断。
        let reflog = Self::run_git(repo_path, &[
            "reflog", "show", "--max-count=2", "--no-notes", "--no-show-signature",
            "--no-color", "--format=%H%x00%gs", branch_ref, "--",
        ])
        .await?;
        let mut entries = reflog.lines();
        let latest_entry = entries.next().and_then(|entry| entry.split_once('\0'));
        let previous_entry = entries.next().and_then(|entry| entry.split_once('\0'));
        let (Some((latest_hash, message)), Some((logged_previous, _))) = (latest_entry, previous_entry) else {
            return Ok(None);
        };
        let Some(kind) = IntegrationKind::from_reflog(message) else {
            return Ok(None);
        };
        if latest_hash != head_hash || logged_previous == head_hash {
            return Ok(None);
        }

        // 2. reflog 被清理后可能出现断档。不能把断档之前的提交误当成本次合入前的位置。
        let previous_ref = format!("{branch_ref}@{{1}}^{{commit}}");
        let previous = Self::run_git_raw(Some(repo_path), &["rev-parse", "--verify", &previous_ref]).await?;
        let is_continuous = previous.status.success()
            && previous.stderr.is_empty()
            && String::from_utf8_lossy(&previous.stdout).trim_end() == logged_previous;
        if !is_continuous {
            return Ok(None);
        }

        // 3. 非快进操作必须直接接在原提交后；快进则以 reflog 记录的祖先为准。
        let matches_history = match kind {
            IntegrationKind::FastForward => {
                Self::branch_commit_is_ancestor(repo_path, logged_previous, head_hash).await?
            }
            IntegrationKind::CherryPick | IntegrationKind::MergeCommit => {
                let parents = Self::run_git(repo_path, &["rev-list", "--parents", "-n", "1", head_hash, "--"]).await?;
                let mut hashes = parents.split_whitespace();
                let starts_at_previous = hashes.next() == Some(head_hash) && hashes.next() == Some(logged_previous);
                let has_second_parent = hashes.next().is_some();
                starts_at_previous && (has_second_parent == matches!(kind, IntegrationKind::MergeCommit))
            }
        };
        Ok(matches_history.then(|| logged_previous.to_owned()))
    }

    /// 检查进行中的 Git 操作及所有未提交改动。其他工作树共用该分支时也不能回退。
    pub(super) async fn is_integration_undo_worktree_clean(repo_path: &Path, branch_ref: &str) -> GitResult<bool> {
        // 1. 单看工作区状态会漏掉已经暂存完冲突解决结果、但还在进行中的操作。
        let git_dir = Self::run_git(repo_path, &["rev-parse", "--absolute-git-dir"]).await?;
        let git_dir = Path::new(git_dir.trim_end_matches(['\r', '\n']));
        for operation_path in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"] {
            if git_dir.join(operation_path).try_exists()? {
                return Ok(false);
            }
        }

        // 2. 绕过隐藏未跟踪项或子模块的配置，不能因为用户的展示偏好就把工作区当作干净。
        let status = Self::run_git(repo_path, &[
            "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=none",
        ])
        .await?;
        if !status.is_empty() {
            return Ok(false);
        }
        let worktrees = Self::run_git(repo_path, &["worktree", "list", "--porcelain"]).await?;
        let checked_out_count = worktrees.lines()
            .filter(|entry| entry.strip_prefix("branch ") == Some(branch_ref))
            .count();
        Ok(checked_out_count == 1)
    }

    /// 更新工作区和索引前保护本地忽略项；Git 的 read-tree 可能覆盖这些未跟踪的文件。
    pub(super) async fn update_integration_undo_tree(
        repo_path: &Path,
        from_hash: &str,
        to_hash: &str,
    ) -> GitResult<()> {
        // 仓库可从子目录打开；忽略项必须从仓库根目录读取，才能覆盖工作树中的所有写入路径。
        let repo_root = Self::get_repo_root(repo_path).await?;
        let repo_path = repo_root.as_path();

        // 1. 只检查将被写入的新路径。删除或修改两边都已跟踪的路径不会占用忽略项的位置。
        let restored_paths = Self::run_git(repo_path, &[
            "diff-tree", "-r", "--no-commit-id", "--no-renames", "--diff-filter=A",
            "--name-only", "-z", from_hash, to_hash, "--",
        ])
        .await?;
        if !restored_paths.is_empty() {
            // 2. Git 可以折叠整个忽略目录；既拦截同名文件，也拦截文件和目录互相替换。
            let ignored_paths = Self::run_git(repo_path, &[
                "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z", "--",
            ])
            .await?;
            let restored_paths: Vec<String> = restored_paths.split_terminator('\0').map(str::to_uppercase).collect();
            for ignored_path in ignored_paths.split_terminator('\0') {
                // 在大小写不敏感的工作区，大小写不同的 Git 路径仍可能落到同一个文件。
                let protected_path = ignored_path.trim_end_matches('/').to_uppercase();
                let conflicts_with_restored_path = restored_paths.iter().any(|restored_path| {
                    restored_path == &protected_path
                        || restored_path.strip_prefix(protected_path.as_str()).is_some_and(|suffix| suffix.starts_with('/'))
                        || protected_path.strip_prefix(restored_path.as_str()).is_some_and(|suffix| suffix.starts_with('/'))
                });
                if conflicts_with_restored_path {
                    return Err(GitError::CommandFailed {
                        stderr: format!("The following untracked working tree files would be overwritten by checkout:\n\t{ignored_path}"),
                        exit_code: None,
                    });
                }
            }
        }

        // 3. 两棵树交给 Git 处理，保留 Git 自身对未提交改动和非忽略文件的检查。
        Self::run_git(repo_path, &["read-tree", "-m", "-u", "--no-recurse-submodules", from_hash, to_hash]).await?;
        Ok(())
    }

    /// 识别 Git 记录的子模块指针变化，不读取或移动子模块仓库的本地引用。
    async fn integration_changes_submodules(repo_path: &Path, head_hash: &str, previous_hash: &str) -> GitResult<bool> {
        const GITLINK_MODE: &str = "160000";
        let changes = Self::run_git(repo_path, &[
            "diff-tree", "--raw", "--no-commit-id", "--no-renames", "--ignore-submodules=none", "-r", head_hash, previous_hash, "--",
        ])
        .await?;
        Ok(changes.lines().filter_map(|line| line.strip_prefix(':')).any(|change| {
            change.split_whitespace().take(2).any(|mode| mode == GITLINK_MODE)
        }))
    }

    /// 确认服务器仍与本机上游记录一致，且合入引入的提交中没有任何一笔出现在当前分支上游。
    async fn unpublished_integration_upstream(
        repo_path: &Path,
        head_hash: &str,
        previous_hash: &str,
        upstream: &BranchUpstreamTarget,
    ) -> GitResult<Option<String>> {
        // 1. 浅克隆可能看不到共同祖先；默认推送不是上游时，检查上游不足以确认是否已推送。
        let shallow = Self::run_git(repo_path, &["rev-parse", "--is-shallow-repository"]).await?;
        if shallow.trim() != "false" {
            return Ok(None);
        }
        let push_ref = Self::run_git(repo_path, &["rev-parse", "--verify", "--symbolic-full-name", "@{push}"]).await?;
        if push_ref.trim_end() != upstream.tracking_ref {
            return Ok(None);
        }
        let tracking_commit = format!("{}^{{commit}}", upstream.tracking_ref);
        let tracking_hash = Self::run_git(repo_path, &["rev-parse", "--verify", &tracking_commit]).await?;
        let tracking_hash = tracking_hash.trim();

        // 2. 比较共同祖先；快进后只推送其中一部分的情况同样不能回退。
        let bases = Self::run_git_raw(Some(repo_path), &["merge-base", "--all", head_hash, tracking_hash]).await?;
        if !matches!(bases.status.code(), Some(0) | Some(1)) {
            return Ok(None);
        }
        for base in String::from_utf8_lossy(&bases.stdout).lines() {
            if !Self::branch_commit_is_ancestor(repo_path, base, previous_hash).await? {
                return Ok(None);
            }
        }

        // 3. 只查询实际跟踪的远端分支。未找到或请求失败均由调用者按不可撤销处理。
        let advertised_ref = Self::run_git_with_timeout(repo_path, &[
            "-c", "credential.interactive=false", "ls-remote", "--exit-code", "--refs", "--",
            upstream.remote.as_str(), upstream.remote_ref.as_str(),
        ], UPSTREAM_CHECK_TIMEOUT)
        .await?;
        let matches_server = advertised_ref.trim_end().split_once('\t')
            == Some((tracking_hash, upstream.remote_ref.as_str()));
        Ok(matches_server.then(|| tracking_hash.to_owned()))
    }
}
