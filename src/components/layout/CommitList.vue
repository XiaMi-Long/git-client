<!--
  @component CommitList
  @description
    提交列表区 - 分支范围切换、工作区伪节点、提交列表。
    含 mini 分支图谱（6.4，SVG 节点 + 连线 + 分支着色）、虚拟滚动（6.3）、提交右键 cherry-pick（11.1）。
  @workflow
    1. 仓库切换 -> loadCommits 加载第一页。
    2. 虚拟滚动：只渲染可视区 + 缓冲，滚动到底加载下一页（6.2 / 6.3）。
    3. computeGraph 计算每个提交的 lane 与父子连线，SVG 渲染图谱（6.4）。
    4. 右键提交 -> cherry-pick（11.1）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 提交列表渲染、分页、范围切换（6.x）、工作区伪节点（7.x）、提交右键（11.1）。
    - 2026-07-30: Updated. mini 图谱 + 分支着色 + 虚拟滚动（6.3 / 6.4）。
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
import SquashPickDialog from "./SquashPickDialog.vue";
import StashCreateDialog from "./StashCreateDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const settingsStore = useSettingsStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// 拉取 / 推送 / 压缩挑拣（从顶栏移入）
const pulling = ref(false);
const pushing = ref(false);
const squashOpen = ref(false);

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
  remotePullsLoaded.value = true;
  await loadRemotePulls();
}

// 设置展开方式为 auto 时自动展开；落后清零时重置
watch(showRemoteHint, (v) => {
  if (!v) {
    remotePullsOpen.value = false;
    remotePulls.value = [];
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

// 快捷键 Ctrl+P 拉取，Ctrl+Shift+P 推送
function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (e.shiftKey) handlePush();
    else handlePull();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// 点击外部关闭储藏下拉
function onDocDown(e: MouseEvent) {
  if (stashDropdownOpen.value && !(e.target as HTMLElement).closest(".stash-dropdown-wrap")) {
    stashDropdownOpen.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocDown));
onUnmounted(() => document.removeEventListener("mousedown", onDocDown));

const listEl = ref<HTMLElement | null>(null);

// 行高（与 CSS .commit-item height 一致）
const ROW_HEIGHT = 26;
// 虚拟滚动缓冲行数
const BUFFER = 8;

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

/** lane -> 颜色 */
function laneColor(lane: number): string {
  return BRANCH_COLORS[lane % BRANCH_COLORS.length];
}

/** 分支名 -> 颜色（ref 徽章用，按名 hash 分配稳定色） */
function branchColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
}

// ===== mini 图谱算法（6.4） =====
interface GraphNode {
  hash: string;
  lane: number;
  parents: { hash: string; lane: number; index: number }[];
}

/** 计算每个提交的 lane（列）与父子连线 */
function computeGraph(commits: CommitInfo[]): GraphNode[] {
  const indexMap = new Map<string, number>();
  commits.forEach((c, i) => indexMap.set(c.hash, i));
  // 每列活跃的"下一目标 hash"
  const lanes: string[] = [];
  return commits.map((c) => {
    // 找 c 是否已在某 lane（作为某提交的父）
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(c.hash);
    }
    const parents = c.parents.map((p, pi) => {
      let pl: number;
      if (pi === 0) {
        // 第一父继承当前 lane
        lanes[lane] = p;
        pl = lane;
      } else {
        // 第二父及以后，找或新建 lane
        pl = lanes.indexOf(p);
        if (pl === -1) {
          pl = lanes.length;
          lanes.push(p);
        }
      }
      return { hash: p, lane: pl, index: indexMap.get(p) ?? -1 };
    });
    return { hash: c.hash, lane, parents };
  });
}

const graph = computed(() => computeGraph(commitStore.commits));

// ===== 虚拟滚动（6.3） =====
const scrollTop = ref(0);
const viewportHeight = ref(600);

const totalHeight = computed(() => commitStore.commits.length * ROW_HEIGHT);
const visibleStart = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER)
);
const visibleEnd = computed(() =>
  Math.min(
    commitStore.commits.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + BUFFER
  )
);
const visibleCommits = computed(() =>
  commitStore.commits.slice(visibleStart.value, visibleEnd.value)
);
const offsetY = computed(() => visibleStart.value * ROW_HEIGHT);

// 图谱节点（可视区内）
const visibleNodes = computed(() =>
  visibleCommits.value.map((c, i) => {
    const gi = visibleStart.value + i;
    const lane = graph.value[gi]?.lane ?? 0;
    return { cx: lane * 4 + 6, cy: i * ROW_HEIGHT + 13, color: laneColor(lane) };
  })
);

// 图谱连线（可视区内，跨可视区截断到边缘）
const visibleEdges = computed(() => {
  const edges: { id: string; x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  const maxLocal = visibleCommits.value.length;
  visibleCommits.value.forEach((c, i) => {
    const gi = visibleStart.value + i;
    const node = graph.value[gi];
    if (!node) return;
    const fromX = node.lane * 4 + 6;
    const fromY = i * ROW_HEIGHT + 13;
    node.parents.forEach((p) => {
      if (p.index < 0) return;
      const pLocal = p.index - visibleStart.value;
      // 截断到可视区边缘
      const clamped = Math.max(0, Math.min(maxLocal, pLocal));
      edges.push({
        id: `${gi}-${p.hash}`,
        x1: fromX,
        y1: fromY,
        x2: p.lane * 4 + 6,
        y2: clamped * ROW_HEIGHT + 13,
        color: laneColor(p.lane),
      });
    });
  });
  return edges;
});

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

// 仓库切换时重置浏览状态并重新加载
watch(
  () => repoStore.activeRepo?.id,
  () => {
    commitStore.switchRepo();
  },
  { immediate: true }
);

// ===== 提交右键 cherry-pick（11.1） =====
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
    { label: "复制哈希", action: () => navigator.clipboard?.writeText(c.hash) },
  ];
}
</script>

