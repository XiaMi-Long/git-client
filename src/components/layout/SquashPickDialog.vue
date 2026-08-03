<!--
  @component SquashPickDialog
  @description
    压缩挑拣弹窗 -- 从源分支挑选多个提交压缩为一个，合并到当前分支。
    场景1 跨分支：cherry-pick --no-commit 多个 + commit
    场景2 本分支：reset --soft HEAD~N + commit（须最近连续）
  @workflow
    1. 选源分支（默认当前分支）-> 加载该分支提交。
    2. 多选提交（本分支须从 HEAD 起连续）。
    3. 输入新提交信息 -> 执行压缩。
  @changeLog
    - 2026-07-30: Created. 压缩挑拣弹窗。
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import { useDialog } from "@/composables/useDialog";
import type { CommitInfo } from "@/types/git";
import ConfirmDialog from "./ConfirmDialog.vue";
import CommitDetailViewer from "./CommitDetailViewer.vue";

const emit = defineEmits<{ close: [] }>();
const repoStore = useRepoStore();
const selectionStore = useSelectionStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// 动画
const show = ref(false);
onMounted(() => {
  show.value = true;
});
function close() {
  show.value = false;
  setTimeout(() => emit("close"), 150);
}

// 当前分支
const currentBranch = computed(
  () => repoStore.activeRepo?.branches.find((b) => b.is_current)?.name ?? ""
);
const branchOptions = computed(() =>
  (repoStore.activeRepo?.branches ?? []).map((b) => b.name)
);

const sourceBranch = ref(currentBranch.value);
const commits = ref<CommitInfo[]>([]);
const selectedHashes = ref<Set<string>>(new Set());
const commitMessage = ref("");
const loading = ref(false);
const executing = ref(false);

// 右侧详情：当前查看的提交（默认第一个）
const viewingCommit = ref<string | null>(null);

const isLocal = computed(() => sourceBranch.value === currentBranch.value);
const selectedList = computed(() => Array.from(selectedHashes.value));

// 加载源分支提交
async function loadCommits() {
  const path = repoStore.activeRepo?.path;
  if (!path) return;
  loading.value = true;
  try {
    const result = await invoke<CommitInfo[]>("git_get_log", {
      path,
      query: {
        skip: 0,
        limit: 100,
        branch: isLocal.value ? null : sourceBranch.value,
        search: null,
        all_branches: false,
      },
    });
    commits.value = result;
  } catch {
    commits.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  sourceBranch,
  () => {
    selectedHashes.value = new Set();
    commitMessage.value = "";
    loadCommits();
  },
  { immediate: true }
);

// 提交加载完成后默认查看第一个
watch(commits, (list) => {
  if (list.length > 0 && !viewingCommit.value) {
    viewingCommit.value = list[0].hash;
  }
});

function toggleHash(hash: string) {
  const s = new Set(selectedHashes.value);
  if (s.has(hash)) s.delete(hash);
  else s.add(hash);
  selectedHashes.value = s;
}

// 场景2：验证选中是最近连续 N 个（从 HEAD 起）
function validateLocalContiguous(): { valid: boolean; error?: string } {
  if (!isLocal.value) return { valid: true };
  const logHashes = commits.value.map((c) => c.hash);
  const indices = selectedList.value
    .map((h) => logHashes.indexOf(h))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      return { valid: false, error: "本分支压缩只能选择最近的连续提交（从 HEAD 起）" };
    }
  }
  return { valid: true };
}

