<!--
  @component CommitDetailViewer
  @description
    提交详情查看器（模块化组件，Step4）。
    输入仓库路径 + 提交哈希，展示该提交的所有文件改动：
    左侧文件列表（增删统计），右侧 DiffViewer（统一/双栏/词级高亮）。
    可在 CommitList 提交查看、压缩挑拣弹窗、存储查看等场景复用。
  @usage
    <CommitDetailViewer :path="repoPath" :commit-hash="hash" />
  @changeLog
    - 2026-08-01: Created. 模块化拆分 - 提交详情查看。
-->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { FileDiff } from "@/types/git";
import DiffViewer from "./DiffViewer.vue";
import FileTypeIcon from "./FileTypeIcon.vue";

const props = defineProps<{
  /** 仓库路径 */
  path: string;
  /** 提交哈希；null 时显示空态 */
  commitHash: string | null;
}>();

const diffs = ref<FileDiff[]>([]);
const loading = ref(false);
const selectedFile = ref<string | null>(null);

const fileLabel = (f: FileDiff) =>
  f.is_renamed ? `${f.old_path} → ${f.new_path}` : f.new_path || f.old_path;

watch(
  () => props.commitHash,
  async (hash) => {
    if (!hash || !props.path) {
      diffs.value = [];
      selectedFile.value = null;
      return;
    }
    loading.value = true;
    try {
      const result = await invoke<FileDiff[]>("git_get_commit_diff", {
        path: props.path,
        commitHash: hash,
        filePath: null,
      });
      diffs.value = result;
      selectedFile.value = result.length > 0 ? fileLabel(result[0]) : null;
    } catch {
      diffs.value = [];
      selectedFile.value = null;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

const emptyText = computed(() =>
  !props.commitHash ? "点击左侧提交以查看详情" : loading.value ? "加载中…" : "该提交没有文件改动"
);
</script>

<template>
  <div class="commit-detail-viewer">
    <div v-if="!props.commitHash || loading || diffs.length === 0" class="viewer-empty">
      {{ emptyText }}
    </div>
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
          <span class="file-status" :class="{ renamed: f.is_renamed, deleted: f.is_deleted, added: f.is_new }">
            {{ f.is_new ? "A" : f.is_deleted ? "D" : f.is_renamed ? "R" : "M" }}
          </span>
          <FileTypeIcon :path="f.new_path || f.old_path" />
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
</template>

<style scoped>
.commit-detail-viewer {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.viewer-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}

.file-list {
  width: 240px;
  overflow-y: auto;
  border-right: 1px solid var(--border-default);
  flex-shrink: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 100ms ease;
}

.file-item:hover {
  background: var(--bg-hover);
}

/* 选中态与主界面 FileList 一致：accent 实底 + 白字，亮暗主题表现统一 */
.file-item.active {
  background: var(--accent);
  color: #fff;
}

.file-item.active .file-path {
  color: #fff;
}

.file-status {
  font-size: 11px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  color: var(--info);
}
.file-status.added {
  color: var(--diff-add-fg);
}
.file-status.deleted {
  color: var(--diff-del-fg);
}
.file-status.renamed {
  color: var(--warning);
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
  gap: 5px;
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
