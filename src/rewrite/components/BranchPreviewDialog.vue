<!--
  @component BranchPreviewDialog
  @description
    在独立弹窗中浏览非当前分支的提交。本地分支还可查看上游差异和手动同步。
    提交行提供与主列表一致的右键菜单，便于直接审查、Cherry-pick 和复制提交信息。
  @usage
    传入打开时固定的仓库和分支信息，收到 close 后由父组件关闭弹窗；
    Cherry-pick 产生冲突时发出 conflict，由父组件关闭预览并打开冲突处理。
  @dataFormat
    分支使用 BranchInfo 中的完整引用，历史及提交审查使用 CommitInfo。
  @changeLog
    - 2026-11-07: Created. 新增分支历史预览、上游状态和手动同步入口。
    - 2026-11-07: Updated. 本地分支预览支持作者筛选，弹窗尺寸随窗口增大。
    - 2026-11-10: Updated. 提交列表提供与主列表一致的右键菜单，可审查、Cherry-pick 到当前分支并复制提交信息与哈希。
    - 2026-11-13: Updated. 分支预览按窗口宽度展开，移除大屏固定宽度上限。
    - 2026-11-17: Updated. 提交列表支持 Shift/Ctrl 多选，并可按累计或逐条批量审查。
    - 2026-11-17: Updated. 远程分支预览同样提供关键词与作者搜索。
    - 2026-11-21: Updated. 打开弹窗时显示所选分支的完整历史，可切换到主线。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRepoStore } from "@/stores/repo";
import type { CommitInfo } from "@/types/git";
import { useBranchPreview, type BranchPreviewTarget } from "../composables/useBranchPreview";
import { useGitActions } from "../composables/useGitActions";
import { formatDateTime } from "../utils/date";
import CommitSearchBox from "./CommitSearchBox.vue";
import ReviewDialog from "./ReviewDialog.vue";

/** 右键菜单最多允许贴到弹窗边缘的最小留白，避免菜单描边被裁掉。 */
const MENU_INSET = 8;

/** 分支预览提交行的右键菜单状态。 */
interface PreviewCommitMenu {
  /** 相对弹窗左上角的位置，随菜单尺寸测量后再做边界修正。 */
  left: number;
  top: number;
  commit: CommitInfo;
  /** 提交在弹窗当前历史中的位置，用于审查翻页。 */
  index: number;
  /** 首次渲染先隐藏，完成尺寸测量后再显示，避免菜单在边缘闪动。 */
  ready: boolean;
}

const props = defineProps<{
  /** 打开预览时选定的仓库、显示名和完整分支引用。 */
  target: BranchPreviewTarget;
}>();

const emit = defineEmits<{
  /** 用户关闭整个分支预览时通知父组件。 */
  close: [];
  /** Cherry-pick 产生冲突，需要父组件关闭预览并打开冲突处理。 */
  conflict: [];
}>();

const repoStore = useRepoStore();
const gitActions = useGitActions();
const gitOperation = gitActions.operation;
const dialog = ref<HTMLDialogElement | null>(null);
const menuElement = ref<HTMLDivElement | null>(null);
const commitMenu = ref<PreviewCommitMenu | null>(null);
const notice = ref<string | null>(null);
const reviewIndex = ref<number | null>(null);
// 搜索防抖可能在审查打开后完成，审查顺序仍使用点击提交时的列表。
const reviewCommits = ref<CommitInfo[]>([]);
/** 批量审查的提交集合；null 表示单提交审查 */
const reviewBatch = ref<CommitInfo[] | null>(null);
/** 多选提交审查：选中的提交哈希 */
const selectedCommitHashes = ref<Set<string>>(new Set());
/** Shift 连选的锚点提交哈希 */
const commitAnchorHash = ref<string | null>(null);
let reviewTrigger: HTMLButtonElement | null = null;
// 右键打开菜单时记录所在提交行，关闭审查后把焦点还给它。
let menuTrigger: HTMLElement | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const {
  branch, commits, loading, loadingMore, hasMore, historyError, paginationError,
  commitSearch, hasCommitFilters, mainlineOnly, setMainlineOnly,
  activeAction, actionResult, gitBusy, hasKnownUpstream, isDiverged, canFetch, canPull, canPush,
  refreshPreview, loadMore, execute,
} = useBranchPreview(props.target);

