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

  /** 加载第一页 */
  async function loadCommits() {
    const path = repoStore.activeRepo?.path;
    if (!path) {
      commits.value = [];
      hasMore.value = false;
      return;
    }
    loading.value = true;
    try {
      const query: LogQuery = {
        skip: 0,
        limit: PAGE_SIZE,
        branch: queryBranch.value,
        search: search.value.trim() || null,
        all_branches: queryAllBranches.value,
      };
      const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
      commits.value = result;
      // 搜索模式返回合并结果（固定上限），不触发分页加载
      hasMore.value = !search.value.trim() && result.length >= PAGE_SIZE;
    } catch {
      commits.value = [];
      hasMore.value = false;
    } finally {
      loading.value = false;
    }
  }

  /** 加载下一页（6.2 分页） */
  async function loadMore() {
    const path = repoStore.activeRepo?.path;
    if (!path || loadingMore.value || !hasMore.value || loading.value) return;
    loadingMore.value = true;
    try {
      const query: LogQuery = {
        skip: commits.value.length,
        limit: PAGE_SIZE,
        branch: queryBranch.value,
        search: search.value.trim() || null,
        all_branches: queryAllBranches.value,
      };
      const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
      commits.value.push(...result);
      hasMore.value = !search.value.trim() && result.length >= PAGE_SIZE;
    } catch {
      // 忽略分页错误
    } finally {
      loadingMore.value = false;
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

  /** 切换仓库时重置浏览状态（旧分支在新仓库不存在） */
  async function switchRepo() {
    browseBranch.value = null;
    search.value = "";
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
    switchRepo,
  };
});
