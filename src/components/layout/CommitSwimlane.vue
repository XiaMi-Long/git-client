<!--
  @component CommitSwimlane
  @description
    提交历史泳道图（V2 模式）。行 = 提交（按时间，最新在上），列 = 作者泳道，
    每个提交显示在它作者的列里；同作者列内以极淡泳道线贯穿，一眼看出提交节奏。
    作者表头吸附顶部、时间列吸附左侧，横向可滚动（作者多时）。
  @features
    - 作者排序：当前用户（git config user.name）永远第一，其余按提交频率降序
    - 行虚拟滚动（纵向），列全量渲染（作者数量通常可控）
    - hover：整行高亮 + 圆点放大 + 行尾浮出 短hash·时间
    - 选中：整行 accent 实底白字（与 V1 一致），右侧 diff 联动
    - 右键：cherry-pick / 复制提交信息 / 复制哈希（复用 ContextMenu）
  @usage
    由 CommitList 在 settings.commitListMode === 'swimlane' 时渲染，替换经典列表体。
  @changeLog
    - 2026-08-09: Created. 泳道图 V2 首版。
    - 2026-08-15: Updated. 未推送提交徽章（本地领先上游），数据来自 commitStore.unpushedHashes。
    - 2026-08-15: Updated. 时间列加宽（默认 110px）并支持拖拽调节，与作者列一致。
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSelectionStore } from "@/stores/selection";
import { useSettingsStore } from "@/stores/settings";
import { useDialog } from "@/composables/useDialog";
import type { CommitInfo } from "@/types/git";
import ContextMenu from "./ContextMenu.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const settingsStore = useSettingsStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// ===== 行距 / 表头高度（与 CSS 一致） =====
const ROW_HEIGHT = 27; // 行 26px + 1px 下边距
const HEADER_H = 34;
const BUFFER = 8;

// ===== 作者排序：当前用户第一，其余按频率降序 =====
const currentUserName = ref<string | null>(null);

async function loadCurrentUser() {
  const path = repoStore.activeRepo?.path;
  if (!path) {
    currentUserName.value = null;
    return;
  }
  try {
    currentUserName.value = await invoke<string | null>("git_get_user_name", { path });
  } catch {
    currentUserName.value = null;
  }
}

watch(() => repoStore.activeRepo?.id, loadCurrentUser, { immediate: true });

const authors = computed(() => {
  const countMap = new Map<string, number>();
  for (const c of commitStore.commits) {
    countMap.set(c.author_name, (countMap.get(c.author_name) ?? 0) + 1);
  }
  const list = [...countMap.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  // 当前用户提到最前
  if (currentUserName.value) {
    const idx = list.findIndex(([name]) => name === currentUserName.value);
    if (idx > 0) {
      const [u] = list.splice(idx, 1);
      list.unshift(u);
    }
  }
  return list;
});

// ===== 作者颜色（复用 V1 分支色板，按名 hash 稳定分配） =====
const BRANCH_COLORS = [
  "#3b82f6", "#4ec9b0", "#dcdcaa", "#ce9178",
  "#b392f0", "#f48771", "#9cdcfe", "#c586c0",
];
function authorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
}

