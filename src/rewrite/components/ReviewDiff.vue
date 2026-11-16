<!--
  @component ReviewDiff
  @description
    审查弹窗内的真实 Git diff 渲染：统一视图 / 双栏视图 / 自动换行 / 可选逐行作者。
    复用原型视觉类名，由 src/styles/rewrite.css 提供样式。

  @usage
    <ReviewDiff :file="activeFile" :view="diffView" :wrap="wrap"
      :show-blame="showBlame" :old-blame="oldBlame" :new-blame="newBlame" />

  @dataFormat
    file: FileDiff | null；hunks[].lines[].line_type 为 added/deleted/context。
    oldBlame/newBlame: 行号 → BlameLine 的映射，分别对应旧、新版本文件。

  @changeLog
    - 2026-11-04: Created. 新 Review 真实 diff 渲染，统一/双栏/换行。
    - 2026-11-16: Updated. 支持在行号右侧展示逐行作者信息。
-->
<script setup lang="ts">
import { computed } from "vue";
import type { BlameLine, DiffLine, FileDiff } from "@/types/git";
import { highlightCode } from "../utils/highlight";

const props = withDefaults(defineProps<{
  file: FileDiff | null;
  view: "unified" | "split";
  wrap: boolean;
  /** 是否在行号右侧展示逐行作者 */
  showBlame?: boolean;
  /** 旧版本行号对应的 blame，删除行和双栏左侧使用 */
  oldBlame?: Map<number, BlameLine>;
  /** 新版本行号对应的 blame，新增行、上下文和双栏右侧使用 */
  newBlame?: Map<number, BlameLine>;
}>(), {
  showBlame: false,
  oldBlame: () => new Map<number, BlameLine>(),
  newBlame: () => new Map<number, BlameLine>(),
});

/**
 * 从行号映射中取出作者信息。
 * @param source - 旧版本或新版本的 blame 行号映射
 * @param lineNumber - 当前行的版本行号
 * @returns 对应作者；开关关闭或行号为空时为 null
 */
function blameForLine(source: Map<number, BlameLine>, lineNumber: number | null): BlameLine | null {
  if (!props.showBlame || lineNumber == null) {
    return null;
  }
  return source.get(lineNumber) ?? null;
}

/**
 * 统一视图的行作者：删除行查旧版本，其他行优先查新版本。
 * @param line - diff 行
 * @returns 对应作者
 */
function unifiedBlame(line: DiffLine): BlameLine | null {
  if (line.line_type === "deleted") {
    return blameForLine(props.oldBlame, line.old_line_no);
  }
  return blameForLine(props.newBlame, line.new_line_no) ?? blameForLine(props.oldBlame, line.old_line_no);
}

/**
 * 生成作者列悬停说明。
 * @param blame - 作者信息
 * @returns 作者、提交短哈希和标题
 */
function blameTitle(blame: BlameLine): string {
  const authorName = blame.author_name || "未知作者";
  const identity = blame.author_email ? `${authorName} <${blame.author_email}>` : authorName;
  const summary = blame.summary ? ` · ${blame.summary}` : "";
  return `${identity} · ${blame.short_hash}${summary}`;
}

/** 统一视图行样式：真实 line_type -> 原型 class */
function lineClass(line: DiffLine): string {
  if (line.line_type === "added") return "add";
  if (line.line_type === "deleted") return "del";
  return "ctx";
}

/** 行首符号 */
function lineSign(line: DiffLine): string {
  if (line.line_type === "added") return "+";
  if (line.line_type === "deleted") return "-";
  return " ";
}

/** 统一视图只展示正文行，hunk 头已单独渲染 */
const unifiedHunks = computed(() => {
  if (!props.file) return [];
  return props.file.hunks.map((hunk) => ({
    header: hunk.header,
    lines: hunk.lines
      .filter((line) => line.line_type !== "hunkheader" && line.line_type !== "diffheader")
      .map((line) => ({ line, blame: unifiedBlame(line) })),
  }));
});

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  leftBlame: BlameLine | null;
  rightBlame: BlameLine | null;
}

