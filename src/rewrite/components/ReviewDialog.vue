<!--
  @component ReviewDialog
  @description
    提交审查弹窗：真实文件 diff、统一/双栏/换行、上下提交切换、复制哈希、Esc/键盘操作。
    视觉沿用确认原型；数据通过 git_get_commit_diff 获取。

  @usage
    <ReviewDialog v-if="reviewOpen" :commit="reviewCommit" :index="reviewIndex" :total="commits.length"
      :repo-path="activeRepo.path" @close="..." @step="..." />

  @dataFormat
    commit: CommitInfo；files: FileDiff[]（后端返回）。

  @changeLog
    - 2026-11-04: Created. 新 Review 真实 diff、键盘和复制反馈。
    - 2026-11-13: Updated. 大屏审查随窗口加宽，文件栏按比例扩展并完整换行显示路径。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, FileDiff } from "@/types/git";
import { formatDateTime } from "../utils/date";
import ReviewDiff from "./ReviewDiff.vue";

const props = defineProps<{
  commit: CommitInfo;
  repoPath: string;
  index: number;
  total: number;
}>();

const emit = defineEmits<{
  close: [];
  step: [delta: number];
}>();

const dialog = ref<HTMLElement | null>(null);
const files = ref<FileDiff[]>([]);
const activeFile = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const diffView = ref<"unified" | "split">("unified");
const wrap = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let requestSequence = 0;

const currentFile = computed(() => files.value[activeFile.value] ?? null);
const hasPrev = computed(() => props.index > 0);
const hasNext = computed(() => props.index < props.total - 1);

const meta = computed(() => {
  const refName = props.commit.refs[0] ? ` · ${props.commit.refs[0]}` : "";
  return `${props.commit.short_hash} · ${props.commit.author_name} · ${formatDateTime(props.commit.author_date)}${refName}`;
});

/**
 * 推导单文件状态字母，用于文件列表。
 * @param file - 文件 diff
 * @returns A/D/R/M
 */
function fileStatus(file: FileDiff): string {
  if (file.is_new) return "A";
  if (file.is_deleted) return "D";
  if (file.is_renamed) return "R";
  return "M";
}

/**
 * 读取当前提交的所有文件 diff。
 * @returns {Promise<void>}
 */
async function loadDiff(): Promise<void> {
  const sequence = ++requestSequence;
  activeFile.value = 0;
  files.value = [];
  error.value = null;
  loading.value = true;
  try {
    const result = await invoke<FileDiff[]>("git_get_commit_diff", {
      path: props.repoPath,
      commitHash: props.commit.hash,
      filePath: null,
    });
    if (sequence !== requestSequence) return;
    files.value = result;
  } catch (e) {
    if (sequence !== requestSequence) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

watch(() => [props.commit.hash, props.repoPath], () => {
  void loadDiff();
}, { immediate: true });

/**
 * 复制完整提交哈希并在按钮内给出短暂成功反馈。
 * @returns {Promise<void>}
 */
async function copyHash(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.commit.hash);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 500);
  } catch {
    error.value = "复制失败，请手动选择哈希";
  }
}

/**
 * 弹窗键盘：Esc 关闭，左右/方括号切换提交，n/p 切换文件，u/s 切换视图，w 换行。
 * @param event - 键盘事件
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key === "Tab") {
    trapFocus(event);
    return;
  }
  if (event.key === "[" || event.key === "ArrowLeft") {
    event.preventDefault();
    if (hasPrev.value) emit("step", -1);
    return;
  }
  if (event.key === "]" || event.key === "ArrowRight") {
    event.preventDefault();
    if (hasNext.value) emit("step", 1);
    return;
  }
  if (files.value.length) {
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      activeFile.value = Math.min(files.value.length - 1, activeFile.value + 1);
    } else if (key === "p") {
      event.preventDefault();
      activeFile.value = Math.max(0, activeFile.value - 1);
    } else if (key === "u") {
      event.preventDefault();
      diffView.value = "unified";
    } else if (key === "s") {
      event.preventDefault();
      diffView.value = "split";
    } else if (key === "w") {
      event.preventDefault();
      wrap.value = !wrap.value;
    }
  }
}

/**
 * 将 Tab 焦点限制在弹窗内，避免关闭后跳到背景。
 * @param event - 键盘事件
 * @returns {void}
 */
