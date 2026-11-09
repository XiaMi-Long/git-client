/**
 * @description
 *   为分支预览独立读取历史和远程状态，并执行绑定到该分支的手动操作。
 * @workflow
 *   1. 按完整引用读取分支信息，以提交哈希固定分页范围。
 *   2. 用户点击时按弹窗中的仓库和上游发起操作。
 *   3. 操作结束后刷新原项目及仍打开的预览。
 * @changeLog
 *   - 2026-11-07: Created. 将非当前分支的历史及同步状态与主列表分离。
 *   - 2026-11-07: Updated. 分支历史支持独立的关键词和作者条件。
 */
import { computed, onScopeDispose, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { PAGE_SIZE } from "@/stores/commit";
import { useRepoStore } from "@/stores/repo";
import type { BranchInfo, BranchPreviewInfo, CommitAuthor, CommitInfo, LogQuery } from "@/types/git";
import { useCommitSearch } from "./useCommitSearch";
import { useGitActions, type GitActionResult } from "./useGitActions";
import type { RemoteSyncAction } from "./useRemoteSync";

/** 打开时固定的仓库与分支身份。 */
export interface BranchPreviewTarget {
  /** 用于将同步后的仓库摘要写回打开时的项目。 */
  repoId: string;
  repoPath: string;
  repoName: string;
  /** 使用完整引用查询，以区分同名的本地分支和远程分支。 */
  branch: BranchInfo;
}

const ACTION_LABELS: Record<RemoteSyncAction, string> = {
  fetch: "获取远程",
  pull: "拉取",
  push: "推送",
};

/**
 * 管理单个分支预览的分页、状态和手动操作。
 * @param target - 当前弹窗固定的仓库与分支
 * @returns 分支信息、历史状态、操作可用条件和查询方法
 */
export function useBranchPreview(target: BranchPreviewTarget) {
  const repoStore = useRepoStore();
  const gitActions = useGitActions();
  const gitBusy = gitActions.busy;
  const branch = ref<BranchPreviewInfo | null>(null);
  const commits = ref<CommitInfo[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const hasMore = ref(false);
  const historyError = ref<string | null>(null);
  const paginationError = ref<string | null>(null);
  const activeAction = ref<RemoteSyncAction | null>(null);
  const actionResult = ref<GitActionResult | null>(null);
  // 这里保存已提交给分支历史的条件，输入草稿由 useCommitSearch 管理。
  const keyword = ref("");
  const authorFilter = ref<CommitAuthor | null>(null);
  const hasCommitFilters = computed(() => Boolean(keyword.value || authorFilter.value));
  // 分页固定到同一个提交和筛选条件。条件变化时清除 loadedHead，使历史从第一页重新读取。
  let loadedHead: string | null = null;
  let historySequence = 0;
  let disposed = false;

  const commitSearch = useCommitSearch({
    scope: () => ({
      repoId: target.repoId,
      path: target.repoPath,
      branch: `${branch.value?.commit_hash ?? target.branch.commit_hash}^{commit}`,
      allBranches: false,
    }),
    selectedAuthor: () => authorFilter.value,
    setKeyword: (nextKeyword) => applyHistoryFilters(authorFilter.value, nextKeyword),
    setAuthor: applyHistoryFilters,
  });

  const hasKnownUpstream = computed(() => Boolean(branch.value?.upstream_target) && !branch.value?.upstream_gone);
  const isDiverged = computed(() => Boolean(hasKnownUpstream.value && branch.value?.ahead && branch.value?.behind));
  const canFetch = computed(() => {
    const hasTarget = Boolean(branch.value?.upstream_target);
    const isBusy = loading.value || Boolean(activeAction.value) || Boolean(gitBusy.value);
    return hasTarget && !isBusy && !historyError.value;
  });
  const canPull = computed(() => canFetch.value && !branch.value?.is_current && !isDiverged.value);
  const canPush = computed(() => {
    const isPushReady = hasKnownUpstream.value && branch.value?.behind === 0;
    return canFetch.value && isPushReady && !branch.value?.is_current;
  });

  /**
   * 应用弹窗自己的作者和关键词条件，并从所选分支重新读取历史。
   * @param author - 筛选的 Git 作者，null 表示所有作者
   * @param searchText - 搜索框中的当前关键词
   * @returns void
   */
  function applyHistoryFilters(author: CommitAuthor | null, searchText: string): void {
    const nextKeyword = searchText.trim();
    if (nextKeyword === keyword.value && author === authorFilter.value) {
      return;
    }
    keyword.value = nextKeyword;
    authorFilter.value = author;
    // 旧列表与新条件不匹配，清空后再加载，避免用户误把旧提交当作筛选结果。
    loadedHead = null;
    commits.value = [];
    hasMore.value = false;
    void refreshPreview();
  }

  /**
   * 读取指定分支提交快照中的一页历史。
   * @param head - 已校验的分支头提交哈希
   * @param skip - 已加载的提交数量
   * @returns 按提交顺序返回的一页记录
   */
  function readHistoryPage(head: string, skip: number): Promise<CommitInfo[]> {
    const query: LogQuery = {
      skip,
      limit: PAGE_SIZE,
      branch: `${head}^{commit}`,
      search: keyword.value || null,
      author: authorFilter.value,
      all_branches: false,
    };
    return invoke<CommitInfo[]>("git_get_log", { path: target.repoPath, query });
  }

  /**
   * 读取当前分支信息，分支头或筛选条件变化时重新读取第一页。
   * @returns 本次查询结束
   * @reasoning 获取和推送通常只改变上游数量，保留已加载的分页可避免用户丢失阅读位置。
   * @changeLog
   * - 2026-11-07: Created. 按分支头的变化刷新历史并隔离旧请求。
   */
  async function refreshPreview(): Promise<void> {
    // 1. 开始刷新时结束旧分页请求的写入资格。
    const requestSequence = ++historySequence;
    loading.value = true;
    loadingMore.value = false;
    historyError.value = null;
    paginationError.value = null;

    // 2. 先读取分支状态，再根据提交哈希决定是否替换历史。
    try {
      const branchInfo = await invoke<BranchPreviewInfo>("git_get_branch_info", {
        path: target.repoPath,
        branchRef: target.branch.full_name,
      });
      // 关闭后丢弃响应，避免旧分支的结果写回已离开的弹窗。
      if (requestSequence !== historySequence) {
        return;
      }
      branch.value = branchInfo;

      if (loadedHead !== branchInfo.commit_hash) {
        const page = await readHistoryPage(branchInfo.commit_hash, 0);
        if (requestSequence === historySequence) {
          loadedHead = branchInfo.commit_hash;
          commits.value = page;
          // 关键词搜索沿用后端的合并结果上限，单独按作者筛选时仍可翻页。
          hasMore.value = !keyword.value && page.length >= PAGE_SIZE;
        }
      }
    } catch (error) {
      if (requestSequence === historySequence) {
        historyError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestSequence === historySequence) {
        loading.value = false;
      }
    }
  }

  /**
   * 从同一个提交快照继续读取较早的历史。
   * @returns 下一页读取结束
   */
  async function loadMore(): Promise<void> {
    const isPagingUnavailable = loading.value || loadingMore.value || !hasMore.value || Boolean(historyError.value);
    // 1. 首次读取失败或分支更新期间，不能继续使用旧快照分页。
    if (!loadedHead || isPagingUnavailable) {
      return;
    }

    // 2. 追加记录前确认分页请求仍属于当前快照。
    const requestSequence = historySequence;
    loadingMore.value = true;
    paginationError.value = null;
    try {
      const page = await readHistoryPage(loadedHead, commits.value.length);
      if (requestSequence === historySequence) {
        commits.value.push(...page);
        hasMore.value = page.length >= PAGE_SIZE;
      }
    } catch (error) {
      if (requestSequence === historySequence) {
        paginationError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestSequence === historySequence) {
        loadingMore.value = false;
      }
    }
  }

  /**
   * 在共享 Git 互斥器内操作所选分支，结束后刷新原项目和当前弹窗。
   * @param action - 用户点击的获取、拉取或推送
   * @returns 远程操作和结果刷新结束
   * @reasoning 拉取可能已经更新远程引用，之后才发现无法快进，所以失败后也需要读取最新差异数量。
   * @changeLog
   * - 2026-11-07: Created. 将手动同步固定到弹窗打开时的仓库和分支。
   */
  async function execute(action: RemoteSyncAction): Promise<void> {
    const isAllowed = { fetch: canFetch.value, pull: canPull.value, push: canPush.value }[action];
    const upstream = branch.value?.upstream_target;
    // 状态尚未读取或命令仍在进行时，不能发起新的远程操作。
    if (!isAllowed || !upstream) {
      return;
    }
    const isRepoOpen = repoStore.repos.some((repo) => repo.id === target.repoId && repo.path === target.repoPath);
    if (!isRepoOpen) {
      actionResult.value = { ok: false, message: "该项目已关闭，请重新打开分支" };
      return;
    }

    // 1. 按打开弹窗时的仓库和引用执行，禁止使用此时的当前检出分支代替目标。
    activeAction.value = action;
    actionResult.value = null;
    const label = `${ACTION_LABELS[action]} ${target.branch.name}`;
    try {
      const result = await gitActions.runExclusive(label, async () => {
        try {
          const message = await invoke<string>("git_sync_branch_upstream", {
            path: target.repoPath,
            branchRef: target.branch.full_name,
            expectedTarget: upstream,
            action,
          });
          return { ok: true, message };
        } finally {
          // 2. 快进失败前也可能已更新远程引用，因此成功和失败都要重新读取状态。
          await Promise.all([
            repoStore.refreshRepo(target.repoId).catch(() => {}),
            disposed ? Promise.resolve() : refreshPreview(),
          ]);
        }
      });
      if (!disposed) {
        actionResult.value = result;
      }
    } finally {
      activeAction.value = null;
    }
  }

  // 弹窗可能在上一次操作仍运行时重新打开，操作结束后用本地引用补齐最新状态。
  watch(gitBusy, (busy, previousBusy) => {
    if (previousBusy && !busy && !activeAction.value) {
      void refreshPreview();
    }
  });

  onScopeDispose(() => {
    disposed = true;
    historySequence++;
  });

  return {
    branch, commits, loading, loadingMore, hasMore, historyError, paginationError,
    commitSearch, hasCommitFilters,
    activeAction, actionResult, gitBusy, hasKnownUpstream, isDiverged, canFetch, canPull, canPush,
    refreshPreview, loadMore, execute,
  };
}
