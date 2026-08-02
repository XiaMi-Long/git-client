<!--
  @component StashCreateDialog
  @description
    创建存储（stash）命名弹窗。默认名由设置模板渲染（yyyy-mm-dd-时-分），用户可修改。
  @usage
    <StashCreateDialog :scope="scope" @close="..." @created="..." />
  @changeLog
    - 2026-08-01: Created. 储藏功能 - 命名弹窗。
-->
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useSettingsStore } from "@/stores/settings";
import { useToast } from "@/composables/useToast";

const props = defineProps<{
  /** 储藏范围：unstaged / staged / all */
  scope: "unstaged" | "staged" | "all";
}>();

const emit = defineEmits<{ close: []; created: [] }>();

const repoStore = useRepoStore();
const settingsStore = useSettingsStore();
const toast = useToast();

const name = ref(settingsStore.renderStashName());
const saving = ref(false);
const show = ref(false);

const scopeLabel = computed(() => {
  switch (props.scope) {
    case "unstaged":
      return "未暂存的改动";
    case "staged":
      return "已暂存的改动";
    default:
      return "全部改动（含未跟踪文件）";
  }
});

const previewName = computed(() => {
  // 若用户没改过且模板含占位符，实时预览渲染效果
  return name.value.trim();
});

onMounted(() => {
  show.value = true;
});

function close() {
  show.value = false;
  setTimeout(() => emit("close"), 150);
}

async function create() {
  const msg = name.value.trim();
  if (!msg) {
    toast.error("存储名不能为空");
    return;
  }
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  saving.value = true;
  try {
    await invoke("git_create_stash", { path, message: msg, scope: props.scope });
    toast.success(`已储藏 ${scopeLabel.value}`);
    emit("created");
    close();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="stash-overlay" :class="{ show }" @click.self="close">
      <div class="stash-dialog" :class="{ show }">
        <div class="dialog-title">创建存储</div>
        <div class="dialog-body">
          <div class="scope-line">将储藏：<b>{{ scopeLabel }}</b></div>
          <div class="name-row">
            <label>存储名</label>
            <input
              v-model="name"
              type="text"
              class="name-input"
              placeholder="输入存储名"
              @keydown.enter="create"
            />
          </div>
          <div class="hint">
            默认名来自设置中的模板（当前渲染：{{ previewName }}）<br />
            支持占位符：${'${yyyy}'} ${'${mm}'} ${'${dd}'} ${'${HH}'} ${'${MM}'} ${'${ss}'}
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn cancel" @click="close">取消</button>
          <button class="btn primary" :disabled="saving || !name.trim()" @click="create">
            {{ saving ? "存储中…" : "创建存储" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.stash-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 150ms ease;
}
.stash-overlay.show {
  opacity: 1;
}

.stash-dialog {
  width: 420px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transform: scale(0.96);
  transition: transform 150ms ease;
}
.stash-dialog.show {
  transform: scale(1);
}

.dialog-title {
  font-size: 14px;
  font-weight: 500;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
}

.dialog-body {
  padding: 16px;
}

.scope-line {
  font-size: 13px;
  color: var(--fg-secondary);
  margin-bottom: 14px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.name-row label {
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
}
.name-input {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 3px;
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
}
.name-input:focus {
  border-color: var(--accent);
}

.hint {
  font-size: 12px;
  color: var(--fg-tertiary);
  line-height: 1.6;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-default);
}

.btn {
  height: 28px;
  padding: 0 16px;
  border-radius: 3px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 150ms ease;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.cancel {
  background: transparent;
  border-color: var(--border-default);
  color: var(--fg-primary);
}
.btn.primary {
  background: var(--accent);
  color: #fff;
}
</style>
