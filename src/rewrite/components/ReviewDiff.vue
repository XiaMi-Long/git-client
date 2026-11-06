<!--
  @component ReviewDiff
  @description
    审查弹窗内的真实 Git diff 渲染：统一视图 / 双栏视图 / 自动换行。
    复用原型视觉类名，由 src/styles/rewrite.css 提供样式。

  @usage
    <ReviewDiff :file="activeFile" :view="diffView" :wrap="wrap" />

  @dataFormat
    file: FileDiff | null；hunks[].lines[].line_type 为 added/deleted/context。

  @changeLog
    - 2026-11-04: Created. 新 Review 真实 diff 渲染，统一/双栏/换行。
-->
<script setup lang="ts">
import { computed } from "vue";
import type { DiffLine, FileDiff } from "@/types/git";
import { highlightCode } from "../utils/highlight";

const props = defineProps<{
  file: FileDiff | null;
  view: "unified" | "split";
  wrap: boolean;
}>();

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
    lines: hunk.lines.filter((line) => line.line_type !== "hunkheader" && line.line_type !== "diffheader"),
  }));
});

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** 双栏行对齐：context 双侧，added 右侧，deleted 左侧 */
const splitHunks = computed(() => {
  if (!props.file) return [];
  return props.file.hunks.map((hunk) => {
    const rows: SplitRow[] = [];
    for (const line of hunk.lines) {
      if (line.line_type === "hunkheader" || line.line_type === "diffheader") continue;
      if (line.line_type === "added") {
        rows.push({ left: null, right: line });
      } else if (line.line_type === "deleted") {
        rows.push({ left: line, right: null });
      } else {
        rows.push({ left: line, right: line });
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
          v-for="(line, index) in hunk.lines"
          :key="`${hunk.header}-${index}`"
          class="diff-line"
          :class="lineClass(line)"
        >
          <span class="ln">{{ line.old_line_no ?? "" }}</span>
          <span class="ln">{{ line.new_line_no ?? "" }}</span>
          <span class="sign">{{ lineSign(line) }}</span>
          <span class="code" v-html="highlightCode(line.content)"></span>
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
            :class="row.left ? lineClass(row.left) : 'blank'"
          >
            <span class="ln">{{ row.left?.old_line_no ?? "" }}</span>
            <span class="sign">{{ row.left ? lineSign(row.left) : "" }}</span>
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
            :class="row.right ? lineClass(row.right) : 'blank'"
          >
            <span class="ln">{{ row.right?.new_line_no ?? "" }}</span>
            <span class="sign">{{ row.right ? lineSign(row.right) : "" }}</span>
            <span class="code" v-html="row.right ? highlightCode(row.right.content) : ''"></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
