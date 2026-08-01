<!--
  @component ToastContainer
  @description
    右下角 Toast 气泡容器。成功绿 / 失败红 / 进行中蓝灰，2.5s 自动消失。
  @usage <ToastContainer />
  @changeLog
    - 2026-07-30: Created. 交互反馈优化 - 操作瞬时反馈。
-->
<script setup lang="ts">
import { useToast } from "@/composables/useToast";

const { toasts } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  right: 16px;
  bottom: 40px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 3000;
  pointer-events: none;
}

.toast {
  min-width: 180px;
  max-width: 320px;
  padding: 8px 14px;
  border-radius: 4px;
  font-size: 13px;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.toast.success {
  background: var(--success);
}

.toast.error {
  background: var(--danger);
}

.toast.info {
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  color: var(--fg-primary);
}

/* 进入 / 离开动画 */
.toast-enter-active,
.toast-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
