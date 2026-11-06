<!--
  @component ConflictDialog
  @description
    merge / pull / cherry-pick 冲突处理弹窗：冲突文件列表、外部编辑器打开、标记已解决、
    检查冲突标记、继续和中止。外部编辑器负责文件内容，应用只做 Git 状态操作。

  @usage
    <ConflictDialog v-if="open" :operation="operation" :files="files" :busy="busy"
      @close="..." @resolve="..." @open-file="..." @check="..." @continue="..." @abort="..." />

  @dataFormat
    operation: OperationState；files: string[]。

  @changeLog
    - 2026-11-04: Created. 真实冲突文件处理与继续/中止。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { OperationState } from "@/types/git";

const props = defineProps<{
  operation: OperationState;
  files: string[];
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  resolve: [file: string];
  openFile: [file: string];
  check: [];
  continue: [];
  abort: [];
}>();

const dialog = ref<HTMLElement | null>(null);

const title = computed(() => {
  if (props.operation === "cherrypicking") return "挑拣冲突";
  if (props.operation === "merging") return "合并冲突";
  if (props.operation === "rebasing") return "rebase 冲突";
  return "冲突处理";
});

const canContinue = computed(
  () => props.files.length === 0 && props.operation !== "conflict" && props.operation !== "rebasing",
);

/**
 * 弹窗内 Esc 关闭，不触发继续/中止。
 * @param event - 键盘事件
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

onMounted(async () => {
  await nextTick();
  dialog.value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section ref="dialog" class="dialog conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflictTitle" tabindex="-1" @keydown="onKeydown">
        <header class="dialog-header">
          <div class="dialog-heading">
            <div class="dialog-label">冲突处理</div>
            <h2 id="conflictTitle" class="dialog-subject">{{ title }}</h2>
            <div class="dialog-meta">{{ files.length ? `${files.length} 个文件待解决` : "冲突已全部标记解决" }}</div>
          </div>
          <div class="dialog-actions">
            <button class="close-btn" type="button" aria-label="关闭冲突处理" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="conflict-body">
          <div v-if="!files.length" class="conflict-empty">所有冲突文件都已标记解决，可以继续。</div>
          <div v-for="file in files" :key="file" class="conflict-row">
            <span class="conflict-status">UU</span>
            <span class="conflict-path" :title="file">{{ file }}</span>
            <button class="conflict-resolve secondary" type="button" :disabled="busy" @click="emit('openFile', file)">打开文件</button>
            <button class="conflict-resolve" type="button" :disabled="busy" @click="emit('resolve', file)">标记已解决</button>
          </div>
        </div>

        <footer class="dialog-footer">
          <div class="foot-left">
            <button class="foot-btn" type="button" :disabled="busy" @click="emit('check')">检查冲突标记</button>
          </div>
          <div class="foot-center">{{ files.length ? `${files.length} 个待解决` : "可以继续" }}</div>
          <div class="foot-right conflict-actions">
            <button class="foot-btn" type="button" :disabled="busy" @click="emit('abort')">中止</button>
            <button class="action-btn primary small" type="button" :disabled="busy || !canContinue" @click="emit('continue')">继续</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
