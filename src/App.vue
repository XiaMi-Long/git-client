<!--
  App 根组件 - 应用入口，负责主题属性挂载、主视图容器、恢复上次仓库
  @changeLog
    - 2026-07-29: Created. 初始化根组件，挂载主题、布局占位。
    - 2026-07-29: Updated. 替换占位为三栏主视图 MainView。
    - 2026-07-29: Updated. 启动时恢复上次打开的仓库。
-->
<script setup lang="ts">
import { onMounted } from "vue";
import { useThemeStore } from "@/stores/theme";
import { useRepoStore } from "@/stores/repo";
import { useSettingsStore } from "@/stores/settings";
import MainView from "@/views/MainView.vue";

const themeStore = useThemeStore();
const repoStore = useRepoStore();
const settingsStore = useSettingsStore();

onMounted(() => {
  themeStore.initTheme();
  settingsStore.load();
  // 恢复上次打开的仓库（异步，不阻塞渲染）
  repoStore.restoreRepos();
});
</script>

<template>
  <div class="app-container" :data-theme="themeStore.isDark ? 'dark' : 'light'">
    <MainView />
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
</style>