const reviewCommit = computed(() => reviewIndex.value === null ? null : reviewCommits.value[reviewIndex.value]);
/** 已选提交在弹窗历史中的位置，按列表顺序（最新在前）升序 */
const selectedCommitIndexes = computed<number[]>(() => {
  const hashes = selectedCommitHashes.value;
  if (!hashes.size) return [];
  const indexes: number[] = [];
  commits.value.forEach((commit, index) => {
    if (hashes.has(commit.hash)) indexes.push(index);
  });
  return indexes;
});
/** 已选提交数量 */
const selectedCommitCount = computed(() => selectedCommitIndexes.value.length);
/** 已选提交，按列表顺序（最新在前） */
const selectedCommits = computed<CommitInfo[]>(() => selectedCommitIndexes.value
  .map((index) => commits.value[index])
  .filter((commit): commit is CommitInfo => Boolean(commit)));
/**
 * 选中范围：按历史顺序计算区间，连续选择时区间恰好等于所选提交。
 */
const selectionRange = computed(() => {
  const indexes = selectedCommitIndexes.value;
  if (!indexes.length) return null;
  const newest = commits.value[indexes[0]];
  const oldest = commits.value[indexes[indexes.length - 1]];
  if (!newest || !oldest) return null;
  const span = indexes[indexes.length - 1] - indexes[0] + 1;
  return { newest, oldest, missed: span - indexes.length };
});
/** 选择工具栏展示的范围文案 */
const selectionRangeLabel = computed(() => {
  const range = selectionRange.value;
  if (!range) return "";
  if (selectedCommitCount.value === 1) return range.newest.short_hash;
  const base = `${range.oldest.short_hash} → ${range.newest.short_hash}`;
  return range.missed > 0 ? `${base} · 不相邻，逐条展示` : base;
});
/** 所选提交不相邻时的缺口数量，决定走累计还是逐条审查 */
const batchGap = computed(() => selectionRange.value?.missed ?? 0);
/** 工具栏主按钮文案：连续选择看累计，不相邻时逐条展示 */
const batchActionLabel = computed(() => {
  if (selectedCommitCount.value <= 1) return "查看改动";
  return batchGap.value > 0 ? `逐条查看（${selectedCommitCount.value}）` : `查看合并改动（${selectedCommitCount.value}）`;
});
/** 右键菜单命中的提交是否在多选集合里，决定是否提供合并审查入口 */
const commitMenuInSelection = computed(() => {
  const menu = commitMenu.value;
  if (!menu) return false;
  return selectedCommitHashes.value.size > 1 && selectedCommitHashes.value.has(menu.commit.hash);
});
const upstreamLabel = computed(() => {
  const upstream = branch.value?.upstream_target;
  // 跟踪引用可以由 refspec 映射到别名，这里展示远程仓库里的实际分支名。
  if (upstream) {
    return `${upstream.remote}/${upstream.remote_ref.slice("refs/heads/".length)}`;
  }
  return branch.value?.upstream || (branch.value ? "未设置" : "—");
});

// 数量取自本地引用，提示文案同时说明操作被禁用的原因。
const syncHint = computed(() => {
  const current = branch.value;
  if (!current) {
    return "数量将在读取分支状态后显示";
  }
  if (!current.upstream_target) {
    return current.upstream ? "该上游不支持远程同步" : "可在分支的「⋯」菜单设置上游";
  }
  if (current.is_current) {
    return "该分支已检出，请在主界面拉取或推送";
  }
  if (current.upstream_gone) {
    return "本机缺少上游引用，请先获取远程";
  }
  if (isDiverged.value) {
    return "与上游已分叉，无法快进拉取或直接推送";
  }
  if (current.behind > 0) {
    return "本地落后于上游，快进拉取后可推送";
  }
  return "提交数基于本地远程引用";
});

/**
 * 用新的哈希集合替换多选，整体替换以触发行高亮。
 * @param hashes - 新的选中集合
 * @returns void
 */
