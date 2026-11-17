<!--
  @component ReviewDialog
  @description
    提交审查弹窗：真实文件 diff、统一/双栏/换行、逐行作者、上下提交切换、复制哈希、Esc/键盘操作。
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
    - 2026-11-16: Updated. 文件列表按文件后缀展示类型图标。
    - 2026-11-16: Updated. 审查 diff 按设置展示可选的上下文行数。
    - 2026-11-16: Updated. 顶部统一工具栏支持逐行作者开关，并把复制哈希并入同一工具栏。
    - 2026-11-16: Updated. 顶部工具栏增加上下文行数选择，切换后保留当前文件并重新读取 diff。
    - 2026-11-17: Updated. 逐行作者后可再开启「提交时间」，在作者列右侧展示该行提交时间。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, DIFF_CONTEXT_OPTIONS } from "@/stores/settings";
import type { BlameLine, CommitDiff, CommitInfo, FileDiff } from "@/types/git";
import AppSelect from "@/components/AppSelect.vue";
import FileTypeIcon from "@/components/layout/FileTypeIcon.vue";
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

const settingsStore = useSettingsStore();
const diffContextOptions = DIFF_CONTEXT_OPTIONS.map((lines) => ({
  value: String(lines),
  label: `${lines} 行`,
}));

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
// 弹窗内开关与设置页共用同一偏好，下次打开审查时沿用上次选择。
const showBlame = ref(settingsStore.showLineAuthors);
// 提交时间列跟随逐行作者出现，默认关闭，仅在本次审查内使用。
const showBlameTime = ref(false);
const oldBlame = shallowRef<Map<number, BlameLine>>(new Map());
const newBlame = shallowRef<Map<number, BlameLine>>(new Map());
const blameLoading = ref(false);
const blameCache = new Map<string, Map<number, BlameLine>>();
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let requestSequence = 0;
let blameSequence = 0;

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

/** 当前文件逐行作者需要查询的两个版本；新增、删除文件只查存在的一侧。 */
const blameTarget = computed(() => {
  const file = currentFile.value;
  // 无文本差异的文件（二进制、仅模式变化）没有可标注的行。
  if (!file || !file.hunks.length) {
    return null;
  }

  const newRevision = mode.value === "per-commit"
    ? activeCommit.value?.hash ?? null
    : mode.value === "aggregate"
      ? batchNewest.value.hash
      : props.commit.hash;
  const oldRevision = mode.value === "per-commit"
    ? activeCommit.value?.parents[0] ?? null
    : mode.value === "aggregate"
      ? batchFrom.value
      : props.commit.parents[0] ?? null;

  return {
    newRevision: file.is_deleted ? null : newRevision,
    oldRevision: file.is_new ? null : oldRevision,
    newPath: file.new_path || file.old_path,
    oldPath: file.old_path || file.new_path,
  };
});
/** 当前作者查询的唯一键，文件、版本或审查模式变化时重新读取。 */
const blameRequestKey = computed(() => {
  const target = blameTarget.value;
  if (!target) {
    return "";
  }
  return JSON.stringify([props.repoPath, target.newRevision, target.newPath, target.oldRevision, target.oldPath]);
});

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
 * @param preserveSelection - 是否保留当前文件和逐条审查位置；上下文切换时使用
 * @returns {Promise<void>}
 */
async function loadDiff(preserveSelection = false): Promise<void> {
  const previousFile = activeFile.value;
  const previousEntry = activeEntry.value;
  const sequence = ++requestSequence;
  if (!preserveSelection) {
    activeFile.value = 0;
    activeEntry.value = 0;
  }
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
        contextLines: settingsStore.diffContextLines,
      });
      if (sequence !== requestSequence) return;
      commitDiffs.value = result;
    } else if (mode.value === "aggregate") {
      const result = await invoke<FileDiff[]>("git_get_commit_range_diff", {
        path: props.repoPath,
        fromCommit: batchFrom.value,
        toCommit: batchNewest.value.hash,
        contextLines: settingsStore.diffContextLines,
      });
      if (sequence !== requestSequence) return;
      files.value = result;
    } else {
      const result = await invoke<FileDiff[]>("git_get_commit_diff", {
        path: props.repoPath,
        commitHash: props.commit.hash,
        filePath: null,
        contextLines: settingsStore.diffContextLines,
      });
      if (sequence !== requestSequence) return;
      files.value = result;
    }
  } catch (e) {
    if (sequence !== requestSequence) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (sequence === requestSequence) {
      // 上下文行数变化后列表会重建，恢复原文件位置，避免跳回第一个文件。
      if (preserveSelection) {
        activeFile.value = Math.min(previousFile, Math.max(0, files.value.length - 1));
        activeEntry.value = Math.min(previousEntry, Math.max(0, flatEntries.value.length - 1));
      }
      loading.value = false;
    }
  }
}

