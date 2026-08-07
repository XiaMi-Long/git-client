/**
 * 选中状态管理
 * 管理当前选中对象、提交信息、暂存 / 提交、分支操作、远程同步、cherry-pick、冲突处理
 * 所有 git 操作通过 withOp 包裹，设置当前操作提示（状态栏加载反馈）
 * 依据: tasks 7.x / 8.x / 9.x / 10.x / 11.x / 12.x
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "./repo";
import { useCommitStore } from "./commit";
import { useToast } from "@/composables/useToast";
import type { FileDiff, BranchOperationResult, CompareResult, RemoteResult, OperationState, BranchInfo } from "@/types/git";

export const useSelectionStore = defineStore("selection", () => {
  const repoStore = useRepoStore();
  const commitStore = useCommitStore();
  const { info: toastInfo } = useToast();

  // 选中类型：null 未选中 / working 工作区 / commit 提交
  const type = ref<"working" | "commit" | null>(null);
  const commitHash = ref<string | null>(null);
  const selectedFile = ref<string | null>(null);
  const commitMessage = ref("");
  const commitFileDiffs = ref<FileDiff[]>([]);

  // 当前 git 操作状态（冲突 / merge / rebase / cherry-pick）
  const operationState = ref<OperationState>("normal");
  const conflictedFiles = ref<string[]>([]);

  // 当前正在执行的操作提示文案（状态栏加载反馈），null 表示空闲
  const currentOp = ref<string | null>(null);

  const isWorkingMode = computed(() => type.value === "working");
  const isConflicted = computed(() => operationState.value !== "normal");
  const isBusy = computed(() => currentOp.value !== null);

  /**
   * 包裹一个异步操作，执行期间设置 currentOp 提示，结束后清空
   * @param op - 操作文案，如"拉取中"
   * @param fn - 实际操作
   */
  async function withOp<T>(op: string, fn: () => Promise<T>): Promise<T> {
    currentOp.value = op;
    // 操作开始时给 toast 瞬时反馈（顶部进度条由 currentOp 驱动）
    toastInfo(op);
    try {
      return await fn();
    } finally {
      currentOp.value = null;
    }
  }

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
    return withOp("暂存中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_add", { path, filePath });
      await repoStore.refreshActive();
    });
  }

  async function unstageFile(filePath: string) {
    return withOp("取消暂存中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_unstage", { path, filePath });
      await repoStore.refreshActive();
    });
  }

  async function stageAll() {
    return withOp("全部暂存中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_add_all", { path });
      await repoStore.refreshActive();
    });
  }

  async function unstageAll() {
    return withOp("全部取消暂存中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_unstage_all", { path });
      await repoStore.refreshActive();
    });
  }

  /** 放弃单个文件改动（未暂存 → 恢复；未跟踪 → 删除文件） */
  async function discardFile(filePath: string) {
    return withOp("放弃改动中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_discard_file", { path, file: filePath });
      await repoStore.refreshActive();
    });
  }

  /** 放弃全部未暂存改动（含未跟踪文件） */
  async function discardAll() {
    return withOp("全部放弃中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_discard_all", { path });
      await repoStore.refreshActive();
    });
  }

  /** hunk 级暂存（7.5）：应用单个 hunk patch 到暂存区 */
  async function stageHunk(patch: string) {
    return withOp("暂存 hunk 中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_apply_hunk", { path, patch });
      await repoStore.refreshActive();
    });
  }

  async function commit() {
    return withOp("提交中", async () => {
      const path = repoStore.activeRepo?.path;
      const msg = commitMessage.value.trim();
      if (!path || !msg) return;
      await invoke("git_commit", { path, message: msg });
      commitMessage.value = "";
      await repoStore.refreshActive();
      await commitStore.loadCommits();
    });
  }

  // ===== 分支操作 =====

  async function createBranch(name: string, checkout: boolean): Promise<BranchOperationResult | null> {
    return withOp("新建分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<BranchOperationResult>("git_create_branch", { path, name, checkout });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      }
      return result;
    });
  }

  async function checkoutBranch(name: string, stash = false): Promise<BranchOperationResult | null> {
    return withOp("切换分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      // 工作区有未提交改动时先 stash（用户已在确认框同意）
      if (stash) {
        try {
          await invoke("git_stash_changes", {
            path,
            message: `git-client: 切换分支 ${name} 前自动暂存`,
          });
        } catch (e) {
          return {
            success: false,
            message: `暂存改动失败: ${e}`,
            current_branch: null,
          };
        }
      }
      const result = await invoke<BranchOperationResult>("git_checkout_branch", { path, name });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
        // 切换分支后重新检测冲突状态（避免上一分支的冲突残留）
        await loadOperationState();
        // 切换分支后默认展示新分支的工作区（无需用户手动点击）
        selectWorking();
      }
      return result;
    });
  }

  /** 基于远程分支创建本地分支并切换（含 tracking） */
  async function createBranchFromRemote(localName: string, remoteRef: string): Promise<BranchOperationResult | null> {
    return withOp("创建本地分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<BranchOperationResult>("git_create_branch_from_remote", {
        path,
        localName,
        remoteRef,
      });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      }
      return result;
    });
  }

  /** 快进更新本地分支到其上游（右键获取最新，不切换分支，仅 fast-forward） */
  async function fetchBranchFF(branch: BranchInfo): Promise<BranchOperationResult | null> {
    return withOp("获取最新中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const upstream = branch.upstream;
      if (!upstream) {
        return { success: false, message: `分支 ${branch.name} 没有上游，无法获取最新`, current_branch: null };
      }
      try {
        await invoke("git_fetch_branch_ff", { path, branch: branch.name, upstream });
        await repoStore.refreshActive();
        return { success: true, message: `分支 ${branch.name} 已更新到 ${upstream} 最新`, current_branch: null };
      } catch (e) {
        // 常见原因：本地有独有提交（non-fast-forward），git 拒绝覆盖
        return {
          success: false,
          message: e instanceof Error ? e.message : String(e),
          current_branch: null,
        };
      }
    });
  }

  async function deleteBranch(name: string, force: boolean): Promise<BranchOperationResult | null> {
    return withOp("删除分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<BranchOperationResult>("git_delete_branch", { path, name, force });
      if (result.success) {
        await repoStore.refreshActive();
      }
      return result;
    });
  }

  /** 删除远程分支（git push origin --delete，危险操作） */
  async function deleteRemoteBranch(remoteRef: string): Promise<BranchOperationResult | null> {
    return withOp("删除远程分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      try {
        await invoke("git_push_delete_remote", { path, remoteRef });
        await repoStore.refreshActive();
        return { success: true, message: `远程分支 ${remoteRef} 已删除`, current_branch: null };
      } catch (e) {
        return {
          success: false,
          message: e instanceof Error ? e.message : String(e),
          current_branch: null,
        };
      }
    });
  }

  async function renameBranch(oldName: string, newName: string): Promise<BranchOperationResult | null> {
    return withOp("重命名分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<BranchOperationResult>("git_rename_branch", { path, oldName, newName });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      }
      return result;
    });
  }

  async function mergeBranch(source: string, noFf: boolean): Promise<BranchOperationResult | null> {
    return withOp("合并中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<BranchOperationResult>("git_merge_branch", { path, source, noFf });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      } else {
        // 合并失败（可能冲突）：刷新操作状态 + 仓库数据，进入冲突模式
        await loadOperationState();
        await repoStore.refreshActive();
        // 冲突时切到工作区模式，右侧展示冲突文件与暂存区
        if (operationState.value !== "normal") {
          selectWorking();
        }
      }
      return result;
    });
  }

  /** 比较两分支领先/落后（9.6 精确对比） */
  async function compareBranches(from: string, to: string): Promise<CompareResult | null> {
    return withOp("对比中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      return await invoke<CompareResult>("git_compare_branches", { path, from, to });
    });
  }

  // ===== 远程同步 =====

  async function pull(): Promise<RemoteResult | null> {
    return withOp("拉取中", async () => {
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
    });
  }

  async function push(): Promise<RemoteResult | null> {
    return withOp("推送中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<RemoteResult>("git_push", { path });
      if (result.success) {
        await repoStore.refreshActive();
      }
      return result;
    });
  }

  // ===== cherry-pick（11.x） =====

  async function cherryPick(hash: string): Promise<RemoteResult | null> {
    return withOp("cherry-pick 中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<RemoteResult>("git_cherry_pick", { path, commitHash: hash });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      } else if (result.has_conflict) {
        await loadOperationState();
        selectWorking();
      }
      return result;
    });
  }

  // ===== 压缩挑拣（逐个挑拣 + 末尾压缩的流程原语，由弹窗编排） =====

  /** 挑拣单个提交（cherry-pick，单独落地提交），返回成功 / 冲突结果 */
  async function pickOneCommit(hash: string): Promise<RemoteResult | null> {
    return withOp("挑拣中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const result = await invoke<RemoteResult>("git_cherry_pick", { path, commitHash: hash });
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      } else if (result.has_conflict) {
        await loadOperationState();
      }
      return result;
    });
  }

  /** 获取当前冲突文件列表 */
  async function getConflictedFiles(): Promise<string[]> {
    const path = repoStore.activeRepo?.path;
    if (!path) return [];
    try {
      return await invoke<string[]>("git_list_conflicted_files", { path });
    } catch {
      return [];
    }
  }

  /**
   * 「已解决，继续」：自动校验冲突标记 → 暂存冲突文件 → cherry-pick --continue
   * 外部编辑器解决后不会自动暂存，此处代为暂存；残留标记则拦截
   */
  async function verifyAndContinue(): Promise<{ ok: boolean; message: string; markerFiles: string[] }> {
    const path = repoStore.activeRepo?.path;
    if (!path) return { ok: false, message: "仓库未打开", markerFiles: [] };
    return withOp("校验冲突中", async () => {
      let markers: string[] = [];
      try {
        markers = await invoke<string[]>("git_check_conflict_markers", { path });
      } catch {
        // 检查失败不阻断，交由 continue 暴露问题
      }
      if (markers.length > 0) {
        return {
          ok: false,
          message: "以下文件仍残留冲突标记，请完整解决后再继续",
          markerFiles: markers,
        };
      }
      const conflicted = await invoke<string[]>("git_list_conflicted_files", { path }).catch(
        () => [] as string[]
      );
      for (const f of conflicted) {
        await invoke("git_mark_resolved", { path, filePath: f });
      }
      const result = await invoke<RemoteResult>("git_cherry_pick_continue", { path });
      await loadOperationState();
      if (result.success) {
        await repoStore.refreshActive();
        await commitStore.loadCommits();
        return { ok: true, message: result.message, markerFiles: [] };
      }
      return { ok: false, message: result.message, markerFiles: [] };
    });
  }

  /** 中止当前冲突中的这一次挑拣（已完成的挑拣保留） */
  async function abortCurrentPick(): Promise<boolean> {
    return withOp("中止中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return false;
      try {
        await invoke("git_abort_operation", { path });
      } catch {
        // 中止失败（可能已不在挑拣状态），继续检测真实状态
      }
      await loadOperationState();
      await repoStore.refreshActive();
      await commitStore.loadCommits();
      return operationState.value === "normal";
    });
  }

  /** 末尾压缩：将最近 count 个提交 reset --soft 后重新提交为一个 */
  async function finalizeSquash(count: number, message: string): Promise<RemoteResult | null> {
    return withOp("压缩中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path || count < 1) return null;
      await invoke("git_reset_soft", { path, toCommit: `HEAD~${count}` });
      await invoke("git_commit", { path, message });
      await repoStore.refreshActive();
      await commitStore.loadCommits();
      return { success: true, message: "压缩完成", has_conflict: false, status: null };
    });
  }

  /** 全部回滚：hard reset 到流程开始前的 HEAD（危险操作，用户已确认） */
  async function rollbackAll(toCommit: string): Promise<boolean> {
    return withOp("回滚中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return false;
      try {
        // 若处于冲突中（CHERRY_PICK_HEAD 残留），先中止当前挑拣，
        // 否则 hard reset 不会清理挑拣状态，仓库会卡在「挑拣进行中」
        await invoke("git_abort_operation", { path }).catch(() => {});
        await invoke("git_reset_hard", { path, toCommit });
        await loadOperationState();
        await repoStore.refreshActive();
        await commitStore.loadCommits();
        return true;
      } catch {
        return false;
      }
    });
  }

  /** 场景2：本分支压缩 -- reset --soft HEAD~N + commit（选中须为最近连续 N 个） */
  async function squashPickLocal(hashes: string[], message: string): Promise<RemoteResult | null> {
    return withOp("压缩本分支中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return null;
      const n = hashes.length;
      await invoke("git_reset_soft", { path, toCommit: `HEAD~${n}` });
      await invoke("git_commit", { path, message });
      await repoStore.refreshActive();
      await commitStore.loadCommits();
      return { success: true, message: "本分支压缩成功", has_conflict: false, status: null };
    });
  }

  // ===== 冲突处理（12.x） =====

  async function loadOperationState(): Promise<boolean> {
    const path = repoStore.activeRepo?.path;
    if (!path) return false;
    try {
      operationState.value = await invoke<OperationState>("git_get_operation_state", { path });
      if (operationState.value !== "normal") {
        conflictedFiles.value = await invoke<string[]>("git_list_conflicted_files", { path });
      } else {
        conflictedFiles.value = [];
      }
      return true;
    } catch {
      // 忽略
      return false;
    }
  }

  async function markResolved(filePath: string) {
    return withOp("标记已解决中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      await invoke("git_mark_resolved", { path, filePath });
      await loadOperationState();
      await repoStore.refreshActive();
    });
  }

  async function continueOperation() {
    return withOp("继续中", async () => {
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
        await loadOperationState();
      }
    });
  }

  async function abortOperation() {
    return withOp("中止中", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return;
      try {
        await invoke("git_abort_operation", { path });
        operationState.value = "normal";
        conflictedFiles.value = [];
        await repoStore.refreshActive();
        await commitStore.loadCommits();
      } catch {
        // 中止失败（常见：实际已无进行中的合并/cherry-pick，如用户之前手动撤回过）：
        // 重新检测真实状态，若已是 normal 则清除前端缓存的冲突状态，界面自动恢复
        await loadOperationState();
        await repoStore.refreshActive();
        if (operationState.value === "normal") {
          conflictedFiles.value = [];
        }
      }
    });
  }

  // commitHash 变化时加载该提交的所有文件 diff
  watch(commitHash, () => {
    loadCommitDiffs();
  });

  // 切换仓库时重新检测该仓库的冲突状态（按仓库隔离，避免串扰）
  watch(
    () => repoStore.activeRepo?.id,
    () => {
      loadOperationState();
    },
    { immediate: true }
  );

  return {
    type,
    commitHash,
    selectedFile,
    commitMessage,
    commitFileDiffs,
    operationState,
    conflictedFiles,
    currentOp,
    isWorkingMode,
    isConflicted,
    isBusy,
    selectWorking,
    selectCommit,
    clear,
    loadCommitDiffs,
    loadOperationState,
    stageFile,
    unstageFile,
    stageAll,
    discardFile,
    discardAll,
    stageHunk,
    unstageAll,
    commit,
    createBranch,
    checkoutBranch,
    createBranchFromRemote,
    fetchBranchFF,
    deleteBranch,
    deleteRemoteBranch,
    renameBranch,
    mergeBranch,
    compareBranches,
    pull,
    push,
    cherryPick,
    pickOneCommit,
    getConflictedFiles,
    verifyAndContinue,
    abortCurrentPick,
    finalizeSquash,
    rollbackAll,
    squashPickLocal,
    markResolved,
    continueOperation,
    abortOperation,
  };
});
