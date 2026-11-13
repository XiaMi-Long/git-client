/**
 * @description
 *   管理提交关键词和作者快捷选项，将筛选条件提交给当前历史视图。
 * @workflow
 *   1. 打开搜索框时按当前浏览范围读取最近作者。
 *   2. 输入关键词时防抖，选择作者时立即提交两个条件。
 *   3. 切换仓库或分支范围后丢弃旧范围的作者响应。
 * @changeLog
 *   - 2026-11-07: Created. 支持提交搜索框的作者快捷筛选。
 *   - 2026-11-07: Updated. 主列表和分支预览分别传入查询范围及筛选状态。
 *   - 2026-11-10: Updated. 作者筛选改为多选，切换选项时保留浮层并支持一键清除。
 */
import { computed, onScopeDispose, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { CommitAuthor } from "@/types/git";
import { isSameAuthor } from "../utils/author";

/** 沿用原搜索输入的防抖间隔，避免每次按键都读取 Git 日志。 */
const SEARCH_DEBOUNCE_MS = 300;

/** 当前历史视图读取作者候选时使用的仓库和提交范围。 */
interface CommitSearchScope {
  /** 切换项目时清除当前搜索输入。 */
  repoId: string;
  path: string;
  /** Git 日志范围，null 表示按当前检出分支读取。 */
  branch: string | null;
  allBranches: boolean;
  /** 主列表跟随 HEAD 时，以当前检出引用识别范围切换。 */
  headRef?: string;
}

/** 将搜索交互与历史视图的查询和筛选状态连接起来。 */
interface CommitSearchSource {
  scope: () => CommitSearchScope | null;
  selectedAuthors: () => CommitAuthor[];
  setKeyword: (keyword: string) => void;
  setAuthors: (authors: CommitAuthor[], keyword: string) => void;
}

/**
 * 组织提交搜索和作者快捷选项的交互与请求状态。
 * @param source - 当前历史视图提供的查询范围、作者条件和更新操作
 * @returns 搜索输入、作者选项状态及供应用壳绑定的操作
 */
export function useCommitSearch(source: CommitSearchSource) {
  const scope = computed(source.scope);
  const selectedAuthors = computed(source.selectedAuthors);
  const localSearch = ref("");
  const searchInput = ref<HTMLInputElement | null>(null);
  const authorOptionsOpen = ref(false);
  const authorOptions = ref<CommitAuthor[]>([]);
  const authorOptionsLoading = ref(false);
  const authorOptionsError = ref<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  // 每次读取或切换范围都更新序号，只让当前范围的最新请求更新浮层。
  let authorRequestSequence = 0;

  /**
   * 取消尚未提交的关键词查询，供回车、选作者及切换仓库复用。
   * @returns {void}
   */
  function cancelSearchTimer(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  /**
   * 读取当前浏览范围的作者候选，浮层内反馈加载及错误。
   * @returns 作者请求处理完成后结束
   */
  async function loadAuthorOptions(): Promise<void> {
    const requestScope = scope.value;
    // 同一范围重复聚焦或点击重试时，共用已经进行中的查询。
    if (!requestScope || authorOptionsLoading.value) {
      return;
    }

    const requestSequence = ++authorRequestSequence;
    authorOptionsLoading.value = true;
    authorOptionsError.value = null;
    try {
      const recentAuthors = await invoke<CommitAuthor[]>("git_list_recent_commit_authors", {
        path: requestScope.path,
        branch: requestScope.branch,
        allBranches: requestScope.allBranches,
      });
      if (requestSequence === authorRequestSequence) {
        authorOptions.value = recentAuthors;
      }
    } catch (error) {
      if (requestSequence === authorRequestSequence) {
        authorOptionsError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestSequence === authorRequestSequence) {
        authorOptionsLoading.value = false;
      }
    }
  }

  /**
   * 在搜索框聚焦或点击时打开作者选项，每次展开按当前范围读取。
   * @returns {void}
   */
  function openAuthorOptions(): void {
    // 只有打开了项目才能读取作者，同次展开只触发一次读取。
    if (!scope.value || authorOptionsOpen.value) {
      return;
    }
    authorOptionsOpen.value = true;
    void loadAuthorOptions();
  }

  /**
   * 收起作者选项，保留提交筛选条件。
   * @returns {void}
   */
  function closeAuthorOptions(): void {
    authorOptionsOpen.value = false;
  }

  /**
   * 在焦点从搜索区域移到其他控件时收起选项，允许 Tab 进入浮层。
   * @param event - 搜索区域的焦点离开事件
   * @returns {void}
   */
  function onSearchFocusOut(event: FocusEvent): void {
    const searchRegion = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && !searchRegion.contains(event.relatedTarget)) {
      closeAuthorOptions();
    }
  }

  /**
   * 输入关键词时收起快捷选项，并延迟提交搜索。
   * @returns {void}
   */
  function onSearchInput(): void {
    closeAuthorOptions();
    cancelSearchTimer();
    searchTimer = setTimeout(() => {
      searchTimer = null;
      source.setKeyword(localSearch.value);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * 回车立即应用当前关键词，继续使用已选作者。
   * @returns {void}
   */
  function applySearch(): void {
    cancelSearchTimer();
    closeAuthorOptions();
    source.setKeyword(localSearch.value);
  }

  /**
   * 清空关键词并重新查询，已选作者保留在搜索框标签上。
   * @returns {void}
   */
  function clearSearch(): void {
    localSearch.value = "";
    applySearch();
  }

  /**
   * Escape 优先收起作者选项，其次清空关键词。搜索无可收起内容时交给所在视图处理。
   * @param event - 搜索区域收到的 Escape 按键事件
   * @returns {void}
   */
  function dismissSearch(event: KeyboardEvent): void {
    if (!authorOptionsOpen.value && !localSearch.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (authorOptionsOpen.value) {
      searchInput.value?.focus();
      closeAuthorOptions();
    } else {
      clearSearch();
    }
  }

  /**
   * 切换单个作者的选中状态，保留作者浮层供继续多选。
   * @param author - 点击的作者候选
   * @returns {void}
   */
  function toggleAuthorFilter(author: CommitAuthor): void {
    cancelSearchTimer();
    const currentAuthors = selectedAuthors.value;
    const isSelected = currentAuthors.some((item) => isSameAuthor(item, author));
    const nextAuthors = isSelected
      ? currentAuthors.filter((item) => !isSameAuthor(item, author))
      : [...currentAuthors, author];
    source.setAuthors(nextAuthors, localSearch.value);
  }

  /**
   * 清除全部作者筛选，保留当前关键词和作者浮层。
   * @returns {void}
   */
  function clearAuthorFilters(): void {
    cancelSearchTimer();
    if (!selectedAuthors.value.length) {
      return;
    }
    source.setAuthors([], localSearch.value);
  }

  /**
   * 判断候选是否在当前作者筛选内。
   * @param author - 作者候选
   * @returns 同名且同邮箱时为 true
   */
  function isAuthorSelected(author: CommitAuthor): boolean {
    return selectedAuthors.value.some((item) => isSameAuthor(item, author));
  }

  /**
   * 从无结果提示中清除所有提交筛选。
   * @returns {void}
   */
  function clearCommitFilters(): void {
    localSearch.value = "";
    cancelSearchTimer();
    closeAuthorOptions();
    source.setAuthors([], "");
  }

  // 仓库、浏览分支或检出分支变化时，旧范围的选项不再可用。
  watch([
    () => scope.value?.repoId,
    () => scope.value?.path,
    () => scope.value?.branch,
    () => scope.value?.allBranches,
    () => scope.value?.headRef,
  ], ([repoId], [previousRepoId]) => {
    authorRequestSequence++;
    closeAuthorOptions();
    authorOptions.value = [];
    authorOptionsLoading.value = false;
    authorOptionsError.value = null;
    if (repoId !== previousRepoId) {
      cancelSearchTimer();
      localSearch.value = "";
    }
  }, { flush: "sync" });

  onScopeDispose(() => {
    cancelSearchTimer();
    authorRequestSequence++;
  });

  return {
    selectedAuthors,
    localSearch,
    searchInput,
    authorOptionsOpen,
    authorOptions,
    authorOptionsLoading,
    authorOptionsError,
    openAuthorOptions,
    closeAuthorOptions,
    loadAuthorOptions,
    onSearchFocusOut,
    onSearchInput,
    applySearch,
    clearSearch,
    dismissSearch,
    toggleAuthorFilter,
    clearAuthorFilters,
    isAuthorSelected,
    clearCommitFilters,
  };
}
