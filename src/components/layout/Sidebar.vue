<!--
  @component Sidebar
  @description
    侧栏 - 分支 / 远程 / 标签 三组树形列表，支持分组折叠 / 展开。
    单击分支浏览其历史（6.6）；双击检出（9.2）；右键菜单：新建/检出/删除/重命名/合并/对比（9.x）。
    所有确认/消息弹窗统一用 ConfirmDialog（替代原生 message/confirm）。
  @changeLog
    - 2026-07-29: Created. 布局骨架与分组标题。
    - 2026-07-29: Updated. 分支/标签数据（5.4）、浏览（6.6）、右键与双击（9.x）。
    - 2026-07-30: Updated. 分组折叠/展开、hover --bg-hover、统一 ConfirmDialog 弹窗。
-->
<script setup lang="ts">
import { ref, computed } from "vue";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSelectionStore } from "@/stores/selection";
import type { BranchInfo } from "@/types/git";
import ContextMenu from "./ContextMenu.vue";
import PromptDialog from "./PromptDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();

const hasRepo = computed(() => !!repoStore.activeRepo);
const localBranches = computed(
  () => repoStore.activeRepo?.branches.filter((b) => !b.is_remote) ?? []
);
const remoteBranches = computed(
  () => repoStore.activeRepo?.branches.filter((b) => b.is_remote) ?? []
);
const tags = computed(() => repoStore.activeRepo?.tags ?? []);

// 分组折叠状态
const collapsed = ref({ branches: false, remotes: false, tags: false });
function toggleGroup(g: "branches" | "remotes" | "tags") {
  collapsed.value[g] = !collapsed.value[g];
}

// 右键菜单状态
const menu = ref<{ x: number; y: number; branch: BranchInfo } | null>(null);

// 输入对话框状态（新建/重命名）
const promptState = ref<{ title: string; default?: string; resolve: (v: string | null) => void } | null>(null);

// 确认/消息对话框状态
const dialogState = ref<{
  title: string;
  message: string;
  hideCancel?: boolean;
  danger?: boolean;
  resolve: (v: boolean) => void;
} | null>(null);

const currentBranchName = computed(
  () => repoStore.activeRepo?.branches.find((b) => b.is_current)?.name ?? null
);

function onBranchContextmenu(e: MouseEvent, branch: BranchInfo) {
  e.preventDefault();
  menu.value = { x: e.clientX, y: e.clientY, branch };
}

function closeMenu() {
  menu.value = null;
}

// 模态输入对话框（替代 Tauri 缺失的 prompt）
function showPrompt(title: string, def?: string): Promise<string | null> {
  return new Promise((resolve) => {
    promptState.value = { title, default: def, resolve };
  });
}

function onPromptConfirm(value: string) {
  promptState.value?.resolve(value);
  promptState.value = null;
}

function onPromptCancel() {
  promptState.value?.resolve(null);
  promptState.value = null;
}

// 统一确认/消息对话框
function showConfirm(title: string, msg: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    dialogState.value = { title, message: msg, danger, resolve: (v) => resolve(v) };
  });
}

function showMessage(title: string, msg: string): Promise<void> {
  return new Promise((resolve) => {
    dialogState.value = { title, message: msg, hideCancel: true, resolve: () => resolve(true) };
  });
}

function onDialogConfirm() {
  dialogState.value?.resolve(true);
  dialogState.value = null;
}

function onDialogCancel() {
  dialogState.value?.resolve(false);
  dialogState.value = null;
}

// ===== 分支操作 =====

async function handleNewBranch() {
  const name = await showPrompt("新建分支", "");
  if (!name) return;
  const checkout = await showConfirm("新建分支", "立即检出该分支？");
  const result = await selectionStore.createBranch(name, checkout);
  if (result) await showMessage(result.success ? "新建分支" : "失败", result.message);
}

async function handleCheckout(branch: BranchInfo) {
  const result = await selectionStore.checkoutBranch(branch.name);
  if (result && !result.success) await showMessage("检出失败", result.message);
}

async function handleDelete(branch: BranchInfo) {
  const ok = await showConfirm("删除分支", `确定删除分支 "${branch.name}"？`, true);
  if (!ok) return;
  const result = await selectionStore.deleteBranch(branch.name, false);
  if (result) await showMessage(result.success ? "删除分支" : "失败", result.message);
}

async function handleRename(branch: BranchInfo) {
  const newName = await showPrompt("重命名分支", branch.name);
  if (!newName || newName === branch.name) return;
  const result = await selectionStore.renameBranch(branch.name, newName);
  if (result) await showMessage(result.success ? "重命名分支" : "失败", result.message);
}

async function handleMerge(branch: BranchInfo) {
  const result = await selectionStore.mergeBranch(branch.name, false);
  if (result) await showMessage(result.success ? "合并" : "合并失败", result.message);
}

async function handleCompare(branch: BranchInfo) {
  const current = currentBranchName.value;
  if (!current) {
    await showMessage("分支对比", "未找到当前分支");
    return;
  }
  // 9.6 精确对比：branch 相对当前分支的领先/落后
  const result = await selectionStore.compareBranches(branch.name, current);
  if (result) {
    await showMessage(
      "分支对比",
      `${branch.name} 相对 ${current}\n领先 ${result.ahead}  落后 ${result.behind}`
    );
  }
}

