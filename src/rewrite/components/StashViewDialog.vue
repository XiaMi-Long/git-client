<!--
  @component StashViewDialog
  @description
    储藏详情弹窗：真实 stash diff 文件列表与统一/双栏/换行视图。

  @usage
    <StashViewDialog v-if="stashView" :stash="stashView.stash" :files="stashView.files" @close="..." />

  @changeLog
    - 2026-11-04: Created. 储藏查看接 git_show_stash 的真实 diff。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { FileDiff, StashInfo } from "@/types/git";
import ReviewDiff from "./ReviewDiff.vue";

const props = defineProps<{
  stash: StashInfo;
  files: FileDiff[];
}>();

const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLElement | null>(null);
const activeFile = ref(0);
const view = ref<"unified" | "split">("unified");
const wrap = ref(false);

const currentFile = computed(() => props.files[activeFile.value] ?? null);

/**
 * 文件状态字母。
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
 * Esc 关闭。
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
      <section ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="stashTitle" tabindex="-1" @keydown="onKeydown">
        <header class="dialog-header">
          <div class="dialog-heading">
            <div class="dialog-label">储藏详情</div>
            <h2 id="stashTitle" class="dialog-subject">{{ stash.message }}</h2>
            <div class="dialog-meta">{{ stash.index }} · {{ stash.branch }} · {{ stash.hash }}</div>
          </div>
          <div class="dialog-actions">
            <button class="close-btn" type="button" aria-label="关闭储藏详情" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="dialog-body">
          <aside class="files" aria-label="储藏文件">
            <div class="files-head"><span>改动文件</span><span>{{ files.length }}</span></div>
            <button
              v-for="(file, index) in files"
              :key="`${file.old_path}-${file.new_path}`"
              type="button"
              class="file-row"
              :class="{ active: index === activeFile }"
              :title="file.new_path"
              @click="activeFile = index"
            >
              <span class="file-status" :class="fileStatus(file).toLowerCase()">{{ fileStatus(file) }}</span>
              <span class="file-name">{{ file.new_path }}</span>
              <span class="file-stat">+{{ file.additions }} −{{ file.deletions }}</span>
            </button>
          </aside>
          <section class="diff" :class="{ wrap }" aria-label="储藏差异">
            <div class="diff-toolbar">
              <button class="tab" :class="{ active: view === 'unified' }" type="button" @click="view = 'unified'">统一</button>
              <button class="tab" :class="{ active: view === 'split' }" type="button" @click="view = 'split'">双栏</button>
              <button class="tab" :class="{ active: wrap }" type="button" @click="wrap = !wrap">换行</button>
            </div>
            <ReviewDiff :file="currentFile" :view="view" :wrap="wrap" />
          </section>
        </div>

        <footer class="dialog-footer">
          <div class="foot-left"><span class="foot-hint">只读储藏内容</span></div>
          <div class="foot-center">{{ files.length ? `文件 ${activeFile + 1} / ${files.length}` : "文件 0 / 0" }}</div>
          <div class="foot-right"><span class="foot-hint">Esc 关闭</span></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
