/**
 * 提交历史状态管理
 * 提交列表的分页加载、分支范围切换、侧栏浏览、搜索
 * 切换仓库时通过 switchRepo 重置浏览状态（避免旧分支残留）
 * 依据: design.md D6, tasks 6.x
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, LogQuery } from "@/types/git";
import { useRepoStore } from "./repo";

/** 每页提交数（与后端 PAGE_SIZE 一致） */
const PAGE_SIZE = 100;

export const useCommitStore = defineStore("commit", () => {
  const repoStore = useRepoStore();

  // 提交列表
  const commits = ref<CommitInfo[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const hasMore = ref(true);

  // 6.5 分支范围：current 当前分支 / all 所有分支
  const scope = ref<"current" | "all">("current");
  // 6.6 侧栏浏览的分支（仅查看历史，不切换工作区）
  const browseBranch = ref<string | null>(null);
  // 6.7 搜索关键词
  const search = ref<string>("");
  // 从提交文件列表快捷打开或手动查询文件历史时预填的路径
  const fileHistoryPath = ref("");
  // 递增序号用于丢弃被新查询或仓库切换取代的提交日志响应
  let logRequestSequence = 0;

  // ===== 未推送提交标识（经典列表与泳道图共用，单一数据源） =====
  // 当前分支（含 upstream / ahead）
  const currentBranch = computed(
    () => repoStore.activeRepo?.branches.find((b) => b.is_current) ?? null
  );
  const currentAhead = computed(() => currentBranch.value?.ahead ?? 0);
  // 未推送提交的 hash 集合（相对当前分支上游 @{upstream}..HEAD 的领先提交）
  const unpushedHashes = ref<Set<string>>(new Set());
  // 竞态保护：切换分支时丢弃过期响应
  let unpushedSeq = 0;

  /** 加载当前分支未推送提交 hash 集合 */
  async function loadUnpushed() {
    const path = repoStore.activeRepo?.path;
    const branch = currentBranch.value;
    const seq = ++unpushedSeq;
    if (!path || !branch || !branch.upstream) {
      unpushedHashes.value = new Set();
      return;
    }
    try {
      const list = await invoke<CommitInfo[]>("git_get_log", {
        path,
        query: {
          skip: 0,
          limit: 100,
          branch: `${branch.upstream}..${branch.name}`,
          search: null,
          all_branches: false,
        },
      });
      if (seq !== unpushedSeq) return; // 过期响应丢弃
      unpushedHashes.value = new Set(list.map((c) => c.hash));
    } catch {
      if (seq !== unpushedSeq) return;
      unpushedHashes.value = new Set();
    }
  }

  // 分支 / 领先数 / 仓库变化时（重新）加载未推送集合；ahead 为 0 时直接清空
  watch(
    () => [currentBranch.value?.name, currentAhead.value, repoStore.activeRepo?.id] as const,
    () => {
      if (currentAhead.value > 0) {
        loadUnpushed();
      } else {
        unpushedSeq++;
        unpushedHashes.value = new Set();
      }
    }
  );

  const queryAllBranches = computed(() => scope.value === "all");
  const queryBranch = computed<string | null>(() => {
    if (scope.value === "all") return null;
    return browseBranch.value;
  });

  /**
   * 加载当前仓库和筛选条件下的第一页提交。
   * @returns {Promise<void>} 完成第一页提交查询
   */
  async function loadCommits(): Promise<void> {
    const requestSequence = ++logRequestSequence;
    const repo = repoStore.activeRepo;
    if (!repo) {
      commits.value = [];
      hasMore.value = false;
      loading.value = false;
      loadingMore.value = false;
      return;
    }
    const path = repo.path;
    loading.value = true;
    loadingMore.value = false;
    try {
      const query: LogQuery = {
        skip: 0,
        limit: PAGE_SIZE,
        branch: queryBranch.value,
        search: search.value.trim() || null,
        all_branches: queryAllBranches.value,
      };
      const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
      if (requestSequence !== logRequestSequence || repo.id !== repoStore.activeRepo?.id || path !== repoStore.activeRepo?.path) return;
      commits.value = result;
      // 搜索模式返回合并结果（固定上限），不触发分页加载
      hasMore.value = !search.value.trim() && result.length >= PAGE_SIZE;
    } catch {
      if (requestSequence !== logRequestSequence || repo.id !== repoStore.activeRepo?.id || path !== repoStore.activeRepo?.path) return;
      commits.value = [];
      hasMore.value = false;
    } finally {
      if (requestSequence === logRequestSequence) loading.value = false;
    }
  }

  /**
   * 加载当前查询的下一页提交。
   * @returns {Promise<void>} 完成下一页提交查询
   */
  async function loadMore(): Promise<void> {
    const repo = repoStore.activeRepo;
    const path = repo?.path;
    if (!path || loadingMore.value || !hasMore.value || loading.value) return;
    const requestSequence = logRequestSequence;
    const offset = commits.value.length;
    const searchQuery = search.value.trim();
    loadingMore.value = true;
    try {
      const query: LogQuery = {
        skip: offset,
        limit: PAGE_SIZE,
        branch: queryBranch.value,
        search: searchQuery || null,
        all_branches: queryAllBranches.value,
      };
      const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
      if (requestSequence !== logRequestSequence || repo?.id !== repoStore.activeRepo?.id || path !== repoStore.activeRepo?.path) return;
      commits.value.push(...result);
      hasMore.value = !searchQuery && result.length >= PAGE_SIZE;
    } catch {
      if (requestSequence !== logRequestSequence || repo?.id !== repoStore.activeRepo?.id || path !== repoStore.activeRepo?.path) return;
      // 忽略分页错误
    } finally {
      if (requestSequence === logRequestSequence) loadingMore.value = false;
    }
  }

  /** 设置分支范围（6.5） */
  function setScope(s: "current" | "all") {
    scope.value = s;
    browseBranch.value = null;
    loadCommits();
  }

  /** 浏览指定分支历史（6.6，不切换工作区） */
  function browseTo(branch: string | null) {
    scope.value = "current";
    browseBranch.value = branch;
    loadCommits();
  }

  /** 设置搜索关键词（6.7，防抖在调用方） */
  function setSearch(q: string) {
    search.value = q;
    loadCommits();
  }

  /**
   * 设置文件历史的路径筛选。
   * @param {string} path - 文件历史输入路径，可为绝对路径或快捷入口提供的仓库相对路径
   * @returns {void} 更新共享路径筛选
   */
  function setFileHistoryPath(path: string): void {
    fileHistoryPath.value = path;
  }

  /**
   * 切换仓库时重置分支、搜索和文件路径浏览状态。
   * @returns {Promise<void>} 加载新仓库第一页提交
   */
  async function switchRepo() {
    logRequestSequence++;
    commits.value = [];
    hasMore.value = true;
    loading.value = false;
    loadingMore.value = false;
    browseBranch.value = null;
    search.value = "";
    fileHistoryPath.value = "";
    scope.value = "current";
    await loadCommits();
  }

  return {
    commits,
    loading,
    loadingMore,
    hasMore,
    scope,
    browseBranch,
    search,
    fileHistoryPath,
    queryBranch,
    queryAllBranches,
    currentBranch,
    currentAhead,
    unpushedHashes,
    loadCommits,
    loadMore,
    setScope,
    browseTo,
    setSearch,
    setFileHistoryPath,
    switchRepo,
  };
});