/** 双栏行对齐：context 双侧，added 右侧，deleted 左侧 */
const splitHunks = computed(() => {
  if (!props.file) return [];
  return props.file.hunks.map((hunk) => {
    const rows: SplitRow[] = [];
    for (const line of hunk.lines) {
      if (line.line_type === "hunkheader" || line.line_type === "diffheader") continue;
      if (line.line_type === "added") {
        rows.push({
          left: null,
          right: line,
          leftBlame: null,
          rightBlame: blameForLine(props.newBlame, line.new_line_no),
        });
      } else if (line.line_type === "deleted") {
        rows.push({
          left: line,
          right: null,
          leftBlame: blameForLine(props.oldBlame, line.old_line_no),
          rightBlame: null,
        });
      } else {
        rows.push({
          left: line,
          right: line,
          leftBlame: blameForLine(props.oldBlame, line.old_line_no),
          rightBlame: blameForLine(props.newBlame, line.new_line_no),
        });
      }
    }
    return { header: hunk.header, rows };
  });
});
</script>

<template>
  <div class="review-diff">
    <div v-if="!file" class="diff-empty">这个提交没有文件改动</div>
    <div v-else-if="!file.hunks.length" class="diff-empty">该文件没有文本差异</div>

    <div v-else-if="view === 'unified'" class="diff-scroll">
      <template v-for="hunk in unifiedHunks" :key="hunk.header">
        <div class="hunk">{{ hunk.header }}</div>
        <div
          v-for="(entry, index) in hunk.lines"
          :key="`${hunk.header}-${index}`"
          class="diff-line"
          :class="[lineClass(entry.line), { 'with-blame': showBlame }]"
        >
          <span class="ln">{{ entry.line.old_line_no ?? "" }}</span>
          <span class="ln">{{ entry.line.new_line_no ?? "" }}</span>
          <span class="sign">{{ lineSign(entry.line) }}</span>
          <span v-if="showBlame" class="blame" :title="entry.blame ? blameTitle(entry.blame) : undefined">
            {{ entry.blame?.author_name || "" }}
          </span>
          <span class="code" v-html="highlightCode(entry.line.content)"></span>
        </div>
      </template>
    </div>

    <div v-else class="diff-split">
      <div class="pane">
        <div class="pane-head">旧文件</div>
        <template v-for="hunk in splitHunks" :key="`left-${hunk.header}`">
          <div class="hunk">{{ hunk.header }}</div>
          <div
            v-for="(row, index) in hunk.rows"
            :key="`left-${hunk.header}-${index}`"
            class="split-line"
            :class="[row.left ? lineClass(row.left) : 'blank', { 'with-blame': showBlame }]"
          >
            <span class="ln">{{ row.left?.old_line_no ?? "" }}</span>
            <span class="sign">{{ row.left ? lineSign(row.left) : "" }}</span>
            <span v-if="showBlame" class="blame" :title="row.leftBlame ? blameTitle(row.leftBlame) : undefined">
              {{ row.leftBlame?.author_name || "" }}
            </span>
            <span class="code" v-html="row.left ? highlightCode(row.left.content) : ''"></span>
          </div>
        </template>
      </div>

      <div class="pane">
        <div class="pane-head">新文件</div>
        <template v-for="hunk in splitHunks" :key="`right-${hunk.header}`">
          <div class="hunk">{{ hunk.header }}</div>
          <div
            v-for="(row, index) in hunk.rows"
            :key="`right-${hunk.header}-${index}`"
            class="split-line"
            :class="[row.right ? lineClass(row.right) : 'blank', { 'with-blame': showBlame }]"
          >
            <span class="ln">{{ row.right?.new_line_no ?? "" }}</span>
            <span class="sign">{{ row.right ? lineSign(row.right) : "" }}</span>
            <span v-if="showBlame" class="blame" :title="row.rightBlame ? blameTitle(row.rightBlame) : undefined">
              {{ row.rightBlame?.author_name || "" }}
            </span>
            <span class="code" v-html="row.right ? highlightCode(row.right.content) : ''"></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