function applyCommitSelection(hashes: Set<string>): void {
  selectedCommitHashes.value = hashes;
}

/**
 * 清除多选与连选锚点。
 * @returns void
 */
function clearCommitSelection(): void {
  if (!selectedCommitHashes.value.size && !commitAnchorHash.value) return;
  selectedCommitHashes.value = new Set();
  commitAnchorHash.value = null;
}

/**
 * 切换单行选中，并把该行设为连选锚点。
 * @param index - 提交在弹窗历史中的位置
 * @returns void
 */
function toggleCommitSelection(index: number): void {
  const commit = commits.value[index];
  if (!commit) return;
  const next = new Set(selectedCommitHashes.value);
  if (next.has(commit.hash)) {
    next.delete(commit.hash);
  } else {
    next.add(commit.hash);
  }
  commitAnchorHash.value = commit.hash;
  applyCommitSelection(next);
}

/**
 * 选中从锚点到目标行的连续区间。
 * @param targetIndex - 目标提交在弹窗历史中的位置
 * @param additive - 是否在已有选择上追加区间（Ctrl+Shift 点选）
 * @returns void
 */
function selectCommitRange(targetIndex: number, additive = false): void {
  const target = commits.value[targetIndex];
  if (!target) return;
  const anchorIndex = commitAnchorHash.value
    ? commits.value.findIndex((commit) => commit.hash === commitAnchorHash.value)
    : -1;
  const from = anchorIndex >= 0 ? anchorIndex : targetIndex;
  const next = new Set(additive ? selectedCommitHashes.value : []);
  for (let index = Math.min(from, targetIndex); index <= Math.max(from, targetIndex); index += 1) {
    const commit = commits.value[index];
    if (commit) next.add(commit.hash);
  }
  commitAnchorHash.value = commits.value[from]?.hash ?? target.hash;
  applyCommitSelection(next);
}

/**
 * 选中弹窗当前已加载的全部提交（列表内 Ctrl+A）。
 * @returns void
 */
function selectAllCommits(): void {
  const first = commits.value[0];
  if (!first) return;
  commitAnchorHash.value = first.hash;
  applyCommitSelection(new Set(commits.value.map((commit) => commit.hash)));
}

/**
 * 提交行单击：普通点击打开单提交审查，Ctrl 切换多选，Shift 连选。
 * @param event - 鼠标事件
 * @param index - 提交在弹窗历史中的位置
 * @param trigger - 发起审查的提交行
 * @returns void
 */
function onCommitClick(event: MouseEvent, index: number, trigger: HTMLElement): void {
  if (loading.value || gitBusy.value || activeAction.value) return;
  if (event.shiftKey) {
    event.preventDefault();
    selectCommitRange(index, event.ctrlKey || event.metaKey);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    toggleCommitSelection(index);
    return;
  }
  clearCommitSelection();
  // 关闭审查后再 Shift 点选，可从刚看过的提交开始连选。
  commitAnchorHash.value = commits.value[index]?.hash ?? null;
  openReview(index, trigger);
}

/**
 * 提交行键盘：Enter 查看、Space 多选、↑↓ 移动焦点、Ctrl+A 全选。
 * @param event - 键盘事件
 * @param index - 当前行提交在弹窗历史中的位置
 * @param trigger - 当前行元素
 * @returns void
 */
function onCommitKeydown(event: KeyboardEvent, index: number, trigger: HTMLElement): void {
  if (loading.value || gitBusy.value || activeAction.value) return;
  if (event.key === "Enter") {
    event.preventDefault();
    openReviewFromRow(index, trigger);
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    toggleCommitSelection(index);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAllCommits();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".preview-commits .preview-commit"));
  const next = rows[rows.indexOf(trigger) + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
  if (!event.shiftKey) return;
  const targetIndex = Number(next.dataset.commitIndex);
  if (!Number.isInteger(targetIndex)) return;
  if (!commitAnchorHash.value) commitAnchorHash.value = commits.value[index]?.hash ?? null;
  selectCommitRange(targetIndex, true);
}

