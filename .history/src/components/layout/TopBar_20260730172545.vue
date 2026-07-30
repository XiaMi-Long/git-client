<!--
  @component TopBar
  @description
    顶栏 - 仓库标签页、分支下拉选择、拉取 / 推送按钮、搜索框、主题切换。
    拉取/推送结果用统一 ConfirmDialog 提示。
  @workflow
    1. [+] 按钮调系统目录选择对话框 -> openRepo。
    2. 分支按钮点击 -> 弹出分支下拉，选中即检出。
    3. 拉取 / 推送按钮（Ctrl+P / Ctrl+Shift+P）-> 调 git_pull / git_push，结果用 ConfirmDialog 提示。
    4. 搜索框 300ms 防抖驱动提交列表过滤（6.7）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 仓库打开、搜索、分支下拉、拉取推送（5.x / 6.7 / 9.2 / 10.x）。
    - 2026-07-30: Updated. 拉取/推送结果改用统一 ConfirmDialog（替代原生 message）。
-->
<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSelectionStore } from "@/stores/selection";
import { useDialog } from "@/composables/useDialog";
import ThemeToggle from "@/components/ThemeToggle.vue";
import ContextMenu from "./ContextMenu.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import SettingsDialog from "./SettingsDialog.vue";
import SquashPickDialog from "./SquashPickDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// 设置弹窗
const settingsOpen = ref(false);
// 压缩挑拣弹窗
const squashOpen = ref(false);

// 错误提示（如无效目录），3 秒后自动消失
const errorMsg = ref<string | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string) {
  errorMsg.value = msg;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    errorMsg.value = null;
  }, 3000);
}

// 当前分支名
const currentBranch = computed(() => {
  const repo = repoStore.activeRepo;
  if (!repo) return null;
  const branch = repo.branches.find((b) => b.is_current);
  return branch?.name ?? repo.status?.current_branch ?? null;
});

// ===== 分支下拉 =====
const branchMenu = ref<{ x: number; y: number } | null>(null);

function onBranchSelectClick(e: MouseEvent) {
  if (!currentBranch.value) return;
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  branchMenu.value = { x: rect.left, y: rect.bottom };
}

function closeBranchMenu() {
  branchMenu.value = null;
}

const branchItems = computed(() => {
  const branches = repoStore.activeRepo?.branches.filter((b) => !b.is_remote) ?? [];
  return branches.map((b) => ({
    label: b.name + (b.is_current ? "  ✓" : ""),
    action: () => {
      selectionStore.checkoutBranch(b.name);
    },
    disabled: b.is_current,
  }));
});

// ===== 拉取 / 推送 =====
const pulling = ref(false);
const pushing = ref(false);

async function handlePull() {
  if (pulling.value || !repoStore.activeRepo) return;
  pulling.value = true;
  try {
    const result = await selectionStore.pull();
    if (result) {
      await showMessage(result.success ? "拉取" : "拉取失败", result.message);
    }
  } finally {
    pulling.value = false;
  }
}

async function handlePush() {
  if (pushing.value || !repoStore.activeRepo) return;
  pushing.value = true;
  try {
    const result = await selectionStore.push();
    if (result) {
      await showMessage(result.success ? "推送" : "推送失败", result.message);
    }
  } finally {
    pushing.value = false;
  }
}

// 快捷键：Ctrl+P 拉取，Ctrl+Shift+P 推送
function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (e.shiftKey) handlePush();
    else handlePull();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  nextTick(() => updateScrollState());
});
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// ===== 搜索 =====
const localSearch = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(localSearch, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    commitStore.setSearch(val);
  }, 300);
});