// ===== 时间显示：与经典列表一致，跟随设置（相对/绝对） =====
function formatTime(c: CommitInfo): string {
  if (settingsStore.timeFormat !== "absolute") return c.relative_date;
  const d = new Date(c.author_date);
  if (isNaN(d.getTime())) return c.relative_date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 作者过滤：点击表头只显示该作者的提交，再点取消 =====
const filterAuthor = ref<string | null>(null);
const filteredCommits = computed(() => {
  if (!filterAuthor.value) return commitStore.commits;
  return commitStore.commits.filter((c) => c.author_name === filterAuthor.value);
});

// 点击表头作者列：切换过滤
function toggleFilter(name: string) {
  filterAuthor.value = filterAuthor.value === name ? null : name;
  scrollTop.value = 0;
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
}

// ===== 列宽：时间列默认 110px、作者列默认 190px，均可拖拽调节 =====
const DEFAULT_COL_W = 190;
const DEFAULT_TIME_W = 110;
const colWidths = ref<Record<string, number>>({});
function colWidth(name: string): number {
  return colWidths.value[name] ?? DEFAULT_COL_W;
}
// 时间列宽（拖拽调节）
const timeWidth = ref(DEFAULT_TIME_W);
// 所有作者列总宽（表头/行 min-width 用）
const totalColWidth = computed(() =>
  authors.value.reduce((sum, [name]) => sum + colWidth(name), 0)
);

// 拖拽状态（time / author 两类）
type ColDrag =
  | { kind: "time"; startX: number; startW: number }
  | { kind: "author"; name: string; startX: number; startW: number };
let dragging: ColDrag | null = null;
function onTimeResizeStart(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  dragging = { kind: "time", startX: e.clientX, startW: timeWidth.value };
  document.body.classList.add("col-resizing");
}
function onColResizeStart(e: MouseEvent, name: string) {
  e.preventDefault();
  e.stopPropagation();
  dragging = { kind: "author", name, startX: e.clientX, startW: colWidth(name) };
  document.body.classList.add("col-resizing");
}
function onColResizeMove(e: MouseEvent) {
  if (!dragging) return;
  const delta = e.clientX - dragging.startX;
  if (dragging.kind === "time") {
    timeWidth.value = Math.min(240, Math.max(64, dragging.startW + delta));
  } else {
    colWidths.value = {
      ...colWidths.value,
      [dragging.name]: Math.max(80, dragging.startW + delta),
    };
  }
}
function onColResizeEnd() {
  if (dragging) {
    dragging = null;
    document.body.classList.remove("col-resizing");
  }
}
// ===== 行虚拟滚动（纵向，基于过滤后列表） =====
const scrollEl = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(600);

const N = computed(() => filteredCommits.value.length);
const visibleStart = computed(() =>
  Math.max(0, Math.floor((scrollTop.value - HEADER_H) / ROW_HEIGHT) - BUFFER)
);
const visibleEnd = computed(() =>
  Math.min(N.value, Math.ceil((scrollTop.value - HEADER_H + viewportH.value) / ROW_HEIGHT) + BUFFER)
);
const visibleCommits = computed(() =>
  filteredCommits.value.slice(visibleStart.value, visibleEnd.value)
);
const padTop = computed(() => visibleStart.value * ROW_HEIGHT);
const padBottom = computed(() => (N.value - visibleEnd.value) * ROW_HEIGHT);

function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
    commitStore.loadMore();
  }
}

function updateViewport() {
  if (scrollEl.value) viewportH.value = scrollEl.value.clientHeight;
}

// 仓库切换时滚动复位
watch(
  () => repoStore.activeRepo?.id,
  () => {
    scrollTop.value = 0;
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
  }
);

onMounted(() => {
  updateViewport();
  document.addEventListener("mousemove", onColResizeMove);
  document.addEventListener("mouseup", onColResizeEnd);
});
onUnmounted(() => {
  document.removeEventListener("mousemove", onColResizeMove);
  document.removeEventListener("mouseup", onColResizeEnd);
});

// ===== 选中 / hover =====
const hoverHash = ref<string | null>(null);
function isSelected(c: CommitInfo) {
  return selectionStore.commitHash === c.hash;
}

// ===== 右键菜单 =====
const commitMenu = ref<{ x: number; y: number; commit: CommitInfo } | null>(null);
function onCommitContextmenu(e: MouseEvent, c: CommitInfo) {
  e.preventDefault();
  commitMenu.value = { x: e.clientX, y: e.clientY, commit: c };
}
function closeCommitMenu() {
  commitMenu.value = null;
}
async function handleCherryPick(c: CommitInfo) {
  const result = await selectionStore.cherryPick(c.hash);
  if (result) {
    await showMessage(result.success ? "cherry-pick" : "cherry-pick 失败", result.message);
  }
}
function commitMenuItems(c: CommitInfo) {
  return [
    { label: "cherry-pick", action: () => handleCherryPick(c) },
    { label: "复制提交信息", action: () => navigator.clipboard?.writeText(c.body ? `${c.subject}\n\n${c.body}` : c.subject) },
    { label: "复制哈希", action: () => navigator.clipboard?.writeText(c.hash) },
  ];
}
</script>

