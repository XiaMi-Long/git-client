<!--
  App 根组件 - 应用入口，负责主题属性挂载与全局布局容器
  @changeLog
    - 2026-07-29: Created. 初始化根组件，挂载主题、布局占位。
-->
<script setup lang="ts">
import { onMounted } from "vue";
import { useThemeStore } from "@/stores/theme";
import ThemeToggle from "@/components/ThemeToggle.vue";

const themeStore = useThemeStore();

onMounted(() => {
  themeStore.initTheme();
});
</script>

<template>
  <div class="app-container" :data-theme="themeStore.isDark ? 'dark' : 'light'">
    <!-- 主布局占位，后续替换为三栏布局 -->
    <div class="app-placeholder">
      <h1>Git 客户端</h1>
      <p>项目已初始化，等待实现三栏布局…</p>
      <div class="theme-row">
        <ThemeToggle />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
  color: var(--fg-primary);
}

.app-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
}

.app-placeholder h1 {
  font-size: 20px;
  font-weight: 600;
}

.app-placeholder p {
  font-size: 13px;
  color: var(--fg-secondary);
}

.theme-row {
  margin-top: 16px;
}
</style>
