/**
 * 选中状态管理
 * 管理当前选中对象（工作区 / 提交）、选中文件、提交信息，
 * 以及暂存 / 提交操作、分支操作
 * 依据: tasks 7.x / 8.x / 9.x
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "./repo";
import { useCommitStore } from "./commit";
import type { FileDiff, BranchOperationResult } from "@/types/git";

export const useSelectionStore = defineStore("selection", () => {
  const repoStore = useRepoStore();
  const commitStore = useCommitStore();

  // 选中类型：null 未选中 / working 工作区 / commit 提交
  const type = ref<"working" | "commit" | null>(null);
  // 选中的提交哈希（commit 模式）
  const commitHash = ref<string | null>(null);
  // 选中的文件路径（工作区或提交的文件 diff）
  const selectedFile = ref<string | null>(null);
  // 提交信息
  const commitMessage = ref("");
  // 提交模式下加载的该提交所有文件 diff（用于文件列表与 diff 查看）
  const commitFileDiffs = ref<FileDiff[]>([]);

  const isWorkingMode = computed(() => type.value === "working");

  /** 进入工作区模式（7.2） */
  function selectWorking() {
    type.value = "working";
    commitHash.value = null;
    selectedFile.value = null;
    commitFileDiffs.value = [];
  }

  /** 选中某个提交（退出工作区模式） */
  function selectCommit(hash: string) {
    type.value = "commit";
    commitHash.value = hash;
    selectedFile.value = null;
  }

  /** 清除选中 */
  function clear() {
    type.value = null;
    commitHash.value = null;
    selectedFile.value = null;
    commitFileDiffs.value = [];
  }

  /** 加载选中提交的所有文件 diff（8.4 提交模式文件列表） */
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

  /** 暂存文件（7.4） */
  async function stageFile(filePath: string) {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_add", { path, filePath });
    await repoStore.refreshActive();
  }

  /** 取消暂存文件（7.4） */
  async function unstageFile(filePath: string) {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_unstage", { path, filePath });
    await repoStore.refreshActive();
  }

  /** 全部暂存 */
  async function stageAll() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_add_all", { path });
    await repoStore.refreshActive();
  }

  /** 全部取消暂存 */
  async function unstageAll() {
    const path = repoStore.activeRepo?.path;
    if (!path) return;
    await invoke("git_unstage_all", { path });
    await repoStore.refreshActive();
  }

  /** 提交（7.6），空信息拦截 */
  async function commit() {
    const path = repoStore.activeRepo?.path;
    const msg = commitMessage.value.trim();
    if (!path || !msg) return;
    await invoke("git_commit", { path, message: msg });
    commitMessage.value = "";
    await repoStore.refreshActive();
    await commitStore.loadCommits();
  }

  // ===== 分支操作（9.x） =====

  /** 新建分支（9.1） */
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

  /** 检出分支（9.2） */
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

  /** 删除分支（9.3） */
  async function deleteBranch(name: string, force: boolean): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_delete_branch", { path, name, force });
    if (result.success) {
      await repoStore.refreshActive();
    }
    return result;
  }

  /** 重命名分支（9.4） */
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

  /** 合并分支到当前（9.5） */
  async function mergeBranch(source: string, noFf: boolean): Promise<BranchOperationResult | null> {
    const path = repoStore.activeRepo?.path;
    if (!path) return null;
    const result = await invoke<BranchOperationResult>("git_merge_branch", { path, source, noFf });
    if (result.success) {
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    }
    return result;
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
    isWorkingMode,
    selectWorking,
    selectCommit,
    clear,
    loadCommitDiffs,
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
  };
});
