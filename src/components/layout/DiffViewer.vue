<!--
  @component DiffViewer
  @description
    右侧下方 - diff 展示。统一 / 双栏视图切换、词级高亮、按文件懒加载、自动换行。
  @workflow
    1. 选中文件变化 -> 懒加载该文件 diff（工作区用 working/staged，提交从 commitFileDiffs 取）。
    2. 统一视图：hunk 头 + 行号 + 增删色；词级高亮对相邻 deleted/added 行对做 LCS。
    3. 双栏视图：左旧右新，context 行对齐。
  @changeLog
    - 2026-07-29: Created. 布局骨架与视图切换按钮。
    - 2026-07-29: Updated. 完整 diff 渲染、词级高亮、双栏、懒加载、换行（8.1-8.5）。
-->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { FileDiff, DiffHunk, DiffLine } from "@/types/git";

const repoStore = useRepoStore();
const selectionStore = useSelectionStore();

// 外部数据源模式：stash 查看等弹窗复用渲染逻辑时注入
// externalDiffs 传入后优先使用，selectedFile 用 externalFile（否则回退 selectionStore）
const props = defineProps<{
  externalDiffs?: FileDiff[] | null;
  externalFile?: string | null;
}>();

// 当前文件 diff
const fileDiff = ref<FileDiff | null>(null);
const loading = ref(false);
// 8.3 视图模式
const diffMode = ref<"unified" | "split">("unified");
// 8.5 自动换行
const wrap = ref(false);

// 文件名展示
const fileName = computed(() => {
  if (!fileDiff.value) return "未选中文件";
  const f = fileDiff.value;
  return f.is_renamed ? `${f.old_path} → ${f.new_path}` : f.new_path;
});

// 选中文件是否在已暂存（工作区模式决定用 staged 还是 working diff）
const isStagedFile = computed(() => {
  const file = selectionStore.selectedFile;
  if (!file) return false;
  return !!repoStore.activeRepo?.status?.staged.find((s) => s.path === file);
});

// 8.4 懒加载：选中文件 / 模式 / 提交变化时加载
watch(
  () => [
    selectionStore.selectedFile,
    selectionStore.type,
    selectionStore.commitHash,
    props.externalDiffs,
    props.externalFile,
  ],
  async () => {
    // 外部数据源模式（stash 查看等）：直接从注入的 diffs 取，不发请求
    if (props.externalDiffs) {
      const file = props.externalFile ?? selectionStore.selectedFile;
      if (!file) {
        fileDiff.value = null;
        return;
      }
      fileDiff.value =
        props.externalDiffs.find(
          (f) => f.new_path === file || f.old_path === file || `${f.old_path} -> ${f.new_path}` === file
        ) ?? null;
      return;
    }
    const path = repoStore.activeRepo?.path;
    const file = selectionStore.selectedFile;
    if (!path || !file) {
      fileDiff.value = null;
      return;
    }
    loading.value = true;
    try {
      let result: FileDiff[];
      if (selectionStore.isWorkingMode) {
        // 工作区模式：已暂存用 staged diff，否则 working diff
        if (isStagedFile.value) {
          result = await invoke<FileDiff[]>("git_get_staged_diff", { path, filePath: file });
        } else {
          result = await invoke<FileDiff[]>("git_get_working_diff", { path, filePath: file });
        }
      } else if (selectionStore.commitHash) {
        // 提交模式：从已加载的 commitFileDiffs 取（避免重复请求）
        result = selectionStore.commitFileDiffs.filter(
          (f) => f.new_path === file || f.old_path === file || `${f.old_path} -> ${f.new_path}` === file
        );
      } else {
        fileDiff.value = null;
        loading.value = false;
        return;
      }
      fileDiff.value = result[0] ?? null;
    } catch {
      fileDiff.value = null;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

// ===== 词级高亮（8.2） =====

interface WordPart {
  text: string;
  changed: boolean;
}

/** 对两字符串做 LCS 词级 diff，返回各自的片段（changed 标记改动词） */
function diffWords(oldStr: string, newStr: string): { oldParts: WordPart[]; newParts: WordPart[] } {
  const oldWords = oldStr.split(/(\s+)/).filter((w) => w.length > 0);
  const newWords = newStr.split(/(\s+)/).filter((w) => w.length > 0);
  const m = oldWords.length;
  const n = newWords.length;

  // LCS DP 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // 回溯生成片段
  const oldParts: WordPart[] = [];
  const newParts: WordPart[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      oldParts.push({ text: oldWords[i], changed: false });
      newParts.push({ text: newWords[j], changed: false });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oldParts.push({ text: oldWords[i], changed: true });
      i++;
    } else {
      newParts.push({ text: newWords[j], changed: true });
      j++;
    }
  }
  while (i < m) {
    oldParts.push({ text: oldWords[i], changed: true });
    i++;
  }
  while (j < n) {
    newParts.push({ text: newWords[j], changed: true });
    j++;
  }
  return { oldParts, newParts };
}

interface ProcessedLine extends DiffLine {
  wordParts: WordPart[] | null;
}

// 预处理 hunks：给相邻 deleted/added 行对做词级高亮
const processedHunks = computed(() => {
  if (!fileDiff.value) return [];
  return fileDiff.value.hunks.map((hunk) => {
    const lines: ProcessedLine[] = hunk.lines.map((l) => ({ ...l, wordParts: null }));
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].line_type === "deleted" && i + 1 < lines.length && lines[i + 1].line_type === "added") {
        const { oldParts, newParts } = diffWords(lines[i].content, lines[i + 1].content);
        lines[i].wordParts = oldParts;
        lines[i + 1].wordParts = newParts;
      }
    }
    return { ...hunk, lines };
  });
});