// 打开仓库
async function handleOpenRepo() {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  try {
    await repoStore.openRepo(selected);
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

async function handleCloseRepo(id: string) {
  await repoStore.closeRepo(id);
}

function handleSwitchRepo(id: string) {
  repoStore.setActive(id);
}

// 仓库标签滚动：滚轮 y->x、边缘渐变遮罩
const repoTabsEl = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

function updateScrollState() {
  const el = repoTabsEl.value;
  if (!el) return;
  canScrollLeft.value = el.scrollLeft > 0;
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function onTabsScroll() {
  updateScrollState();
}

// 滚轮纵向滚动转为标签横向滚动
function onTabsWheel(e: WheelEvent) {
  const el = repoTabsEl.value;
  if (!el || e.deltaY === 0) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

watch(
  () => repoStore.repos.length,
  () => nextTick(() => updateScrollState())
);
</script>

<template>
  <div class="top-bar">
    <!-- 仓库标签页 -->
    <div class="repo-tabs-wrap">
      <div
        ref="repoTabsEl"
        class="repo-tabs"
        @scroll="onTabsScroll"
        @wheel="onTabsWheel"
      >
        <div
          v-for="tab in repoStore.repos"
          :key="tab.id"
          class="repo-tab"
          :class="{ active: tab.id === repoStore.activeId }"
          :title="tab.path"
          @click="handleSwitchRepo(tab.id)"
        >
          <span class="repo-tab-name">{{ tab.name }}</span>
          <span class="repo-close" @click.stop="handleCloseRepo(tab.id)">×</span>
        </div>
        <button class="repo-tab-add" title="打开仓库" @click="handleOpenRepo">+</button>
      </div>
      <div v-if="canScrollLeft" class="scroll-fade left"></div>
      <div v-if="canScrollRight" class="scroll-fade right"></div>
    </div>

    <!-- 当前分支 + 拉取/推送 -->
    <div class="actions">
      <button
        class="branch-select"
        :disabled="!currentBranch"
        :title="currentBranch ? '切换分支' : '未打开仓库'"
        @click="onBranchSelectClick"
      >
        <span class="branch-dot" />
        <span>{{ currentBranch ?? "未打开仓库" }}</span>
        <span class="caret">▾</span>
      </button>
      <button
        class="action-btn"
        title="拉取 (Ctrl+P)"
        :disabled="!repoStore.activeRepo || pulling"
        @click="handlePull"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{{ pulling ? "拉取中…" : "拉取" }}</span>
      </button>
      <button
        class="action-btn"
        title="推送 (Ctrl+Shift+P)"
        :disabled="!repoStore.activeRepo || pushing"
        @click="handlePush"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>{{ pushing ? "推送中…" : "推送" }}</span>
      </button>
      <button
        class="action-btn primary"
        title="压缩挑拣"
        :disabled="!repoStore.activeRepo"
        @click="squashOpen = true"
      >
        <span>压缩挑拣</span>
      </button>
    </div>

    <!-- 搜索框 + 主题 -->
    <div class="right">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input v-model="localSearch" type="text" placeholder="搜索提交信息 / 作者 / 哈希" />
      </div>
      <ThemeToggle />
      <button class="icon-btn" title="设置" @click="settingsOpen = true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
      <SquashPickDialog v-if="squashOpen" @close="squashOpen = false" />
    </div>

    <!-- 错误提示条 -->
    <div v-if="errorMsg" class="error-bar">{{ errorMsg }}</div>

    <!-- 分支下拉 -->
    <ContextMenu
      v-if="branchMenu"
      :x="branchMenu.x"
      :y="branchMenu.y"
      :items="branchItems"
      @close="closeBranchMenu"
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
.top-bar {
  display: flex;
  align-items: center;
  height: 40px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  padding: 0 8px;
  gap: 12px;
  flex-shrink: 0;
  position: relative;
}

/* 仓库标签页 */
.repo-tabs-wrap {
  position: relative;
  flex: 0 1 40%;
  min-width: 0;
  overflow: hidden;
}

.repo-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  height: 40px;
  scrollbar-width: none;
}

.repo-tabs::-webkit-scrollbar {
  display: none;
}

.repo-tab {
  flex-shrink: 0;
  height: 28px;
  padding: 0 8px 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--fg-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}

.repo-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 边缘渐变遮罩，暗示可滚动 */
.scroll-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 20px;
  pointer-events: none;
  z-index: 1;
}

.scroll-fade.left {
  left: 0;
  background: linear-gradient(to right, var(--bg-panel), transparent);
}

.scroll-fade.right {
  right: 0;
  background: linear-gradient(to left, var(--bg-panel), transparent);
}

.repo-tab.active {
  color: var(--fg-primary);
  border-bottom-color: var(--accent);
}

.repo-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  color: var(--fg-tertiary);
  font-size: 14px;
  opacity: 0;
}

.repo-tab:hover .repo-close {
  opacity: 1;
}

.repo-close:hover {
  background: var(--bg-elevated);
  color: var(--danger);
}

.repo-tab-add {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 16px;
  cursor: pointer;
  border-radius: 2px;
}

.repo-tab-add:hover {
  background: var(--bg-elevated);
  color: var(--fg-primary);
}

/* 操作区 */
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-primary);
  font-size: 13px;
  cursor: pointer;
}

.branch-select:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.branch-select:disabled {
  opacity: 0.5;
  cursor: default;
}

.branch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.caret {
  font-size: 10px;
  color: var(--fg-tertiary);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.action-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

/* 右侧 */
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  cursor: pointer;
  transition: all 150ms ease;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  width: 240px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-tertiary);
  transition: border-color 150ms ease;
}

.search-box:focus-within {
  border-color: var(--accent);
}

.search-box input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg-primary);
  font-size: 13px;
}

.search-box input::placeholder {
  color: var(--fg-tertiary);
}

/* 错误提示条 */
.error-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  transform: translateY(100%);
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  padding: 6px 12px;
  z-index: 10;
}
</style>
