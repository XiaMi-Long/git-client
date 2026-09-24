<!--
  @component CommitList
  @description
    提交列表区 - 分支范围切换、工作区伪节点、提交列表。
    含虚拟滚动（6.3）、提交右键 cherry-pick（11.1）。
  @workflow
    1. 仓库切换 -> loadCommits 加载第一页。
    2. 虚拟滚动：只渲染可视区 + 缓冲，滚动到底加载下一页（6.2 / 6.3）。
    3. 右键提交 -> cherry-pick（11.1）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 提交列表渲染、分页、范围切换（6.x）、工作区伪节点（7.x）、提交右键（11.1）。
    - 2026-07-30: Updated. mini 图谱 + 分支着色 + 虚拟滚动（6.3 / 6.4）。
    - 2026-08-15: Updated. 未推送提交集合上移到 commitStore，经典列表与泳道图共用单一数据源。
    - 2026-09-24: Updated. 移除经典列表左侧的分支图谱。
    - 2026-09-24: Updated. 增加日期分组、多视图选择器及扩展历史视图容器。
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSelectionStore } from "@/stores/selection";
import { useSettingsStore } from "@/stores/settings";
import { useDialog } from "@/composables/useDialog";
import type { CommitInfo } from "@/types/git";
import type { CommitHistoryView } from "@/stores/settings";
import ContextMenu from "./ContextMenu.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import SquashPickDialog from "./SquashPickDialog.vue";
import StashCreateDialog from "./StashCreateDialog.vue";
import CommitSwimlane from "./CommitSwimlane.vue";
import CommitHistoryViews from "./CommitHistoryViews.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const settingsStore = useSettingsStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// 拉取 / 推送 / 压缩挑拣（从顶栏移入）
const pulling = ref(false);
const pushing = ref(false);
const squashOpen = ref(false);
const viewPickerOpen = ref(false);
const viewPickerTrigger = ref<HTMLButtonElement | null>(null);
const viewPickerMenu = ref<HTMLElement | null>(null);
const groupByDate = ref(true); // 默认开启经典列表日期分组

const historyViewOptions: Array<{ mode: CommitHistoryView; label: string; description: string }> = [
  { mode: "classic", label: "提交列表", description: "按提交时间顺序浏览与搜索" },
  { mode: "swimlane", label: "作者泳道", description: "按作者查看提交分布" },
  { mode: "graph", label: "分支拓扑", description: "查看分支分叉与合并关系" },
  { mode: "file", label: "文件历史", description: "只看某个文件或目录的提交" },
  { mode: "release", label: "版本标签", description: "按标签浏览版本提交范围" },
  { mode: "activity", label: "提交活动", description: "查看近 180 天的每日提交" },
];

const currentHistoryView = computed(() =>
  historyViewOptions.find((option) => option.mode === settingsStore.commitHistoryView) ?? historyViewOptions[0]
);
const isSupplementaryView = computed(() =>
  !["classic", "swimlane"].includes(settingsStore.commitHistoryView)
);
const supplementaryView = computed(() =>
  isSupplementaryView.value
    ? settingsStore.commitHistoryView as Extract<CommitHistoryView, "graph" | "file" | "release" | "activity">
    : "graph"
);

// 储藏：下拉三选项 + 命名弹窗
const stashScope = ref<"unstaged" | "staged" | "all" | null>(null);
const stashDropdownOpen = ref(false);
const stashScopes: { key: "unstaged" | "staged" | "all"; label: string }[] = [
  { key: "unstaged", label: "储藏未暂存" },
  { key: "staged", label: "储藏暂存" },
  { key: "all", label: "储藏全部" },
];

function onStashCreated() {
  repoStore.refreshActive();
}

