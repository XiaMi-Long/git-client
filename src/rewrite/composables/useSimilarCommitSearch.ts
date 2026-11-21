/**
 * @description
 *   在主列表传入的分支范围内查询相似提交。弹窗的关键词、作者、结果与分页各自独立。
 * @dataFormat
 *   从提交标题提取初始关键词，使用主列表提供的 Git 引用或全分支范围查询提交记录。
 * @changeLog
 *   - 2026-11-21: Created. 支持从主列表的单条提交打开相似提交搜索。
 */
import { onScopeDispose, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { PAGE_SIZE } from "@/stores/commit";
import type { CommitAuthor, CommitInfo, LogQuery } from "@/types/git";
import { isSameAuthorSet } from "../utils/author";
import { useCommitSearch } from "./useCommitSearch";

/** 打开弹窗时从主提交列表取得的查询范围和初始标题。 */
export interface SimilarCommitSearchTarget {
  /** 用于区分项目及其作者候选。 */
  repoId: string;
  /** 要读取的仓库路径。 */
  repoPath: string;
  /** 弹窗标题栏使用的项目显示名。 */
  repoName: string;
  /** 沿用主列表分支选择器显示的范围名称。 */
  scopeLabel: string;
  /** 单分支查询的 Git 引用；没有引用时由 Git 使用 HEAD。 */
  branch: string | null;
  /** 主列表在所有分支模式时，查询不受单个分支约束。 */
  allBranches: boolean;
  /** 右键选中的提交标题，作为初始关键词来源。 */
  commitSubject: string;
}

/**
 * 从提交标题提取相似搜索词，去掉末尾的数字序号及其前面的空格。
 * @param subject - Git 提交标题
 * @returns 去掉序号后的标题。没有可用前缀时沿用原标题，避免打开空查询。
 */
function getSimilarCommitKeyword(subject: string): string {
  const trimmedSubject = subject.trim();
  const subjectWithoutSequence = trimmedSubject.replace(/[0-9０-９]+$/, "").trimEnd();
  return subjectWithoutSequence || trimmedSubject;
}

/**
 * 管理相似提交弹窗内的关键词、作者和分页查询。
 * @param target - 主列表右键打开弹窗时取得的仓库、分支范围和提交标题
 * @returns 搜索框控制器、提交结果以及读取和重试方法
 */
export function useSimilarCommitSearch(target: SimilarCommitSearchTarget) {
  const initialKeyword = getSimilarCommitKeyword(target.commitSubject);
  const keyword = ref(initialKeyword);
  const authorFilters = ref<CommitAuthor[]>([]);
  const commits = ref<CommitInfo[]>([]);
  const loading = ref(false);
  const hasMore = ref(false);
  const searchError = ref<string | null>(null);
  // 换词、换作者或关闭弹窗后，旧请求不能再更新结果与加载状态。
  let querySequence = 0;

  const commitSearch = useCommitSearch({
    scope: () => ({
      repoId: target.repoId,
      path: target.repoPath,
      branch: target.branch,
      allBranches: target.allBranches,
    }),
    initialKeyword,
    selectedAuthors: () => authorFilters.value,
    setKeyword: (searchText) => applyFilters(authorFilters.value, searchText),
    setAuthors: applyFilters,
  });

  /**
   * 应用弹窗中的筛选条件，从第一页查询。
   * @param authors - 当前已选的作者
   * @param searchText - 搜索框中的关键词
   * @returns void
   */
  function applyFilters(authors: CommitAuthor[], searchText: string): void {
    const nextKeyword = searchText.trim();
    const hasSameAuthorFilters = isSameAuthorSet(authors, authorFilters.value);
    // 相同条件可能由回车和防抖重复提交，已有结果可以继续使用。
    if (nextKeyword === keyword.value && hasSameAuthorFilters) {
      return;
    }
    keyword.value = nextKeyword;
    authorFilters.value = authors;
    void loadResults();
  }

  /**
   * 读取一页相似提交，筛选变化时替换结果，加载更多时保留已读记录。
   * @param append - 是否继续读取下一页
   * @returns 本页读取结束
   * @reasoning
   * 弹窗可能在上一次查询未结束时提交新的条件，用请求序号保证结果只属于最新条件。
   * @changeLog
   * - 2026-11-21: Created. 使用提交信息的字面搜索与原有 Git 分页能力。
   */
  async function loadResults(append = false): Promise<void> {
    const isNextPageUnavailable = append && (loading.value || !hasMore.value);
    // 前一页未完成时无法确定下一页的偏移量。
    if (isNextPageUnavailable) {
      return;
    }

    // 1. 新条件从第一页开始，加载更多时继续保留已读记录。
    const requestSequence = ++querySequence;
    searchError.value = null;
    if (!append) {
      commits.value = [];
      hasMore.value = false;
    }
    // 清除全部条件时等待用户继续搜索，避免把整个分支的历史当作相似结果。
    if (!keyword.value && !authorFilters.value.length) {
      loading.value = false;
      return;
    }

    // 2. 多读取一条用于确认是否还有下一页，当前页只展示约定的数量。
    const query: LogQuery = {
      skip: commits.value.length,
      limit: PAGE_SIZE + 1,
      branch: target.branch,
      all_branches: target.allBranches,
      search: keyword.value || null,
      search_message_only: true,
      authors: authorFilters.value,
    };
    loading.value = true;
    try {
      const matchedCommits = await invoke<CommitInfo[]>("git_get_log", { path: target.repoPath, query });
      // 旧条件的结果晚到时不能追加到新查询。
      if (requestSequence !== querySequence) {
        return;
      }
      const page = matchedCommits.slice(0, PAGE_SIZE);
      commits.value = append ? [...commits.value, ...page] : page;
      hasMore.value = matchedCommits.length > PAGE_SIZE;
    } catch (error) {
      if (requestSequence === querySequence) {
        searchError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestSequence === querySequence) {
        loading.value = false;
      }
    }
  }

  onScopeDispose(() => {
    querySequence++;
  });

  return { commitSearch, commits, loading, hasMore, searchError, loadResults };
}