<template>
  <div class="swimlane">
    <div ref="scrollEl" class="swimlane-scroll" @scroll="onScroll">
      <!-- 表头：时间列 + 作者列（sticky top，横向随内容滚动；点击列头过滤该作者，拖拽列边缘调宽） -->
      <div class="header-row" :style="{ minWidth: timeWidth + totalColWidth + 'px' }">
        <div class="time-cell header" :style="{ width: timeWidth + 'px' }">
          时间
          <span
            class="col-resizer"
            title="拖动调整列宽"
            @click.stop
            @mousedown="onTimeResizeStart($event)"
          />
        </div>
        <div
          v-for="[name, count] in authors"
          :key="name"
          class="author-cell header"
          :class="{ filtered: filterAuthor === name, dimmed: filterAuthor && filterAuthor !== name }"
          :style="{ width: colWidth(name) + 'px' }"
          :title="filterAuthor === name ? '点击取消过滤' : '点击只显示该作者的提交'"
          @click="toggleFilter(name)"
        >
          <span class="lane" :style="{ background: authorColor(name) }" />
          <span class="a-dot" :style="{ background: authorColor(name) }" />
          <span class="a-name">{{ name }}</span>
          <span v-if="name === currentUserName" class="me-tag">我</span>
          <span class="a-count">{{ count }}</span>
          <span
            class="col-resizer"
            title="拖动调整列宽"
            @click.stop
            @mousedown="onColResizeStart($event, name)"
          />
        </div>
      </div>

      <!-- 顶部占位（虚拟滚动） -->
      <div :style="{ height: padTop + 'px' }" />

      <!-- 提交行 -->
      <div
        v-for="c in visibleCommits"
        :key="c.hash"
        class="row"
        :class="{ active: isSelected(c) }"
        :style="{ minWidth: timeWidth + totalColWidth + 'px' }"
        @click="selectionStore.selectCommit(c.hash)"
        @contextmenu="onCommitContextmenu($event, c)"
        @mouseenter="hoverHash = c.hash"
        @mouseleave="hoverHash = null"
      >
        <div class="time-cell" :style="{ width: timeWidth + 'px' }">{{ formatTime(c) }}</div>
        <div v-for="[name] in authors" :key="name" class="author-cell" :style="{ width: colWidth(name) + 'px' }">
          <span class="lane" :style="{ background: authorColor(name) }" />
          <template v-if="c.author_name === name">
            <span class="dot" :class="{ grow: hoverHash === c.hash }" :style="{ background: authorColor(name) }" />
            <span class="subject" :title="c.subject">{{ c.subject }}</span>
            <span
              v-if="commitStore.unpushedHashes.has(c.hash)"
              class="unpushed-badge"
              title="本地提交，尚未推送到远程"
            >未推送</span>
          </template>
        </div>
        <!-- 行尾悬浮信息：sticky right，hover 时在行内浮出完整提交信息 -->
        <div class="row-tail" :class="{ show: hoverHash === c.hash && !isSelected(c) }">
          {{ c.subject }} · {{ c.short_hash }} · {{ formatTime(c) }}
        </div>
      </div>

      <!-- 底部占位（虚拟滚动） -->
      <div :style="{ height: padBottom + 'px' }" />

      <div v-if="commitStore.loadingMore" class="load-hint">加载中…</div>
      <div v-else-if="!commitStore.hasMore && N > 0" class="load-hint">没有更多了</div>
      <div v-if="commitStore.loading" class="load-hint">加载中…</div>
      <div v-if="!commitStore.loading && N === 0" class="list-empty">
        <p>{{ repoStore.activeRepo ? "暂无提交" : "打开仓库后展示提交历史" }}</p>
      </div>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      v-if="commitMenu"
      :x="commitMenu.x"
      :y="commitMenu.y"
      :items="commitMenuItems(commitMenu.commit)"
      @close="closeCommitMenu"
    />

    <!-- 确认/消息对话框 -->
    <ConfirmDialog
      v-if="dialogState"
      :title="dialogState.title"
      :message="dialogState.message"
      :hide-cancel="dialogState.hideCancel"
      :danger="dialogState.danger"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
