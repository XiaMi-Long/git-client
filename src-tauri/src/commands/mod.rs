// Tauri command 处理模块
// 前端通过 invoke 调用的命令在此注册
// 依据: design.md D3, tasks 2.x

use std::path::PathBuf;

use crate::git::{
    BranchOperationResult, BranchInfo, CommitInfo, CompareResult, FileDiff, GitExecutor,
    GitVersionInfo, LogQuery, OperationState, RemoteResult, StashInfo, TagInfo, WorkingAreaStatus,
};

/// 将路径字符串转为 PathBuf
fn to_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

/// 检测 git 版本（2.1）
#[tauri::command]
pub async fn git_detect_version() -> Result<GitVersionInfo, String> {
    GitExecutor::detect_version()
        .await
        .map_err(|e| e.to_string())
}

/// 验证目录是否为有效 git 仓库
#[tauri::command]
pub async fn git_is_valid_repo(path: String) -> Result<bool, String> {
    Ok(GitExecutor::is_valid_repo(&to_path(&path)).await)
}

/// 获取工作区状态（2.2）
#[tauri::command]
pub async fn git_get_status(path: String) -> Result<WorkingAreaStatus, String> {
    GitExecutor::get_status(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 获取提交日志（2.3）
#[tauri::command]
pub async fn git_get_log(path: String, query: LogQuery) -> Result<Vec<CommitInfo>, String> {
    GitExecutor::get_log(&to_path(&path), &query)
        .await
        .map_err(|e| e.to_string())
}

/// 获取提交总数
#[tauri::command]
pub async fn git_get_commit_count(path: String, branch: Option<String>) -> Result<usize, String> {
    GitExecutor::get_commit_count(&to_path(&path), branch.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// 获取工作区某文件的 diff（2.4）
#[tauri::command]
pub async fn git_get_working_diff(path: String, file_path: String) -> Result<Vec<FileDiff>, String> {
    GitExecutor::get_working_diff(&to_path(&path), &file_path)
        .await
        .map_err(|e| e.to_string())
}

/// 获取已暂存某文件的 diff
#[tauri::command]
pub async fn git_get_staged_diff(path: String, file_path: String) -> Result<Vec<FileDiff>, String> {
    GitExecutor::get_staged_diff(&to_path(&path), &file_path)
        .await
        .map_err(|e| e.to_string())
}

/// 获取指定提交中某文件的 diff
#[tauri::command]
pub async fn git_get_commit_diff(
    path: String,
    commit_hash: String,
    file_path: Option<String>,
) -> Result<Vec<FileDiff>, String> {
    GitExecutor::get_commit_diff(&to_path(&path), &commit_hash, file_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// 获取所有分支（2.5）
#[tauri::command]
pub async fn git_list_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    GitExecutor::list_branches(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 获取所有标签
#[tauri::command]
pub async fn git_list_tags(path: String) -> Result<Vec<TagInfo>, String> {
    GitExecutor::list_tags(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 获取当前分支名
#[tauri::command]
pub async fn git_get_current_branch(path: String) -> Result<Option<String>, String> {
    GitExecutor::get_current_branch(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 新建分支（2.6）
#[tauri::command]
pub async fn git_create_branch(
    path: String,
    name: String,
    checkout: bool,
) -> Result<BranchOperationResult, String> {
    GitExecutor::create_branch(&to_path(&path), &name, checkout)
        .await
        .map_err(|e| e.to_string())
}

/// 检出分支
#[tauri::command]
pub async fn git_checkout_branch(
    path: String,
    name: String,
) -> Result<BranchOperationResult, String> {
    GitExecutor::checkout_branch(&to_path(&path), &name)
        .await
        .map_err(|e| e.to_string())
}

/// 暂存工作区改动（检出前自动 stash）
#[tauri::command]
pub async fn git_stash_changes(path: String, message: String) -> Result<(), String> {
    GitExecutor::stash_changes(&to_path(&path), &message)
        .await
        .map_err(|e| e.to_string())
}

/// 列出所有存储条目（git stash list）
#[tauri::command]
pub async fn git_list_stashes(path: String) -> Result<Vec<StashInfo>, String> {
    GitExecutor::list_stashes(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 创建存储（scope: all / staged / unstaged）
#[tauri::command]
pub async fn git_create_stash(path: String, message: String, scope: String) -> Result<(), String> {
    GitExecutor::create_stash(&to_path(&path), &message, &scope)
        .await
        .map_err(|e| e.to_string())
}

/// 应用存储（pop=true 应用并删除 / pop=false 仅应用）
#[tauri::command]
pub async fn git_apply_stash(path: String, index: String, pop: bool) -> Result<(), String> {
    GitExecutor::apply_stash(&to_path(&path), &index, pop)
        .await
        .map_err(|e| e.to_string())
}

/// 删除存储
#[tauri::command]
pub async fn git_drop_stash(path: String, index: String) -> Result<(), String> {
    GitExecutor::drop_stash(&to_path(&path), &index)
        .await
        .map_err(|e| e.to_string())
}

/// 查看存储的文件改动（git stash show -p）
#[tauri::command]
pub async fn git_show_stash(path: String, index: String) -> Result<Vec<FileDiff>, String> {
    GitExecutor::show_stash(&to_path(&path), &index)
        .await
        .map_err(|e| e.to_string())
}

/// 基于远程分支创建本地分支并切换（含 tracking）
#[tauri::command]
pub async fn git_create_branch_from_remote(
    path: String,
    local_name: String,
    remote_ref: String,
) -> Result<BranchOperationResult, String> {
    GitExecutor::create_branch_from_remote(&to_path(&path), &local_name, &remote_ref)
        .await
        .map_err(|e| e.to_string())
}

/// 删除分支
#[tauri::command]
pub async fn git_delete_branch(
    path: String,
    name: String,
    force: bool,
) -> Result<BranchOperationResult, String> {
    GitExecutor::delete_branch(&to_path(&path), &name, force)
        .await
        .map_err(|e| e.to_string())
}

/// 重命名分支
#[tauri::command]
pub async fn git_rename_branch(
    path: String,
    old_name: String,
    new_name: String,
) -> Result<BranchOperationResult, String> {
    GitExecutor::rename_branch(&to_path(&path), &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

/// 合并分支
#[tauri::command]
pub async fn git_merge_branch(
    path: String,
    source: String,
    no_ff: bool,
) -> Result<BranchOperationResult, String> {
    GitExecutor::merge_branch(&to_path(&path), &source, no_ff)
        .await
        .map_err(|e| e.to_string())
}

/// 比较两分支领先/落后（9.6）
#[tauri::command]
pub async fn git_compare_branches(
    path: String,
    from: String,
    to: String,
) -> Result<CompareResult, String> {
    GitExecutor::compare_branches(&to_path(&path), &from, &to)
        .await
        .map_err(|e| e.to_string())
}

/// cherry-pick（2.7）
#[tauri::command]
pub async fn git_cherry_pick(
    path: String,
    commit_hash: String,
) -> Result<RemoteResult, String> {
    GitExecutor::cherry_pick(&to_path(&path), &commit_hash)
        .await
        .map_err(|e| e.to_string())
}

/// cherry-pick 继续
#[tauri::command]
pub async fn git_cherry_pick_continue(path: String) -> Result<RemoteResult, String> {
    GitExecutor::cherry_pick_continue(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// cherry-pick 中止
#[tauri::command]
pub async fn git_cherry_pick_abort(path: String) -> Result<(), String> {
    GitExecutor::cherry_pick_abort(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 拉取（2.8）
#[tauri::command]
pub async fn git_pull(path: String) -> Result<RemoteResult, String> {
    GitExecutor::pull(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 推送
#[tauri::command]
pub async fn git_push(path: String) -> Result<RemoteResult, String> {
    GitExecutor::push(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 推送到指定远程分支
#[tauri::command]
pub async fn git_push_upstream(
    path: String,
    remote: String,
    branch: String,
) -> Result<RemoteResult, String> {
    GitExecutor::push_upstream(&to_path(&path), &remote, &branch)
        .await
        .map_err(|e| e.to_string())
}

/// 删除远程分支（git push origin --delete branch）
#[tauri::command]
pub async fn git_push_delete_remote(
    path: String,
    remote_ref: String,
) -> Result<(), String> {
    GitExecutor::delete_remote_branch(&to_path(&path), &remote_ref)
        .await
        .map_err(|e| e.to_string())
}

/// 获取远程更新（git fetch，更新 origin/* 引用，不动工作区）
#[tauri::command]
pub async fn git_fetch(path: String) -> Result<(), String> {
    GitExecutor::fetch_repo(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 快进更新指定本地分支到其上游（不切换分支，仅 fast-forward）
#[tauri::command]
pub async fn git_fetch_branch_ff(
    path: String,
    branch: String,
    upstream: String,
) -> Result<(), String> {
    GitExecutor::fetch_branch_ff(&to_path(&path), &branch, &upstream)
        .await
        .map_err(|e| e.to_string())
}

/// 设置当前激活仓库（供后台定时 fetch 使用）
#[tauri::command]
pub fn git_set_active_repo(
    state: tauri::State<'_, std::sync::Mutex<crate::FetcherState>>,
    path: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.current_repo = Some(path);
    Ok(())
}

/// 检测冲突状态（2.9）
#[tauri::command]
pub async fn git_check_conflict(path: String) -> Result<bool, String> {
    GitExecutor::check_conflict(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 获取冲突文件列表
#[tauri::command]
pub async fn git_list_conflicted_files(path: String) -> Result<Vec<String>, String> {
    GitExecutor::list_conflicted_files(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 标记冲突文件为已解决
#[tauri::command]
pub async fn git_mark_resolved(path: String, file_path: String) -> Result<(), String> {
    GitExecutor::mark_resolved(&to_path(&path), &file_path)
        .await
        .map_err(|e| e.to_string())
}

/// 中止操作（合并/rebase/cherry-pick）
#[tauri::command]
pub async fn git_abort_operation(path: String) -> Result<(), String> {
    GitExecutor::abort_operation(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 获取当前操作状态
#[tauri::command]
pub async fn git_get_operation_state(path: String) -> Result<OperationState, String> {
    GitExecutor::get_operation_state(&to_path(&path))
        .await
        .map_err(|e| e.to_string())
}

/// 暂存文件（git add）
#[tauri::command]
pub async fn git_add(path: String, file_path: String) -> Result<(), String> {
    GitExecutor::run_git(&to_path(&path), &["add", &file_path])
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 取消暂存（git reset HEAD --）
#[tauri::command]
pub async fn git_unstage(path: String, file_path: String) -> Result<(), String> {
    GitExecutor::run_git(&to_path(&path), &["reset", "HEAD", "--", &file_path])
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 全部暂存
#[tauri::command]
pub async fn git_add_all(path: String) -> Result<(), String> {
    GitExecutor::run_git(&to_path(&path), &["add", "-A"])
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 全部取消暂存
#[tauri::command]
pub async fn git_unstage_all(path: String) -> Result<(), String> {
    GitExecutor::run_git(&to_path(&path), &["reset", "HEAD"])
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 提交
#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    GitExecutor::run_git(&to_path(&path), &["commit", "-m", &message])
        .await
        .map_err(|e| e.to_string())
}

/// hunk 级暂存（7.5）：应用单个 hunk patch 到暂存区
#[tauri::command]
pub async fn git_apply_hunk(path: String, patch: String) -> Result<(), String> {
    GitExecutor::apply_hunk(&to_path(&path), &patch)
        .await
        .map_err(|e| e.to_string())
}

/// cherry-pick 多个提交但不提交（压缩挑拣场景1：跨分支压缩）
#[tauri::command]
pub async fn git_cherry_pick_no_commit(path: String, hashes: Vec<String>) -> Result<(), String> {
    GitExecutor::cherry_pick_no_commit(&to_path(&path), &hashes)
        .await
        .map_err(|e| e.to_string())
}

/// soft reset 到指定提交（压缩挑拣场景2：本分支压缩）
#[tauri::command]
pub async fn git_reset_soft(path: String, to_commit: String) -> Result<(), String> {
    GitExecutor::reset_soft(&to_path(&path), &to_commit)
        .await
        .map_err(|e| e.to_string())
}

/// 获取所有已注册的 command 列表，用于 lib.rs 注册
pub fn all_commands() -> Vec<&'static str> {
    vec![
        "git_detect_version",
        "git_is_valid_repo",
        "git_get_status",
        "git_get_log",
        "git_get_commit_count",
        "git_get_working_diff",
        "git_get_staged_diff",
        "git_get_commit_diff",
        "git_list_branches",
        "git_list_tags",
        "git_get_current_branch",
        "git_create_branch",
        "git_checkout_branch",
        "git_stash_changes",
        "git_list_stashes",
        "git_create_stash",
        "git_apply_stash",
        "git_drop_stash",
        "git_show_stash",
        "git_create_branch_from_remote",
        "git_delete_branch",
        "git_rename_branch",
        "git_merge_branch",
        "git_cherry_pick",
        "git_cherry_pick_continue",
        "git_cherry_pick_abort",
        "git_pull",
        "git_push",
        "git_push_upstream",
        "git_push_delete_remote",
        "git_fetch",
        "git_fetch_branch_ff",
        "git_set_active_repo",
        "git_check_conflict",
        "git_list_conflicted_files",
        "git_mark_resolved",
        "git_abort_operation",
        "git_get_operation_state",
        "git_add",
        "git_unstage",
        "git_add_all",
        "git_unstage_all",
        "git_commit",
    ]
}