/**
 * 保存工具栏选择的上下文行数，与设置页共用同一偏好。
 * @param value - 选择框返回的字符串档位
 * @returns {void}
 */
function persistDiffContext(value: string): void {
  const lines = Number(value);
  const matchedOption = DIFF_CONTEXT_OPTIONS.find((option) => option === lines);
  if (matchedOption) {
    settingsStore.setDiffContextLines(matchedOption);
  }
}

// 设置页或弹窗工具栏改变上下文行数时，按当前文件重新读取。
watch(() => settingsStore.diffContextLines, () => {
  void loadDiff(true);
});

/**
 * 读取一个版本文件的逐行作者，并在弹窗生命周期内缓存结果。
 * @param revision - 提交哈希
 * @param filePath - 该版本下的文件路径
 * @returns 行号到作者信息的映射；读取失败时为空映射
 */
async function readBlame(revision: string, filePath: string): Promise<Map<number, BlameLine>> {
  const cacheKey = `${revision}\u0000${filePath}`;
  const cached = blameCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const lines = await invoke<BlameLine[]>("git_blame_file", {
      path: props.repoPath,
      revision,
      filePath,
    });
    const indexed = new Map(lines.map((line) => [line.line, line]));
    blameCache.set(cacheKey, indexed);
    return indexed;
  } catch {
    // 二进制文件、超大文件或历史不可读时不显示作者，不回滚已打开的 diff。
    return new Map();
  }
}

/**
 * 按当前文件和审查模式读取新旧两个版本的逐行作者。
 * @returns 作者请求结束
 */
async function loadBlame(): Promise<void> {
  const sequence = ++blameSequence;
  const target = blameTarget.value;

  // 作者开关关闭、文件未加载或没有可查询版本时，清空旧文件的数据。
  if (!showBlame.value || !target || (!target.newRevision && !target.oldRevision)) {
    oldBlame.value = new Map();
    newBlame.value = new Map();
    blameLoading.value = false;
    return;
  }

  // 切换文件时先清空旧作者，避免新行号配上上一个文件的名字。
  oldBlame.value = new Map();
  newBlame.value = new Map();
  blameLoading.value = true;
  try {
    const [nextNewBlame, nextOldBlame] = await Promise.all([
      target.newRevision
        ? readBlame(target.newRevision, target.newPath)
        : Promise.resolve(new Map<number, BlameLine>()),
      target.oldRevision
        ? readBlame(target.oldRevision, target.oldPath)
        : Promise.resolve(new Map<number, BlameLine>()),
    ]);
    if (sequence !== blameSequence) {
      return;
    }
    newBlame.value = nextNewBlame;
    oldBlame.value = nextOldBlame;
  } finally {
    if (sequence === blameSequence) {
      blameLoading.value = false;
    }
  }
}

/**
 * 切换逐行作者显示；数据加载由监听当前文件与开关状态的 watch 驱动。
 * @returns {void}
 */
function toggleBlame(): void {
  const enabled = !showBlame.value;
  showBlame.value = enabled;
  settingsStore.setShowLineAuthors(enabled);
}

