<!--
  @component ReviewDialog
  @description
    提交审查弹窗：真实文件 diff、统一/双栏/换行、上下提交切换、复制哈希、Esc/键盘操作。
    多选提交时按选择形态切换批量视图：
      - 所选提交在历史中相邻（含连续区间）→ 合并审查，展示「最旧提交的父提交 → 最新提交」的累计改动；
      - 所选提交不相邻（Ctrl 跳选）→ 逐条审查，只展示所选提交各自的改动，避免混入未选中的提交。
    视觉沿用确认原型；数据通过 git_get_commit_diff / git_get_commit_range_diff / git_get_commits_diff 获取。

  @usage
    <ReviewDialog v-if="reviewOpen" :commit="reviewCommit" :index="reviewIndex" :total="commits.length"
      :repo-path="activeRepo.path" :batch="reviewBatch" :batch-gap="batchGap"
      @close="..." @step="..." @focus-commit="..." />

  @dataFormat
    commit: CommitInfo；batch: CommitInfo[]（列表顺序，最新在前）；batchGap: 区间内未选中的提交数。
    files: FileDiff[]；commitDiffs: CommitDiff[]（后端返回）。

  @changeLog
    - 2026-11-04: Created. 新 Review 真实 diff、键盘和复制反馈。
    - 2026-11-13: Updated. 大屏审查随窗口加宽，文件栏按比例扩展并完整换行显示路径。
    - 2026-11-16: Updated. 支持多选提交审查：相邻选择看累计改动，不相邻选择逐条展示各自改动。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { CommitDiff, CommitInfo, FileDiff } from "@/types/git";
import { formatDateTime } from "../utils/date";
import ReviewDiff from "./ReviewDiff.vue";

const props = defineProps<{
  commit: CommitInfo;
  repoPath: string;
  index: number;
  total: number;
  /** 多选提交集合（列表顺序，最新在前）；多于一条时启用批量审查 */
  batch?: CommitInfo[] | null;
  /** 选中区间内未选中的提交数量；大于 0 时说明所选不相邻，改为逐条展示 */
  batchGap?: number;
}>();

const emit = defineEmits<{
  close: [];
  step: [delta: number];
  /** 批量视图内切换到某条提交的单提交审查 */
  focusCommit: [hash: string];
}>();

/** 审查模式：单提交 / 相邻选择的累计改动 / 不相邻选择的逐条改动 */
type ReviewMode = "single" | "aggregate" | "per-commit";

const dialog = ref<HTMLElement | null>(null);
/** 单提交或累计审查的文件列表 */
const files = ref<FileDiff[]>([]);
/** 逐条审查的提交 diff；只包含所选提交 */
const commitDiffs = ref<CommitDiff[]>([]);
const activeFile = ref(0);
const activeEntry = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const diffView = ref<"unified" | "split">("unified");
const wrap = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let requestSequence = 0;

/** chips 最多展示的提交数，超出部分只提示总数 */
const CHIP_LIMIT = 8;

/** 批量审查：至少两条提交 */
const isBatch = computed(() => (props.batch?.length ?? 0) > 1);
const batchCount = computed(() => props.batch?.length ?? 0);
/** 审查模式：所选提交不相邻时逐条展示，避免累计区间混入未选中提交 */
const mode = computed<ReviewMode>(() => {
  if (!isBatch.value) return "single";
  return (props.batchGap ?? 0) > 0 ? "per-commit" : "aggregate";
});
/** 合并区间的最新提交（列表顺序的第一条） */
const batchNewest = computed<CommitInfo>(() => props.batch?.[0] ?? props.commit);
/** 合并区间的最旧提交（列表顺序的最后一条） */
const batchOldest = computed<CommitInfo>(() => {
  const batch = props.batch;
  if (!batch?.length) return props.commit;
  return batch[batch.length - 1];
});
/** 合并区间起点：最旧提交的父提交；根提交没有父提交时为空，由后端回退空树 */
const batchFrom = computed<string | null>(() => batchOldest.value.parents[0] ?? null);
/** 头部 chips 展示的提交，点击回到单提交审查 */
const chipCommits = computed<CommitInfo[]>(() => (props.batch ?? []).slice(0, CHIP_LIMIT));
const hiddenChipCount = computed(() => Math.max(0, batchCount.value - CHIP_LIMIT));

