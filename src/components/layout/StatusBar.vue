<!--
  @component StatusBar
  @description
    状态栏 - 连接状态、操作加载提示（spinner + 文案）、领先 / 落后、冲突继续 / 中止、编码。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 连接状态与领先落后（5.4）、冲突继续 / 中止（12.4）。
    - 2026-07-29: Updated. 操作加载提示 spinner + 文案（A 状态栏加载提示系统）。
-->
<script setup lang="ts">
import { computed } from "vue";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";

const repoStore = useRepoStore();
const selectionStore = useSelectionStore();

const hasRepo = computed(() => !!repoStore.activeRepo);
const isConnected = computed(() => !!repoStore.activeRepo?.status?.upstream);
const ahead = computed(() => repoStore.activeRepo?.status?.ahead ?? 0);
const behind = computed(() => repoStore.activeRepo?.status?.behind ?? 0);
const isConflicted = computed(() => selectionStore.isConflicted);
const currentOp = computed(() => selectionStore.currentOp);

const connectionText = computed(() => {
  const repo = repoStore.activeRepo;
  if (!repo) return "未打开仓库";
  const upstream = repo.status?.upstream;
  if (upstream) return `已连接 ${upstream}`;
  return "无远程";
});

const conflictText = computed(() => {
  switch (selectionStore.operationState) {
    case "cherrypicking":
      return "cherry-pick 冲突";
    case "merging":
      return "合并冲突";
    case "rebasing":
      return "rebase 冲突";
    case "conflict":
      return "存在冲突";
    default:
      return "冲突中";
  }
});
</script>

<template>
  <div class="status-bar">
    <!-- 左：连接状态 -->
    <div class="left">
      <span class="status-dot" :class="{ connected: isConnected }" />
      <span>{{ connectionText }}</span>
    </div>

    <!-- 中：操作中 > 冲突 > 领先落后 -->
    <div class="center">
      <!-- 操作加载提示（最高优先级） -->
      <template v-if="currentOp">
        <span class="spinner" />
        <span class="op-text">{{ currentOp }}</span>
      </template>
      <!-- 冲突 -->
      <template v-else-if="isConflicted">
        <span class="conflict-text">⚠ {{ conflictText }}</span>
        <button class="op-btn" @click="selectionStore.continueOperation()">继续</button>
        <button class="op-btn danger" @click="selectionStore.abortOperation()">中止</button>
      </template>
      <!-- 领先 / 落后 -->
      <template v-else-if="hasRepo">
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

/* 操作加载提示 */
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.op-text {
  color: var(--accent);
}

.ahead {
  color: var(--success);
}

.behind {
  color: var(--warning);
}

.conflict-text {
  color: var(--danger);
}

.op-btn {
  height: 18px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 11px;
  cursor: pointer;
}

.op-btn:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.op-btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}

.right {
  color: var(--fg-tertiary);
}
</style>