watch(
  () => [showBlame.value, blameRequestKey.value] as const,
  () => {
    void loadBlame();
  },
  { immediate: true },
);

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
            <button class="close-btn" type="button" aria-label="关闭审查" @click="emit('close')">×</button>
          </div>
        </header>

        <!-- 统一工具栏：视图切换、换行、逐行作者、上下文行数和复制哈希都在弹窗内完成 -->
        <div class="review-toolbar" role="toolbar" aria-label="审查工具栏">
          <div class="review-toolbar-tabs" role="group" aria-label="差异视图与显示项">
            <button class="tab" :class="{ active: diffView === 'unified' }" type="button" :aria-pressed="diffView === 'unified'" @click="diffView = 'unified'">统一</button>
            <button class="tab" :class="{ active: diffView === 'split' }" type="button" :aria-pressed="diffView === 'split'" @click="diffView = 'split'">双栏</button>
            <button class="tab" :class="{ active: wrap }" type="button" :aria-pressed="wrap" @click="wrap = !wrap">换行</button>
            <button
              class="tab"
              :class="{ active: showBlame }"
              type="button"
              :aria-pressed="showBlame"
              :aria-busy="showBlame && blameLoading"
              title="显示每行作者（git blame）"
              @click="toggleBlame"
            >逐行作者</button>
            <button
              class="tab"
              :class="{ active: showBlameTime }"
              type="button"
              :disabled="!showBlame"
              :aria-pressed="showBlameTime"
              :title="showBlame ? '在作者右侧显示该行的提交时间' : '先开启逐行作者'"
              @click="showBlameTime = !showBlameTime"
            >提交时间</button>
          </div>
          <span class="review-context">
            <span class="review-context-label">上下文</span>
            <AppSelect
              class="review-context-select"
              :model-value="String(settingsStore.diffContextLines)"
              :options="diffContextOptions"
              ariaLabel="Diff 上下文行数"
              @update:model-value="persistDiffContext"
            />
          </span>
          <span class="review-toolbar-spacer" aria-hidden="true"></span>
          <span v-if="activeCommit" class="diff-source" :title="activeCommit.subject">
            {{ activeCommit.short_hash }} · {{ activeCommit.author_name }}
          </span>
          <button class="ghost-btn" type="button" :class="{ done: copied }" @click="copyHash">
            {{ copied ? "已复制" : isBatch ? "复制范围" : "复制哈希" }}
          </button>
        </div>

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
                  <FileTypeIcon :path="row.file.new_path" />
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
                <FileTypeIcon :path="file.new_path" />
                <span class="file-name">{{ file.new_path }}</span>
                <span class="file-stat">+{{ file.additions }} −{{ file.deletions }}</span>
              </button>
            </template>
          </aside>

          <section class="diff" :class="{ wrap }" aria-label="文件差异">
            <div v-if="loading" class="diff-empty">正在读取差异…</div>
            <div v-else-if="error" class="diff-empty">{{ error }}</div>
            <ReviewDiff
              v-else
              :file="currentFile"
              :view="diffView"
              :wrap="wrap"
              :show-blame="showBlame"
              :show-blame-time="showBlameTime"
              :old-blame="oldBlame"
              :new-blame="newBlame"
            />
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

/* 顶部统一工具栏：差异视图、显示项和复制哈希集中在一处。 */
.review-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 16px;
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--review-border);
  background: var(--review-header);
  color: var(--review-header-text);
}

.review-toolbar-tabs {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 100%;
}

.review-context {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.review-context-label {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.review-context-select {
  width: 88px;
}

.review-context-select :deep(.app-select-trigger) {
  height: 28px;
  padding: 0 8px;
  border-color: var(--review-action-border);
  background: transparent;
  color: var(--review-action-text);
  font-size: 11px;
}

.review-context-select :deep(.app-select-chevron) {
  width: 12px;
  height: 12px;
}

/* 提交时间开关在未开启逐行作者时不可用。 */
.review-toolbar .tab:disabled {
  color: var(--muted-2);
  cursor: default;
}

/* 作者数据读取期间在开关后显示旋转指示，不额外占用行内文字。 */
.review-toolbar .tab[aria-busy="true"]::after {
  content: "";
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.review-toolbar-spacer {
  flex: 1;
}

.review-toolbar .ghost-btn {
  flex-shrink: 0;
}

.review-toolbar .diff-source {
  max-width: 38%;
}

.review-dialog .dialog-body {
  grid-template-columns: minmax(280px, 28%) minmax(0, 1fr);
}

.review-dialog .files {
  min-width: 0;
}

/* 长路径增加行高，状态、类型图标和统计仍停留在首行 */
.review-dialog .file-row {
  grid-template-columns: 16px 16px minmax(0, 1fr) auto;
  align-items: start;
  padding-block: 8px;
}

/* 图标与状态字母按首行对齐，长路径换行时不会被拉伸 */
.review-dialog .file-row > .file-type-icon {
  margin-top: 1px;
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

/* 逐条审查时在统一工具栏标注当前文件来自哪条提交。 */
.diff-source {
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
