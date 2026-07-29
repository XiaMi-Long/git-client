/**
 * 提交历史状态管理
 * 提交列表的分页加载、分支范围切换、侧栏浏览、搜索
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

  // 是否查询所有分支
  const queryAllBranches = computed(() => scope.value === "all");
  // 实际查询的 branch：所有分支时为 null（配合 all_branches=true），侧栏浏览时为该分支
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
      hasMore.value = result.length >= PAGE_SIZE;
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
      hasMore.value = result.length >= PAGE_SIZE;
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
  }

  /** 浏览指定分支历史（6.6，不切换工作区） */
  function browseTo(branch: string | null) {
    scope.value = "current";
    browseBranch.value = branch;
  }

  /** 设置搜索关键词（6.7，防抖在调用方） */
  function setSearch(q: string) {
    search.value = q;
  }

  // scope / browseBranch / search 变化时重新加载第一页
  watch([scope, browseBranch, search], () => {
    loadCommits();
  });

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
    loadCommits,
    loadMore,
    setScope,
    browseTo,
    setSearch,
  };
});