// 双栏：拆分 hunk 为左右两列（context 对齐，deleted 左，added 右）
function splitHunk(hunk: DiffHunk): { left: (DiffLine | null)[]; right: (DiffLine | null)[] } {
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];
  for (const line of hunk.lines) {
    if (line.line_type === "context") {
      left.push(line);
      right.push(line);
    } else if (line.line_type === "deleted") {
      left.push(line);
      right.push(null);
    } else if (line.line_type === "added") {
      left.push(null);
      right.push(line);
    }
  }
  return { left, right };
}

const splitHunks = computed(() => {
  if (!fileDiff.value) return [];
  return fileDiff.value.hunks.map((h) => splitHunk(h));
});

// 是否可 hunk 级暂存（工作区模式 + 未暂存文件）
const canStageHunk = computed(
  () => selectionStore.isWorkingMode && !isStagedFile.value && !!fileDiff.value
);

/** 构造单个 hunk 的 unified diff patch，用于 git apply --cached（7.5） */
function buildHunkPatch(file: FileDiff, hunk: DiffHunk): string {
  const oldPath = file.is_new ? "/dev/null" : `a/${file.old_path}`;
  const newPath = file.is_deleted ? "/dev/null" : `b/${file.new_path}`;
  let patch = `diff --git a/${file.old_path} b/${file.new_path}\n`;
  if (file.is_new) patch += `new file mode 100644\n`;
  patch += `--- ${oldPath}\n`;
  patch += `+++ ${newPath}\n`;
  patch += hunk.header + "\n";
  for (const line of hunk.lines) {
    let prefix = " ";
    if (line.line_type === "added") prefix = "+";
    else if (line.line_type === "deleted") prefix = "-";
    patch += prefix + line.content + "\n";
  }
  return patch;
}

async function handleStageHunk(hunk: DiffHunk) {
  if (!fileDiff.value) return;
  const patch = buildHunkPatch(fileDiff.value, hunk);
  await selectionStore.stageHunk(patch);
}
</script>

