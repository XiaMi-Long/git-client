<!--
  @component CommitGraphView
  @description
    按提交父子关系显示完整分支拓扑图，图谱仅作为独立历史视图呈现。

  @usage
    <CommitGraphView :active="historyView === 'graph'" @select="selectCommit" />

  @dataFormat
    按页读取含 parents 与 refs 的 CommitInfo；拓扑边只连接真实父提交。

  @workflow
    1. 按当前分支范围、搜索词和拓扑顺序加载提交。
    2. 根据父提交关系分配泳道并绘制合并线。
    3. 选择节点后使用现有提交详情与 diff 面板。
    4. 滚动到已加载历史末尾时继续分页。

  @changeLog
    - 2026-09-24: Created. 新增独立分支拓扑视图。
    - 2026-09-24: Updated. 提交信息字号与普通历史列表保持一致。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useCommitStore } from "@/stores/commit";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo, LogQuery } from "@/types/git";

const props = defineProps<{
  /** 是否正在显示分支拓扑视图 */
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
const commits = ref<CommitInfo[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const queryError = ref("");
const scrollElement = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(500);
const ROW_HEIGHT = 36;
const BUFFER = 8;
const COLORS = ["#3b82f6", "#4ec9b0", "#dcdcaa", "#ce9178", "#b392f0", "#f48771", "#9cdcfe", "#c586c0"];
let requestSequence = 0;
let loadedQueryKey = "";

const queryKey = computed(() => JSON.stringify([
  repoStore.activeRepo?.id,
  repoStore.activeRepo?.path,
  commitStore.scope,
  commitStore.browseBranch,
  commitStore.search,
]));
const totalHeight = computed(() => commits.value.length * ROW_HEIGHT);
const visibleStart = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER));
const visibleEnd = computed(() => Math.min(
  commits.value.length,
  Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + BUFFER,
));
const visibleCommits = computed(() => commits.value.slice(visibleStart.value, visibleEnd.value));
const visibleHeight = computed(() => visibleCommits.value.length * ROW_HEIGHT);
const offsetY = computed(() => visibleStart.value * ROW_HEIGHT);

/**
 * 根据提交父关系分配泳道并记录父节点的位置。
 * @param {CommitInfo[]} history - 当前已加载的拓扑顺序提交
 * @returns {Array<{ lane: number; parents: Array<{ hash: string; lane: number; index: number }> }>} 每个提交的图谱坐标
 */
function buildGraphLayout(history: CommitInfo[]): Array<{
  lane: number;
  parents: Array<{ hash: string; lane: number; index: number }>;
}> {
  const lanes: Array<string | null> = [];
  const indices = new Map<string, number>(history.map((commit, index) => [commit.hash, index] as const));
  return history.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = commit.hash;
    }

    const parents = commit.parents.map((hash, parentIndex) => {
      let parentLane = lanes.indexOf(hash);
      if (parentLane < 0) {
        parentLane = parentIndex === 0 ? lane : lanes.indexOf(null);
        if (parentLane < 0) parentLane = lanes.length;
        lanes[parentLane] = hash;
      } else if (parentIndex === 0 && parentLane !== lane) {
        // 已有分支指向第一父提交时，把当前合并线汇入该泳道。
        lanes[lane] = null;
      }
      return { hash, lane: parentLane, index: indices.get(hash) ?? -1 };
    });

    if (commit.parents.length === 0) lanes[lane] = null;
    return { lane, parents };
  });
}

const graphLayout = computed(() => buildGraphLayout(commits.value));
const maxLane = computed(() => graphLayout.value.reduce((max, node) => Math.max(max, node.lane + 1), 2));
const graphWidth = computed(() => maxLane.value * 20 + 12);

/**
 * 根据提交行索引和父关系构造可视窗口内的图谱线段。
 * @returns {Array<{ id: string; path: string; color: string }>} SVG 路径数据
 */
