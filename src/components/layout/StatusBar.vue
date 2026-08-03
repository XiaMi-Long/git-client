<!--
  @component StatusBar
  @description
    状态栏 - 分左右两区域。
    left：连接状态 -> loading -> 领先/落后 -> 冲突[继续][中止]（按序追加）
    right：UTF-8 编码
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 连接状态、领先落后、冲突继续/中止、加载提示。
    - 2026-07-30: Updated. 改为左右两区域，loading 不再居中，跟在连接状态后。
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
const isFetching = computed(() => repoStore.fetching);

// 汇总可拉取分支数（本地分支落后上游的数量）
const pullableCount = computed(
  () => repoStore.activeRepo?.branches.filter((b) => !b.is_remote && b.behind > 0).length ?? 0
);

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
    <!-- left 区域：连接状态 -> loading -> 领先落后 -> 冲突 -->
    <div class="left">
      <span class="status-dot" :class="{ connected: isConnected }" />
      <span>{{ connectionText }}</span>

      <!-- 操作加载提示（紧跟连接状态） -->
      <template v-if="currentOp">
        <span class="separator">|</span>
        <span class="spinner" />
        <span class="op-text">{{ currentOp }}</span>
      </template>

      <!-- 正在检查远程更新 -->
      <template v-else-if="isFetching">
        <span class="separator">|</span>
        <span class="spinner" />
        <span class="op-text">正在检查更新…</span>
      </template>

      <!-- 有分支可拉取汇总 -->
      <template v-else-if="pullableCount > 0">
        <span class="separator">|</span>
        <span class="behind">有 {{ pullableCount }} 个分支可拉取</span>
      </template>

      <!-- 冲突 -->
      <template v-else-if="isConflicted">
        <span class="separator">|</span>
        <span class="conflict-text">⚠ {{ conflictText }}</span>
        <button class="op-btn danger" @click="selectionStore.abortOperation()">中止合并</button>
      </template>

      <!-- 领先 / 落后 -->
      <template v-else-if="hasRepo && (ahead > 0 || behind > 0)">
        <span class="separator">|</span>
        <span v-if="ahead > 0" class="ahead">领先 {{ ahead }}</span>
        <span v-if="behind > 0" class="behind">落后 {{ behind }}</span>
      </template>
    </div>

    <!-- right 区域 -->
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
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
}

.right {
  flex-shrink: 0;
  color: var(--fg-tertiary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-tertiary);
  flex-shrink: 0;
}

.status-dot.connected {
  background: var(--success);
}

.separator {
  color: var(--fg-tertiary);
  opacity: 0.5;
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
  border-radius: var(--radius-sm);
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
</style>
