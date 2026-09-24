<!--
  @component HistoryCommitRows
  @description
    为文件历史、版本范围和活动日期提供一致的可滚动提交列表，并复用统一的提交选择。

  @usage
    <HistoryCommitRows :commits="commits" :loading="loading" @select="selectCommit" />

  @dataFormat
    接收 CommitInfo 数组、当前选中哈希及分页状态；向外发送选择、加载更多和右键事件。

  @changeLog
    - 2026-09-24: Created. 复用历史视图提交行与分页交互。
-->
<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import type { CommitInfo } from "@/types/git";

/**
 * 当前历史查询的提交列表及交互状态。
 */
const props = defineProps<{
  /** 当前查询已加载的提交 */
  commits: CommitInfo[];
  /** 首次加载中的状态 */
  loading: boolean;
  /** 后续分页请求中的状态 */
  loadingMore: boolean;
  /** 是否还有后续提交页 */
  hasMore: boolean;
  /** 当前选中的提交哈希 */
  selectedHash: string | null;
  /** 空结果提示 */
  emptyMessage: string;
}>();

const emit = defineEmits<{
  /** 选择提交并更新右侧详情 */
  (e: "select", hash: string): void;
  /** 请求加载下一页 */
  (e: "load-more"): void;
  /** 提交行的右键事件 */
  (e: "contextmenu", event: MouseEvent, commit: CommitInfo): void;
}>();

const settingsStore = useSettingsStore();

/**
 * 按当前时间显示设置格式化提交时间。
 * @param {CommitInfo} commit - 当前提交
 * @returns {string} 相对时间或本地绝对时间
 */
function formatTime(commit: CommitInfo): string {
  if (settingsStore.timeFormat !== "absolute") return commit.relative_date;
  const date = new Date(commit.author_date);
  if (Number.isNaN(date.getTime())) return commit.relative_date;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 接近列表底部时请求下一页提交。
 * @param {Event} event - 列表滚动事件
 * @returns {void} 按分页状态触发加载更多事件
 */
function onScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement;
  if (props.hasMore && !props.loading && !props.loadingMore && element.scrollHeight - element.scrollTop - element.clientHeight < 60) {
    emit("load-more");
  }
}

/**
 * 阻止浏览器右键菜单并把提交上下文交给父视图。
 * @param {MouseEvent} event - 原生右键事件
 * @param {CommitInfo} commit - 当前提交
 * @returns {void} 发出提交右键事件
 */
function onContextMenu(event: MouseEvent, commit: CommitInfo): void {
  event.preventDefault();
  emit("contextmenu", event, commit);
}
</script>

<template>
  <div class="history-commit-rows" @scroll="onScroll">
    <button
      v-for="commit in props.commits"
      :key="commit.hash"
      class="history-commit-row"
      :class="{ active: props.selectedHash === commit.hash }"
      :title="commit.subject"
      @click="emit('select', commit.hash)"
      @contextmenu="onContextMenu($event, commit)"
    >
      <span class="row-hash">{{ commit.short_hash }}</span>
      <span class="row-subject">{{ commit.subject }}</span>
      <span class="row-author">{{ commit.author_name }}</span>
      <span class="row-date">{{ formatTime(commit) }}</span>
    </button>

    <div v-if="props.loadingMore" class="history-list-status">加载中…</div>
    <div v-else-if="!props.hasMore && props.commits.length > 0" class="history-list-status">没有更多了</div>
    <div v-if="props.loading" class="history-list-status">加载中…</div>
    <div v-if="!props.loading && props.commits.length === 0" class="history-list-empty">{{ props.emptyMessage }}</div>
  </div>
</template>

<style scoped>
.history-commit-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.history-commit-row {
  width: calc(100% - 12px);
  height: 32px;
  margin: 1px 6px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.history-commit-row:hover {
  background: var(--bg-hover);
}

.history-commit-row.active {
  color: #fff;
  background: var(--accent);
}

.row-hash {
  width: 58px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--fg-tertiary);
  font: 12px "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active .row-hash,
.active .row-author,
.active .row-date {
  color: #fff;
}

.row-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-author {
  width: 76px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--fg-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-date {
  width: 116px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--fg-tertiary);
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-list-status,
.history-list-empty {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.history-list-empty {
  height: 100%;
  min-height: 160px;
}
</style>