<template>
  <div class="diff-viewer">
    <div class="diff-header">
      <span class="file-name">{{ fileName }}</span>
      <div class="diff-actions">
        <button class="mode-btn" :class="{ active: diffMode === 'unified' }" @click="diffMode = 'unified'">统一</button>
        <button class="mode-btn" :class="{ active: diffMode === 'split' }" @click="diffMode = 'split'">双栏</button>
        <button class="mode-btn" :class="{ active: wrap }" @click="wrap = !wrap">{{ wrap ? "换行:开" : "换行:关" }}</button>
      </div>
    </div>

    <div class="diff-body">
      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="!fileDiff" class="hint">选中文件后展示差异</div>

      <!-- 统一视图（8.1） -->
      <div v-else-if="diffMode === 'unified'" class="diff-content" :class="{ wrap }">
        <template v-for="hunk in processedHunks" :key="hunk.header">
          <div class="hunk-header">
            <span class="hunk-header-text">{{ hunk.header }}</span>
            <button v-if="canStageHunk" class="hunk-action" @click="handleStageHunk(hunk)">
              暂存此块
            </button>
          </div>
          <div
            v-for="(line, i) in hunk.lines"
            :key="i"
            class="diff-line"
            :class="line.line_type"
          >
            <span class="line-no old">{{ line.old_line_no ?? "" }}</span>
            <span class="line-no new">{{ line.new_line_no ?? "" }}</span>
            <span class="line-content">
              <template v-if="line.wordParts">
                <span
                  v-for="(p, pi) in line.wordParts"
                  :key="pi"
                  :class="{ 'word-changed': p.changed }"
                >{{ p.text }}</span>
              </template>
              <template v-else>{{ line.content }}</template>
            </span>
          </div>
        </template>
      </div>

      <!-- 双栏视图（8.3） -->
      <div v-else class="diff-content split-view" :class="{ wrap }">
        <template v-for="(sh, hi) in splitHunks" :key="hi">
          <div class="hunk-header split-hunk-header">{{ fileDiff.hunks[hi].header }}</div>
          <div class="split-row-pair">
            <div class="split-col">
              <div
                v-for="(line, i) in sh.left"
                :key="'l' + i"
                class="diff-line"
                :class="line?.line_type || 'empty'"
              >
                <span class="line-no old">{{ line?.old_line_no ?? "" }}</span>
                <span class="line-content">{{ line?.content ?? "" }}</span>
              </div>
            </div>
            <div class="split-col">
              <div
                v-for="(line, i) in sh.right"
                :key="'r' + i"
                class="diff-line"
                :class="line?.line_type || 'empty'"
              >
                <span class="line-no new">{{ line?.new_line_no ?? "" }}</span>
                <span class="line-content">{{ line?.content ?? "" }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  overflow: hidden;
}

.diff-header {
  height: 28px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.file-name {
  font-size: 13px;
  color: var(--fg-secondary);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--ctrl-radius);
  padding: 2px;
}

.mode-btn {
  height: 22px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--fg-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

.mode-btn:hover:not(.active) {
  color: var(--fg-primary);
  background: var(--bg-hover);
}

.mode-btn.active {
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow-sm);
}

.diff-body {
  flex: 1;
  overflow: auto;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: var(--mono-font-size);
  line-height: 1.5;
}

.hint {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
  font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
}

.hunk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--diff-hunk-bg);
  color: var(--fg-secondary);
  padding: 2px 8px;
  font-size: 12px;
}

.hunk-action {
  height: 18px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  font-size: 11px;
  cursor: pointer;
}

.hunk-action:hover {
  color: var(--fg-primary);
  border-color: var(--accent);
}

.split-hunk-header {
  grid-column: 1 / -1;
}

.diff-line {
  display: flex;
  align-items: baseline;
  min-height: 20px;
  padding: 0 8px;
}

.diff-line.context {
  color: var(--fg-primary);
}

.diff-line.added {
  background: var(--diff-add-bg);
  color: var(--diff-add-fg);
}

.diff-line.deleted {
  background: var(--diff-del-bg);
  color: var(--diff-del-fg);
}

.diff-line.empty {
  background: var(--bg-panel);
}

.line-no {
  width: 44px;
  flex-shrink: 0;
  color: var(--fg-tertiary);
  text-align: right;
  padding-right: 8px;
  user-select: none;
}

.line-content {
  flex: 1;
  white-space: pre;
}

/* 自动换行（8.5） */
.diff-content.wrap .line-content {
  white-space: pre-wrap;
  word-break: break-all;
}

/* 词级高亮（8.2） */
.word-changed {
  background: var(--diff-word-bg);
  border-radius: var(--radius-sm);
}

/* 双栏 */
.split-view {
  display: flex;
  flex-direction: column;
}

.split-row-pair {
  display: flex;
}

.split-col {
  flex: 1;
  min-width: 0;
}

.split-col + .split-col {
  border-left: 1px solid var(--border-default);
}
</style>
