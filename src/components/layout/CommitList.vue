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
import { message } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo } from "@/types/git";
import ContextMenu from "./ContextMenu.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();

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

// 仓库切换时重新加载提交
watch(
  () => repoStore.activeRepo?.id,
  () => {
    commitStore.loadCommits();
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
    await message(result.message, result.success ? "cherry-pick" : "cherry-pick 失败");
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
    <!-- 范围切换（6.5） -->
    <div class="scope-bar">
      <button
        class="scope-btn"
        :class="{ active: commitStore.scope === 'current' && !commitStore.browseBranch }"
        @click="commitStore.setScope('current')"
      >
        当前分支
      </button>
      <button
        class="scope-btn"
        :class="{ active: commitStore.scope === 'all' }"
        @click="commitStore.setScope('all')"
      >
        所有分支
      </button>
      <span v-if="commitStore.browseBranch" class="browse-hint">
        浏览: {{ commitStore.browseBranch }}
      </span>
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
  </div>
</template>

<style scoped>
.commit-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

.scope-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.scope-btn {
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

.scope-btn.active {
  background: var(--bg-elevated);
  color: var(--fg-primary);
  border-color: var(--border-strong);
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

/* mini 图谱 SVG，绝对定位在左侧 20px 列 */
.graph-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 0;
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
  background: var(--bg-elevated);
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