function visibleEdges(): Array<{ id: string; path: string; color: string }> {
  const edges: Array<{ id: string; path: string; color: string }> = [];
  visibleCommits.value.forEach((commit, localIndex) => {
    const globalIndex = visibleStart.value + localIndex;
    const node = graphLayout.value[globalIndex];
    if (!node) return;
    node.parents.forEach((parent, parentIndex) => {
      const endIndex = parent.index < 0 ? visibleEnd.value : parent.index;
      const endLocalIndex = Math.max(localIndex + 1, Math.min(visibleCommits.value.length, endIndex - visibleStart.value));
      const x1 = node.lane * 20 + 8;
      const x2 = parent.lane * 20 + 8;
      const y1 = localIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = endLocalIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const curve = Math.max(8, Math.abs(x2 - x1) / 2);
      const direction = x2 >= x1 ? 1 : -1;
      edges.push({
        id: `${commit.hash}-${parent.hash}-${parentIndex}`,
        path: `M ${x1} ${y1} C ${x1 + curve * direction} ${y1}, ${x2 - curve * direction} ${y2}, ${x2} ${y2}`,
        color: COLORS[node.lane % COLORS.length],
      });
    });
  });
  return edges;
}

const edges = computed(visibleEdges);

/**
 * 加载拓扑顺序的提交页。
 * @param {boolean} [reset] - 是否从第一页重新读取
 * @returns {Promise<void>} 完成当前页或下一页查询
 */