// 提交时间展示：按设置（相对 / 绝对时间）
function formatTime(c: CommitInfo): string {
  if (settingsStore.timeFormat !== "absolute") return c.relative_date;
  const d = new Date(c.author_date);
  if (isNaN(d.getTime())) return c.relative_date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 分支标签显示：所有分支视图显示全部 refs；浏览/当前分支视图只显示与当前视图分支相关的标签
function visibleRefs(c: CommitInfo): string[] {
  if (commitStore.scope === "all") return c.refs;
  const target = commitStore.browseBranch ?? currentBranch.value?.name;
  if (!target) return c.refs;
  return c.refs.filter((r) => {
    const clean = r.replace(/[()]/g, "").replace(/^origin\//, "");
    return clean === target;
  });
}

// ===== 远程更新提示（Step3） =====
// 当前分支落后上游时显示提示行，点击展开远程待拉取提交列表
const currentBranch = computed(
  () => repoStore.activeRepo?.branches.find((b) => b.is_current) ?? null
);
const currentBehind = computed(() => currentBranch.value?.behind ?? 0);
const currentRemoteRef = computed(() => currentBranch.value?.upstream ?? null);

const remotePulls = ref<CommitInfo[]>([]);
const remotePullsLoading = ref(false);
const remotePullsOpen = ref(false);
// 已加载过远程列表的标记（避免 auto 模式重复请求）
let remotePullsLoaded = false;

// 设置联动：开启且落后才显示提示行
const showRemoteHint = computed(
  () => settingsStore.enableRemoteHint && !!currentBranch.value && currentBehind.value > 0 && !!currentRemoteRef.value
);

async function loadRemotePulls() {
  const path = repoStore.activeRepo?.path;
  const branch = currentBranch.value;
  if (!path || !branch || !currentRemoteRef.value) return;
  remotePullsLoading.value = true;
  try {
    remotePulls.value = await invoke<CommitInfo[]>("git_get_log", {
      path,
      query: {
        skip: 0,
        limit: 50,
        branch: `${branch.name}..${currentRemoteRef.value}`,
        search: null,
        all_branches: false,
      },
    });
  } catch {
    remotePulls.value = [];
  } finally {
    remotePullsLoading.value = false;
  }
}

// 展开 / 收起
async function toggleRemotePulls() {
  if (remotePullsOpen.value) {
    remotePullsOpen.value = false;
    return;
  }
  remotePullsOpen.value = true;
  remotePullsLoaded = true;
  await loadRemotePulls();
}

// 设置展开方式为 auto 时自动展开；落后清零时重置
watch(showRemoteHint, (v) => {
  if (!v) {
    remotePullsOpen.value = false;
    remotePulls.value = [];
    remotePullsLoaded = false;
  } else if (settingsStore.remoteHintExpandMode === "auto" && !remotePullsLoaded) {
    remotePullsOpen.value = true;
    remotePullsLoaded = true;
    loadRemotePulls();
  }
});
// 切换分支时重置（当前分支变化 → 只显示提示文字，除非设置直接显示列表）
watch(
  () => currentBranch.value?.name,
  () => {
    remotePullsOpen.value = false;
    remotePulls.value = [];
    remotePullsLoaded = false;
    if (settingsStore.remoteHintExpandMode === "auto" && currentBehind.value > 0) {
      remotePullsOpen.value = true;
      remotePullsLoaded = true;
      loadRemotePulls();
    }
  }
);
watch(
  () => repoStore.activeRepo?.id,
  () => {
    remotePullsOpen.value = false;
    remotePulls.value = [];
    remotePullsLoaded = false;
  }
);

// 刷新仓库引用后，更新当前已展开的远程提交提示列表
watch(
  () => repoStore.activeRepo?.branches,
  (branches) => {
    if (branches && remotePullsOpen.value && showRemoteHint.value) {
      loadRemotePulls();
    }
  }
);

/**
 * 重新读取当前仓库的本地状态和当前 diff。
 * @returns {Promise<void>} 刷新完成
 */
async function handleRefresh(): Promise<void> {
  if (!repoStore.activeRepo || selectionStore.isBusy) return;
  await selectionStore.refreshLocalState();
}

/**
 * 获取远程引用并展示执行结果。
 * @returns {Promise<void>} Fetch 及结果提示完成
 */
async function handleFetchRemote(): Promise<void> {
  if (!repoStore.activeRepo || selectionStore.isBusy) return;
  // 等待 Fetch 与后续仓库刷新全部结束，再显示结果
  const result = await selectionStore.fetchRemote();
  if (result) {
    await showMessage(result.success ? "获取远程" : "获取远程失败", result.message);
  }
}

/**
 * 切换提交历史视图并关闭选择菜单。
 * @param {CommitHistoryView} mode - 目标提交历史视图
 * @returns {void} 持久化目标视图
 */
function selectHistoryView(mode: CommitHistoryView): void {
  settingsStore.setCommitHistoryView(mode);
  viewPickerOpen.value = false;
  nextTick(() => viewPickerTrigger.value?.focus());
}

/**
 * 将焦点移动到历史视图菜单中的指定项目。
 * @param {"first" | "last" | "selected"} target - 菜单焦点目标
 * @returns {void} 聚焦目标菜单项
 */
function focusHistoryMenuItem(target: "first" | "last" | "selected"): void {
  const items = Array.from(viewPickerMenu.value?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? []);
  if (items.length === 0) return;

  const selectedIndex = items.findIndex((item) => item.getAttribute("aria-checked") === "true");
  const index = target === "first" ? 0 : target === "last" ? items.length - 1 : Math.max(0, selectedIndex);
  items[index].focus();
}

/**
 * 展开或收起历史视图菜单，展开时聚焦当前视图。
 * @returns {void} 更新菜单状态并安排焦点
 */
function toggleHistoryViewPicker(): void {
  viewPickerOpen.value = !viewPickerOpen.value;
  if (viewPickerOpen.value) nextTick(() => focusHistoryMenuItem("selected"));
}

/**
 * 处理历史视图菜单的方向键和首尾导航。
 * @param {KeyboardEvent} event - 当前菜单键盘事件
 * @returns {void} 按键盘方向移动菜单焦点
 */
function onHistoryViewMenuKeydown(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(viewPickerMenu.value?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? []);
  if (items.length === 0) return;

  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex = currentIndex < 0 ? 0 : currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else if (event.key === "ArrowDown") nextIndex = (nextIndex + 1) % items.length;
  else nextIndex = (nextIndex - 1 + items.length) % items.length;
  items[nextIndex].focus();
}

/**
 * 焦点离开菜单后关闭菜单并保留新的焦点位置。
 * @param {FocusEvent} event - 当前焦点离开事件
 * @returns {void} 在焦点移出菜单时收起菜单
 */
function onHistoryViewMenuFocusout(event: FocusEvent): void {
  const nextTarget = event.relatedTarget as Node | null;
  if (nextTarget && viewPickerMenu.value?.contains(nextTarget)) return;
  viewPickerOpen.value = false;
}

/**
 * 从历史视图触发按钮用方向键打开菜单并定位首项或末项。
 * @param {KeyboardEvent} event - 当前触发按钮键盘事件
 * @returns {void} 按键盘方向打开并聚焦菜单
 */
function onHistoryViewTriggerKeydown(event: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  viewPickerOpen.value = true;
  const target = event.key === "ArrowUp" || event.key === "End" ? "last" : "first";
  nextTick(() => focusHistoryMenuItem(target));
}

async function handlePull() {
  if (pulling.value || !repoStore.activeRepo) return;
  pulling.value = true;
  try {
    const result = await selectionStore.pull();
    if (result) await showMessage(result.success ? "拉取" : "拉取失败", result.message);
  } finally {
    pulling.value = false;
  }
}

async function handlePush() {
  if (pushing.value || !repoStore.activeRepo) return;
  pushing.value = true;
  try {
    const result = await selectionStore.push();
    if (result) await showMessage(result.success ? "推送" : "推送失败", result.message);
  } finally {
    pushing.value = false;
  }
}

/**
 * 处理历史菜单 Escape 和 Git 拉取/推送快捷键。
 * @param {KeyboardEvent} e - 当前键盘事件
 * @returns {void} 关闭视图菜单或触发对应远程操作
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && viewPickerOpen.value) {
    viewPickerOpen.value = false;
    nextTick(() => viewPickerTrigger.value?.focus());
  }
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (e.shiftKey) handlePush();
    else handlePull();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// 点击外部关闭储藏下拉
/**
 * 点击下拉菜单外部时收起菜单。
 * @param {MouseEvent} e - 文档级鼠标事件
 * @returns {void} 关闭失焦的下拉菜单
 */
function onDocDown(e: MouseEvent): void {
  if (stashDropdownOpen.value && !(e.target as HTMLElement).closest(".stash-dropdown-wrap")) {
    stashDropdownOpen.value = false;
  }
  if (viewPickerOpen.value && !(e.target as HTMLElement).closest(".history-view-picker")) {
    viewPickerOpen.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocDown));
onUnmounted(() => document.removeEventListener("mousedown", onDocDown));

const listEl = ref<HTMLElement | null>(null);

// 行距（与 CSS .commit-item 实际行距一致：height 26px + 1px 下边距 = 27px）
const ROW_HEIGHT = 27;
// 虚拟滚动缓冲行数
const BUFFER = 8;

interface CommitDateRow {
  /** 行类型 */
  kind: "date";
  /** 虚拟滚动稳定键 */
  key: string;
  /** 日期分组标题 */
  label: string;
}

interface CommitEntryRow {
  /** 行类型 */
  kind: "commit";
  /** 虚拟滚动稳定键 */
  key: string;
  /** 提交数据 */
  commit: CommitInfo;
}

type CommitListRow = CommitDateRow | CommitEntryRow;

// 未提交文件数
const workingCount = computed(() => {
  const s = repoStore.activeRepo?.status;
  if (!s) return 0;
  return s.staged.length + s.unstaged.length + s.untracked.length;
});

// ===== 分支着色 =====
// 分支色板（暗色友好，高饱和便于区分）
const BRANCH_COLORS = [
  "#3b82f6", // 蓝
  "#4ec9b0", // 青
  "#dcdcaa", // 黄
  "#ce9178", // 橙
  "#b392f0", // 紫
  "#f48771", // 红
  "#9cdcfe", // 浅蓝
  "#c586c0", // 粉
];

/** 分支名 -> 颜色（ref 徽章用，按名 hash 分配稳定色） */
function branchColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
}

// ===== 虚拟滚动（6.3） =====
const scrollTop = ref(0);
const viewportHeight = ref(600);

/**
 * 构造经典列表的提交行和可选日期分组行。
 * @returns {CommitListRow[]} 当前已加载历史对应的虚拟行
 */
function buildCommitRows(): CommitListRow[] {
  const rows: CommitListRow[] = [];
  let previousDate = "";
  for (const commit of commitStore.commits) {
    const date = new Date(commit.commit_date);
    const dateKey = Number.isNaN(date.getTime()) ? commit.commit_date.slice(0, 10) : date.toLocaleDateString("sv-SE");
    if (groupByDate.value && dateKey !== previousDate) {
      const label = Number.isNaN(date.getTime())
        ? dateKey
        : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      rows.push({ kind: "date", key: `date-${dateKey}-${rows.length}`, label });
    }
    rows.push({ kind: "commit", key: commit.hash, commit });
    previousDate = dateKey;
  }
  return rows;
}

const listRows = computed(buildCommitRows);
const totalHeight = computed(() => listRows.value.length * ROW_HEIGHT);
const visibleStart = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER)
);
const visibleEnd = computed(() =>
  Math.min(
    listRows.value.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + BUFFER
  )
);
const visibleRows = computed(() => listRows.value.slice(visibleStart.value, visibleEnd.value));
const offsetY = computed(() => visibleStart.value * ROW_HEIGHT);