<template>
  <div class="commit-list">
    <!-- 工具栏：拉取/推送/压缩挑拣 + 范围切换 -->
    <div class="toolbar">
      <div class="toolbar-left">
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
      </div>
      <div class="toolbar-right">
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
        <span v-if="commitStore.browseBranch" class="browse-hint">
          浏览: {{ commitStore.browseBranch }}
        </span>
      </div>
    </div>

    <!-- 工作区伪节点 -->
    <div
      class="working-node"
      :class="{ active: selectionStore.isWorkingMode }"
      @click="selectionStore.selectWorking()"
    >
      <span class="graph-col">◎</span>
      <span class="working-label">工作区</span>
      <span class="working-count" :class="{ 'has-changes': workingCount > 0 }">{{ workingCount }}</span>
    </div>

    <!-- 远程更新提示行（当前分支落后上游时显示） -->
    <div v-if="showRemoteHint" class="remote-hint-row">
      <button class="remote-hint" :class="{ open: remotePullsOpen }" @click="toggleRemotePulls">
        <span class="remote-hint-dot" />
        当前分支有 {{ currentBehind }} 条新提交可查看
        <span class="remote-hint-caret">{{ remotePullsOpen ? "▾" : "▸" }}</span>
      </button>
    </div>

    <!-- 远程待拉取提交列表（点击提示行后展开） -->
    <div v-if="remotePullsOpen" class="remote-pulls-panel">
      <div class="remote-pulls-header">
        <span>远程待拉取提交（{{ remotePulls.length }}）</span>
        <button class="rp-close" @click="remotePullsOpen = false">收起</button>
      </div>
      <div v-if="remotePullsLoading" class="load-hint">加载中…</div>
      <div v-else-if="remotePulls.length === 0" class="load-hint">没有待拉取提交</div>
      <div v-else class="remote-pulls-list">
        <div
          v-for="c in remotePulls"
          :key="c.hash"
          class="remote-pull-item"
          :class="{ active: selectionStore.commitHash === c.hash }"
          :title="c.subject"
          @click="selectionStore.selectCommit(c.hash)"
        >
          <span class="rp-hash">{{ c.short_hash }}</span>
          <span class="rp-subject">{{ c.subject }}</span>
          <span class="rp-author">{{ c.author_name }}</span>
          <span class="rp-date">{{ c.relative_date }}</span>
        </div>
      </div>
    </div>

    <!-- 提交列表（虚拟滚动） -->
    <div ref="listEl" class="commit-scroll" @scroll="onScroll">
      <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="virtual-translate" :style="{ transform: `translateY(${offsetY}px)` }">
          <!-- mini 图谱 SVG -->
          <svg
            class="graph-svg"
            :width="20"
            :height="visibleCommits.length * ROW_HEIGHT"
          >
            <line
              v-for="edge in visibleEdges"
              :key="edge.id"
              :x1="edge.x1"
              :y1="edge.y1"
              :x2="edge.x2"
              :y2="edge.y2"
              :stroke="edge.color"
              stroke-width="1.5"
            />
            <circle
              v-for="(n, i) in visibleNodes"
              :key="i"
              :cx="n.cx"
              :cy="n.cy"
              r="3"
              :fill="n.color"
            />
          </svg>

          <!-- 提交项 -->
          <div
            v-for="(c, i) in visibleCommits"
            :key="c.hash"
            class="commit-item"
            :class="{ active: selectionStore.commitHash === c.hash }"
            :title="c.subject"
            @click="selectionStore.selectCommit(c.hash)"
            @contextmenu="onCommitContextmenu($event, c)"
          >
            <span class="graph-col" />
            <span class="commit-hash">{{ c.short_hash }}</span>
            <span class="commit-subject">{{ c.subject }}</span>
            <span class="commit-refs">
              <span
                v-for="r in c.refs"
                :key="r"
                class="ref-badge"
                :style="{ background: branchColor(r) }"
              >{{ r }}</span>
            </span>
            <span class="commit-author">{{ c.author_name }}</span>
            <span class="commit-date">{{ c.relative_date }}</span>
          </div>
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
  border-radius: 2px;
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
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
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
}

.working-node {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.working-node:hover {
  background: var(--bg-elevated);
}

.working-node.active {
  background: var(--accent);
  color: #fff;
}

.graph-col {
  width: 20px;
  text-align: center;
  color: var(--accent);
  flex-shrink: 0;
}

.working-node.active .graph-col {
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
  border-radius: 3px;
  color: var(--info);
  font-size: 12.5px;
  cursor: pointer;
  padding: 2px 8px;
  transition: background 150ms ease, border-color 150ms ease;
}

.remote-hint:hover {
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
  justify-content: space-between;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--info);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.rp-close {
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 12px;
  cursor: pointer;
}

.rp-close:hover {
  color: var(--fg-primary);
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

/* mini 图谱 SVG，绝对定位在左侧 20px 列，z-index 高于提交项背景避免被覆盖 */
.graph-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 2;
}

.commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px;
  color: var(--fg-secondary);
  cursor: pointer;
  border-bottom: 1px solid var(--border-default);
  position: relative;
  z-index: 1;
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

.commit-hash {
  width: 56px;
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

.ref-badge {
  padding: 1px 6px;
  color: #fff;
  font-size: 11px;
  border-radius: 2px;
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
  width: 90px;
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