function trapFocus(event: KeyboardEvent): void {
  if (!dialog.value) return;
  const focusables = Array.from(
    dialog.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
  if (!focusables.length) return;

  const current = focusables.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? (current <= 0 ? focusables.length - 1 : current - 1)
    : (current === -1 || current === focusables.length - 1 ? 0 : current + 1);
  event.preventDefault();
  focusables[next]?.focus();
}

onMounted(async () => {
  await nextTick();
  dialog.value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="dialog review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reviewSubject"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header class="dialog-header">
          <div class="dialog-heading">
            <div class="dialog-label">提交审查</div>
            <h2 id="reviewSubject" class="dialog-subject">{{ commit.subject }}</h2>
            <div class="dialog-meta" :title="commit.hash">{{ meta }}</div>
          </div>
          <div class="dialog-actions">
            <button class="ghost-btn" type="button" :class="{ done: copied }" @click="copyHash">
              {{ copied ? "已复制" : "复制哈希" }}
            </button>
            <button class="close-btn" type="button" aria-label="关闭审查" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="dialog-body">
          <aside class="files" aria-label="改动文件">
            <div class="files-head">
              <span>改动文件</span>
              <span>{{ files.length }}</span>
            </div>
            <div v-if="loading" class="file-loading">加载中…</div>
            <div v-else-if="error" class="file-loading error">{{ error }}</div>
            <div v-else-if="!files.length" class="file-loading">这个提交没有文件改动</div>
            <template v-else>
              <button
                v-for="(file, index) in files"
                :key="`${file.old_path}-${file.new_path}`"
                type="button"
                class="file-row"
                :class="{ active: index === activeFile }"
                :title="file.new_path"
                :aria-pressed="index === activeFile"
                @click="activeFile = index"
              >
                <span class="file-status" :class="fileStatus(file).toLowerCase()">{{ fileStatus(file) }}</span>
                <span class="file-name">{{ file.new_path }}</span>
                <span class="file-stat">+{{ file.additions }} −{{ file.deletions }}</span>
              </button>
            </template>
          </aside>

          <section class="diff" :class="{ wrap }" aria-label="文件差异">
            <div class="diff-toolbar">
              <button class="tab" :class="{ active: diffView === 'unified' }" type="button" @click="diffView = 'unified'">统一</button>
              <button class="tab" :class="{ active: diffView === 'split' }" type="button" @click="diffView = 'split'">双栏</button>
              <button class="tab" :class="{ active: wrap }" type="button" @click="wrap = !wrap">换行</button>
            </div>
            <div v-if="loading" class="diff-empty">正在读取差异…</div>
            <div v-else-if="error" class="diff-empty">{{ error }}</div>
            <ReviewDiff v-else :file="currentFile" :view="diffView" :wrap="wrap" />
          </section>
        </div>

        <footer class="dialog-footer">
          <div class="foot-left">
            <button class="foot-btn" type="button" :disabled="!hasPrev" @click="emit('step', -1)">← 上一个提交</button>
            <button class="foot-btn" type="button" :disabled="!hasNext" @click="emit('step', 1)">下一个提交 →</button>
          </div>
          <div class="foot-center">
            {{ files.length ? `文件 ${activeFile + 1} / ${files.length}` : "文件 0 / 0" }}
          </div>
          <div class="foot-right"><span class="foot-hint">Esc 关闭</span></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 审查使用窗口宽度，保留外层遮罩的安全边距，不再受通用弹窗的固定宽度上限限制。 */
.review-dialog {
  width: min(92vw, 100%);
  max-width: none;
}

.review-dialog .dialog-body {
  grid-template-columns: minmax(280px, 28%) minmax(0, 1fr);
}

.review-dialog .files {
  min-width: 0;
}

/* 长路径增加行高，状态和统计仍停留在首行，避免文件名被省略号遮住。 */
.review-dialog .file-row {
  align-items: start;
  padding-block: 8px;
}

.review-dialog .file-name {
  min-width: 0;
  overflow: visible;
  overflow-wrap: anywhere;
  white-space: normal;
  text-overflow: clip;
}

.review-dialog .file-status,
.review-dialog .file-stat {
  line-height: 16px;
}
</style>