async function execute() {
  if (selectedList.value.length === 0) {
    await showMessage("提示", "请至少选择一个提交");
    return;
  }
  if (!commitMessage.value.trim()) {
    await showMessage("提示", "请输入新的提交信息");
    return;
  }
  const v = validateLocalContiguous();
  if (!v.valid) {
    await showMessage("无法压缩", v.error!);
    return;
  }
  executing.value = true;
  try {
    const hashes = selectedList.value;
    const result = isLocal.value
      ? await selectionStore.squashPickLocal(hashes, commitMessage.value.trim())
      : await selectionStore.squashPickFromBranch(hashes, commitMessage.value.trim());
    if (result) {
      await showMessage(result.success ? "压缩挑拣" : "压缩挑拣失败", result.message);
      if (result.success) {
        show.value = false;
        setTimeout(() => emit("close"), 150);
      }
    }
  } finally {
    executing.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="show" class="overlay" @click.self="close">
        <div class="squash-dialog">
          <div class="dialog-header">
            <span>压缩挑拣</span>
            <button class="close-btn" title="关闭" @click="close">×</button>
          </div>

          <div class="dialog-body">
            <!-- 左侧：选择与配置 -->
            <div class="left-panel">
              <!-- 当前分支提示（固定） -->
              <div class="current-branch-hint">当前分支：<strong>{{ currentBranch }}</strong></div>

              <!-- 源分支选择 -->
              <div class="form-row">
                <label>源分支</label>
                <select v-model="sourceBranch">
                  <option v-for="b in branchOptions" :key="b" :value="b">{{ b }}</option>
                </select>
              </div>
              <div class="hint">
                {{ isLocal ? "本分支压缩：选择最近的连续提交（从 HEAD 起）" : `跨分支：从 ${sourceBranch} 挑选提交压缩合并到 ${currentBranch}` }}
              </div>

              <!-- 提交列表 -->
              <div class="commit-list">
                <div v-if="loading" class="load-hint">加载中…</div>
                <div v-else-if="commits.length === 0" class="load-hint">暂无提交</div>
                <div
                  v-for="c in commits"
                  :key="c.hash"
                  class="commit-item"
                  :class="{ selected: selectedHashes.has(c.hash) }"
                  @click="toggleHash(c.hash)"
                >
                  <span class="checkbox">{{ selectedHashes.has(c.hash) ? "☑" : "☐" }}</span>
                  <span class="hash">{{ c.short_hash }}</span>
                  <span class="subject">{{ c.subject }}</span>
                  <span class="author">{{ c.author_name }}</span>
                  <button
                    class="view-btn"
                    :class="{ active: viewingCommit === c.hash }"
                    title="查看该提交的更改"
                    @click.stop="viewingCommit = c.hash"
                  >
                    查看
                  </button>
                </div>
              </div>

              <!-- 新 commit 文本 -->
              <div class="form-row">
                <label>新提交信息</label>
                <input v-model="commitMessage" type="text" placeholder="压缩后的提交信息" />
              </div>
            </div>

            <!-- 右侧：提交详情查看器（模块化） -->
            <div class="right-panel">
              <div class="right-title">提交详情</div>
              <CommitDetailViewer
                :path="repoStore.activeRepo?.path ?? ''"
                :commit-hash="viewingCommit"
              />
            </div>
          </div>

          <div class="dialog-footer">
            <span class="selected-count">已选 {{ selectedList.length }} 个</span>
            <button class="btn" @click="close">取消</button>
            <button
              class="btn primary"
              :disabled="executing || selectedList.length === 0 || !commitMessage.trim()"
              @click="execute"
            >
              {{ executing ? "执行中…" : "执行压缩" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <ConfirmDialog
      v-if="dialogState"
      :title="dialogState.title"
      :message="dialogState.message"
      :hide-cancel="dialogState.hideCancel"
      :danger="dialogState.danger"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.squash-dialog {
  width: 70vw;
  height: 70vh;
  min-width: 900px;
  min-height: 560px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
  flex-shrink: 0;
}

.close-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 18px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.dialog-body {
  flex: 1;
  padding: 16px;
  display: flex;
  gap: 16px;
  overflow: hidden;
}

/* 左侧面板：选择与配置 */
.left-panel {
  width: 46%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 右侧面板：提交详情 */
.right-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  overflow: hidden;
}

.right-title {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--fg-tertiary);
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.current-branch-hint {
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.current-branch-hint strong {
  color: var(--accent);
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.form-row label {
  width: 90px;
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.form-row select,
.form-row input[type="text"] {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
}

.form-row select:focus,
.form-row input[type="text"]:focus {
  border-color: var(--accent);
}

.hint {
  margin-left: 102px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--fg-tertiary);
}

.commit-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  background: var(--bg-base);
}

.load-hint {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-tertiary);
  font-size: 13px;
}

.commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-default);
  font-size: 13px;
}

.commit-item:hover {
  background: var(--bg-hover);
}

.commit-item.selected {
  background: var(--accent);
  color: #fff;
}

.checkbox {
  width: 16px;
  flex-shrink: 0;
}

.hash {
  width: 56px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  color: var(--fg-tertiary);
  flex-shrink: 0;
}

.commit-item.selected .hash {
  color: rgba(255, 255, 255, 0.7);
}

.subject {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author {
  width: 80px;
  font-size: 12px;
  color: var(--fg-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.commit-item.selected .author {
  color: rgba(255, 255, 255, 0.7);
}

/* 查看提交详情按钮 */
.view-btn {
  height: 20px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-tertiary);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.view-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.view-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.commit-item.selected .view-btn {
  border-color: rgba(255, 255, 255, 0.5);
  color: rgba(255, 255, 255, 0.85);
}

.commit-item.selected .view-btn.active {
  background: rgba(255, 255, 255, 0.9);
  border-color: transparent;
  color: var(--accent);
}

.dialog-footer {
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border-default);
  flex-shrink: 0;
}

.selected-count {
  flex: 1;
  font-size: 12px;
  color: var(--fg-tertiary);
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

/* 动画（同设置弹窗） */
.settings-enter-active,
.settings-leave-active {
  transition: opacity 150ms ease;
}

.settings-enter-active .squash-dialog,
.settings-leave-active .squash-dialog {
  transition: opacity 150ms ease, transform 150ms ease;
}

.settings-enter-from,
.settings-leave-to {
  opacity: 0;
}

.settings-enter-from .squash-dialog,
.settings-leave-to .squash-dialog {
  opacity: 0;
  transform: scale(0.96);
}
</style>
