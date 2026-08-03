<!--
  @component PromptDialog
  @description
    模态输入对话框，用于分支名等文本输入。Teleport 到 body，Enter 确认 / Esc 取消。
    替代 Tauri dialog 插件缺失的 prompt。
  @usage
    <PromptDialog v-if="state" :title="state.title" :default="state.default"
      @confirm="..." @cancel="..." />
  @changeLog
    - 2026-07-29: Created. 用于分支操作输入（9.x）。
-->
<script setup lang="ts">
import { ref, onMounted } from "vue";

const props = defineProps<{
  title: string;
  placeholder?: string;
  default?: string;
}>();

const emit = defineEmits<{
  confirm: [value: string];
  cancel: [];
}>();

const value = ref(props.default ?? "");
const inputEl = ref<HTMLInputElement | null>(null);

onMounted(() => {
  inputEl.value?.focus();
  inputEl.value?.select();
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && value.value.trim()) {
    emit("confirm", value.value.trim());
  } else if (e.key === "Escape") {
    emit("cancel");
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('cancel')">
      <div class="dialog">
        <div class="dialog-title">{{ title }}</div>
        <input
          ref="inputEl"
          v-model="value"
          :placeholder="placeholder"
          class="dialog-input"
          @keydown="onKeydown"
        />
        <div class="dialog-actions">
          <button class="btn" @click="emit('cancel')">取消</button>
          <button
            class="btn primary"
            :disabled="!value.trim()"
            @click="emit('confirm', value.trim())"
          >
            确定
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
  width: 320px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--shadow-lg);
}

.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
  margin-bottom: 12px;
}

.dialog-input {
  width: 100%;
  height: 28px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--ctrl-radius);
  color: var(--fg-primary);
  font-size: 13px;
  padding: 0 12px;
  outline: none;
  font-family: inherit;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.dialog-input:focus {
  border-color: var(--accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  height: 28px;
  padding: 0 16px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.btn:hover:not(:disabled) {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
