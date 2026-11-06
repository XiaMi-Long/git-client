<!--
  App 根组件 - 挂载新 GitTrail 3.0 UI，初始化主题与设置。
  @changeLog
    - 2026-07-29: Created. 初始化根组件，挂载主题、布局占位。
    - 2026-07-29: Updated. 替换占位为三栏主视图 MainView。
    - 2026-07-29: Updated. 启动时恢复上次打开的仓库。
    - 2026-11-04: Updated. 直接替换旧 MainView，挂载 RewriteApp；仓库恢复移入新壳。
-->
<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import RewriteApp from "@/rewrite/RewriteApp.vue";

const themeStore = useThemeStore();
const settingsStore = useSettingsStore();

// 在首屏渲染前应用主题/密度和设置，避免新壳先以默认值闪一下
themeStore.initTheme();
settingsStore.load();
</script>

<template>
  <div class="app-container">
    <RewriteApp />
  </div>
</template>

<style scoped>
.app-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
