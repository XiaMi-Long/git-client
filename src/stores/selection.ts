/**
 * 选中状态管理
 * 管理当前选中对象、提交信息、暂存 / 提交、分支操作、远程同步、cherry-pick、冲突处理
 * 依据: tasks 7.x / 8.x / 9.x / 10.x / 11.x / 12.x
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "./repo";
import { useCommitStore } from "./commit";
import type { FileDiff, BranchOperationResult, RemoteResult, OperationState } from "@/types/git";

export const useSelectionStore = defineStore("selection", () => {
  const repoStore = useRepoStore();
  const commitStore = useCommitStore();

  // 选中类型：null 未选中 / working 工作区 / commit 提交
  const type = ref<"working" | "commit" | null>(null);
  const commitHash = ref<string | null>(null);
  const selectedFile = ref<string | null>(null);
  const commitMessage = ref("");
  const commitFileDiffs = ref<FileDiff[]>([]);

  // 当前 git 操作状态（冲突 / merge / rebase / cherry-pick）
  const operationState = ref<OperationState>("normal");
  const conflictedFiles = ref<string[]>([]);

  const isWorkingMode = computed(() => type.value === "working");
  const isConflicted = computed(() => operationState.value !== "normal");

  function selectWorking() {
    type.value = "working";
    commitHash.value = null;
    selectedFile.value = null;
    commitFileDiffs.value = [];
  }

  function selectCommit(hash: string) {
    type.value = "commit";
    commitHash.value = hash;
    selectedFile.value = null;
  }

  function clear() {
    type.value = null;
    commitHash.value = null;
    selectedFile.value = null;
    commitFileDiffs.value = [];
  }

  async function loadCommitDiffs() {
    const path = repoStore.activeRepo?.path;
    if (!path || !commitHash.value) {
      commitFileDiffs.value = [];
      return;
    }
    try {
      commitFileDiffs.value = await invoke<FileDiff[]>("git_get_commit_diff", {
        path,
        commitHash: commitHash.value,
        filePath: null,
      });
    } catch {
      commitFileDiffs.value = [];
    }
  }

  // ===== 暂存 / 提交 =====

  async function stageFile(filePath: string) {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_add", { path, filePath });
    await repoStore.refreshActive();
  }

  async function unstageFile(filePath: string) {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_unstage", { path, filePath });
    await repoStore.refreshActive();
  }

  async function stageAll() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_add_all", { path });
    await repoStore.refreshActive();
  }

  async function unstageAll() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_unstage_all", { path });
    await repoStore.refreshActive();
  }

  async function commit() {
    const path = repoStore.activeRepo?.path;
    const msg = commitMessage.value.trim();
    if (!path || !msg) return;
    await invoke("git_commit", { path, message: msg });
    commitMessage.value = "";
    await repoStore.refreshActive();
    await commitStore.loadCommits();
  }

  // ===== 分支操作 =====

  async function createBranch(name: string, checkout: boolean): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_create_branch", { path, name, checkout });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    }
    return result;
  }

  async function checkoutBranch(name: string): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_checkout_branch", { path, name });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    }
    return result;
  }

  async function deleteBranch(name: string, force: boolean): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_delete_branch", { path, name, force });
    if (result.success) {
      await repoStore.refreshActive();
    }
    return result;
  }

  async function renameBranch(oldName: string, newName: string): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_rename_branch", { path, oldName, newName });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    }
    return result;
  }

  async function mergeBranch(source: string, noFf: boolean): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_merge_branch", { path, source, noFf });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    } else {
      // 合并可能产生冲突，刷新操作状态
      await loadOperationState();
    }
    return result;
  }

  // ===== 远程同步 =====

  async function pull(): Promise<RemoteResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<RemoteResult>("git_pull", { path });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    } else if (result.has_conflict) {
      await loadOperationState();
    } else if (result.status) {
      const tab = repoStore.activeRepo;
      if (tab) tab.status = result.status;
    }
    return result;
  }

  async function push(): Promise<RemoteResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<RemoteResult>("git_push", { path });
    if (result.success) {
      await repoStore.refreshActive();
    }
    return result;
  }

  // ===== cherry-pick（11.x） =====

  /** 对指定提交执行 cherry-pick */
  async function cherryPick(hash: string): Promise<RemoteResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<RemoteResult>("git_cherry_pick", { path, commitHash: hash });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    } else if (result.has_conflict) {
      // 冲突 -> 进入冲突状态，切到工作区模式查看冲突文件
      await loadOperationState();
      selectWorking();
    }
    return result;
  }

  // ===== 冲突处理（12.x） =====

  /** 加载当前操作状态与冲突文件列表 */
  async function loadOperationState() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    try {
      operationState.value = await invoke<OperationState>("git_get_operation_state", { path });
      if (operationState.value !== "normal") {
        conflictedFiles.value = await invoke<string[]>("git_list_conflicted_files", { path });
      } else {
        conflictedFiles.value = [];
      }
    } catch {
      // 忽略
    }
  }

  /** 标记冲突文件为已解决 */
  async function markResolved(filePath: string) {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_mark_resolved", { path, filePath });
    await loadOperationState();
    await repoStore.refreshActive();
  }

  /** 继续当前操作（cherry-pick / merge） */
  async function continueOperation() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    try {
      if (operationState.value === "cherrypicking") {
        await invoke("git_cherry_pick_continue", { path });
      }
      await loadOperationState();
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    } catch {
      // 继续可能仍冲突
      await loadOperationState();
    }
  }

  /** 中止当前操作 */
  async function abortOperation() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_abort_operation", { path });
    operationState.value = "normal";
    conflictedFiles.value = [];
    await repoStore.refreshActive();
    await commitStore.loadCommits();
  }

  // commitHash 变化时加载该提交的所有文件 diff
  watch(commitHash, () => {
    loadCommitDiffs();
  });

  return {
    type,
    commitHash,
    selectedFile,
    commitMessage,
    commitFileDiffs,
    operationState,
    conflictedFiles,
    isWorkingMode,
    isConflicted,
    selectWorking,
    selectCommit,
    clear,
    loadCommitDiffs,
    loadOperationState,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    commit,
    createBranch,
    checkoutBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    pull,
    push,
    cherryPick,
    markResolved,
    continueOperation,
    abortOperation,
  };
});
