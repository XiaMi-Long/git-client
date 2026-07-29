<!--
  @component CommitList
  @description
    提交列表区 - 分支范围切换、工作区伪节点、提交列表（含 mini 图谱列占位）。
    提交项右键：cherry-pick / 复制哈希（11.1）。
  @workflow
    1. 仓库切换 -> loadCommits 加载第一页。
    2. 滚动到底 -> loadMore 加载下一页（6.2）。
    3. 点击工作区伪节点 -> 进入工作区模式（7.2）。
    4. 右键提交 -> cherry-pick（11.1）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 提交列表渲染、分页、范围切换（6.x）、工作区伪节点（7.x）。
    - 2026-07-29: Updated. 提交右键 cherry-pick（11.1）。
-->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
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

// 未提交文件数
const workingCount = computed(() => {
  const s = repoStore.activeRepo?.status;
  if (!s) return 0;
  return s.staged.length + s.unstaged.length + s.untracked.length;
});

// 提交右键菜单
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

// 仓库切换时重新加载提交
watch(
  () => repoStore.activeRepo?.id,
  () => {
    commitStore.loadCommits();
  },
  { immediate: true }
);

// 滚动到底加载更多（6.2）
function onScroll() {
  const el = listEl.value;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
    commitStore.loadMore();
  }
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

    <!-- 工作区伪节点（7.1 / 7.2） -->
    <div
      class="working-node"
      :class="{ active: selectionStore.isWorkingMode }"
      @click="selectionStore.selectWorking()"
    >
      <span class="graph-col">◎</span>
      <span class="working-label">工作区</span>
      <span class="working-count" :class="{ 'has-changes': workingCount > 0 }">{{ workingCount }}</span>
    </div>

    <!-- 提交列表 -->
    <div ref="listEl" class="commit-scroll" @scroll="onScroll">
      <div
        v-for="c in commitStore.commits"
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
          <span v-for="r in c.refs" :key="r" class="ref-badge">{{ r }}</span>
        </span>
        <span class="commit-author">{{ c.author_name }}</span>
        <span class="commit-date">{{ c.relative_date }}</span>
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
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  border-radius: 2px;
  white-space: nowrap;
}

.commit-item.active .ref-badge {
  background: rgba(255, 255, 255, 0.3);
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
