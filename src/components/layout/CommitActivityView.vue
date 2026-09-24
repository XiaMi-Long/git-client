<!--
  @component CommitActivityView
  @description
    展示最近 180 天的每日提交热力图，点击日期后浏览当天的提交。

  @usage
    <CommitActivityView :active="historyView === 'activity'" @select="selectCommit" />

  @dataFormat
    活动摘要为 CommitActivityDay 数组；当天提交仍使用统一 CommitInfo 和右侧 diff。

  @workflow
    1. 按仓库和分支范围请求最近 180 天的每日提交数量。
    2. 补齐零提交日期并绘制日历热力图。
    3. 点击日期后按同一范围、文本搜索和日期边界加载提交明细。

  @changeLog
    - 2026-09-24: Created. 新增每日提交活动热力图。
    - 2026-09-24: Updated. 热力图响应式铺满可用宽度并统一界面字号。
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useCommitStore } from "@/stores/commit";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { CommitActivityDay, CommitInfo, LogQuery } from "@/types/git";
import HistoryCommitRows from "./HistoryCommitRows.vue";

const props = defineProps<{
  /** 是否正在显示活动热力图 */
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
const activity = ref<CommitActivityDay[]>([]);
const activityLoading = ref(false);
const activityError = ref("");
const selectedDay = ref("");
const dayCommits = ref<CommitInfo[]>([]);
const dayLoading = ref(false);
const dayLoadingMore = ref(false);
const dayHasMore = ref(false);
const dayError = ref("");
let activitySequence = 0;
let daySequence = 0;
let loadedActivityKey = "";
let loadedDayKey = "";

// 活动范围只依赖仓库和分支；搜索词只过滤被选中的日期明细。
const activityKey = computed(() => JSON.stringify([
  repoStore.activeRepo?.id,
  repoStore.activeRepo?.path,
  commitStore.scope,
  commitStore.browseBranch,
]));
const dayQueryKey = computed(() => JSON.stringify([
  activityKey.value,
  selectedDay.value,
  commitStore.search,
]));
const dailyCounts = computed(() => new Map(activity.value.map((item) => [item.date, item.count])));

/**
 * 将本地日期格式化为 YYYY-MM-DD。
 * @param {Date} value - 要显示的日期
 * @returns {string} 日期键
 */
function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/**
 * 生成热力图需要的连续 180 天日期格。
 * @returns {Array<{ date: string; count: number; column: number; row: number }>} 连续日历格及网格位置
 */
function buildCalendarDays(): Array<{ date: string; count: number; column: number; row: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 179);
  const firstWeekday = (start.getDay() + 6) % 7;
  const days: Array<{ date: string; count: number; column: number; row: number }> = [];

  for (let index = 0; index < 180; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    days.push({
      date: dateKey(date),
      count: dailyCounts.value.get(dateKey(date)) ?? 0,
      column: Math.floor((firstWeekday + index) / 7) + 1,
      row: ((date.getDay() + 6) % 7) + 1,
    });
  }
  return days;
}

const calendarDays = computed(buildCalendarDays);
// 总数只统计当前热力图展示的 180 天，不包含为完整覆盖首日而多查的历史日期。
const displayedCommitCount = computed(() =>
  calendarDays.value.reduce((total, day) => total + day.count, 0)
);

/**
 * 查询最近 180 天的分支提交数量。
 * @returns {Promise<void>} 更新每日聚合结果或显示错误
 */
async function loadActivity(): Promise<void> {
  const repo = repoStore.activeRepo;
  if (!repo) {
    activity.value = [];
    activityError.value = "打开仓库后查看提交活动";
    activityLoading.value = false;
    return;
  }
  const sequence = ++activitySequence;
  activity.value = [];
  activityLoading.value = true;
  activityError.value = "";
  try {
    const result = await invoke<CommitActivityDay[]>("git_get_commit_activity", {
      path: repo.path,
      days: 180,
      branch: commitStore.queryBranch,
      allBranches: commitStore.queryAllBranches,
    });
    if (sequence !== activitySequence || repo.id !== repoStore.activeRepo?.id) return;
    activity.value = result;
  } catch (error) {
    if (sequence !== activitySequence || repo.id !== repoStore.activeRepo?.id) return;
    activity.value = [];
    activityError.value = String(error);
  } finally {
    if (sequence === activitySequence) activityLoading.value = false;
  }
}

