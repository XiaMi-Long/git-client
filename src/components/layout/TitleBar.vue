<!--
  @component TitleBar
  @description
    自定义窗口标题栏 - 独立一行（32px），位于顶栏上方。
    左侧：应用图标 + 标题「GitTrail」；右侧：最小化 / 最大化(还原) / 关闭。
    整行空白区域为窗口拖拽区域（data-tauri-drag-region），双击切换最大化/还原。
  @workflow
    1. 根元素加 data-tauri-drag-region 提供拖拽 + 双击最大化（Tauri 原生处理）。
    2. 窗口按钮调用 getCurrentWindow 的 minimize / toggleMaximize / close。
    3. 挂载时读取 isMaximized，监听 onResized 刷新，切换最大化/还原图标。
  @changeLog
    - 2026-08-04: Created. 无边框窗口自定义标题栏。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

// 是否处于最大化状态（决定最大化/还原图标）
const isMaximized = ref(false);

async function refreshMaxState() {
  isMaximized.value = await appWindow.isMaximized();
}

function onMinimize() {
  appWindow.minimize();
}

function onToggleMaximize() {
  appWindow.toggleMaximize();
}

function onClose() {
  appWindow.close();
}

// 窗口尺寸变化监听器的注销函数（Promise<UnlistenFn>）
let unlistenResized: Promise<() => void> | null = null;

onMounted(() => {
  refreshMaxState();
  // 窗口尺寸变化（含最大化/还原）时同步按钮图标
  unlistenResized = appWindow.onResized(() => {
    refreshMaxState();
  });
});

onUnmounted(() => {
  unlistenResized?.then((fn) => fn());
});
</script>

<template>
  <div class="title-bar" data-tauri-drag-region>
    <!-- 左侧：应用图标 + 标题（同为拖拽区域） -->
    <div class="title-left" data-tauri-drag-region>
      <svg
        class="app-logo"
        data-tauri-drag-region
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <!-- 类 Lucide git-branch：应用标识 -->
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <span class="app-title" data-tauri-drag-region>GitTrail</span>
    </div>

    <!-- 右侧：窗口控制按钮（非拖拽区域） -->
    <div class="window-controls">
      <button class="win-btn" title="最小化" @click="onMinimize">
        <svg
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
      </button>

      <button
        class="win-btn"
        :title="isMaximized ? '还原' : '最大化'"
        @click="onToggleMaximize"
      >
        <!-- 最大化 -->
        <svg
          v-if="!isMaximized"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="8" height="8" />
        </svg>
        <!-- 还原（两层重叠方框） -->
        <svg
          v-else
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          aria-hidden="true"
        >
          <path d="M3.5 3.5 h4 v4 h-4 z" />
          <path d="M2.5 2.5 v4 h4 v-4 z" />
        </svg>
      </button>

      <button class="win-btn close" title="关闭" @click="onClose">
        <svg
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M2 2 l6 6 M8 2 l-6 6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

/* 左侧标题区：整体可拖拽 */
.title-left {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  color: var(--fg-secondary);
  overflow: hidden;
}

.app-logo {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.app-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右侧窗口控制按钮 */
.window-controls {
  display: flex;
  height: 100%;
  flex-shrink: 0;
}

.win-btn {
  width: 46px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--fg-secondary);
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}

/* 窗口按钮图标固定 10px，避免 viewBox 撑开 */
.win-btn svg {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
}

.win-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

/* 关闭按钮：悬停危险红（桌面惯例） */
.win-btn.close:hover {
  background: #e81123;
  color: #fff;
}
</style>