/**
 * 行内 Enter：选中的多条包含该行时打开批量审查，否则打开单提交审查。
 * @param index - 提交在弹窗历史中的位置
 * @param trigger - 发起审查的提交行
 * @returns void
 */
function openReviewFromRow(index: number, trigger: HTMLElement | null): void {
  const commit = commits.value[index];
  if (!commit) return;
  if (selectedCommitHashes.value.size > 1 && selectedCommitHashes.value.has(commit.hash)) {
    openBatchReview(trigger);
    return;
  }
  openReview(index, trigger);
}

/**
 * 打开多选提交的批量审查；只选中一条时退回单提交审查。
 * @param trigger - 发起审查的提交行，用于关闭后恢复焦点
 * @returns void
 */
function openBatchReview(trigger: HTMLElement | null = null): void {
  const commitsInBatch = selectedCommits.value;
  const indexes = selectedCommitIndexes.value;
  if (!commitsInBatch.length) return;
  if (commitsInBatch.length === 1) {
    openReview(indexes[0], trigger);
    return;
  }
  closeCommitMenu();
  reviewTrigger = trigger instanceof HTMLButtonElement ? trigger : null;
  reviewCommits.value = commits.value.slice();
  // 现有审查界面挂到 body，暂时关闭原生弹窗以免审查被遮住，同时保留历史和滚动状态。
  dialog.value?.close();
  reviewBatch.value = commitsInBatch;
  reviewIndex.value = indexes[0];
}

/**
 * 从预览打开所选提交的现有审查界面。
 * @param index - 提交在弹窗历史中的位置
 * @param trigger - 发起审查的提交行，用于关闭审查后恢复焦点
 * @returns void
 */
function openReview(index: number, trigger: HTMLElement | null): void {
  closeCommitMenu();
  reviewTrigger = trigger instanceof HTMLButtonElement ? trigger : null;
  reviewCommits.value = commits.value.slice();
  // 现有审查界面挂到 body，暂时关闭原生弹窗以免审查被遮住，同时保留历史和滚动状态。
  dialog.value?.close();
  reviewBatch.value = null;
  reviewIndex.value = index;
}

/**
 * 在弹窗内打开提交右键菜单，并把位置限制在弹窗范围内。
 * @param event - 提交行的右键事件
 * @param commit - 关联的提交
 * @param index - 提交在弹窗当前历史中的位置
 * @returns 菜单测量完成后结束
 */
async function openCommitContext(event: MouseEvent, commit: CommitInfo, index: number): Promise<void> {
  const dialogElement = dialog.value;
  if (!dialogElement) {
    return;
  }
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const dialogRect = dialogElement.getBoundingClientRect();

  // 1. 先按点击位置渲染，再测量菜单实际尺寸，避免靠近弹窗边缘时被裁掉。
  commitMenu.value = {
    left: event.clientX - dialogRect.left,
    top: event.clientY - dialogRect.top,
    commit,
    index,
    ready: false,
  };
  await nextTick();
  const menu = menuElement.value;
  if (!commitMenu.value || !menu) {
    return;
  }
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = dialogRect.width - menuRect.width - MENU_INSET;
  const maxTop = dialogRect.height - menuRect.height - MENU_INSET;
  commitMenu.value = {
    ...commitMenu.value,
    left: Math.max(MENU_INSET, Math.min(commitMenu.value.left, maxLeft)),
    top: Math.max(MENU_INSET, Math.min(commitMenu.value.top, maxTop)),
    ready: true,
  };
}

/**
 * 关闭提交右键菜单，并清空触发行的焦点记录。
 * @returns void
 */
function closeCommitMenu(): void {
  commitMenu.value = null;
  menuTrigger = null;
}

/**
 * 在弹窗内显示短暂的操作反馈，保证提示不被原生弹窗遮挡。
 * @param message - 反馈文案
 * @returns void
 */
function showPreviewNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }
  noticeTimer = setTimeout(() => {
    notice.value = null;
    noticeTimer = null;
  }, 2800);
}

/**
 * 复制文本到剪贴板，并在弹窗内提示结果。
 * @param value - 待复制的文本
 * @param successMessage - 复制成功后的提示
 * @returns 复制结束
 */