/**
 * 查询当前选中日期的提交明细。
 * @param {boolean} [reset] - 是否从第一页重新读取
 * @returns {Promise<void>} 完成当前页或下一页查询
 */
async function loadDayCommits(reset = false): Promise<void> {
  const repo = repoStore.activeRepo;
  if (!repo || !selectedDay.value) {
    dayCommits.value = [];
    dayHasMore.value = false;
    dayError.value = "";
    dayLoading.value = false;
    dayLoadingMore.value = false;
    return;
  }

  const dayStart = new Date(`${selectedDay.value}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setTime(dayEnd.getTime() - 1000);

  if (reset) {
    daySequence++;
    dayCommits.value = [];
    dayHasMore.value = true;
    dayError.value = "";
  }

  const sequence = daySequence;
  const query: LogQuery = {
    skip: reset ? 0 : dayCommits.value.length,
    limit: 100,
    branch: commitStore.queryBranch,
    search: commitStore.search.trim() || null,
    all_branches: commitStore.queryAllBranches,
    since: dayStart.toISOString(),
    until: dayEnd.toISOString(),
  };

  if (reset) dayLoading.value = true;
  else dayLoadingMore.value = true;
  try {
    const result = await invoke<CommitInfo[]>("git_get_log", { path: repo.path, query });
    if (sequence !== daySequence || repo.id !== repoStore.activeRepo?.id) return;
    if (reset) dayCommits.value = result;
    else dayCommits.value.push(...result);
    dayHasMore.value = !query.search && result.length === query.limit;
  } catch (error) {
    if (sequence !== daySequence || repo.id !== repoStore.activeRepo?.id) return;
    dayError.value = String(error);
    if (reset) dayCommits.value = [];
    dayHasMore.value = false;
  } finally {
    if (sequence === daySequence) {
      dayLoading.value = false;
      dayLoadingMore.value = false;
    }
  }
}

/**
 * 选择日历中的某一天并载入提交明细。
 * @param {string} date - YYYY-MM-DD 日期键
 * @returns {void} 更新当前日期选择
 */
function selectDay(date: string): void {
  selectedDay.value = date;
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
  [() => props.active, activityKey],
  ([active, key]) => {
    if (!active || key === loadedActivityKey) return;
    loadedActivityKey = key;
    void loadActivity();
  },
  { immediate: true }
);

watch(
  [() => props.active, dayQueryKey],
  ([active, key]) => {
    if (!active || !selectedDay.value || key === loadedDayKey) return;
    loadedDayKey = key;
    void loadDayCommits(true);
  },
  { immediate: true }
);

watch(
  () => repoStore.activeRepo?.id,
  () => {
    activitySequence++;
    daySequence++;
    activity.value = [];
    selectedDay.value = "";
    dayCommits.value = [];
    loadedActivityKey = "";
    loadedDayKey = "";
  }
);
</script>

<template>
  <div class="activity-view">
    <div class="activity-header">
      <div>
        <strong>近 180 天</strong>
        <span>按提交时间统计 · {{ commitStore.scope === 'all' ? '所有分支' : (commitStore.browseBranch ?? '当前分支') }}</span>
      </div>
      <span v-if="commitStore.search" class="activity-state">搜索只筛选选中日期的明细</span>
      <span v-if="activityLoading" class="activity-state">加载中…</span>
      <span v-else-if="activityError" class="activity-error">{{ activityError }}</span>
      <span v-else-if="displayedCommitCount === 0" class="activity-state">近 180 天没有提交</span>
    </div>

    <div class="calendar-scroll">
      <div class="weekday-labels" aria-hidden="true">
        <span>一</span><span>三</span><span>五</span>
      </div>
      <div class="activity-calendar" aria-label="最近 180 天每日提交数量">
        <button
          v-for="day in calendarDays"
          :key="day.date"
          class="activity-cell"
          :class="[
            day.count === 0 ? 'heat-0' : day.count < 3 ? 'heat-1' : day.count < 6 ? 'heat-2' : day.count < 10 ? 'heat-3' : 'heat-4',
            { selected: selectedDay === day.date },
          ]"
          :style="{ gridColumn: day.column, gridRow: day.row }"
          :title="`${day.date} · ${day.count} 条提交`"
          :aria-label="`${day.date}，${day.count} 条提交`"
          @click="selectDay(day.date)"
        />
      </div>
    </div>

    <div class="activity-legend">
      <span>少</span><i class="heat-0" /><i class="heat-1" /><i class="heat-2" /><i class="heat-3" /><i class="heat-4" /><span>多</span>
      <span class="activity-count">{{ displayedCommitCount }} 条提交</span>
    </div>

    <div class="day-detail-header">
      <strong>{{ selectedDay || "选择日期查看提交" }}</strong>
      <span v-if="selectedDay">{{ dailyCounts.get(selectedDay) ?? 0 }} 条提交</span>
    </div>
    <div v-if="dayError" class="activity-error">{{ dayError }}</div>
    <HistoryCommitRows
      v-if="selectedDay"
      :key="dayQueryKey"
      :commits="dayCommits"
      :loading="dayLoading"
      :loading-more="dayLoadingMore"
      :has-more="dayHasMore"
      :selected-hash="selectionStore.commitRepositoryPath === repoStore.activeRepo?.path ? selectionStore.commitHash : null"
      :empty-message="'这一天没有匹配的提交'"
      @select="emit('select', $event)"
      @load-more="loadDayCommits(false)"
      @contextmenu="relayContextMenu"
    />
    <div v-else class="activity-empty">点击上方日期格查看当天提交</div>
  </div>
</template>

<style scoped>
.activity-view {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.activity-header,
.day-detail-header {
  display: flex;
  min-height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-secondary);
  font-size: 13px;
}

.activity-header > div {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;
}

.activity-header strong,
.day-detail-header strong {
  color: var(--fg-primary);
}

.activity-header span,
.day-detail-header span,
.activity-state {
  color: var(--fg-tertiary);
  font-size: 12px;
}

.activity-error {
  color: var(--danger) !important;
  font-size: 12px;
}

.calendar-scroll {
  display: flex;
  width: 100%;
  flex-shrink: 0;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 8px 4px;
}

.weekday-labels {
  display: grid;
  width: 16px;
  flex-shrink: 0;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 3px;
  padding-top: 1px;
  color: var(--fg-tertiary);
  font-size: 11px;
  line-height: 1;
}

.weekday-labels span:nth-child(2) {
  grid-row: 3;
}

.weekday-labels span:nth-child(3) {
  grid-row: 5;
}

.activity-calendar {
  display: grid;
  min-width: 360px;
  flex: 1;
  grid-template-columns: repeat(27, 16px);
  grid-template-rows: repeat(7, 16px);
  justify-content: space-between;
  gap: 3px;
  padding: 1px;
}

.activity-cell {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
}

.activity-legend i {
  width: 12px;
  height: 12px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
}

.activity-cell {
  cursor: pointer;
}

.activity-cell:hover,
.activity-cell.selected {
  outline: 1px solid var(--fg-primary);
  outline-offset: 1px;
}

.heat-0 {
  background: var(--bg-hover);
}

.heat-1 {
  background: #234f78;
}

.heat-2 {
  background: #2478a9;
}

.heat-3 {
  background: #2592a3;
}

.heat-4 {
  background: #39b77d;
}

.activity-legend {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 8px;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.activity-legend i {
  display: inline-block;
}

.activity-count {
  margin-left: auto;
}

.day-detail-header {
  margin-top: 2px;
  border-top: 1px solid var(--border-default);
}

.activity-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}
</style>
