/**
 * 仓库状态管理
 * 多仓库标签页，每仓库独立状态（分支 / 标签 / 工作区状态）
 * 已打开仓库路径持久化到 localStorage，启动时先恢复项目行，再按需读取仓库数据
 * 依据: design.md D4, tasks 5.x
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { BranchInfo, TagInfo, WorkingAreaStatus, StashInfo } from "@/types/git";

/** 持久化已打开仓库路径的 localStorage key */
const STORAGE_KEY = "git-client-recent-repos";

/** 单个仓库的运行时状态 */
export interface RepoTab {
  id: string;
  /** 仓库名（目录名） */
  name: string;
  /** 仓库路径 */
  path: string;
  /** 分支列表 */
  branches: BranchInfo[];
  /** 已成功读取分支列表，即使当前处于游离 HEAD 或仓库尚无分支。 */
  branchSummaryReady: boolean;
  /** 标签列表 */
  tags: TagInfo[];
  /** 存储（stash）列表 */
  stashes: StashInfo[];
  /** 工作区状态 */
  status: WorkingAreaStatus | null;
  /** 是否正在准备激活项目的本地仓库数据。 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 创建只含路径和名称的项目行，供启动恢复和手动添加复用。
 * @param path - 保存或选择的仓库路径
 * @returns 尚未读取 Git 数据的仓库状态
 */
function createRepoTab(path: string): RepoTab {
  return {
    id: crypto.randomUUID(),
    name: path.split(/[/\\]/).filter(Boolean).pop() ?? path,
    path,
    branches: [],
    branchSummaryReady: false,
    tags: [],
    stashes: [],
    status: null,
    loading: false,
    error: null,
  };
}

export const useRepoStore = defineStore("repo", () => {
  // 所有打开的仓库标签
  const repos = ref<RepoTab[]>([]);
  // 当前激活的标签 id
  const activeId = ref<string | null>(null);
  // 尚未完成目录校验的选中项目，用于提示等待并推迟后台摘要读取。
  const pendingActivationId = ref<string | null>(null);
  // 当前激活的仓库
  const activeRepo = computed(
    () => repos.value.find((r) => r.id === activeId.value) ?? null
  );
  // 启动恢复的项目共享校验请求，null 表示尚未发起或需要重试。
  const restoredRepoChecks = new Map<string, Promise<boolean> | null>();
  const refreshRequests = new Map<string, symbol>();
  let activationSequence = 0;
  let watcherUpdate: Promise<void> = Promise.resolve();

  /** 将已打开仓库路径持久化到 localStorage */
  function persist() {
    const paths = repos.value.map((r) => r.path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  }

  /**
   * 校验从本地路径恢复的项目，失效路径从当前列表跳过。
   * @param repo - 已显示但可能尚未校验的仓库
   * @returns 仓库可继续读取时返回 true
   */
  async function validateRestoredRepo(repo: RepoTab): Promise<boolean> {
    const pendingCheck = restoredRepoChecks.get(repo.id);
    if (pendingCheck === undefined) {
      return true;
    }
    if (pendingCheck) {
      return pendingCheck;
    }

    const check = invoke<boolean>("git_is_valid_repo", { path: repo.path }).then((valid) => {
      // 校验期间移除的项目已失效，不能被旧响应重新激活。
      if (!restoredRepoChecks.delete(repo.id)) {
        return false;
      }
      if (!valid) {
        repos.value = repos.value.filter((item) => item.id !== repo.id);
      }
      return valid;
    }).catch((error) => {
      // 调用失败时保留该行，用户下次打开可重新校验目录。
      if (restoredRepoChecks.has(repo.id)) {
        restoredRepoChecks.set(repo.id, null);
        repo.error = error instanceof Error ? error.message : String(error);
      }
      return false;
    });
    restoredRepoChecks.set(repo.id, check);
    return check;
  }

  /**
   * 串行更新后端唯一的工作区监听，快速切换时以最新激活项目为准。
   * @param repo - 要监听的仓库，null 表示停止监听
   * @returns 此次监听更新处理结束
   */
  function updateWatcher(repo: RepoTab | null): Promise<void> {
    const repoId = repo?.id ?? null;
    watcherUpdate = watcherUpdate.then(async () => {
      // 排队期间发生切换时，跳过已经过期的监听请求。
      if (activeId.value !== repoId) {
        return;
      }
      await invoke("watcher_stop").catch(() => {});
      if (repo && activeId.value === repoId) {
        await invoke("watcher_start", { path: repo.path }).catch((error) => {
          repo.error = error instanceof Error ? error.message : String(error);
        });
      }
    });
    return watcherUpdate;
  }

  /**
   * 校验手动添加的仓库，激活并保存项目路径。
   * @param path - 目录选择器返回的仓库路径
   * @returns 仓库打开流程结束
   */
  async function openRepo(path: string): Promise<void> {
    // 校验仓库有效性
    const valid = await invoke<boolean>("git_is_valid_repo", { path });
    if (!valid) {
      throw new Error("所选目录不是 Git 仓库");
    }

    // 已打开则直接激活
    const existing = repos.value.find((r) => r.path === path);
    if (existing) {
      await setActive(existing.id);
      return;
    }

    const tab = createRepoTab(path);
    repos.value.push(tab);
    await setActive(tab.id);
    persist();
  }

  /**
   * 刷新分支、标签、工作区和储藏，各项读取独立容错。
   * @param id - 要刷新的项目 ID
   * @returns 此次刷新完成或被更新的请求取代后结束
   */
  async function refreshRepo(id: string): Promise<void> {
    const tab = repos.value.find((r) => r.id === id);
    if (!tab) {
      return;
    }
    const request = Symbol();
    refreshRequests.set(id, request);
    try {
      const [branches, tags, status, stashes] = await Promise.all([
        invoke<BranchInfo[]>("git_list_branches", { path: tab.path }).catch((error) => {
          if (refreshRequests.get(id) === request && !tab.branchSummaryReady) {
            tab.error = error instanceof Error ? error.message : String(error);
          }
          return null;
        }),
        invoke<TagInfo[]>("git_list_tags", { path: tab.path }).catch(() => [] as TagInfo[]),
        invoke<WorkingAreaStatus>("git_get_status", { path: tab.path }).catch(() => null),
        invoke<StashInfo[]>("git_list_stashes", { path: tab.path }).catch(() => [] as StashInfo[]),
      ]);

      // 旧刷新不能覆盖更新的仓库状态，已移除的项目也不再写入。
      if (refreshRequests.get(id) !== request) {
        return;
      }
      if (branches !== null) {
        tab.branches = branches;
        tab.branchSummaryReady = true;
      }
      tab.tags = tags;
      tab.stashes = stashes;
      tab.status = status;
    } finally {
      if (refreshRequests.get(id) === request) {
        refreshRequests.delete(id);
        tab.loading = false;
      }
    }
  }

  /**
   * 刷新当前激活仓库
   */
  async function refreshActive(): Promise<void> {
    if (activeId.value) {
      await refreshRepo(activeId.value);
    }
  }

  /**
   * 关闭仓库标签
   */
  async function closeRepo(id: string): Promise<void> {
    const wasActive = activeId.value === id;
    repos.value = repos.value.filter((r) => r.id !== id);
    restoredRepoChecks.delete(id);
    refreshRequests.delete(id);

    if (wasActive) {
      activeId.value = null;
      const [next, ...fallbackRepos] = repos.value;
      if (next) {
        await setActive(next.id, fallbackRepos.map((repo) => repo.id));
      }
      if (!activeId.value) {
        await updateWatcher(null);
      }
    }
    persist();
  }

  /**
   * 激活目标项目，并准备其本地 Git 数据和工作区监听。
   * @param id - 优先打开的项目
   * @param fallbackIds - 恢复或移除项目时可顺序尝试的备选项目
   * @returns 激活完成、被更新的选择取代或无可用项目后结束
   */
  async function setActive(id: string, fallbackIds: readonly string[] = []): Promise<void> {
    const sequence = ++activationSequence;
    try {
      for (const candidateId of [id, ...fallbackIds]) {
        // 先确认候选路径仍然有效，恢复时可以继续尝试下一个项目。
        const tab = repos.value.find((repo) => repo.id === candidateId);
        if (!tab) {
          continue;
        }
        if (activeId.value === candidateId) {
          return;
        }
        pendingActivationId.value = candidateId;
        const valid = await validateRestoredRepo(tab);
        if (sequence !== activationSequence) {
          return;
        }
        const canActivate = valid && repos.value.some((repo) => repo.id === candidateId);
        if (!canActivate) {
          continue;
        }

        // 校验后发布激活状态，提交列表可以和仓库数据并行读取。
        tab.loading = true;
        tab.error = null;
        activeId.value = candidateId;
        pendingActivationId.value = null;
        await Promise.all([refreshRepo(candidateId), updateWatcher(tab)]);
        return;
      }
    } finally {
      if (sequence === activationSequence) {
        pendingActivationId.value = null;
      }
    }
  }

  /**
   * 从本地存储一次恢复项目行，将校验和 Git 读取留给后续激活或后台摘要。
   * @returns {void}
   */
  function restoreRepos(): void {
    try {
      const savedPaths: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(savedPaths)) {
        return;
      }

      // 旧路径数组可能含有重复或无效项，构建完项目行后统一发布。
      const knownPaths = new Set(repos.value.map((repo) => repo.path));
      const restoredTabs: RepoTab[] = [];
      for (const path of savedPaths) {
        const isSavedPath = typeof path === "string" && Boolean(path.trim());
        if (!isSavedPath || knownPaths.has(path)) {
          continue;
        }
        const tab = createRepoTab(path);
        knownPaths.add(path);
        restoredRepoChecks.set(tab.id, null);
        restoredTabs.push(tab);
      }
      repos.value = [...repos.value, ...restoredTabs];
    } catch {
      // localStorage 数据损坏，忽略
    }
  }

  /**
   * 判断项目是否仍需后台摘要，激活项目的完整读取优先。
   * @param repo - 后台任务中的仓库
   * @returns 可以继续读取或应用摘要时返回 true
   */
  function needsBranchSummary(repo: RepoTab): boolean {
    const hasForegroundLoad = repo.loading || repo.id === activeId.value || repo.id === pendingActivationId.value;
    return !repo.branchSummaryReady && !hasForegroundLoad
      && repos.value.some((item) => item.id === repo.id);
  }

  /**
   * 在当前项目准备完成后逐个补齐其他项目的本地分支摘要。
   * @returns 所有待补齐项目处理结束
   */
  async function loadProjectSummaries(): Promise<void> {
    for (const repo of [...repos.value]) {
      if (!needsBranchSummary(repo)) {
        continue;
      }
      const valid = await validateRestoredRepo(repo);
      if (!valid || !needsBranchSummary(repo)) {
        continue;
      }

      // 后台只读取本地分支，不启动工作区监听或请求提交、储藏。
      try {
        const branches = await invoke<BranchInfo[]>("git_list_branches", { path: repo.path });
        // 读取过程中被激活、刷新或移除的项目由前台接管。
        if (needsBranchSummary(repo)) {
          repo.branches = branches;
          repo.branchSummaryReady = true;
          repo.error = null;
        }
      } catch (error) {
        if (needsBranchSummary(repo)) {
          repo.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }

  return {
    repos,
    activeId,
    activeRepo,
    pendingActivationId,
    openRepo,
    refreshRepo,
    refreshActive,
    closeRepo,
    setActive,
    restoreRepos,
    loadProjectSummaries,
  };
});
