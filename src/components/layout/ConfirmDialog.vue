<!--
  @component ConfirmDialog
  @description
    模态确认 / 消息对话框，Teleport 到 body。替代原生 message/confirm，统一 UI 风格。
    hideCancel=true 时仅显示"确定"（消息提示），否则显示"取消/确定"（确认）。
  @usage
    <ConfirmDialog v-if="dlg" :title="dlg.title" :message="dlg.message"
      :hide-cancel="dlg.hideCancel" :danger="dlg.danger"
      @confirm="onConfirm" @cancel="onCancel" />
  @changeLog
    - 2026-07-30: Created. 统一确认/消息弹窗（替代原生 message/confirm）。
-->
<script setup lang="ts">
import { onMounted, ref } from "vue";

defineProps<{
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** true 时仅显示确定按钮（消息提示模式） */
  hideCancel?: boolean;
  /** true 时确定按钮为危险色（删除等） */
  danger?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialogEl = ref<HTMLElement | null>(null);

onMounted(() => {
  dialogEl.value?.focus();
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    emit("confirm");
  } else if (e.key === "Escape") {
    emit("cancel");
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('cancel')">
      <div ref="dialogEl" class="dialog" tabindex="0" @keydown="onKeydown">
        <div class="dialog-title">{{ title }}</div>
        <div class="dialog-message">{{ message }}</div>
        <div class="dialog-actions">
          <button v-if="!hideCancel" class="btn" @click="emit('cancel')">
            {{ cancelText ?? "取消" }}
          </button>
          <button class="btn primary" :class="{ danger }" @click="emit('confirm')">
            {{ confirmText ?? "确定" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog {
  width: 360px;
  max-width: 90vw;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  padding: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  outline: none;
}

.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
  margin-bottom: 12px;
}

.dialog-message {
  font-size: 13px;
  color: var(--fg-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  margin-bottom: 16px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  height: 28px;
  padding: 0 16px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.btn:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.primary:hover {
  background: var(--accent-hover);
}

.btn.primary.danger {
  background: var(--danger);
  border-color: var(--danger);
}

.btn.primary.danger:hover {
  opacity: 0.85;
}
</style>
