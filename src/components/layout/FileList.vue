<!--
  @component FileList
  @description
    右侧上方 - 更改文件列表。
    冲突模式：冲突文件列表 + 标记已解决（12.2 / 12.3）。
    工作区模式：已暂存 / 未暂存两组 + 文件级暂存操作（7.3 / 7.4）。
    提交模式：该提交的文件列表（8.4）。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 工作区模式两组与暂存（7.x）、提交模式文件列表（8.4）。
    - 2026-07-29: Updated. 冲突模式冲突文件列表与标记已解决（12.2 / 12.3）。
-->
<script setup lang="ts">
import { ref, computed } from "vue";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import { useDialog } from "@/composables/useDialog";
import ConfirmDialog from "./ConfirmDialog.vue";
import type { FileChangeType, FileDiff } from "@/types/git";

const repoStore = useRepoStore();
const selectionStore = useSelectionStore();
const { dialogState, showConfirm, onConfirm, onCancel } = useDialog();

const staged = computed(() => repoStore.activeRepo?.status?.staged ?? []);
const unstaged = computed(() => repoStore.activeRepo?.status?.unstaged ?? []);
const untracked = computed(() => repoStore.activeRepo?.status?.untracked ?? []);
const isWorking = computed(() => selectionStore.isWorkingMode);
const isConflicted = computed(() => selectionStore.isConflicted);
const commitFiles = computed(() => selectionStore.commitFileDiffs);
// 冲突文件列表与展开状态
const conflictFiles = computed(() => selectionStore.conflictedFiles);
const conflictOpen = ref(true);

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

// 手动刷新冲突状态（外部解决冲突后点击）
async function refreshConflictState() {
  await selectionStore.loadOperationState();
  await repoStore.refreshActive();
}

// 放弃单个文件改动（未暂存 → 恢复；未跟踪 → 删除文件）
async function handleDiscardFile(filePath: string) {
  const ok = await showConfirm(
    "放弃改动",
    `确定放弃 "${filePath}" 的改动？\n未跟踪文件将被删除，不可恢复！`,
    true
  );
  if (!ok) return;
  await selectionStore.discardFile(filePath);
}

// 放弃全部未暂存改动（含未跟踪）
async function handleDiscardAll() {
  const ok = await showConfirm(
    "全部放弃",
    `将放弃所有未暂存 / 未跟踪的改动（共 ${unstaged.value.length + untracked.value.length} 个文件）\n未跟踪文件将被删除，不可恢复！`,
    true
  );
  if (!ok) return;
  await selectionStore.discardAll();
}
</script>

<template>
  <div class="file-list">
    <!-- 工作区模式（冲突时同样显示暂存区，冲突文件单独一组） -->
    <template v-if="isWorking || isConflicted">
      <!-- 冲突横幅（常驻，醒目） -->
      <div v-if="isConflicted" class="conflict-banner">
        <span class="conflict-banner-text">⚠ 合并冲突：{{ conflictFiles.length }} 个文件冲突</span>
        <div class="conflict-banner-actions">
          <button class="conflict-refresh" @click="refreshConflictState">刷新状态</button>
          <button class="conflict-abort" @click="selectionStore.abortOperation()">中止合并</button>
        </div>
      </div>

      <!-- 冲突文件列表（可展开 / 收起） -->
      <div
        v-if="isConflicted"
        class="group-header conflict-header"
        @click="conflictOpen = !conflictOpen"
      >
        <span>⚠ 冲突文件 ({{ conflictFiles.length }})</span>
        <span class="caret">{{ conflictOpen ? "▾" : "▶" }}</span>
      </div>
      <template v-if="isConflicted && conflictOpen">
        <div v-for="f in conflictFiles" :key="f" class="file-item conflict" :title="f">
          <span class="file-status" style="color: var(--danger)">!</span>
          <span class="file-path">{{ f }}</span>
        </div>
      </template>

      <div class="group-header">
        <span>已暂存 ({{ staged.length }})</span>
        <button v-if="staged.length > 0" class="group-action" @click="selectionStore.unstageAll()">
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
        <button class="file-action" @click.stop="selectionStore.unstageFile(f.path)">取消暂存</button>
      </div>

      <div class="group-header">
        <span>未暂存 ({{ unstaged.length + untracked.length }})</span>
        <div class="group-actions">
          <button
            v-if="unstaged.length + untracked.length > 0"
            class="group-action"
            @click="selectionStore.stageAll()"
          >
            全部暂存
          </button>
          <button
            v-if="unstaged.length + untracked.length > 0"
            class="group-action danger"
            @click="handleDiscardAll"
          >
            全部放弃
          </button>
        </div>
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
        <button class="file-action" @click.stop="selectionStore.stageFile(f.path)">暂存</button>
        <button class="file-action discard" title="放弃该文件的改动" @click.stop="handleDiscardFile(f.path)">
          放弃
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
        <button class="file-action" @click.stop="selectionStore.stageFile(f.path)">暂存</button>
        <button class="file-action discard" title="删除该未跟踪文件" @click.stop="handleDiscardFile(f.path)">
          删除
        </button>
      </div>

      <div
        v-if="!isConflicted && staged.length === 0 && unstaged.length === 0 && untracked.length === 0"
        class="list-empty"
      >
        <p>工作区干净，无更改</p>
      </div>
    </template>

    <template v-else-if="selectionStore.commitHash">
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
      <div class="panel-header"><span>更改文件</span></div>
      <div class="list-empty"><p>选中提交或工作区后展示文件列表</p></div>
    </template>
    <!-- 确认/消息对话框 -->
    <ConfirmDialog
      v-if="dialogState"
      :title="dialogState.title"
      :message="dialogState.message"
      :hide-cancel="dialogState.hideCancel"
      :danger="dialogState.danger"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
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

.conflict-header {
  color: var(--danger);
  cursor: pointer;
  user-select: none;
}

/* 冲突横幅（常驻醒目） */
.conflict-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(214, 61, 61, 0.15);
  border-bottom: 1px solid var(--danger);
  flex-shrink: 0;
}

.conflict-banner-text {
  color: var(--danger);
  font-size: 12px;
  font-weight: 500;
}

.conflict-banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.conflict-refresh {
  height: 20px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 150ms ease;
}

.conflict-refresh:hover {
  background: var(--danger);
  color: #fff;
}

.conflict-abort {
  height: 20px;
  padding: 0 10px;
  background: var(--danger);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 150ms ease;
}

.conflict-abort:hover {
  opacity: 0.85;
}

.caret {
  font-size: 10px;
  color: var(--fg-tertiary);
}

.group-action {
  height: 18px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-tertiary);
  font-size: 11px;
  cursor: pointer;
}

.group-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.group-action.danger {
  color: var(--danger);
  border-color: var(--danger);
}

.group-action.danger:hover {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
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

.file-item.conflict .file-path {
  color: var(--danger);
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
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.file-action:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.file-action.discard {
  color: var(--danger);
  border-color: var(--danger);
}

.file-action.discard:hover {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
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
