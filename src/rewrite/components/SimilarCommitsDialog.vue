<!--
  @component SimilarCommitsDialog
  @description
    在主提交列表的分支范围内查找同系列提交，并支持打开结果的改动审查。
  @usage
    主列表传入右键时的仓库、分支范围和提交标题，用户关闭时发出 close。
  @dataFormat
    输入使用 SimilarCommitSearchTarget，结果使用现有的 CommitInfo。
  @workflow
    打开时显示去掉末尾序号的关键词并查询。点击结果打开提交审查，关闭审查后回到搜索结果。
  @changeLog
    - 2026-11-21: Created. 新增从主提交列表打开的相似提交搜索弹窗。
    - 2026-11-21: Updated. 将相似提交弹窗居中显示在应用窗口内。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { CommitInfo } from "@/types/git";
import { useSimilarCommitSearch, type SimilarCommitSearchTarget } from "../composables/useSimilarCommitSearch";
import { formatDateTime } from "../utils/date";
import CommitSearchBox from "./CommitSearchBox.vue";
import ReviewDialog from "./ReviewDialog.vue";

const props = defineProps<{
  /** 右键时的项目、主列表分支范围及选中的提交标题。 */
  target: SimilarCommitSearchTarget;
}>();

const emit = defineEmits<{
  /** 用户主动关闭搜索弹窗时发出，无额外载荷。 */
  close: [];
}>();

/** 审查打开时固定结果顺序，避免防抖搜索或分页响应改变正在审查的提交。 */
interface SimilarCommitReview {
  commits: CommitInfo[];
  index: number;
}

const dialog = ref<HTMLDialogElement | null>(null);
const { commitSearch, commits, loading, hasMore, searchError, loadResults } = useSimilarCommitSearch(props.target);
const review = ref<SimilarCommitReview | null>(null);
let reviewTrigger: HTMLElement | null = null;

const reviewCommit = computed(() => {
  const currentReview = review.value;
  return currentReview ? currentReview.commits[currentReview.index] : null;
});

/**
 * 打开结果的现有提交审查，并保存关闭审查后的焦点位置。
 * @param index - 选中提交在搜索结果中的索引
 * @param event - 点击提交按钮的事件
 * @returns void
 */
function openReview(index: number, event: MouseEvent): void {
  const commitResults = commits.value;
  // 搜索刚提交时可能已清空列表，不能打开已经移除的结果。
  if (!commitResults[index]) {
    return;
  }
  reviewTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  review.value = { commits: commitResults, index };
  // 审查挂载在页面上，先关闭原生弹窗才能让审查接收焦点。
  dialog.value?.close();
}

/**
 * 在进入审查时的相似提交结果中翻页。
 * @param offset - 审查组件给出的上一条或下一条偏移量
 * @returns void
 */
function stepReview(offset: number): void {
  const currentReview = review.value;
  if (!currentReview) {
    return;
  }
  const nextIndex = currentReview.index + offset;
  if (nextIndex >= 0 && nextIndex < currentReview.commits.length) {
    currentReview.index = nextIndex;
  }
}

/**
 * 关闭审查并回到原搜索结果。
 * @returns 审查卸载且搜索弹窗恢复焦点后完成
 */
async function closeReview(): Promise<void> {
  review.value = null;
  const trigger = reviewTrigger;
  reviewTrigger = null;
  await nextTick();
  dialog.value?.showModal();
  if (trigger?.isConnected) {
    trigger.focus({ preventScroll: true });
  }
}

onMounted(() => {
  dialog.value?.showModal();
  void loadResults();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="similar-commits-dialog"
    aria-labelledby="similar-commits-title"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <div class="dialog">
      <!-- 项目与分支范围、关闭入口 -->
      <header class="dialog-header">
        <div class="dialog-heading">
          <div class="dialog-label" :title="target.repoName + ' · ' + target.scopeLabel">{{ target.repoName }} · {{ target.scopeLabel }}</div>
          <h2 id="similar-commits-title" class="dialog-subject">查询相似提交</h2>
        </div>
        <button class="close-btn" type="button" aria-label="关闭查询" autofocus @click="emit('close')">×</button>
      </header>

      <!-- 从原始提交标题得出的关键词，可继续修改或按作者筛选 -->
      <div class="similar-commits-search">
        <CommitSearchBox class="similar-commits-search-box" :controller="commitSearch" placeholder="搜索提交信息" />
      </div>

      <!-- 查询结果及分页反馈 -->
      <section class="similar-commits-results" aria-label="相似提交结果" :aria-busy="loading">
        <p v-if="loading && !commits.length" class="similar-commits-status" role="status">正在读取提交…</p>
        <p v-else-if="!commits.length && !searchError" class="similar-commits-status" role="status">没有匹配的提交</p>
        <ul v-if="commits.length" class="similar-commits-list">
          <li v-for="(commit, index) in commits" :key="commit.hash">
            <button class="similar-commit-row" type="button" @click="openReview(index, $event)">
              <span class="similar-commit-main">
                <span class="commit-subject similar-commit-subject" :title="commit.subject">{{ commit.subject }}</span>
                <span class="commit-meta"><code>{{ commit.short_hash }}</code><span>{{ commit.author_name }}</span></span>
              </span>
              <time class="similar-commit-date" :datetime="commit.author_date">{{ formatDateTime(commit.author_date) }}</time>
            </button>
          </li>
        </ul>
        <div v-if="searchError || hasMore" class="similar-commits-status">
          <p v-if="searchError" role="status">{{ searchError }}</p>
          <button class="icon-control" type="button" :disabled="loading" @click="loadResults(commits.length > 0)">
            {{ loading ? '读取中…' : searchError ? '重试' : '加载更早的提交' }}
          </button>
        </div>
      </section>
    </div>
  </dialog>

  <!-- 单条提交继续使用已有的改动审查 -->
  <ReviewDialog
    v-if="review && reviewCommit"
    :commit="reviewCommit"
    :repo-path="target.repoPath"
    :index="review.index"
    :total="review.commits.length"
    @close="closeReview"
    @step="stepReview"
  />
</template>

<style scoped>
.similar-commits-dialog {
  position: fixed;
  inset: 0;
  width: min(900px, calc(100% - 48px));
  height: min(640px, calc(100% - 48px));
  margin: auto;
  padding: 0;
  overflow: visible;
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
}

.similar-commits-dialog::backdrop {
  background: rgba(18, 24, 31, 0.5);
}

.similar-commits-search {
  position: relative;
  z-index: 1;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.similar-commits-dialog .dialog-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.similar-commits-search-box {
  width: 100%;
}

.similar-commits-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--surface);
}

.similar-commits-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.similar-commit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
  padding: 10px 24px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.similar-commit-row:hover,
.similar-commit-row:focus-visible {
  background: var(--bg);
}

.similar-commit-main {
  min-width: 0;
}

.similar-commit-subject {
  display: block;
}

.similar-commit-date {
  flex-shrink: 0;
  color: var(--muted);
  font: 11px var(--mono);
}

.similar-commits-status {
  margin: 0;
  padding: 16px 24px;
  color: var(--muted);
}
</style>
