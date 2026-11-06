/**
 * 新 UI 的 Git 写操作集合。
 * 只承载本次重写需要的分支、远程、冲突、储藏和 cherry-pick；
 * 不暴露手工暂存/提交框，冲突标记使用 git add 属于用户已确认的内部行为。
 *
 * @changeLog
 *   - 2026-11-04: Created. 分支/远程/冲突/储藏/cherry-pick 真实命令与刷新。
 */
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import type {
  BranchInfo,
  BranchOperationResult,
  FileDiff,
  OperationState,
  RemoteResult,
} from "@/types/git";

/** 单个操作的可展示结果 */
export interface GitActionResult {
  ok: boolean;
  message: string;
}

const busy = ref<string | null>(null);
const operation = ref<OperationState>("normal");
const conflictedFiles = ref<string[]>([]);
const lastError = ref<string | null>(null);

/**
 * 归一化 Tauri/Git 错误为可展示文案。
 * @param error - 捕获的错误
 * @returns 文案
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 刷新分支/提交/操作状态；单个刷新失败不覆盖主操作结果。
 * @returns {Promise<void>}
 */
async function refreshAll(): Promise<void> {
  await useRepoStore().refreshActive().catch(() => {});
  await useCommitStore().loadCommits().catch(() => {});
  await refreshOperation();
}

/**
 * 分支切换/改名/删除后回到当前分支视图，避免提交列表停留在旧浏览分支。
 * @returns {void}
 */
function focusCurrentBranch(): void {
  const commitStore = useCommitStore();
  commitStore.scope = "current";
  commitStore.browseBranch = null;
}

/**
 * 读取当前 merge/cherry-pick 状态和冲突文件。
 * @returns {Promise<void>}
 */
async function refreshOperation(): Promise<void> {
  const path = useRepoStore().activeRepo?.path;
  if (!path) {
    operation.value = "normal";
    conflictedFiles.value = [];
    return;
  }
  try {
    const state = await invoke<OperationState>("git_get_operation_state", { path });
    operation.value = state;
    if (state === "normal") {
      conflictedFiles.value = [];
    } else {
      conflictedFiles.value = await invoke<string[]>("git_list_conflicted_files", { path }).catch(() => []);
    }
  } catch {
    // 检测失败时保留旧状态，避免误报正常
  }
}

/**
 * 包裹一次 Git 写操作，统一 busy、错误与刷新。
 * @param label - 操作中提示
 * @param action - 实际命令
 * @returns 操作结果；已有操作时返回失败
 */
async function run(label: string, action: () => Promise<GitActionResult>): Promise<GitActionResult> {
  if (busy.value) {
    return { ok: false, message: `正在${busy.value}，请稍候` };
  }
  busy.value = label;
  lastError.value = null;
  try {
    return await action();
  } catch (error) {
    const message = errorText(error);
    lastError.value = message;
    return { ok: false, message };
  } finally {
    busy.value = null;
  }
}

/**
 * 新 UI Git 写操作 composable（模块级单例，供壳层/冲突组件共享）。
 */
