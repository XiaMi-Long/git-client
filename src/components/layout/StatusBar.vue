<!--
  @component StatusBar
  @description
    状态栏 - 连接状态、领先 / 落后计数、编码。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 接入仓库连接状态与领先 / 落后（5.4）。
-->
<script setup lang="ts">
import { computed } from "vue";
import { useRepoStore } from "@/stores/repo";

const repoStore = useRepoStore();

const hasRepo = computed(() => !!repoStore.activeRepo);
const isConnected = computed(() => !!repoStore.activeRepo?.status?.upstream);
const ahead = computed(() => repoStore.activeRepo?.status?.ahead ?? 0);
const behind = computed(() => repoStore.activeRepo?.status?.behind ?? 0);

const connectionText = computed(() => {
  const repo = repoStore.activeRepo;
  if (!repo) return "未打开仓库";
  const upstream = repo.status?.upstream;
  if (upstream) return `已连接 ${upstream}`;
  return "无远程";
});
</script>

<template>
  <div class="status-bar">
    <!-- 左：连接状态 -->
    <div class="left">
      <span class="status-dot" :class="{ connected: isConnected }" />
      <span>{{ connectionText }}</span>
    </div>
    <!-- 中：领先/落后 -->
    <div class="center">
      <template v-if="hasRepo">
        <span v-if="ahead > 0" class="ahead">领先 {{ ahead }}</span>
        <span v-if="behind > 0" class="behind">落后 {{ behind }}</span>
        <span v-if="ahead === 0 && behind === 0">-</span>
      </template>
      <template v-else>-</template>
    </div>
    <!-- 右：编码 -->
    <div class="right">UTF-8</div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 12px;
  background: var(--bg-base);
  border-top: 1px solid var(--border-default);
  font-size: 12px;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-tertiary);
}

.status-dot.connected {
  background: var(--success);
}

.center {
  flex: 1;
  text-align: center;
  color: var(--fg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.ahead {
  color: var(--success);
}

.behind {
  color: var(--warning);
}

.right {
  color: var(--fg-tertiary);
}
</style>