async function copyText(value: string, successMessage: string): Promise<void> {
  closeCommitMenu();
  try {
    await navigator.clipboard.writeText(value);
    showPreviewNotice(successMessage);
  } catch {
    showPreviewNotice("复制失败");
  }
}

/**
 * 按提交标题和可选正文复制提交信息。
 * @returns void
 */
function copyCommitMessage(): void {
  const commit = commitMenu.value?.commit;
  if (!commit) {
    return;
  }
  const message = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
  void copyText(message, "已复制提交信息");
}

/**
 * 从右键菜单打开所选提交的审查。
 * @returns void
 */
function reviewFromMenu(): void {
  const menu = commitMenu.value;
  const trigger = menuTrigger;
  if (!menu) {
    return;
  }
  openReview(menu.index, trigger);
}

/**
 * 将预览中的提交 Cherry-pick 到当前检出分支；冲突时交给父组件的冲突处理。
 * @returns Cherry-pick 及提示更新结束
 */
async function cherryPickFromMenu(): Promise<void> {
  const commit = commitMenu.value?.commit;
  if (!commit) {
    return;
  }
  closeCommitMenu();

  // 预览固定了打开时的仓库，项目已切换时不能把提交挑到其他仓库的当前分支。
  const activePath = repoStore.activeRepo?.path;
  if (activePath !== props.target.repoPath) {
    showPreviewNotice("当前项目已切换，请重新打开分支后再操作");
    return;
  }

  const result = await gitActions.cherryPick(commit.hash);
  await gitActions.refreshOperation();
  if (gitOperation.value !== "normal") {
    // 冲突界面挂在主界面，必须先关闭原生弹窗才能显示。
    emit("conflict");
    return;
  }
  showPreviewNotice(result.message);
}

/**
 * 弹窗内 Esc 优先收起右键菜单，其次清除多选，最后退出预览。
 * @returns void
 */
function onDialogCancel(): void {
  if (commitMenu.value) {
    closeCommitMenu();
    return;
  }
  if (selectedCommitHashes.value.size) {
    clearCommitSelection();
    return;
  }
  emit("close");
}

/**
 * 点击菜单以外的区域时收起右键菜单。
 * @param event - 文档鼠标事件
 * @returns void
 */
function onDocumentMouseDown(event: MouseEvent): void {
  const target = event.target;
  if (!commitMenu.value || !(target instanceof Element)) {
    return;
  }
  if (!target.closest(".preview-context-menu")) {
    closeCommitMenu();
  }
}

/**
 * 关闭提交审查，回到分支预览及原提交位置。
 * @returns 焦点恢复后结束
 */
async function closeReview(): Promise<void> {
  reviewIndex.value = null;
  reviewBatch.value = null;
  reviewCommits.value = [];
  await nextTick();
  dialog.value?.showModal();
  reviewTrigger?.focus({ preventScroll: true });
  reviewTrigger = null;
}

/**
 * 批量审查内切换到某条提交的单提交审查，弹窗保持打开。
 * @param hash - 目标提交哈希
 * @returns void
 */
function focusCommitFromBatch(hash: string): void {
  const index = reviewCommits.value.findIndex((commit) => commit.hash === hash);
  if (index < 0) return;
  reviewBatch.value = null;
  reviewIndex.value = index;
}

/**
 * 在预览已加载的提交范围内切换审查对象；批量审查不参与逐条切换。
 * @param delta - 现有审查界面发出的上一个或下一个偏移量
 * @returns void
 */
function stepReview(delta: number): void {
  if (reviewBatch.value) return;
  const nextIndex = (reviewIndex.value ?? 0) + delta;
  if (nextIndex >= 0 && nextIndex < reviewCommits.value.length) {
    reviewIndex.value = nextIndex;
  }
}

onMounted(() => {
  dialog.value?.showModal();
  document.addEventListener("mousedown", onDocumentMouseDown);
  void refreshPreview();
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }
});
</script>

