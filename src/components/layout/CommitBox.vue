<!--
  @component CommitBox
  @description
    提交信息输入框与提交按钮，仅工作区模式显示。Ctrl+Enter 快捷提交。
  @usage <CommitBox />
  @changeLog
    - 2026-07-29: Created. 接入暂存提交（7.6）。
-->
<script setup lang="ts">
import { useSelectionStore } from "@/stores/selection";

const selectionStore = useSelectionStore();

async function onCommit() {
  await selectionStore.commit();
}

// Ctrl+Enter 快捷提交（冲突时禁用）
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    if (selectionStore.isConflicted) return;
    e.preventDefault();
    onCommit();
  }
}
</script>

<template>
  <div class="commit-box">
    <textarea
      v-model="selectionStore.commitMessage"
      class="commit-input"
      placeholder="提交信息…（Ctrl+Enter 提交）"
      rows="3"
      @keydown="onKeydown"
    />
    <button
      class="commit-btn"
      :disabled="!selectionStore.commitMessage.trim() || selectionStore.isConflicted"
      @click="onCommit"
    >
      {{ selectionStore.isConflicted ? "冲突中，无法提交" : "提交" }}
    </button>
  </div>
</template>

<style scoped>
.commit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-default);
  flex-shrink: 0;
}

.commit-input {
  resize: none;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-primary);
  font-size: 13px;
  padding: 6px 8px;
  outline: none;
  font-family: inherit;
}

.commit-input:focus {
  border-color: var(--accent);
}

.commit-input::placeholder {
  color: var(--fg-tertiary);
}

.commit-btn {
  align-self: flex-end;
  height: 28px;
  padding: 0 16px;
  background: var(--accent);
  border: none;
  border-radius: 2px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms ease;
}

.commit-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.commit-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