/** 逐条审查：按所选提交顺序把每个提交的文件改动摊平成带提交信息的行 */
const entryGroups = computed(() => {
  const byHash = new Map((props.batch ?? []).map((item) => [item.hash, item]));
  let nextIndex = 0;
  return commitDiffs.value
    .filter((diff) => diff.files.length > 0)
    .map((diff) => {
      const commit = byHash.get(diff.hash) ?? props.commit;
      return {
        commit,
        rows: diff.files.map((file) => ({ commit, file, index: nextIndex++ })),
      };
    });
});
/** 逐条审查的所有文件行，用于计数和键盘切换 */
const flatEntries = computed(() => entryGroups.value.flatMap((group) => group.rows));
/** 当前显示的文件数随模式变化 */
const fileCount = computed(() => (mode.value === "per-commit" ? flatEntries.value.length : files.value.length));
/** 当前展示的 diff：逐条审查取选中行，其余取文件列表的当前项 */
const currentFile = computed<FileDiff | null>(() => (mode.value === "per-commit"
  ? flatEntries.value[activeEntry.value]?.file ?? null
  : files.value[activeFile.value] ?? null));
/** 当前文件所属提交，逐条审查在工具栏展示来源 */
const activeCommit = computed<CommitInfo | null>(() => (mode.value === "per-commit"
  ? flatEntries.value[activeEntry.value]?.commit ?? null
  : null));
