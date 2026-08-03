<!--
  @component StashViewDialog
  @description
    查看存储（stash）改动弹窗。左侧文件列表（增删统计），右侧复用 DiffViewer 展示选中文件 diff。
  @usage
    <StashViewDialog :stash="stash" @close="..." />
  @changeLog
    - 2026-08-01: Created. 储藏功能 - 查看改动。
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import type { FileDiff, StashInfo } from "@/types/git";
import DiffViewer from "./DiffViewer.vue";

const props = defineProps<{ stash: StashInfo }>();
const emit = defineEmits<{ close: [] }>();

const repoStore = useRepoStore();

const show = ref(false);
const loading = ref(true);
const diffs = ref<FileDiff[]>([]);
const selectedFile = ref<string | null>(null);

// 文件列表展示名（重命名/删除/新增处理）
const fileLabel = (f: FileDiff) =>
  f.is_renamed ? `${f.old_path} → ${f.new_path}` : f.new_path || f.old_path;

onMounted(async () => {
  show.value = true;
  const path = repoStore.activeRepo?.path;
  if (path) {
    try {
      diffs.value = await invoke<FileDiff[]>("git_show_stash", {
        path,
        index: props.stash.index,
      });
      selectedFile.value = diffs.value.length > 0 ? fileLabel(diffs.value[0]) : null;
    } catch (e) {
      diffs.value = [];
    } finally {
      loading.value = false;
    }
  }
});

function close() {
  show.value = false;
  setTimeout(() => emit("close"), 150);
}
</script>

<template>
  <Teleport to="body">
    <div class="stash-view-overlay" :class="{ show }" @click.self="close">
      <div class="stash-view-dialog" :class="{ show }">
        <div class="dialog-title">
          <span class="title-text">存储内容：{{ stash.message }}</span>
          <span class="title-sub">{{ stash.index }} · 来源分支 {{ stash.branch }}</span>
          <button class="close-btn" @click="close">✕</button>
        </div>
        <div class="dialog-body">
          <div v-if="loading" class="loading-hint">加载中…</div>
          <div v-else-if="diffs.length === 0" class="loading-hint">该存储没有文件改动</div>
          <template v-else>
            <div class="file-list">
              <div
                v-for="(f, i) in diffs"
                :key="i"
                class="file-item"
                :class="{ active: fileLabel(f) === selectedFile }"
                :title="fileLabel(f)"
                @click="selectedFile = fileLabel(f)"
              >
                <span class="file-path">{{ fileLabel(f) }}</span>
                <span class="file-stats">
                  <span class="add">+{{ f.additions }}</span>
                  <span class="del">-{{ f.deletions }}</span>
                </span>
              </div>
            </div>
            <div class="diff-area">
              <DiffViewer :external-diffs="diffs" :external-file="selectedFile" />
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.stash-view-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 150ms ease;
}
.stash-view-overlay.show {
  opacity: 1;
}

.stash-view-dialog {
  width: 860px;
  height: 560px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  transform: scale(0.96);
  transition: transform 150ms ease;
}
.stash-view-dialog.show {
  transform: scale(1);
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
}
.title-text {
  font-size: 14px;
  font-weight: 500;
}
.title-sub {
  font-size: 12px;
  color: var(--fg-tertiary);
}
.close-btn {
  margin-left: auto;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 13px;
  cursor: pointer;
  border-radius: var(--ctrl-radius);
}
.close-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.loading-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}

.file-list {
  width: 260px;
  overflow-y: auto;
  border-right: 1px solid var(--border-default);
  flex-shrink: 0;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 100ms ease;
}
.file-item:hover {
  background: var(--bg-hover);
}
.file-item.active {
  background: var(--bg-selected, #2a3f5f);
}
.file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono-font-family, ui-monospace, monospace);
}
.file-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  font-size: 11px;
}
.file-stats .add {
  color: var(--diff-add-fg);
}
.file-stats .del {
  color: var(--diff-del-fg);
}

.diff-area {
  flex: 1;
  overflow: hidden;
}
</style>
