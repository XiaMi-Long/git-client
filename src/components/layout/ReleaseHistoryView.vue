<!--
  @component ReleaseHistoryView
  @description
    以仓库标签为版本节点，浏览目标版本历史或两个标签之间的提交。

  @usage
    <ReleaseHistoryView :active="historyView === 'release'" @select="selectCommit" />

  @dataFormat
    使用 RepoStore 中的 TagInfo 与 Git 日志 CommitInfo；提交选择交由外层统一处理。

  @workflow
    1. 按标签日期展示版本节点和目标提交。
    2. 用户选择目标标签，可选一个基准标签组成版本范围。
    3. 视图分页显示目标标签或基准..目标之间的提交。

  @changeLog
    - 2026-09-24: Created. 新增版本标签历史视图。
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useCommitStore } from "@/stores/commit";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo, LogQuery, TagInfo } from "@/types/git";
import HistoryCommitRows from "./HistoryCommitRows.vue";

const props = defineProps<{
  /** 是否正在显示版本历史视图 */
  active: boolean;
}>();

const emit = defineEmits<{
  /** 选择提交并更新右侧详情 */
  (e: "select", hash: string): void;
  /** 提交行的右键事件 */
  (e: "contextmenu", event: MouseEvent, commit: CommitInfo): void;
}>();

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const targetTag = ref("");
const baseTag = ref("");
const commits = ref<CommitInfo[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const queryError = ref("");
let requestSequence = 0;
let loadedQueryKey = "";

// 标签时间从新到旧排列，帮助用户快速选中发布边界。
const tags = computed(() => [...(repoStore.activeRepo?.tags ?? [])].sort((a, b) => {
  const dateA = a.date ? new Date(a.date).getTime() : 0;
  const dateB = b.date ? new Date(b.date).getTime() : 0;
  return dateB - dateA;
}));
const baseOptions = computed(() => tags.value.filter((tag) => tag.name !== targetTag.value));
const queryKey = computed(() => JSON.stringify([
  repoStore.activeRepo?.id,
  targetTag.value,
  baseTag.value,
  commitStore.search,
]));

/**
 * 按目标标签和可选基准标签加载提交历史。
 * @param {boolean} [reset] - 是否从第一页重新读取
 * @returns {Promise<void>} 完成当前页或下一页查询
 */
async function loadReleaseHistory(reset = false): Promise<void> {
  const path = repoStore.activeRepo?.path;
  if (!path || !targetTag.value) {
    commits.value = [];
    hasMore.value = false;
    queryError.value = tags.value.length ? "请选择目标版本标签" : "当前仓库没有标签";
    loading.value = false;
    loadingMore.value = false;
    return;
  }
  if (baseTag.value === targetTag.value) {
    commits.value = [];
    hasMore.value = false;
    queryError.value = "基准标签和目标标签需要不同";
    loading.value = false;
    loadingMore.value = false;
    return;
  }

  if (reset) {
    requestSequence++;
    commits.value = [];
    hasMore.value = true;
    queryError.value = "";
  }

  const sequence = requestSequence;
  const repositoryId = repoStore.activeRepo?.id;
  const targetRef = `refs/tags/${targetTag.value}`;
  const revision = baseTag.value ? `refs/tags/${baseTag.value}..${targetRef}` : targetRef;
  const search = commitStore.search.trim() || null;
  const query: LogQuery = {
    skip: reset ? 0 : commits.value.length,
    limit: 100,
    branch: revision,
    search,
    all_branches: false,
  };

  if (reset) loading.value = true;
  else loadingMore.value = true;
  try {
    const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
    if (sequence !== requestSequence || repositoryId !== repoStore.activeRepo?.id) return;
    if (reset) commits.value = result;
    else commits.value.push(...result);
    hasMore.value = !search && result.length === query.limit;
  } catch (error) {
    if (sequence !== requestSequence || repositoryId !== repoStore.activeRepo?.id) return;
    queryError.value = String(error);
    if (reset) commits.value = [];
    hasMore.value = false;
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

/**
 * 显示标签日期或轻量标签的目标提交日期。
 * @param {TagInfo} tag - 当前标签
 * @returns {string} 可读的日期或缺失提示
 */
function formatTagDate(tag: TagInfo): string {
  if (!tag.date) return "时间未知";
  const date = new Date(tag.date);
  if (Number.isNaN(date.getTime())) return tag.date;
  return date.toLocaleString();
}

/**
 * 将提交行右键事件转发给外层共享菜单。
 * @param {MouseEvent} event - 行上的右键事件
 * @param {CommitInfo} commit - 当前提交
 * @returns {void} 转发上下文事件
 */
function relayContextMenu(event: MouseEvent, commit: CommitInfo): void {
  emit("contextmenu", event, commit);
}

watch(
  [() => props.active, queryKey],
  ([active, key]) => {
    if (!active || key === loadedQueryKey) return;
    loadedQueryKey = key;
    void loadReleaseHistory(true);
  },
  { immediate: true }
);

watch(
  () => repoStore.activeRepo?.id,
  () => {
    requestSequence++;
    targetTag.value = "";
    baseTag.value = "";
    commits.value = [];
    loadedQueryKey = "";
  }
);

watch(
  [() => props.active, tags],
  ([active, availableTags]) => {
    if (active && !targetTag.value && availableTags.length > 0) {
      targetTag.value = availableTags[0].name;
    }
  },
  { immediate: true }
);

watch(targetTag, (target) => {
  if (baseTag.value === target) baseTag.value = "";
});
</script>

<template>
  <div class="release-history-view">
    <div class="release-toolbar">
      <label>
        目标版本
        <select v-model="targetTag" :disabled="tags.length === 0">
          <option value="" disabled>选择标签</option>
          <option v-for="tag in tags" :key="tag.name" :value="tag.name">{{ tag.name }}</option>
        </select>
      </label>
      <label>
        基准版本
        <select v-model="baseTag" :disabled="!targetTag">
          <option value="">不设基准</option>
          <option v-for="tag in baseOptions" :key="tag.name" :value="tag.name">{{ tag.name }}</option>
        </select>
      </label>
      <span v-if="targetTag" class="release-range-hint">
        {{ baseTag ? `${baseTag}..${targetTag}` : `截至 ${targetTag}` }}
      </span>
    </div>

    <div v-if="tags.length > 0" :key="repoStore.activeRepo?.id" class="release-timeline" aria-label="版本标签时间线">
      <button
        v-for="tag in tags"
        :key="tag.name"
        class="release-tag"
        :class="{ active: targetTag === tag.name }"
        :title="`${tag.name} · ${tag.subject} · ${formatTagDate(tag)}`"
        @click="targetTag = tag.name"
      >
        <span class="tag-dot" />
        <span class="tag-info">
          <strong>{{ tag.name }}</strong>
          <span>{{ formatTagDate(tag) }}</span>
          <small>{{ tag.commit_hash.slice(0, 8) }} · {{ tag.subject }}</small>
        </span>
      </button>
    </div>

    <div v-if="queryError" class="release-error">{{ queryError }}</div>
    <HistoryCommitRows
      :key="queryKey"
      :commits="commits"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :selected-hash="selectionStore.commitRepositoryPath === repoStore.activeRepo?.path ? selectionStore.commitHash : null"
      :empty-message="repoStore.activeRepo ? '这个版本范围内没有提交' : '打开仓库后查看版本历史'"
      @select="emit('select', $event)"
      @load-more="loadReleaseHistory(false)"
      @contextmenu="relayContextMenu"
    />
  </div>
</template>

<style scoped>
.release-history-view {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.release-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-bottom: 1px solid var(--border-default);
}

.release-toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-secondary);
  font-size: 12px;
}

.release-toolbar select {
  max-width: 150px;
  padding: 4px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-primary);
  background: var(--bg-panel);
}

.release-range-hint {
  overflow: hidden;
  color: var(--fg-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-timeline {
  display: flex;
  max-height: 136px;
  flex-shrink: 0;
  gap: 6px;
  overflow-x: auto;
  padding: 8px;
  border-bottom: 1px solid var(--border-default);
}

.release-tag {
  display: flex;
  min-width: 180px;
  max-width: 240px;
  align-items: flex-start;
  gap: 8px;
  padding: 7px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  background: var(--bg-panel);
  text-align: left;
  cursor: pointer;
}

.release-tag:hover,
.release-tag.active {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.tag-dot {
  width: 8px;
  height: 8px;
  margin-top: 4px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent);
}

.tag-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.tag-info strong,
.tag-info span,
.tag-info small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-info strong {
  color: var(--fg-primary);
  font-size: 12px;
}

.tag-info span,
.tag-info small {
  color: var(--fg-tertiary);
  font-size: 10px;
}

.release-error {
  padding: 6px 10px;
  color: var(--danger);
  font-size: 12px;
}
</style>