/** 当前 diff 的合计增删 */
const totals = computed(() => fileCount.value && mode.value === "per-commit"
  ? flatEntries.value.reduce(
    (sum, row) => ({ additions: sum.additions + row.file.additions, deletions: sum.deletions + row.file.deletions }),
    { additions: 0, deletions: 0 },
  )
  : files.value.reduce(
    (sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  ));

const hasPrev = computed(() => !isBatch.value && props.index > 0);
const hasNext = computed(() => !isBatch.value && props.index < props.total - 1);

/** 头部主标题：单提交显示主题，批量视图说明改动范围 */
const heading = computed(() => {
  if (mode.value === "aggregate") return `${batchCount.value} 个提交的累计改动`;
  if (mode.value === "per-commit") return `${batchCount.value} 个提交的各自改动`;
  return props.commit.subject;
});

/** 头部标签 */
const label = computed(() => (mode.value === "aggregate" ? "合并审查" : mode.value === "per-commit" ? "逐条审查" : "提交审查"));

/** 批量视图的补充说明：不相邻时说明为什么逐条展示 */
const note = computed(() => (mode.value === "per-commit"
  ? "所选提交在历史中不相邻，只展示所选提交各自的改动"
  : ""));

/** 左侧空态文案随视图切换，避免把「互相抵消」误报为无改动 */
const emptyText = computed(() => (isBatch.value ? "这批提交没有文件改动" : "这个提交没有文件改动"));

const meta = computed(() => {
  if (mode.value === "aggregate") {
    return `${batchOldest.value.short_hash} → ${batchNewest.value.short_hash} · ${formatDateTime(batchOldest.value.author_date)} → ${formatDateTime(batchNewest.value.author_date)}`;
  }
  if (mode.value === "per-commit") {
    return `${batchOldest.value.short_hash} → ${batchNewest.value.short_hash} · ${formatDateTime(batchOldest.value.author_date)} → ${formatDateTime(batchNewest.value.author_date)}`;
  }
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
 * 按当前模式读取 diff 数据。
 * @returns {Promise<void>}
 */
async function loadDiff(): Promise<void> {
  const sequence = ++requestSequence;
  activeFile.value = 0;
  activeEntry.value = 0;
  files.value = [];
  commitDiffs.value = [];
  error.value = null;
  loading.value = true;
  try {
    if (mode.value === "per-commit") {
      const hashes = (props.batch ?? []).map((item) => item.hash);
      const result = await invoke<CommitDiff[]>("git_get_commits_diff", {
        path: props.repoPath,
        commitHashes: hashes,
      });
      if (sequence !== requestSequence) return;
      commitDiffs.value = result;
    } else if (mode.value === "aggregate") {
      const result = await invoke<FileDiff[]>("git_get_commit_range_diff", {
        path: props.repoPath,
        fromCommit: batchFrom.value,
        toCommit: batchNewest.value.hash,
      });
      if (sequence !== requestSequence) return;
      files.value = result;
    } else {
      const result = await invoke<FileDiff[]>("git_get_commit_diff", {
        path: props.repoPath,
        commitHash: props.commit.hash,
        filePath: null,
      });
      if (sequence !== requestSequence) return;
      files.value = result;
    }
  } catch (e) {
    if (sequence !== requestSequence) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

watch(
  () => [
    props.commit.hash,
    props.repoPath,
    (props.batch ?? []).map((item) => item.hash).join(","),
    mode.value,
  ],
  async () => {
    void loadDiff();
    // 合并视图与单提交视图互相切换时，被点击的 chips 会从 DOM 移除，
    // 焦点会落到 body 导致 Esc 失灵；这里把焦点收回弹窗容器。
    await nextTick();
    if (dialog.value && !dialog.value.contains(document.activeElement)) dialog.value.focus();
  },
  { immediate: true },
);

/**
 * 复制当前视图的哈希：单提交复制完整哈希，批量视图复制区间。
 * @returns {Promise<void>}
 */
async function copyHash(): Promise<void> {
  const value = isBatch.value
    ? `${batchOldest.value.hash}..${batchNewest.value.hash}`
    : props.commit.hash;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 500);
  } catch {
    error.value = "复制失败，请手动选择哈希";
  }
}

/**
 * 切换文件：逐条审查按摊平后的行切换，其余按文件列表切换。
 * @param delta - 偏移量
 * @returns {void}
 */
function stepFile(delta: number): void {
  if (!fileCount.value) return;
  if (mode.value === "per-commit") {
    activeEntry.value = Math.min(fileCount.value - 1, Math.max(0, activeEntry.value + delta));
    return;
  }
  activeFile.value = Math.min(fileCount.value - 1, Math.max(0, activeFile.value + delta));
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
  if (fileCount.value) {
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      stepFile(1);
    } else if (key === "p") {
      event.preventDefault();
      stepFile(-1);
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
            <div class="dialog-label">{{ label }}</div>
            <h2 id="reviewSubject" class="dialog-subject" :title="mode === 'single' ? commit.subject : undefined">{{ heading }}</h2>
            <div
              class="dialog-meta"
              :title="mode === 'aggregate' ? '合并改动 = 最旧提交的父提交到最新提交的净变化' : commit.hash"
            >{{ meta }}</div>
            <!-- 多选时列出涉及的提交，点击可直接回到该提交的单提交审查 -->
            <div v-if="isBatch" class="batch-chips" aria-label="本次批量审查包含的提交">
              <button
                v-for="item in chipCommits"
                :key="item.hash"
                class="batch-chip"
                type="button"
                :title="`只看这一条：${item.short_hash} · ${item.subject}`"
                @click="emit('focusCommit', item.hash)"
              >{{ item.short_hash }}</button>
              <span v-if="hiddenChipCount" class="batch-chip-more">等 {{ batchCount }} 个</span>
              <span v-if="note" class="batch-note">{{ note }}</span>
            </div>
          </div>
          <div class="dialog-actions">
            <button class="ghost-btn" type="button" :class="{ done: copied }" @click="copyHash">
              {{ copied ? "已复制" : isBatch ? "复制范围" : "复制哈希" }}
            </button>
            <button class="close-btn" type="button" aria-label="关闭审查" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="dialog-body">
          <aside class="files" aria-label="改动文件">
            <div class="files-head">
              <span>改动文件</span>
              <span>{{ fileCount }}</span>
            </div>
            <div v-if="loading" class="file-loading">加载中…</div>
            <div v-else-if="error" class="file-loading error">{{ error }}</div>
            <div v-else-if="!fileCount" class="file-loading">{{ emptyText }}</div>

            <!-- 逐条审查：按提交分组，只列出所选提交各自的改动 -->
            <template v-else-if="mode === 'per-commit'">
              <template v-for="group in entryGroups" :key="group.commit.hash">
                <div class="file-group-head" :title="`${group.commit.short_hash} · ${group.commit.subject}`">
                  <span class="file-group-hash">{{ group.commit.short_hash }}</span>
                  <span class="file-group-subject">{{ group.commit.subject }}</span>
                </div>
                <button
                  v-for="row in group.rows"
                  :key="`${group.commit.hash}-${row.file.old_path}-${row.file.new_path}`"
                  type="button"
                  class="file-row"
                  :class="{ active: row.index === activeEntry }"
                  :title="row.file.new_path"
                  :aria-pressed="row.index === activeEntry"
                  @click="activeEntry = row.index"
                >
                  <span class="file-status" :class="fileStatus(row.file).toLowerCase()">{{ fileStatus(row.file) }}</span>
                  <span class="file-name">{{ row.file.new_path }}</span>
                  <span class="file-stat">+{{ row.file.additions }} −{{ row.file.deletions }}</span>
                </button>
              </template>
            </template>

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
              <span v-if="activeCommit" class="diff-source" :title="activeCommit.subject">
                {{ activeCommit.short_hash }} · {{ activeCommit.author_name }}
              </span>
            </div>
            <div v-if="loading" class="diff-empty">正在读取差异…</div>
            <div v-else-if="error" class="diff-empty">{{ error }}</div>
            <ReviewDiff v-else :file="currentFile" :view="diffView" :wrap="wrap" />
          </section>
        </div>

        <footer class="dialog-footer">
          <div class="foot-left">
            <template v-if="isBatch">
              <span class="foot-total">合计 <b class="foot-add">+{{ totals.additions }}</b> <b class="foot-del">−{{ totals.deletions }}</b></span>
            </template>
            <template v-else>
              <button class="foot-btn" type="button" :disabled="!hasPrev" @click="emit('step', -1)">← 上一个提交</button>
              <button class="foot-btn" type="button" :disabled="!hasNext" @click="emit('step', 1)">下一个提交 →</button>
            </template>
          </div>
          <div class="foot-center">
            {{ fileCount ? `文件 ${(mode === 'per-commit' ? activeEntry : activeFile) + 1} / ${fileCount}` : "文件 0 / 0" }}
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

/* 批量审查头部：列出本批提交的短哈希，点击切回单提交。 */
.batch-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.batch-chip {
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--review-action-border);
  border-radius: var(--radius-pill);
  color: var(--review-meta);
  font-family: var(--mono);
  font-size: 10px;
  line-height: 18px;
}

.batch-chip:hover {
  border-color: transparent;
  background: var(--review-action-hover-bg);
  color: var(--review-action-hover-text);
}

.batch-chip-more {
  color: var(--review-meta);
  font-family: var(--mono);
  font-size: 10px;
}

/* 逐条审查时说明展示方式，避免误以为是累计改动。 */
.batch-note {
  padding-left: 4px;
  color: var(--warning);
  font-size: 10px;
  line-height: 18px;
}

/* 逐条审查的文件分组头：短哈希 + 提交主题，作为该组文件行的归属说明。 */
.file-group-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 6px 0 2px;
  padding: 4px 8px;
  border-left: 2px solid var(--accent);
  color: var(--muted);
  font-size: 11px;
}

.file-group-hash {
  flex-shrink: 0;
  color: var(--accent-strong);
  font-family: var(--mono);
  font-size: 10px;
}

.file-group-subject {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 逐条审查时在 diff 工具栏标注当前文件来自哪条提交。 */
.diff-source {
  margin-left: auto;
  overflow: hidden;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 合并视图底部合计增删，颜色与文件列表统计保持一致。 */
.foot-total {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}

.foot-add { color: var(--status-add); font-weight: 600; }
.foot-del { color: var(--status-del); font-weight: 600; }
</style>
