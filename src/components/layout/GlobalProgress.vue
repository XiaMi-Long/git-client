<!--
  @component GlobalProgress
  @description
    顶部全局进度条（VS Code 风格）。Git 操作（currentOp）进行中显示。
  @usage <GlobalProgress />
  @changeLog
    - 2026-07-30: Created. 交互反馈优化 - 操作明显反馈。
-->
<script setup lang="ts">
import { computed } from "vue";
import { useSelectionStore } from "@/stores/selection";

const selectionStore = useSelectionStore();

// 有 Git 操作进行中就显示进度条
const busy = computed(() => !!selectionStore.currentOp);
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="busy" class="global-progress">
      <div class="progress-bar" />
    </div>
  </Transition>
</template>

<style scoped>
.global-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 9999;
  overflow: hidden;
  pointer-events: none;
}

.progress-bar {
  height: 100%;
  width: 40%;
  background: var(--accent);
  animation: progress-slide 1.1s ease-in-out infinite;
}

@keyframes progress-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: opacity 200ms ease;
}

.progress-fade-enter-from,
.progress-fade-leave-to {
  opacity: 0;
}
</style>