function onScroll() {
  const el = listEl.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  // 滚动到底加载更多（6.2）
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
    commitStore.loadMore();
  }
}

function updateViewport() {
  if (listEl.value) {
    viewportHeight.value = listEl.value.clientHeight;
  }
}

onMounted(() => updateViewport());
onUnmounted(() => {});

watch(
  () => settingsStore.commitHistoryView,
  () => nextTick(updateViewport)
);

// 仓库切换时重置浏览状态并重新加载
watch(
  () => repoStore.activeRepo?.id,
  () => {
    scrollTop.value = 0;
    if (listEl.value) listEl.value.scrollTop = 0;
    commitStore.switchRepo();
  },
  { immediate: true }
);

// ===== 提交右键 cherry-pick（11.1） =====
const commitMenu = ref<{ x: number; y: number; commit: CommitInfo } | null>(null);

/**
 * 比较仓库根路径，按 Windows 路径规则忽略大小写。
 * @param {string} firstPath - 第一个仓库根路径
 * @param {string | undefined} secondPath - 第二个仓库根路径
 * @returns {boolean} 两个路径是否指向同一个仓库
 */
function sameRepositoryPath(firstPath: string, secondPath: string | undefined): boolean {
  if (!secondPath) return false;
  const first = firstPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const second = secondPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsPath = /^[a-z]:\//i.test(first) || first.startsWith("//");
  return windowsPath
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

/**
 * 打开当前仓库提交的上下文菜单；外部仓库提交保持只读。
 * @param {MouseEvent} e - 提交行右键事件
 * @param {CommitInfo} c - 当前提交
 * @param {string} [repositoryPath] - 提交所属仓库
 * @returns {void} 显示可用于当前仓库的提交菜单
 */
function onCommitContextmenu(e: MouseEvent, c: CommitInfo, repositoryPath?: string): void {
  e.preventDefault();
  if (repositoryPath && !sameRepositoryPath(repositoryPath, repoStore.activeRepo?.path)) return;
  commitMenu.value = { x: e.clientX, y: e.clientY, commit: c };
}

/**
 * 选择历史视图中的提交，并使用事件携带的仓库上下文读取详情。
 * @param {string} hash - 完整提交哈希
 * @param {string} [repositoryPath] - 提交所属仓库；其他历史视图默认使用当前仓库
 * @returns {void} 更新右侧提交详情
 */
function selectHistoryCommit(hash: string, repositoryPath?: string): void {
  selectionStore.selectCommit(hash, repositoryPath);
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
  <div class="commit-list">
    <!-- 工具栏：仓库刷新、远程同步、压缩挑拣 + 范围切换 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <button
          class="tool-btn"
          :disabled="!repoStore.activeRepo || selectionStore.isBusy"
          @click="handleRefresh"
        >
          {{ selectionStore.currentOp === "刷新中" ? "刷新中…" : "刷新" }}
        </button>
        <button
          class="tool-btn"
          :disabled="!repoStore.activeRepo || selectionStore.isBusy"
          @click="handleFetchRemote"
        >
          {{ selectionStore.currentOp === "获取远程中" ? "获取中…" : "获取远程" }}
        </button>
        <button class="tool-btn" :disabled="!repoStore.activeRepo || pulling" @click="handlePull">
          {{ pulling ? "拉取中…" : "拉取" }}
        </button>
        <button class="tool-btn" :disabled="!repoStore.activeRepo || pushing" @click="handlePush">
          {{ pushing ? "推送中…" : "推送" }}
        </button>
        <button class="tool-btn" :disabled="!repoStore.activeRepo" @click="squashOpen = true">
          压缩挑拣
        </button>
        <!-- 储藏：下拉三选项 -->
        <div class="stash-dropdown-wrap">
          <button
            class="tool-btn"
            :disabled="!repoStore.activeRepo"
            @click="stashDropdownOpen = !stashDropdownOpen"
          >
            储藏 ▾
          </button>
          <div v-if="stashDropdownOpen" class="stash-dropdown">
            <button
              v-for="s in stashScopes"
              :key="s.key"
              class="stash-dropdown-item"
              @click="stashDropdownOpen = false; stashScope = s.key"
            >
              {{ s.label }}
            </button>
          </div>
        </div>
        <!-- 浏览提示：紧跟按钮区域，方便用户看到当前浏览的分支 -->
        <span v-if="commitStore.browseBranch && settingsStore.commitHistoryView !== 'release'" class="browse-hint">
          浏览: {{ commitStore.browseBranch }}
        </span>
      </div>
      <div class="toolbar-right">
        <div class="history-view-picker">
          <button
            ref="viewPickerTrigger"
            class="tool-btn history-view-trigger"
            :aria-expanded="viewPickerOpen"
            aria-haspopup="menu"
            aria-controls="history-view-menu"
            @click="toggleHistoryViewPicker"
            @keydown="onHistoryViewTriggerKeydown"
          >
            视图：{{ currentHistoryView.label }} ▾
          </button>
          <div
            v-show="viewPickerOpen"
            id="history-view-menu"
            ref="viewPickerMenu"
            class="history-view-menu"
            role="menu"
            aria-label="提交历史视图"
            @keydown="onHistoryViewMenuKeydown"
            @focusout="onHistoryViewMenuFocusout"
          >
            <button
              v-for="option in historyViewOptions"
              :key="option.mode"
              class="history-view-option"
              :class="{ selected: settingsStore.commitHistoryView === option.mode }"
              role="menuitemradio"
              :aria-checked="settingsStore.commitHistoryView === option.mode"
              @click="selectHistoryView(option.mode)"
            >
              <span class="view-option-copy">
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </span>
              <span v-if="settingsStore.commitHistoryView === option.mode" aria-hidden="true">✓</span>
            </button>
            <button
              v-if="settingsStore.commitHistoryView === 'classic'"
              class="history-group-option"
              role="menuitemcheckbox"
              :aria-checked="groupByDate"
              @click="groupByDate = !groupByDate"
            >
              <span>列表按日期分组</span>
              <span>{{ groupByDate ? "✓" : "" }}</span>
            </button>
          </div>
        </div>
        <span v-if="settingsStore.commitHistoryView === 'release'" class="scope-label">范围由标签选择</span>
        <template v-else>
        <button
          class="tool-btn"
          :class="{ active: commitStore.scope === 'current' && !commitStore.browseBranch }"
          @click="commitStore.setScope('current')"
        >
          当前分支
        </button>
        <button
          class="tool-btn"
          :class="{ active: commitStore.scope === 'all' }"
          @click="commitStore.setScope('all')"
        >
          所有分支
        </button>
        </template>
      </div>
    </div>

    <!-- 工作区伪节点 -->
    <div
      class="working-node"
      :class="{ active: selectionStore.isWorkingMode }"
      @click="selectionStore.selectWorking()"
    >
      <span class="working-label">工作区（分支：{{ currentBranch?.name ?? "-" }}）</span>
      <span class="working-count" :class="{ 'has-changes': workingCount > 0 }">{{ workingCount }}</span>
    </div>

    <!-- 远程更新提示行（点击展开/收起；面板展开后提示行仍保留，无独立收起按钮） -->
    <div
      v-if="showRemoteHint && settingsStore.remoteHintExpandMode === 'click'"
      class="remote-hint-row"
    >
      <button class="remote-hint" :class="{ open: remotePullsOpen }" @click="toggleRemotePulls">
        <span class="remote-hint-dot" />
        当前分支有 {{ currentBehind }} 条新提交可查看
        <span class="remote-hint-caret">{{ remotePullsOpen ? "▾" : "▸" }}</span>
      </button>
    </div>

    <!-- 远程待拉取提交列表（点击提示行后展开） -->
    <div v-if="remotePullsOpen && showRemoteHint" class="remote-pulls-panel">
      <div class="remote-pulls-header">
        <span class="rp-badge">远程拉取</span>
        <span>远程待拉取提交（{{ remotePulls.length }}）</span>
      </div>
      <div v-if="remotePullsLoading" class="load-hint">加载中…</div>
      <div v-else-if="remotePulls.length === 0" class="load-hint">没有待拉取提交</div>
      <div v-else class="remote-pulls-list">
        <div
          v-for="c in remotePulls"
          :key="c.hash"
          class="remote-pull-item"
          :class="{ active: selectionStore.commitHash === c.hash && selectionStore.commitRepositoryPath === repoStore.activeRepo?.path }"
          :title="c.subject"
          @click="selectionStore.selectCommit(c.hash)"
        >
          <span class="rp-hash">{{ c.short_hash }}</span>
          <span class="rp-subject">{{ c.subject }}</span>
          <span class="rp-author">{{ c.author_name }}</span>
          <span class="rp-date">{{ formatTime(c) }}</span>
        </div>
      </div>
    </div>

    <!-- 经典提交列表：日期分组与提交行共用固定行高的虚拟滚动 -->
    <div v-show="settingsStore.commitHistoryView === 'classic'" ref="listEl" class="commit-scroll" @scroll="onScroll">
      <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="virtual-translate" :style="{ transform: `translateY(${offsetY}px)` }">
          <template v-for="row in visibleRows" :key="row.key">
            <div v-if="row.kind === 'date'" class="date-group-row">{{ row.label }}</div>
            <div
              v-else
              class="commit-item"
              :class="{ active: selectionStore.commitHash === row.commit.hash && selectionStore.commitRepositoryPath === repoStore.activeRepo?.path }"
              :title="row.commit.subject"
              @click="selectionStore.selectCommit(row.commit.hash)"
              @contextmenu="onCommitContextmenu($event, row.commit)"
            >
              <span class="commit-hash">{{ row.commit.short_hash }}</span>
              <span class="commit-subject">{{ row.commit.subject }}</span>
              <span class="commit-refs">
                <span
                  v-for="r in visibleRefs(row.commit)"
                  :key="r"
                  class="ref-badge"
                  :style="{ background: branchColor(r) }"
                >{{ r }}</span>
                <span v-if="commitStore.unpushedHashes.has(row.commit.hash)" class="unpushed-badge" title="本地提交，尚未推送到远程">未推送</span>
              </span>
              <span class="commit-author">{{ row.commit.author_name }}</span>
              <span class="commit-date">{{ formatTime(row.commit) }}</span>
            </div>
          </template>
        </div>
      </div>

      <div v-if="commitStore.loadingMore" class="load-hint">加载中…</div>
      <div
        v-else-if="!commitStore.hasMore && commitStore.commits.length > 0"
        class="load-hint"
      >
        没有更多了
      </div>
      <div v-if="commitStore.loading" class="load-hint">加载中…</div>
      <div
        v-if="!commitStore.loading && commitStore.commits.length === 0"
        class="list-empty"
      >
        <p>{{ repoStore.activeRepo ? "暂无提交" : "打开仓库后展示提交历史" }}</p>
      </div>
    </div>

    <!-- 作者泳道保留其内部滚动位置 -->
    <CommitSwimlane v-show="settingsStore.commitHistoryView === 'swimlane'" />

    <!-- 分支拓扑、文件历史、版本标签和活动视图 -->
    <CommitHistoryViews
      v-show="isSupplementaryView"
      :mode="supplementaryView"
      :active="isSupplementaryView"
      @select="selectHistoryCommit"
      @contextmenu="onCommitContextmenu"
    />

    <!-- 提交右键菜单 -->
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

    <!-- 压缩挑拣弹窗 -->
    <SquashPickDialog v-if="squashOpen" @close="squashOpen = false" />
    <StashCreateDialog
      v-if="stashScope"
      :scope="stashScope"
      @close="stashScope = null"
      @created="onStashCreated"
    />
  </div>
</template>

<style scoped>
.commit-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-left {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.toolbar-left::-webkit-scrollbar {
  display: none;
}

.toolbar-right {
  flex-shrink: 0;
}

.history-view-picker {
  position: relative;
  flex-shrink: 0;
}

.history-view-trigger {
  white-space: nowrap;
}

.history-view-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 250px;
  padding: 4px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.history-view-option,
.history-group-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.history-view-option:hover,
.history-view-option.selected,
.history-group-option:hover {
  color: var(--fg-primary);
  background: var(--bg-hover);
}

.view-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.view-option-copy strong {
  font-size: 12px;
  font-weight: 500;
}

.view-option-copy small {
  overflow: hidden;
  color: var(--fg-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-group-option {
  margin-top: 4px;
  border-top: 1px solid var(--border-default);
  border-radius: 0;
  font-size: 11px;
}

.scope-label {
  padding: 0 6px;
  color: var(--fg-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

/* 储藏下拉 */
.stash-dropdown-wrap {
  position: relative;
}

.stash-dropdown {
  position: absolute;
  top: 28px;
  left: 0;
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  padding: 4px;
  z-index: 500;
}

.stash-dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  height: 28px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--fg-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background 100ms ease;
}

.stash-dropdown-item:hover {
  background: var(--bg-hover);
}

.tool-btn {
  height: 24px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

/* 图标按钮：紧凑方形，无文字 */
.tool-btn.icon-btn {
  width: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.tool-btn.active {
  background: var(--bg-elevated);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.browse-hint {
  margin-left: 8px;
  color: var(--accent);
  font-size: 12px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 3px;
  padding: 2px 8px;
  white-space: nowrap;
}

.working-node {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  margin: 0 6px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 150ms ease;
}

.working-node:hover {
  background: var(--bg-elevated);
}

.working-node.active {
  background: var(--accent);
  color: #fff;
}

.working-label {
  flex: 1;
  font-size: 13px;
}

.working-count {
  color: var(--fg-tertiary);
  font-size: 12px;
}

.working-count.has-changes {
  color: var(--warning);
}

.working-node.active .working-count {
  color: #fff;
}

/* 远程更新提示行：居中，系统蓝（暗色用亮蓝保证可读） */
.remote-hint-row {
  padding: 5px 8px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
  background: rgba(59, 130, 246, 0.1);
  flex-shrink: 0;
}

.remote-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--info);
  font-size: 12.5px;
  cursor: pointer;
  padding: 2px 8px;
  transition: background 150ms ease, border-color 150ms ease;
}

.remote-hint:hover,
.remote-hint.open {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.4);
}

.remote-hint-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--info);
  flex-shrink: 0;
}

.remote-hint-caret {
  font-size: 10px;
  color: var(--fg-tertiary);
}

/* 远程待拉取提交列表 */
.remote-pulls-panel {
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-panel);
  flex-shrink: 0;
  max-height: 220px;
  display: flex;
  flex-direction: column;
}

.remote-pulls-header {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  position: relative;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--info);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.rp-badge {
  padding: 0 8px;
  background: var(--info);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.remote-pulls-list {
  overflow-y: auto;
}

.remote-pull-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background 100ms ease;
}

.remote-pull-item:hover {
  background: var(--bg-hover);
}

.remote-pull-item.active {
  background: var(--bg-selected, #2a3f5f);
}

.rp-hash {
  color: var(--info);
  font-family: var(--mono-font-family, ui-monospace, monospace);
  font-size: 11px;
  flex-shrink: 0;
}

.rp-subject {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rp-author {
  color: var(--fg-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}

.rp-date {
  color: var(--fg-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}

.commit-scroll {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.virtual-spacer {
  position: relative;
}

.virtual-translate {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  margin: 0 6px 1px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  cursor: pointer;
  position: relative;
  z-index: 1;
  transition: background 120ms ease;
}

.commit-item:hover {
  background: var(--bg-hover);
}

.commit-item.active {
  background: var(--accent);
}

.commit-item.active .commit-hash,
.commit-item.active .commit-subject,
.commit-item.active .commit-author,
.commit-item.active .commit-date {
  color: #fff;
}

.date-group-row {
  display: flex;
  height: 26px;
  align-items: center;
  margin: 0 6px 1px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-tertiary);
  background: var(--bg-panel);
  font-size: 11px;
  font-weight: 600;
}

.commit-hash {
  width: 88px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  color: var(--fg-tertiary);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-subject {
  flex: 1;
  font-size: 13px;
  color: var(--fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-refs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 未推送提交徽章：绿色，表示本地领先上游的提交 */
.unpushed-badge {
  padding: 1px 7px;
  background: var(--badge-ahead-bg, #2ea87a);
  color: var(--badge-ahead-fg, #ffffff);
  font-size: 11px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.commit-item.active .unpushed-badge {
  opacity: 0.85;
}

.ref-badge {
  padding: 1px 7px;
  color: #fff;
  font-size: 11px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.commit-item.active .ref-badge {
  opacity: 0.85;
}

.commit-author {
  width: 80px;
  font-size: 12px;
  color: var(--fg-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.commit-date {
  width: 120px;
  font-size: 12px;
  color: var(--fg-tertiary);
  text-align: right;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