async function loadGraphPage(reset = false): Promise<void> {
  if (!reset && (loading.value || loadingMore.value || !hasMore.value)) return;
  const repo = repoStore.activeRepo;
  if (!repo) {
    commits.value = [];
    hasMore.value = false;
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
  const query: LogQuery = {
    skip: reset ? 0 : commits.value.length,
    limit: 100,
    branch: commitStore.queryBranch,
    search: commitStore.search.trim() || null,
    all_branches: commitStore.queryAllBranches,
    topo_order: true,
  };
  if (reset) loading.value = true;
  else loadingMore.value = true;
  try {
    const result = await invoke<CommitInfo[]>("git_get_log", { path: repo.path, query });
    if (sequence !== requestSequence || repo.id !== repoStore.activeRepo?.id) return;
    if (reset) commits.value = result;
    else commits.value.push(...result);
    hasMore.value = !query.search && result.length === query.limit;
  } catch (error) {
    if (sequence !== requestSequence || repo.id !== repoStore.activeRepo?.id) return;
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
 * 处理滚动位置并在历史末尾加载下一页。
 * @param {Event} event - 拓扑图容器的滚动事件
 * @returns {void} 更新虚拟窗口并按需分页
 */
function onScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement;
  scrollTop.value = element.scrollTop;
  viewportHeight.value = element.clientHeight;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 60 && hasMore.value) {
    void loadGraphPage(false);
  }
}

/**
 * 为提交哈希计算稳定的 ref 徽章颜色。
 * @param {string} refName - Git ref 名称
 * @returns {string} 色板中的颜色
 */
function refColor(refName: string): string {
  let hash = 0;
  for (let index = 0; index < refName.length; index++) hash = (hash * 31 + refName.charCodeAt(index)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/**
 * 将提交行右键事件转发给外层共享菜单。
 * @param {MouseEvent} event - 行上的右键事件
 * @param {CommitInfo} commit - 当前提交
 * @returns {void} 转发上下文事件
 */
function relayContextMenu(event: MouseEvent, commit: CommitInfo): void {
  event.preventDefault();
  emit("contextmenu", event, commit);
}

watch(
  [() => props.active, queryKey],
  ([active, key]) => {
    if (!active || key === loadedQueryKey) return;
    loadedQueryKey = key;
    scrollTop.value = 0;
    if (scrollElement.value) scrollElement.value.scrollTop = 0;
    void loadGraphPage(true);
  },
  { immediate: true }
);

watch(
  () => props.active,
  (active) => {
    if (!active) return;
    nextTick(() => {
      if (scrollElement.value) viewportHeight.value = scrollElement.value.clientHeight;
    });
  }
);

watch(
  () => repoStore.activeRepo?.id,
  () => {
    requestSequence++;
    commits.value = [];
    scrollTop.value = 0;
    hasMore.value = false;
    loadedQueryKey = "";
  }
);
</script>

<template>
  <div class="commit-graph-view">
    <div class="graph-header">
      <span>分支拓扑 · 按提交父关系排列</span>
      <span v-if="loading">加载中…</span>
      <span v-else-if="queryError" class="graph-error">{{ queryError }}</span>
    </div>
    <div ref="scrollElement" class="graph-scroll" @scroll="onScroll">
      <div class="graph-spacer" :style="{ height: `${totalHeight}px` }">
        <div class="graph-window" :style="{ transform: `translateY(${offsetY}px)`, height: `${visibleHeight}px` }">
          <svg class="graph-lines" :width="graphWidth" :height="visibleHeight" aria-hidden="true">
            <path v-for="edge in edges" :key="edge.id" :d="edge.path" :stroke="edge.color" />
            <circle
              v-for="(commit, index) in visibleCommits"
              :key="commit.hash"
              :cx="(graphLayout[visibleStart + index]?.lane ?? 0) * 20 + 8"
              :cy="index * ROW_HEIGHT + ROW_HEIGHT / 2"
              r="4"
              :fill="COLORS[(graphLayout[visibleStart + index]?.lane ?? 0) % COLORS.length]"
            />
          </svg>
          <button
            v-for="commit in visibleCommits"
            :key="commit.hash"
            class="graph-row"
            :class="{ active: selectionStore.commitHash === commit.hash && selectionStore.commitRepositoryPath === repoStore.activeRepo?.path }"
            :style="{ paddingLeft: `${graphWidth + 8}px` }"
            :title="commit.subject"
            @click="emit('select', commit.hash)"
            @contextmenu="relayContextMenu($event, commit)"
          >
            <span class="graph-hash">{{ commit.short_hash }}</span>
            <span class="graph-subject">{{ commit.subject }}</span>
            <span class="graph-refs">
              <span v-for="refName in commit.refs.slice(0, 2)" :key="refName" :style="{ background: refColor(refName) }">{{ refName }}</span>
            </span>
            <span class="graph-author">{{ commit.author_name }}</span>
          </button>
        </div>
      </div>
      <div v-if="!loading && commits.length === 0" class="graph-empty">
        {{ repoStore.activeRepo ? '当前范围没有提交' : '打开仓库后查看分支拓扑' }}
      </div>
      <div v-else-if="loadingMore" class="graph-status">加载中…</div>
      <div v-else-if="!hasMore && commits.length > 0" class="graph-status">没有更多了</div>
    </div>
  </div>
</template>

<style scoped>
.commit-graph-view {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.graph-header {
  display: flex;
  min-height: 30px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-tertiary);
  font-size: 11px;
}

.graph-error {
  color: var(--danger);
}

.graph-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.graph-spacer {
  position: relative;
}

.graph-window {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
}

.graph-lines {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 2;
}

.graph-lines path {
  fill: none;
  stroke-width: 1.5;
}

.graph-row {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
  border: 0;
  color: var(--fg-secondary);
  background: var(--bg-base);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.graph-row:hover {
  background: var(--bg-hover);
}

.graph-row.active {
  color: #fff;
  background: var(--accent);
}

.graph-hash {
  width: 64px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--fg-tertiary);
  font: 12px "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  text-overflow: ellipsis;
}

.graph-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-refs {
  display: flex;
  max-width: 130px;
  gap: 3px;
  flex-shrink: 0;
  overflow: hidden;
}

.graph-refs span {
  max-width: 90px;
  overflow: hidden;
  padding: 1px 5px;
  border-radius: var(--radius-pill);
  color: #fff;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-author {
  width: 70px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--fg-tertiary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-row.active .graph-hash,
.graph-row.active .graph-subject,
.graph-row.active .graph-author {
  color: #fff;
}

.graph-empty,
.graph-status {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.graph-empty {
  position: absolute;
  inset: 0;
}
</style>
