/**
 * 仓库状态管理
 * 多仓库标签页，每仓库独立状态（分支 / 标签 / 工作区状态）
 * 已打开仓库路径持久化到 localStorage，启动时恢复
 * 依据: design.md D4, tasks 5.x
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { BranchInfo, TagInfo, WorkingAreaStatus } from "@/types/git";

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
  /** 标签列表 */
  tags: TagInfo[];
  /** 工作区状态 */
  status: WorkingAreaStatus | null;
  /** 是否加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

export const useRepoStore = defineStore("repo", () => {
  // 所有打开的仓库标签
  const repos = ref<RepoTab[]>([]);
  // 当前激活的标签 id
  const activeId = ref<string | null>(null);

  // 当前激活的仓库
  const activeRepo = computed(
    () => repos.value.find((r) => r.id === activeId.value) ?? null
  );

  /** 将已打开仓库路径持久化到 localStorage */
  function persist() {
    const paths = repos.value.map((r) => r.path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  }

  /**
   * 打开仓库
   * 校验目录 -> 加载分支 / 标签 / 状态 -> 启动文件监听 -> 持久化路径
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

    const id = crypto.randomUUID();
    const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;

    const tab: RepoTab = {
      id,
      name,
      path,
      branches: [],
      tags: [],
      status: null,
      loading: true,
      error: null,
    };
    repos.value.push(tab);
    activeId.value = id;

    try {
      await refreshRepo(id);
      // 启动文件监听
      await invoke("watcher_start", { path });
    } catch (e) {
      tab.error = e instanceof Error ? e.message : String(e);
    } finally {
      tab.loading = false;
    }
    persist();
  }

  /**
   * 刷新仓库数据（分支 / 标签 / 状态），文件变更后调用
   * 每个命令独立容错，避免单个失败导致全部数据不赋值
   */
  async function refreshRepo(id: string): Promise<void> {
    const tab = repos.value.find((r) => r.id === id);
    if (!tab) return;
    const [branches, tags, status] = await Promise.all([
      invoke<BranchInfo[]>("git_list_branches", { path: tab.path }).catch(() => [] as BranchInfo[]),
      invoke<TagInfo[]>("git_list_tags", { path: tab.path }).catch(() => [] as TagInfo[]),
      invoke<WorkingAreaStatus>("git_get_status", { path: tab.path }).catch(() => null),
    ]);
    tab.branches = branches;
    tab.tags = tags;
    tab.status = status;
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

    if (wasActive) {
      // 停止旧仓库监听
      await invoke("watcher_stop").catch(() => {});
      // 切到剩余的第一个标签，或置空
      const next = repos.value[0];
      activeId.value = next?.id ?? null;
      if (next) {
        await invoke("watcher_start", { path: next.path }).catch(() => {});
      }
    }
    persist();
  }

  /**
   * 切换激活标签
   */
  async function setActive(id: string): Promise<void> {
    if (activeId.value === id) return;
    // 停止旧仓库监听
    await invoke("watcher_stop").catch(() => {});
    activeId.value = id;
    // 启动新仓库监听
    const tab = repos.value.find((r) => r.id === id);
    if (tab) {
      await invoke("watcher_start", { path: tab.path }).catch(() => {});
    }
  }

  /**
   * 启动时恢复上次打开的仓库（从 localStorage 读路径依次打开）
   * 无效路径自动跳过
   */
  async function restoreRepos(): Promise<void> {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const paths = JSON.parse(saved) as string[];
      for (const path of paths) {
        try {
          await openRepo(path);
        } catch {
          // 路径无效或非仓库，跳过
        }
      }
    } catch {
      // localStorage 数据损坏，忽略
    }
  }

  return {
    repos,
    activeId,
    activeRepo,
    openRepo,
    refreshRepo,
    refreshActive,
    closeRepo,
    setActive,
    restoreRepos,
  };
});
