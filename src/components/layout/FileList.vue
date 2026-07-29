<!--
  @component FileList
  @description
    右侧上方 - 更改文件列表。
    工作区模式：已暂存 / 未暂存两组 + 文件级暂存操作（7.3 / 7.4）。
    提交模式：该提交的文件列表（8.4，从 commitFileDiffs 提取）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 工作区模式已暂存 / 未暂存两组与暂存操作（7.3 / 7.4）。
    - 2026-07-29: Updated. 提交模式文件列表（8.4）。
-->
<script setup lang="ts">
import { computed } from "vue";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { FileChangeType, FileDiff } from "@/types/git";

const repoStore = useRepoStore();
const selectionStore = useSelectionStore();

const staged = computed(() => repoStore.activeRepo?.status.staged ?? []);
const unstaged = computed(() => repoStore.activeRepo?.status.unstaged ?? []);
const untracked = computed(() => repoStore.activeRepo?.status.untracked ?? []);
const isWorking = computed(() => selectionStore.isWorkingMode);

// 提交模式的文件列表（从 commitFileDiffs 提取）
const commitFiles = computed(() => selectionStore.commitFileDiffs);

// 变更类型 -> 状态字母
function statusLetter(type: FileChangeType): string {
  const map: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    typechanged: "T",
    untracked: "?",
    conflicted: "!",
  };
  return map[type] ?? "M";
}

// 变更类型 -> 状态色
function statusColor(type: FileChangeType): string {
  switch (type) {
    case "added":
      return "var(--success)";
    case "deleted":
      return "var(--danger)";
    case "untracked":
      return "var(--fg-tertiary)";
    default:
      return "var(--warning)";
  }
}

// FileDiff -> 状态字母（提交模式）
function diffStatusLetter(f: FileDiff): string {
  if (f.is_new) return "A";
  if (f.is_deleted) return "D";
  if (f.is_renamed) return "R";
  return "M";
}

function diffStatusColor(f: FileDiff): string {
  if (f.is_new) return "var(--success)";
  if (f.is_deleted) return "var(--danger)";
  if (f.is_renamed) return "var(--info)";
  return "var(--warning)";
}

function diffPath(f: FileDiff): string {
  return f.is_renamed ? `${f.old_path} -> ${f.new_path}` : f.new_path;
}
</script>

<template>
  <div class="file-list">
    <template v-if="isWorking">
      <!-- 已暂存组 -->
      <div class="group-header">
        <span>已暂存 ({{ staged.length }})</span>
        <button
          v-if="staged.length > 0"
          class="group-action"
          @click="selectionStore.unstageAll()"
        >
          全部取消暂存
        </button>
      </div>
      <div
        v-for="f in staged"
        :key="'s-' + f.path"
        class="file-item"
        :class="{ active: selectionStore.selectedFile === f.path }"
        @click="selectionStore.selectedFile = f.path"
      >
        <span class="file-status" :style="{ color: statusColor(f.change_type) }">
          {{ statusLetter(f.change_type) }}
        </span>
        <span class="file-path">{{ f.path }}</span>
        <button class="file-action" @click.stop="selectionStore.unstageFile(f.path)">
          取消暂存
        </button>
      </div>

      <!-- 未暂存组 -->
      <div class="group-header">
        <span>未暂存 ({{ unstaged.length + untracked.length }})</span>
        <button
          v-if="unstaged.length + untracked.length > 0"
          class="group-action"
          @click="selectionStore.stageAll()"
        >
          全部暂存
        </button>
      </div>
      <div
        v-for="f in unstaged"
        :key="'u-' + f.path"
        class="file-item"
        :class="{ active: selectionStore.selectedFile === f.path }"
        @click="selectionStore.selectedFile = f.path"
      >
        <span class="file-status" :style="{ color: statusColor(f.change_type) }">
          {{ statusLetter(f.change_type) }}
        </span>
        <span class="file-path">{{ f.path }}</span>
        <button class="file-action" @click.stop="selectionStore.stageFile(f.path)">
          暂存
        </button>
      </div>
      <div
        v-for="f in untracked"
        :key="'t-' + f.path"
        class="file-item"
        :class="{ active: selectionStore.selectedFile === f.path }"
        @click="selectionStore.selectedFile = f.path"
      >
        <span class="file-status" :style="{ color: statusColor(f.change_type) }">
          {{ statusLetter(f.change_type) }}
        </span>
        <span class="file-path">{{ f.path }}</span>
        <button class="file-action" @click.stop="selectionStore.stageFile(f.path)">
          暂存
        </button>
      </div>

      <!-- 空状态 -->
      <div
        v-if="staged.length === 0 && unstaged.length === 0 && untracked.length === 0"
        class="list-empty"
      >
        <p>工作区干净，无更改</p>
      </div>
    </template>

    <template v-else-if="selectionStore.commitHash">
      <!-- 提交模式文件列表 -->
      <div class="group-header">
        <span>更改文件 ({{ commitFiles.length }})</span>
      </div>
      <div
        v-for="f in commitFiles"
        :key="f.new_path + f.old_path"
        class="file-item"
        :class="{ active: selectionStore.selectedFile === diffPath(f) }"
        @click="selectionStore.selectedFile = diffPath(f)"
      >
        <span class="file-status" :style="{ color: diffStatusColor(f) }">
          {{ diffStatusLetter(f) }}
        </span>
        <span class="file-path">{{ diffPath(f) }}</span>
        <span class="file-stats">
          <span class="add">+{{ f.additions }}</span>
          <span class="del">-{{ f.deletions }}</span>
        </span>
      </div>
      <div v-if="commitFiles.length === 0" class="list-empty">
        <p>该提交无文件更改</p>
      </div>
    </template>

    <template v-else>
      <div class="panel-header">
        <span>更改文件</span>
      </div>
      <div class="list-empty">
        <p>选中提交或工作区后展示文件列表</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.file-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  overflow-y: auto;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  padding: 0 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-secondary);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}

.group-action {
  height: 18px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-tertiary);
  font-size: 11px;
  cursor: pointer;
}

.group-action:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  color: var(--fg-secondary);
  cursor: pointer;
  border-bottom: 1px solid var(--border-default);
}

.file-item:hover {
  background: var(--bg-elevated);
}

.file-item.active {
  background: var(--accent);
  color: #fff;
}

.file-item.active .file-action {
  color: #fff;
}

.file-status {
  width: 16px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.file-path {
  flex: 1;
  font-size: 13px;
  color: var(--fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item.active .file-path {
  color: #fff;
}

.file-stats {
  display: flex;
  gap: 6px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  flex-shrink: 0;
}

.file-stats .add {
  color: var(--success);
}

.file-stats .del {
  color: var(--danger);
}

.file-action {
  height: 20px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.file-action:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.panel-header {
  height: 28px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-secondary);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.list-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}
</style>
