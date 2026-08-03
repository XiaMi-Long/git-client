<!--
  @component ThemeToggle
  @description 主题切换按钮，点击切换暗色/亮色，状态持久化到 localStorage
  @usage <ThemeToggle />
  @changeLog
    - 2026-07-29: Created. 初始实现主题切换按钮。
-->
<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";

const themeStore = useThemeStore();
</script>

<template>
  <button
    class="theme-toggle"
    :title="themeStore.isDark ? '切换到亮色主题' : '切换到暗色主题'"
    @click="themeStore.toggleTheme()"
  >
    <!-- 暗色时显示太阳（切到亮色），亮色时显示月亮（切到暗色） -->
    <svg
      v-if="themeStore.isDark"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
    <svg
      v-else
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
    <span>{{ themeStore.isDark ? "亮色" : "暗色" }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.theme-toggle:hover {
  background: var(--bg-elevated);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}
</style>
