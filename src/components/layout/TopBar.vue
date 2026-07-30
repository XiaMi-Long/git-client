<!--
  @component TopBar
  @description
    顶栏 - 仓库标签页 + 搜索框 + 主题切换 + 设置。
    拉取/推送/压缩挑拣已移至提交列表工具栏。
  @workflow
    1. [+] 打开仓库；标签可横向滚动（滚轮 y->x），边缘渐变遮罩。
    2. 搜索框 300ms 防抖驱动提交列表过滤（6.7）。
  @changeLog
    - 2026-07-29: Created.
    - 2026-07-30: Updated. actions 下移到提交列表工具栏，顶栏精简。
-->
<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import ThemeToggle from "@/components/ThemeToggle.vue";
import SettingsDialog from "./SettingsDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();

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

// 搜索（300ms 防抖）
const localSearch = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(localSearch, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    commitStore.setSearch(val);
  }, 300);
});

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

const settingsOpen = ref(false);

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

function onTabsWheel(e: WheelEvent) {
  const el = repoTabsEl.value;
  if (!el || e.deltaY === 0) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

watch(
  () => repoStore.repos.length,
  () => nextTick(() => updateScrollState()),
);

onMounted(() => nextTick(() => updateScrollState()));
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
          <span class="repo-close" @click.stop="handleCloseRepo(tab.id)"
            >×</span
          >
        </div>
        <button class="repo-tab-add" title="打开仓库" @click="handleOpenRepo">
          +
        </button>
      </div>
      <div v-if="canScrollLeft" class="scroll-fade left"></div>
      <div v-if="canScrollRight" class="scroll-fade right"></div>
    </div>

    <!-- 搜索 + 主题 + 设置 -->
    <div class="right">
      <div class="search-box">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="localSearch"
          type="text"
          placeholder="搜索提交信息 / 作者 / 哈希"
        />
      </div>
      <ThemeToggle />
      <button class="icon-btn" title="设置" @click="settingsOpen = true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
      <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
    </div>

    <!-- 错误提示条 -->
    <div v-if="errorMsg" class="error-bar">{{ errorMsg }}</div>
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
  flex: 0 1 70%;
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

.repo-tab.active {
  color: var(--fg-primary);
  border-bottom-color: var(--accent);
}

.repo-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  flex-shrink: 0;
}

.repo-tab-add:hover {
  background: var(--bg-elevated);
  color: var(--fg-primary);
}

/* 边缘渐变遮罩 */
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

/* 右侧 */
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
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