.swimlane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  min-width: 0;
}

.swimlane-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* ===== 表头 ===== */
.header-row {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  height: 34px;
  align-items: center;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.time-cell {
  position: sticky;
  left: 0;
  z-index: 20;
  flex-shrink: 0;
  padding: 0 8px;
  font-size: 11px;
  color: var(--fg-tertiary);
  background: var(--bg-base);
  border-right: 1px solid var(--border-default);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.time-cell.header {
  height: 34px;
  display: flex;
  align-items: center;
  background: var(--bg-panel);
  z-index: 40;
  /* 不裁剪列宽拖拽手柄 */
  overflow: visible;
}

.author-cell {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  min-width: 0;
}

.author-cell.header {
  height: 34px;
  color: var(--fg-primary);
  font-size: 12px;
  border-right: 1px solid var(--border-default);
  background: var(--bg-panel);
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease, opacity 120ms ease;
}

.author-cell.header:hover {
  background: var(--bg-hover);
}

/* 过滤状态：选中列高亮，其余列变暗 */
.author-cell.header.filtered {
  background: rgba(59, 130, 246, 0.14);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.author-cell.header.dimmed {
  opacity: 0.35;
}

/* 列宽拖拽手柄 */
.col-resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}

.col-resizer:hover {
  background: var(--accent);
  opacity: 0.5;
}

body.col-resizing {
  cursor: col-resize !important;
  user-select: none;
}

/* 泳道线：贯穿整个作者列，极淡 */
.lane {
  position: absolute;
  left: 11px;
  top: 0;
  bottom: 0;
  width: 1.5px;
  opacity: 0.13;
  pointer-events: none;
}

.header-row .lane {
  top: auto;
  bottom: 0;
  height: 6px;
}

/* 表头作者点 */
.a-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.a-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
}

.me-tag {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 10px;
  line-height: 15px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: #fff;
}

.a-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--fg-tertiary);
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
  padding: 0 6px;
  line-height: 15px;
}

/* ===== 提交行 ===== */
.row {
  display: flex;
  height: 26px;
  margin-bottom: 1px;
  align-items: center;
  cursor: pointer;
  transition: background 120ms ease;
}

.row:hover {
  background: var(--bg-hover);
}

.row:hover .time-cell {
  background: var(--bg-hover);
}

.row.active {
  background: var(--accent);
}

.row .time-cell {
  line-height: 26px;
}

.row.active .time-cell {
  color: rgba(255, 255, 255, 0.85);
  background: var(--accent);
  border-right-color: rgba(255, 255, 255, 0.25);
}

.row.active .lane {
  opacity: 0.35;
  background: #fff;
}

/* 提交点 */
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: 2px;
  transition: width 120ms ease, height 120ms ease;
}

.dot.grow {
  width: 11px;
  height: 11px;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.14);
}

.row.active .dot {
  background: #fff !important;
}

.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--fg-primary);
}

/* 未推送提交徽章：绿色，表示本地领先上游的提交（与经典列表一致） */
.unpushed-badge {
  flex-shrink: 0;
  padding: 1px 7px;
  background: var(--badge-ahead-bg, #2ea87a);
  color: var(--badge-ahead-fg, #ffffff);
  font-size: 11px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.row.active .unpushed-badge {
  opacity: 0.85;
}

.row.active .subject {
  color: #fff;
}

/* 行尾悬浮信息：吸附右侧可视区，在行内展示完整提交信息（非浮层卡片） */
.row-tail {
  position: sticky;
  right: 0;
  z-index: 15;
  flex-shrink: 0;
  max-width: 70%;
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--fg-secondary);
  background: var(--bg-hover);
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-tail.show {
  opacity: 1;
}

.load-hint {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.list-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}
</style>