<template>
  <dialog
    ref="dialog"
    class="branch-preview-dialog"
    aria-labelledby="branch-preview-title"
    @cancel.prevent="onDialogCancel"
    @click.self="emit('close')"
  >
    <div class="preview-layout">
      <!-- 分支身份、提交筛选及关闭入口 -->
      <header class="preview-header">
        <div class="preview-heading">
          <div class="preview-context" :title="target.repoName">
            {{ target.repoName }} · {{ target.branch.is_remote ? '远程分支' : '本地分支' }}
          </div>
          <h2 id="branch-preview-title" :title="target.branch.name">{{ target.branch.name }}</h2>
        </div>
        <!-- 历史范围固定在所选分支内，可切换完整历史和主线。 -->
        <div class="preview-scope" role="group" aria-label="历史范围">
          <button
            type="button"
            :class="{ active: !mainlineOnly }"
            title="显示所选分支的完整历史，包含已合入的提交"
            @click="setMainlineOnly(false)"
          >仅本分支</button>
          <button
            type="button"
            :class="{ active: mainlineOnly }"
            title="只沿第一父提交查看所选分支的主线历史"
            @click="setMainlineOnly(true)"
          >主线</button>
        </div>
        <!-- 本地和远程分支共用同一套关键词/作者筛选，查询范围固定在打开时的提交快照 -->
        <CommitSearchBox class="preview-search" :controller="commitSearch" />
        <button class="close-btn" type="button" aria-label="关闭分支预览" autofocus @click="emit('close')">×</button>
      </header>

      <!-- 本地分支的上游及手动操作 -->
      <section v-if="!target.branch.is_remote" class="preview-sync" aria-label="上游同步">
        <div class="preview-sync-bar">
          <div class="preview-upstream" :title="upstreamLabel">
            <span>上游</span>
            <strong>{{ upstreamLabel }}</strong>
          </div>
          <div class="preview-actions">
            <button class="icon-control" type="button" :disabled="!canFetch" :aria-busy="activeAction === 'fetch'" @click="execute('fetch')">
              {{ activeAction === 'fetch' ? '获取中…' : '获取远程' }}
            </button>
            <button
              class="icon-control sync-action"
              :class="{ 'has-updates': hasKnownUpstream && !!branch?.behind }"
              type="button"
              :disabled="!canPull"
              :aria-busy="activeAction === 'pull'"
              title="快进拉取到所选分支"
              @click="execute('pull')"
            >
              {{ activeAction === 'pull' ? '拉取中…' : '↓ 拉取' }}
              <span v-if="activeAction !== 'pull'" class="sync-count">{{ hasKnownUpstream ? branch?.behind : '—' }}</span>
            </button>
            <button
              class="icon-control sync-action"
              :class="{ 'has-updates': hasKnownUpstream && !!branch?.ahead }"
              type="button"
              :disabled="!canPush"
              :aria-busy="activeAction === 'push'"
              title="将所选分支推送到上游"
              @click="execute('push')"
            >
              {{ activeAction === 'push' ? '推送中…' : '↑ 推送' }}
              <span v-if="activeAction !== 'push'" class="sync-count">{{ hasKnownUpstream ? branch?.ahead : '—' }}</span>
            </button>
          </div>
        </div>
        <div class="preview-hint" :class="{ 'preview-warning': isDiverged }" role="status">{{ syncHint }}</div>
        <div v-if="gitBusy && !activeAction" class="preview-result" role="status">正在{{ gitBusy }}…</div>
        <div v-else-if="actionResult" class="preview-result" :class="{ 'preview-error': !actionResult.ok }" role="status">
          {{ actionResult.message }}
        </div>
      </section>
      <div v-else class="preview-sync preview-hint">历史来自本地保存的远程分支引用</div>

      <!-- 独立的提交历史与分页 -->
      <section class="preview-history" aria-label="分支提交历史" :aria-busy="loading || loadingMore" @scroll="closeCommitMenu">
        <!-- 多选提交后的操作条：放在滚动容器内，才能和提交行同宽并对齐，滚动时吸顶 -->
        <div v-if="selectedCommitCount > 0" class="preview-selection-bar" role="group" aria-label="已选中的提交">
          <span class="selection-count">已选择 {{ selectedCommitCount }} 个提交</span>
          <span class="selection-range" :title="selectionRangeLabel">{{ selectionRangeLabel }}</span>
          <span class="selection-hint">Shift 连选 · Ctrl 点选 · Enter 查看</span>
          <div class="selection-actions">
            <button class="selection-btn" type="button" @click="clearCommitSelection">清除选择</button>
            <button class="selection-btn primary" type="button" @click="openBatchReview()">{{ batchActionLabel }}</button>
          </div>
        </div>
        <div v-if="historyError" class="preview-empty preview-error" role="status">
          <p>读取分支失败。{{ historyError }}</p>
          <button class="icon-control" type="button" @click="refreshPreview">重试</button>
        </div>
        <p v-else-if="loading && !commits.length" class="preview-empty" role="status">正在读取分支历史…</p>
        <div v-else-if="!commits.length" class="preview-empty">
          <p>{{ hasCommitFilters ? '没有匹配的提交' : '此分支暂无提交' }}</p>
          <button v-if="hasCommitFilters" class="icon-control" type="button" @click="commitSearch.clearCommitFilters">清除筛选</button>
        </div>
        <template v-else>
          <ul class="preview-commits">
            <li v-for="(commit, index) in commits" :key="commit.hash">
              <button
                class="preview-commit"
                :class="{ selected: selectedCommitHashes.has(commit.hash) }"
                type="button"
                :disabled="loading || !!gitBusy || !!activeAction"
                :data-commit-index="index"
                :aria-pressed="selectedCommitHashes.has(commit.hash)"
                :title="`${commit.subject}\nCtrl / Shift 点选可多选提交`"
                @click="onCommitClick($event, index, $event.currentTarget as HTMLElement)"
                @keydown="onCommitKeydown($event, index, $event.currentTarget as HTMLElement)"
                @contextmenu.prevent="openCommitContext($event, commit, index)"
              >
                <span class="preview-commit-body">
                  <span class="preview-subject" :title="commit.subject">{{ commit.subject }}</span>
                  <span class="preview-meta" :title="commit.author_name"><code>{{ commit.short_hash }}</code> · {{ commit.author_name }}</span>
                </span>
                <time class="preview-date" :datetime="commit.author_date">{{ formatDateTime(commit.author_date) }}</time>
              </button>
            </li>
          </ul>
          <div v-if="hasMore" class="preview-pagination">
            <p v-if="paginationError" class="preview-error" role="status">{{ paginationError }}</p>
            <button class="icon-control" type="button" :disabled="loading || loadingMore || !!activeAction" @click="loadMore">
              {{ loadingMore ? '读取中…' : paginationError ? '重试读取' : '加载更早的提交' }}
            </button>
          </div>
        </template>
      </section>
    </div>

    <!-- 提交右键菜单：与主列表保持同样的操作和分组 -->
    <div
      v-if="commitMenu"
      ref="menuElement"
      class="context-menu preview-context-menu"
      :class="{ 'menu-ready': commitMenu.ready }"
      :style="{ left: `${commitMenu.left}px`, top: `${commitMenu.top}px` }"
      role="menu"
      @contextmenu.prevent
    >
      <div class="menu-header">
        <div class="menu-hash">{{ commitMenu.commit.short_hash }}</div>
        <div class="menu-subject">{{ commitMenu.commit.subject }}</div>
      </div>
      <button v-if="commitMenuInSelection" class="menu-item" type="button" @click="openBatchReview(menuTrigger); closeCommitMenu()"><span>查看选中的 {{ selectedCommitCount }} 个提交改动</span></button>
      <button class="menu-item" type="button" @click="reviewFromMenu"><span>查看改动</span><span class="hint">Enter</span></button>
      <button class="menu-item" type="button" @click="cherryPickFromMenu"><span>Cherry-pick 到当前分支</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" type="button" @click="copyCommitMessage"><span>复制提交信息</span></button>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.short_hash, '已复制短哈希')"><span>复制短哈希</span></button>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.hash, '已复制完整哈希')"><span>复制完整哈希</span></button>
    </div>

    <!-- 弹窗内的轻提示，避免被原生 dialog 的顶层遮罩挡住 -->
    <div v-if="notice" class="preview-notice" role="status" aria-live="polite">{{ notice }}</div>
  </dialog>

  <ReviewDialog
    v-if="reviewCommit"
    :commit="reviewCommit"
    :repo-path="target.repoPath"
    :index="reviewIndex ?? 0"
    :total="reviewCommits.length"
    :batch="reviewBatch"
    :batch-gap="batchGap"
    @close="closeReview"
    @step="stepReview"
    @focus-commit="focusCommitFromBatch"
  />