function menuItems(branch: BranchInfo) {
  const isCurrent = branch.name === currentBranchName.value;
  const isRemote = branch.is_remote;
  return [
    { label: "检出", action: () => handleCheckout(branch), disabled: isCurrent },
    { label: "新建分支…", action: handleNewBranch },
    { label: "重命名…", action: () => handleRename(branch), disabled: isCurrent || isRemote },
    { label: "删除…", action: () => handleDelete(branch), disabled: isCurrent || isRemote, danger: true },
    { label: "", action: () => {}, divider: true },
    { label: "合并到当前", action: () => handleMerge(branch), disabled: isCurrent },
    { label: "与当前对比", action: () => handleCompare(branch), disabled: isCurrent },
  ];
}
</script>

<template>
  <div class="sidebar">
    <template v-if="hasRepo">
      <!-- 分支 -->
      <div class="group">
        <div class="group-header" @click="toggleGroup('branches')">
          <span class="caret">{{ collapsed.branches ? "▶" : "▾" }}</span>
          <span class="group-title">分支</span>
          <button class="group-add" title="新建分支" @click.stop="handleNewBranch">+</button>
        </div>
        <div v-show="!collapsed.branches" class="group-body">
          <div
            v-for="b in localBranches"
            :key="b.full_name"
            class="tree-node"
            :class="{ current: b.is_current, browsing: commitStore.browseBranch === b.name }"
            :title="b.subject"
            @click="commitStore.browseTo(b.name)"
            @dblclick="handleCheckout(b)"
            @contextmenu="onBranchContextmenu($event, b)"
          >
            <span class="node-dot" :class="{ current: b.is_current }" />
            <span class="node-label">{{ b.name }}</span>
          </div>
          <div v-if="localBranches.length === 0" class="empty-hint">暂无分支</div>
        </div>
      </div>

      <!-- 远程 -->
      <div class="group">
        <div class="group-header" @click="toggleGroup('remotes')">
          <span class="caret">{{ collapsed.remotes ? "▶" : "▾" }}</span>
          <span class="group-title">远程</span>
        </div>
        <div v-show="!collapsed.remotes" class="group-body">
          <div
            v-for="b in remoteBranches"
            :key="b.full_name"
            class="tree-node"
            :class="{ browsing: commitStore.browseBranch === b.name }"
            :title="b.subject"
            @click="commitStore.browseTo(b.name)"
            @contextmenu="onBranchContextmenu($event, b)"
          >
            <span class="node-dot remote" />
            <span class="node-label">{{ b.name }}</span>
          </div>
          <div v-if="remoteBranches.length === 0" class="empty-hint">暂无远程</div>
        </div>
      </div>

      <!-- 标签 -->
      <div class="group">
        <div class="group-header" @click="toggleGroup('tags')">
          <span class="caret">{{ collapsed.tags ? "▶" : "▾" }}</span>
          <span class="group-title">标签</span>
        </div>
        <div v-show="!collapsed.tags" class="group-body">
          <div
            v-for="t in tags"
            :key="t.name"
            class="tree-node"
            :title="t.subject"
          >
            <svg class="node-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            <span class="node-label">{{ t.name }}</span>
          </div>
          <div v-if="tags.length === 0" class="empty-hint">暂无标签</div>
        </div>
      </div>
    </template>

    <!-- 未打开仓库 -->
    <div v-else class="sidebar-empty">
      <p>点击 + 打开仓库</p>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems(menu.branch)"
      @close="closeMenu"
    />

    <!-- 输入对话框 -->
    <PromptDialog
      v-if="promptState"
      :title="promptState.title"
      :default="promptState.default"
      @confirm="onPromptConfirm"
      @cancel="onPromptCancel"
    />

    <!-- 确认/消息对话框 -->
    <ConfirmDialog
      v-if="dialogState"
      :title="dialogState.title"
      :message="dialogState.message"
      :hide-cancel="dialogState.hideCancel"
      :danger="dialogState.danger"
      @confirm="onDialogConfirm"
      @cancel="onDialogCancel"
    />
  </div>
</template>

<style scoped>
.sidebar {
  height: 100%;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-default);
  overflow-y: auto;
  padding: 8px 0;
}

.group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  color: var(--fg-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}

.group-header:hover {
  background: var(--bg-hover);
}

.group-title {
  flex: 1;
}

.caret {
  font-size: 10px;
  color: var(--fg-tertiary);
  width: 12px;
}

.group-add {
  width: 18px;
  height: 18px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 14px;
  cursor: pointer;
  border-radius: 2px;
}

.group-add:hover {
  background: var(--bg-elevated);
  color: var(--fg-primary);
}

.group-body {
  padding-left: 8px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px 0 12px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
}

.tree-node:hover {
  background: var(--bg-hover);
}

.tree-node.current {
  color: var(--fg-primary);
  font-weight: 500;
}

.tree-node.browsing {
  background: var(--accent);
  color: var(--fg-primary);
}

.node-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--fg-tertiary);
  flex-shrink: 0;
}

.node-dot.current {
  background: var(--accent);
  border-color: var(--accent);
}

.node-dot.remote {
  background: transparent;
  border-color: var(--fg-tertiary);
}

.node-icon {
  color: var(--fg-tertiary);
  flex-shrink: 0;
}

.node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  height: 26px;
  padding-left: 28px;
  display: flex;
  align-items: center;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.sidebar-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}
</style>