export function useGitActions() {
  const repoStore = useRepoStore();
  const commitStore = useCommitStore();

  /**
   * 检出分支；脏工作区可由用户确认先储藏。
   * @param branch - 目标分支
   * @param stashFirst - 是否先储藏当前改动
   * @returns 操作结果
   */
  async function checkoutBranch(branch: BranchInfo, stashFirst = false): Promise<GitActionResult> {
    return run("切换分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      if (stashFirst) {
        await invoke("git_stash_changes", {
          path,
          message: `git-client: 切换分支 ${branch.name} 前自动储藏`,
        });
      }
      const result = await invoke<BranchOperationResult>("git_checkout_branch", { path, name: branch.name });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 新建本地分支。
   * @param name - 分支名
   * @returns 操作结果
   */
  async function createBranch(name: string): Promise<GitActionResult> {
    return run("新建分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_create_branch", { path, name, checkout: true });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 重命名本地分支。
   * @param oldName - 原名
   * @param newName - 新名
   * @returns 操作结果
   */
  async function renameBranch(oldName: string, newName: string): Promise<GitActionResult> {
    return run("重命名分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_rename_branch", { path, oldName, newName });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 删除本地分支。
   * @param name - 分支名
   * @param force - 是否强制删除
   * @returns 操作结果
   */
  async function deleteBranch(name: string, force = false): Promise<GitActionResult> {
    return run("删除分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_delete_branch", { path, name, force });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 合并分支到当前分支。
   * @param source - 源分支
   * @returns 操作结果
   */
  async function mergeBranch(source: string): Promise<GitActionResult> {
    return run("合并分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_merge_branch", { path, source, noFf: false });
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 基于远程分支创建本地 tracking 分支。
   * @param localName - 本地名
   * @param remoteRef - 远程引用
   * @returns 操作结果
   */
  async function createFromRemote(localName: string, remoteRef: string): Promise<GitActionResult> {
    return run("从远程创建分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_create_branch_from_remote", {
        path,
        localName,
        remoteRef,
      });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 设置本地分支上游。
   * @param branch - 本地分支名
   * @param upstream - 远程引用
   * @returns 操作结果
   */
  async function setUpstream(branch: string, upstream: string): Promise<GitActionResult> {
    return run("设置上游", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<BranchOperationResult>("git_set_upstream", { path, branch, upstream });
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 分支行内拉取：当前分支真实 pull，非当前分支快进到上游。
   * @param branch - 分支
   * @returns 操作结果
   */
  async function pullBranch(branch: BranchInfo): Promise<GitActionResult> {
    return run(`拉取 ${branch.name}`, async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      if (branch.is_current) {
        const result = await invoke<RemoteResult>("git_pull", { path });
        await refreshAll();
        return { ok: result.success, message: result.message };
      }
      if (!branch.upstream) {
        return { ok: false, message: `分支 ${branch.name} 没有上游` };
      }
      await invoke("git_fetch_branch_ff", { path, branch: branch.name, upstream: branch.upstream });
      await refreshAll();
      return { ok: true, message: `已更新 ${branch.name} 到 ${branch.upstream}` };
    });
  }

  /**
   * 删除远程分支。
   * @param remoteRef - 远程引用
   * @returns 操作结果
   */
  async function deleteRemoteBranch(remoteRef: string): Promise<GitActionResult> {
    return run("删除远程分支", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_push_delete_remote", { path, remoteRef });
      await refreshAll();
      return { ok: true, message: `已删除远程分支 ${remoteRef}` };
    });
  }

  /**
   * 远程 fetch。
   * @returns 操作结果
   */
  async function fetchRemote(): Promise<GitActionResult> {
    return run("获取远程", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_fetch", { path });
      await refreshAll();
      return { ok: true, message: "远程引用已更新" };
    });
  }

  /**
   * 拉取当前分支。
   * @returns 操作结果
   */
  async function pullCurrent(): Promise<GitActionResult> {
    return run("拉取", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<RemoteResult>("git_pull", { path });
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 推送当前分支。
   * @returns 操作结果
   */
  async function pushCurrent(): Promise<GitActionResult> {
    return run("推送", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<RemoteResult>("git_push", { path });
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  /**
   * 标记冲突文件已解决（内部 git add）。
   * @param filePath - 仓库相对路径
   * @returns 操作结果
   */
  async function markResolved(filePath: string): Promise<GitActionResult> {
    return run("标记冲突已解决", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_mark_resolved", { path, filePath });
      await repoStore.refreshActive().catch(() => {});
      await refreshOperation();
      return { ok: true, message: `已标记 ${filePath} 已解决` };
    });
  }

  /**
   * 检查冲突标记。
   * @returns 仍含冲突标记的文件
   */
  async function checkConflictMarkers(): Promise<string[]> {
    const path = repoStore.activeRepo?.path;
    if (!path) return [];
    try {
      return await invoke<string[]>("git_check_conflict_markers", { path });
    } catch {
      return [];
    }
  }

  /**
   * 继续当前 merge/pull 或 cherry-pick（内部自动提交）。
   * @returns 操作结果
   */
  async function continueOperation(): Promise<GitActionResult> {
    return run("继续操作", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      let result: GitActionResult;
      if (operation.value === "cherrypicking") {
        const remote = await invoke<RemoteResult>("git_cherry_pick_continue", { path });
        result = { ok: remote.success, message: remote.message };
      } else if (operation.value === "merging" || operation.value === "conflict") {
        const remote = await invoke<RemoteResult>("git_merge_continue", { path });
        result = { ok: remote.success, message: remote.message };
      } else {
        return { ok: false, message: "当前没有可继续的合并或挑拣" };
      }
      await refreshAll();
      return result;
    });
  }

  /**
   * 中止当前操作。
   * @returns 操作结果
   */
  async function abortOperation(): Promise<GitActionResult> {
    return run("中止操作", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_abort_operation", { path });
      await refreshAll();
      return { ok: true, message: "已中止当前操作" };
    });
  }

  /**
   * 新建储藏（默认全部改动，符合本次无暂存 UI 的假设）。
   * @param message - 储藏名
   * @returns 操作结果
   */
  async function createStash(message: string): Promise<GitActionResult> {
    return run("新建储藏", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_create_stash", { path, message, scope: "all" });
      await refreshAll();
      return { ok: true, message: "已新建储藏" };
    });
  }

  /**
   * 应用储藏。
   * @param index - stash 引用
   * @returns 操作结果
   */
  async function applyStash(index: string): Promise<GitActionResult> {
    return run("应用储藏", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_apply_stash", { path, index, pop: false });
      await refreshAll();
      return { ok: true, message: `已应用 ${index}` };
    });
  }

  /**
   * 删除储藏。
   * @param index - stash 引用
   * @returns 操作结果
   */
  async function dropStash(index: string): Promise<GitActionResult> {
    return run("删除储藏", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      await invoke("git_drop_stash", { path, index });
      await refreshAll();
      return { ok: true, message: `已删除 ${index}` };
    });
  }

  /**
   * 批量删除储藏。
   * 删除后 stash 编号会整体前移，因此按编号从大到小执行；
   * 任意一条失败也刷新列表，避免界面继续显示已失效条目。
   * @param indices - 待删除的 stash 引用
   * @returns 操作结果
   */
  async function dropStashes(indices: string[]): Promise<GitActionResult> {
    return run("批量删除储藏", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path || !indices.length) return { ok: false, message: "没有选中的储藏" };
      const number = (index: string) => {
        const matched = index.match(/stash@\{(\d+)\}/);
        return matched ? Number(matched[1]) : -1;
      };
      const ordered = [...indices].sort((left, right) => number(right) - number(left));
      try {
        for (const index of ordered) {
          await invoke("git_drop_stash", { path, index });
        }
        return { ok: true, message: `已删除 ${ordered.length} 条储藏` };
      } finally {
        await refreshAll();
      }
    });
  }

  /**
   * 读取储藏 diff。
   * @param index - stash 引用
   * @returns 文件 diff；失败时为空
   */
  async function showStash(index: string): Promise<FileDiff[]> {
    const path = repoStore.activeRepo?.path;
    if (!path) return [];
    try {
      return await invoke<FileDiff[]>("git_show_stash", { path, index });
    } catch (error) {
      lastError.value = errorText(error);
      return [];
    }
  }

  /**
   * Cherry-pick 单个提交。
   * @param commitHash - 完整哈希
   * @returns 操作结果
   */
  async function cherryPick(commitHash: string): Promise<GitActionResult> {
    return run("Cherry-pick", async () => {
      const path = repoStore.activeRepo?.path;
      if (!path) return { ok: false, message: "仓库未打开" };
      const result = await invoke<RemoteResult>("git_cherry_pick", { path, commitHash });
      focusCurrentBranch();
      await refreshAll();
      return { ok: result.success, message: result.message };
    });
  }

  return {
    busy,
    operation,
    conflictedFiles,
    lastError,
    refreshOperation,
    checkoutBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    mergeBranch,
    createFromRemote,
    setUpstream,
    pullBranch,
    deleteRemoteBranch,
    fetchRemote,
    pullCurrent,
    pushCurrent,
    markResolved,
    checkConflictMarkers,
    continueOperation,
    abortOperation,
    createStash,
    applyStash,
    dropStash,
    dropStashes,
    showStash,
    cherryPick,
  };
}