</template>

<style scoped>
.branch-preview-dialog {
  position: fixed;
  inset: 0;
  width: min(92vw, calc(100% - 48px));
  height: min(86vh, calc(100% - 48px));
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

.branch-preview-dialog::backdrop {
  background: rgba(18, 24, 31, 0.5);
}

.preview-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-header,
.preview-sync-bar,
.preview-commit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.preview-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
}

.preview-heading {
  flex: 1;
}

.preview-header .preview-search {
  width: min(340px, 38vw);
}

.preview-heading,
.preview-upstream,
.preview-commit-body {
  min-width: 0;
}

.preview-context,
.preview-heading h2,
.preview-upstream strong,
.preview-subject,
.preview-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-heading h2 {
  margin: 4px 0 0;
  color: var(--text-strong);
  font: 600 20px/1.4 var(--mono);
}

.preview-context,
.preview-upstream,
.preview-hint,
.preview-result,
.preview-meta,
.preview-date {
  color: var(--muted);
  font-size: 12px;
}

.preview-header .close-btn {
  flex-shrink: 0;
}

.preview-sync {
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.preview-upstream,
.preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-upstream span,
.preview-actions {
  flex-shrink: 0;
}

.preview-upstream strong {
  color: var(--text);
  font: 500 12px var(--mono);
}

.preview-sync-bar + .preview-hint,
.preview-result {
  margin-top: 6px;
}

.preview-result {
  max-height: 84px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.preview-warning {
  color: var(--warning);
}

.preview-error {
  color: var(--danger);
  overflow-wrap: anywhere;
}

.preview-history {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* 多选提交：左侧强调条 + 淡底色，hover 时仍能看清选中态。 */
.preview-commit.selected {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}

.preview-commit.selected:hover {
  background: var(--accent-soft);
}

.preview-commit.selected .preview-subject {
  color: var(--accent-strong);
}

/* 批量审查工具条：在滚动容器内吸顶，宽度与提交行一致，子元素复用主列表的 .selection-* 样式。 */
.preview-selection-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 9px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--accent-soft);
}

/* 历史范围切换：与弹窗内的控件保持同样的圆角和高度。 */
.preview-scope {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.preview-scope button {
  height: 24px;
  padding: 0 10px;
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.preview-scope button:hover {
  color: var(--text);
}

.preview-scope button.active {
  background: var(--surface);
  color: var(--text-strong);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.12));
}

.preview-empty,
.preview-pagination {
  margin: 0;
  padding: 20px 24px;
  font-size: 13px;
}

.preview-empty p,
.preview-pagination p {
  margin: 0 0 8px;
}

.preview-commits {
  margin: 0;
  padding: 0;
  list-style: none;
}

.preview-commit {
  width: 100%;
  min-height: 54px;
  padding: 9px 24px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.preview-commit:not(:disabled):hover,
.preview-commit:focus-visible {
  background: var(--hover);
}

.preview-subject,
.preview-meta {
  display: block;
}

.preview-subject {
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 600;
}

.preview-meta {
  margin-top: 3px;
}

.preview-date {
  flex-shrink: 0;
  font-family: var(--mono);
  white-space: nowrap;
}

/* 右键菜单相对原生弹窗定位，避免顶层弹窗遮住菜单 */
.preview-context-menu {
  position: absolute;
  z-index: 80;
}

.preview-context-menu:not(.menu-ready) {
  visibility: hidden;
}

.preview-notice {
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 90;
  max-width: min(520px, calc(100% - 48px));
  max-height: 40%;
  padding: 10px 16px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-pop);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: left;
  transform: translateX(-50%);
}
</style>
