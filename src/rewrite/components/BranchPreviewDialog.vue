<!--
  @component BranchPreviewDialog
  @description
    在独立弹窗中浏览非当前分支的提交。本地分支还可查看上游差异和手动同步。
  @usage
    传入打开时固定的仓库和分支信息，收到 close 后由父组件关闭弹窗。
  @dataFormat
    分支使用 BranchInfo 中的完整引用，历史及提交审查使用 CommitInfo。
  @changeLog
    - 2026-11-07: Created. 新增分支历史预览、上游状态和手动同步入口。
    - 2026-11-07: Updated. 本地分支预览支持作者筛选，弹窗尺寸随窗口增大。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { CommitInfo } from "@/types/git";
import { useBranchPreview, type BranchPreviewTarget } from "../composables/useBranchPreview";
import { formatDateTime } from "../utils/date";
import CommitSearchBox from "./CommitSearchBox.vue";
import ReviewDialog from "./ReviewDialog.vue";

const props = defineProps<{
  /** 打开预览时选定的仓库、显示名和完整分支引用。 */
  target: BranchPreviewTarget;
}>();

const emit = defineEmits<{
  /** 用户关闭整个分支预览时通知父组件。 */
  close: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const reviewIndex = ref<number | null>(null);
// 搜索防抖可能在审查打开后完成，审查顺序仍使用点击提交时的列表。
const reviewCommits = ref<CommitInfo[]>([]);
let reviewTrigger: HTMLButtonElement | null = null;
const {
  branch, commits, loading, loadingMore, hasMore, historyError, paginationError,
  commitSearch, hasCommitFilters,
  activeAction, actionResult, gitBusy, hasKnownUpstream, isDiverged, canFetch, canPull, canPush,
  refreshPreview, loadMore, execute,
} = useBranchPreview(props.target);

const reviewCommit = computed(() => reviewIndex.value === null ? null : reviewCommits.value[reviewIndex.value]);
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
 * 从预览打开所选提交的现有审查界面。
 * @param index - 提交在弹窗历史中的位置
 * @param event - 用于返回时恢复焦点的点击事件
 * @returns void
 */
function openReview(index: number, event: MouseEvent): void {
  reviewTrigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
  reviewCommits.value = commits.value.slice();
  // 现有审查界面挂到 body，暂时关闭原生弹窗以免审查被遮住，同时保留历史和滚动状态。
  dialog.value?.close();
  reviewIndex.value = index;
}

/**
 * 关闭提交审查，回到分支预览及原提交位置。
 * @returns 焦点恢复后结束
 */
async function closeReview(): Promise<void> {
  reviewIndex.value = null;
  reviewCommits.value = [];
  await nextTick();
  dialog.value?.showModal();
  reviewTrigger?.focus({ preventScroll: true });
  reviewTrigger = null;
}

/**
 * 在预览已加载的提交范围内切换审查对象。
 * @param delta - 现有审查界面发出的上一个或下一个偏移量
 * @returns void
 */
function stepReview(delta: number): void {
  const nextIndex = (reviewIndex.value ?? 0) + delta;
  if (nextIndex >= 0 && nextIndex < reviewCommits.value.length) {
    reviewIndex.value = nextIndex;
  }
}

onMounted(() => {
  dialog.value?.showModal();
  void refreshPreview();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="branch-preview-dialog"
    aria-labelledby="branch-preview-title"
    @cancel.prevent="emit('close')"
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
        <CommitSearchBox v-if="!target.branch.is_remote" class="preview-search" :controller="commitSearch" />
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
      <section class="preview-history" aria-label="分支提交历史" :aria-busy="loading || loadingMore">
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
              <button class="preview-commit" type="button" :disabled="loading || !!gitBusy || !!activeAction" @click="openReview(index, $event)">
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
  </dialog>

  <ReviewDialog
    v-if="reviewCommit"
    :commit="reviewCommit"
    :repo-path="target.repoPath"
    :index="reviewIndex ?? 0"
    :total="reviewCommits.length"
    @close="closeReview"
    @step="stepReview"
  />
</template>

<style scoped>
.branch-preview-dialog {
  position: fixed;
  inset: 0;
  width: min(80vw, 1600px, calc(100% - 48px));
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
</style>
