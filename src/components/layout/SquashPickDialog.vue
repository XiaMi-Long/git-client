<!--
  @component SquashPickDialog
  @description
    压缩挑拣弹窗 -- 从源分支挑选多个提交压缩为一个，合并到当前分支。
    场景1 跨分支：逐个 cherry-pick（每个单独落地）+ 末尾压缩为一个
    场景2 本分支：reset --soft HEAD~N + commit（须最近连续）
  @workflow
    1. 选择阶段：选源分支（默认当前分支）-> 多选提交 -> 输入新提交信息。
    2. 执行阶段：横向流水线可视化逐个挑拣进度；冲突时中断，
       支持「已解决继续」（自动校验冲突标记）/「取消本次提交」（保留已完成的）。
    3. 总结阶段：展示挑拣数与新提交哈希。
  @changeLog
    - 2026-07-30: Created. 压缩挑拣弹窗。
    - 2026-08-07: 重做为双阶段流水线弹窗（逐个挑拣 + 末尾压缩 + 冲突中断处理）。
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import { useCommitStore } from "@/stores/commit";
import { useDialog } from "@/composables/useDialog";
import { useResizable } from "@/composables/useResizable";
import type { CommitInfo } from "@/types/git";
import ConfirmDialog from "./ConfirmDialog.vue";
import CommitDetailViewer from "./CommitDetailViewer.vue";

const emit = defineEmits<{ close: [] }>();
const repoStore = useRepoStore();
const selectionStore = useSelectionStore();
const commitStore = useCommitStore();
const { dialogState, showConfirm, showMessage, onConfirm, onCancel } = useDialog();

// 动画
const show = ref(false);
onMounted(() => {
  show.value = true;
});
function close() {
  show.value = false;
  setTimeout(() => emit("close"), 150);
}

// ===== 选择阶段（沿用原逻辑） =====

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
const searchText = ref("");
const filteredCommits = computed(() => {
  const kw = searchText.value.trim().toLowerCase();
  if (!kw) return commits.value;
  return commits.value.filter(
    (c) =>
      c.subject.toLowerCase().includes(kw) ||
      c.author_name.toLowerCase().includes(kw) ||
      c.hash.toLowerCase().includes(kw) ||
      c.short_hash.toLowerCase().includes(kw)
  );
});
// 左右面板拖拽分隔条（面板在左；默认 60%/40%，打开时按弹窗宽度计算）
const dialogEl = ref<HTMLElement | null>(null);
const { size: leftWidth, dragging, onMouseDown: onLeftResize } = useResizable({
  orientation: "horizontal",
  initial: 600,
  min: 360,
  max: 1000,
});
watch(show, async (v) => {
  if (v) {
    await nextTick();
    const w = dialogEl.value?.offsetWidth;
    if (w) leftWidth.value = Math.round(w * 0.6);
  }
});

// 右侧详情：当前查看的提交（默认第一个）
const viewingCommit = ref<string | null>(null);

const isLocal = computed(() => sourceBranch.value === currentBranch.value);
const selectedList = computed(() => Array.from(selectedHashes.value));

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

// ===== 执行阶段：流水线状态机 =====

type Phase = "select" | "execute" | "summary";
type ExecState = "running" | "conflict" | "postAbort" | "error";
type NodeState = "pending" | "running" | "done" | "conflict" | "skipped";

const phase = ref<Phase>("select");
const execState = ref<ExecState>("running");
const haltMessage = ref("");
const pickOrder = ref<CommitInfo[]>([]);
const pickStates = ref<NodeState[]>([]);
const currentIndex = ref(-1);
const doneCount = ref(0);
const squashState = ref<NodeState>("pending");
const conflictFiles = ref<string[]>([]);
const origHead = ref("");
const copiedPath = ref("");
const summary = ref<{ picked: number; squashed: boolean; newHash: string } | null>(null);

// 执行进行中锁定关闭（冲突 / 中止后等终态允许关闭，交由主界面冲突处理接管）
const locked = computed(() => phase.value === "execute" && execState.value === "running");

// 流水线节点（选提交 → 逐个挑拣 → 压缩为 1 个）
const stepperNodes = computed(() => {
  const nodes: { key: string; label: string; sub: string; state: NodeState }[] = [
    { key: "select", label: "选提交", sub: `${pickOrder.value.length} 个`, state: "done" },
  ];
  if (!isLocal.value) {
    pickOrder.value.forEach((c, i) => {
      nodes.push({
        key: c.hash,
        label: c.short_hash,
        sub: c.subject,
        state: pickStates.value[i] ?? "pending",
      });
    });
  }
  nodes.push({ key: "squash", label: "压缩为 1 个", sub: "", state: squashState.value });
  return nodes;
});

// 当前节点自动滚动到可视区
const nodeEls = ref<HTMLElement[]>([]);
watch(currentIndex, async (i) => {
  await nextTick();
  // +1 偏移：首节点是「选提交」
  nodeEls.value[i + 1]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
});

function resetExecState() {
  execState.value = "running";
  haltMessage.value = "";
  pickStates.value = [];
  currentIndex.value = -1;
  doneCount.value = 0;
  squashState.value = "pending";
  conflictFiles.value = [];
  summary.value = null;
}

/** 脏工作区预检查：有未提交改动则拦截 */
function isWorktreeDirty(): boolean {
  const st = repoStore.activeRepo?.status;
  if (!st) return false;
  return (
    st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length > 0
  );
}

/** 点「执行压缩」：预检查后进入执行阶段 */
async function startExecute() {
  if (selectedList.value.length === 0) {
    await showMessage("提示", "请至少选择一个提交");
    return;
  }
  const needMessage = isLocal.value || selectedList.value.length >= 2;
  if (needMessage && !commitMessage.value.trim()) {
    await showMessage("提示", "请输入新的提交信息");
    return;
  }
  const v = validateLocalContiguous();
  if (!v.valid) {
    await showMessage("无法压缩", v.error!);
    return;
  }
  if (isWorktreeDirty()) {
    await showMessage("无法执行", "工作区存在未提交的改动，请先提交或放弃改动后再执行压缩挑拣");
    return;
  }
  // 记录流程开始前的 HEAD，供「全部回滚」使用
  origHead.value = commitStore.commits[0]?.hash ?? "";
  // 跨分支按从旧到新排序（log 为新到旧，反转为挑拣顺序）
  pickOrder.value = commits.value
    .filter((c) => selectedHashes.value.has(c.hash))
    .reverse();
  resetExecState();
  pickStates.value = pickOrder.value.map(() => "pending" as NodeState);
  phase.value = "execute";
  if (isLocal.value) {
    await runLocalSquash();
  } else {
    await runPipeline(0);
  }
}

/** 场景2：本分支压缩（不会冲突，一步到位） */
async function runLocalSquash() {
  squashState.value = "running";
  try {
    const result = await selectionStore.squashPickLocal(
      pickOrder.value.map((c) => c.hash),
      commitMessage.value.trim()
    );
    if (result?.success) {
      squashState.value = "done";
      summary.value = {
        picked: pickOrder.value.length,
        squashed: true,
        newHash: commitStore.commits[0]?.short_hash ?? "",
      };
      phase.value = "summary";
    } else {
      squashState.value = "pending";
      phase.value = "select";
      await showMessage("压缩失败", result?.message ?? "本分支压缩失败");
    }
  } catch (e) {
    squashState.value = "pending";
    haltOnUnexpected(e);
  }
}

/** 场景1：逐个挑拣流水线（冲突 / 错误时中断） */
async function runPipeline(from: number) {
  try {
    await runPipelineInner(from);
  } catch (e) {
    haltOnUnexpected(e);
  }
}

async function runPipelineInner(from: number) {
  for (let i = from; i < pickOrder.value.length; i++) {
    currentIndex.value = i;
    pickStates.value[i] = "running";
    const result = await selectionStore.pickOneCommit(pickOrder.value[i].hash);
    if (!result) {
      pickStates.value[i] = "pending";
      phase.value = "select";
      return;
    }
    if (result.success) {
      pickStates.value[i] = "done";
      doneCount.value++;
      continue;
    }
    if (result.has_conflict) {
      pickStates.value[i] = "conflict";
      conflictFiles.value = await selectionStore.getConflictedFiles();
      execState.value = "conflict";
      return;
    }
    // 非冲突失败（如空提交）：跳过该提交并停住
    pickStates.value[i] = "skipped";
    haltMessage.value = result.message;
    execState.value = "error";
    return;
  }
  await finishSquash();
}

/** 末尾压缩：doneCount 个已挑拣提交压为一个（1 个时跳过） */
async function finishSquash() {
  try {
    await finishSquashInner();
  } catch (e) {
    squashState.value = "pending";
    haltOnUnexpected(e);
  }
}

async function finishSquashInner() {
  squashState.value = "running";
  if (doneCount.value === 0) {
    squashState.value = "pending";
    await showMessage("压缩挑拣", "没有成功挑拣的提交，已停止");
    backToSelect();
    return;
  }
  if (doneCount.value === 1) {
    // 只有一个提交无需压缩，保留其原提交
    squashState.value = "skipped";
    summary.value = {
      picked: 1,
      squashed: false,
      newHash: commitStore.commits[0]?.short_hash ?? "",
    };
    phase.value = "summary";
    return;
  }
  const result = await selectionStore.finalizeSquash(doneCount.value, commitMessage.value.trim());
  squashState.value = "done";
  summary.value = {
    picked: doneCount.value,
    squashed: true,
    newHash: commitStore.commits[0]?.short_hash ?? "",
  };
  phase.value = "summary";
  if (!result?.success) {
    await showMessage("压缩失败", "末尾压缩失败，已挑拣的提交仍保留在当前分支，请手动处理");
  }
}

// ===== 冲突中断处理 =====

/** 已解决，继续：自动校验冲突标记 → 暂存 → cherry-pick --continue → 流程继续 */
async function onResolvedContinue() {
  const v = await selectionStore.verifyAndContinue();
  if (!v.ok) {
    const detail = v.markerFiles.length > 0 ? `\n${v.markerFiles.join("\n")}` : "";
    await showMessage("无法继续", `${v.message}${detail}`);
    return;
  }
  pickStates.value[currentIndex.value] = "done";
  doneCount.value++;
  conflictFiles.value = [];
  execState.value = "running";
  await runPipeline(currentIndex.value + 1);
}

/** 取消本次提交：abort 当前这一个（保留已完成的），停住给三种去向 */
async function onAbortCurrent() {
  await selectionStore.abortCurrentPick();
  pickStates.value[currentIndex.value] = "skipped";
  conflictFiles.value = [];
  execState.value = "postAbort";
}

/** 继续剩余提交 */
async function onContinueRemaining() {
  execState.value = "running";
  await runPipeline(currentIndex.value + 1);
}

/** 结束并压缩已完成的 */
async function onFinishEarly() {
  execState.value = "running";
  await finishSquash();
}

/** 全部回滚（危险）：确认后 hard reset 到流程开始前 */
async function onRollbackRequest() {
  const ok = await showConfirm(
    "全部回滚",
    `将丢弃本次已挑拣的 ${doneCount.value} 个提交，恢复到执行前的状态，确定继续吗？`,
    true
  );
  if (!ok) return;
  const success = await selectionStore.rollbackAll(origHead.value);
  if (success) {
    backToSelect();
    await showMessage("全部回滚", "已恢复到压缩挑拣前的状态");
  } else {
    await showMessage("回滚失败", "回滚失败，请手动检查仓库状态");
  }
}

function backToSelect() {
  resetExecState();
  phase.value = "select";
}

/** 意外异常兜底：置为错误终态，避免弹窗永久锁死在「执行中」 */
function haltOnUnexpected(e: unknown) {
  haltMessage.value = e instanceof Error ? e.message : String(e);
  execState.value = "error";
}

function copyPath(p: string) {
  navigator.clipboard?.writeText(p);
  copiedPath.value = p;
  setTimeout(() => {
    if (copiedPath.value === p) copiedPath.value = "";
  }, 1200);
}

// ===== 关闭控制 =====

function requestClose() {
  if (locked.value) return;
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") requestClose();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="show" class="overlay" @click.self="requestClose">
        <div ref="dialogEl" class="squash-dialog">
          <div class="dialog-header">
            <span class="header-title">
              压缩挑拣
              <span v-if="phase === 'execute'" class="phase-badge">执行中</span>
              <span v-else-if="phase === 'summary'" class="phase-badge success">已完成</span>
            </span>
            <button
              class="close-btn"
              :disabled="locked"
              :title="locked ? '执行中，请稍候' : '关闭'"
              @click="requestClose"
            >×</button>
          </div>

          <!-- ===== 选择阶段 ===== -->
          <div v-if="phase === 'select'" class="dialog-body">
            <div class="left-panel" :style="{ width: leftWidth + 'px' }">
              <div class="current-branch-hint">当前分支：<strong>{{ currentBranch }}</strong></div>

              <div class="form-row">
                <label>源分支</label>
                <select v-model="sourceBranch">
                  <option v-for="b in branchOptions" :key="b" :value="b">{{ b }}</option>
                </select>
              </div>
              <div class="hint">
                {{ isLocal ? "本分支压缩：选择最近的连续提交（从 HEAD 起）" : `跨分支：从 ${sourceBranch} 逐个挑拣后压缩合并到 ${currentBranch}` }}
              </div>

              <div class="search-box">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input v-model="searchText" type="text" placeholder="搜索提交（信息/作者/哈希）…" />
              </div>
              <div class="commit-list">
                <div v-if="loading" class="load-hint">加载中…</div>
                <div v-else-if="filteredCommits.length === 0" class="load-hint">
                  {{ commits.length === 0 ? "暂无提交" : "没有匹配的提交" }}
                </div>
                <div
                  v-for="c in filteredCommits"
                  :key="c.hash"
                  class="commit-item"
                  :class="{ selected: selectedHashes.has(c.hash) }"
                  :title="`${c.subject}\n${c.author_name} · ${c.author_date ?? ''}`"
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

              <div class="form-row">
                <label>新提交信息</label>
                <input v-model="commitMessage" type="text" placeholder="压缩后的提交信息" />
              </div>
            </div>

            <div class="resizer resizer-v" :class="{ dragging }" @mousedown="onLeftResize" />

            <div class="right-panel">
              <div class="right-title">提交详情</div>
              <CommitDetailViewer
                :path="repoStore.activeRepo?.path ?? ''"
                :commit-hash="viewingCommit"
              />
            </div>
          </div>

          <!-- ===== 执行阶段 ===== -->
          <div v-else-if="phase === 'execute'" class="dialog-body exec-body">
            <!-- 横向流水线 -->
            <div class="stepper">
              <template v-for="(n, idx) in stepperNodes" :key="n.key">
                <div v-if="idx > 0" class="step-line" :class="{ filled: stepperNodes[idx - 1].state === 'done' || stepperNodes[idx - 1].state === 'skipped' }" />
                <div
                  :ref="(el) => (nodeEls[idx] = el as HTMLElement)"
                  class="step-node"
                  :class="n.state"
                >
                  <div class="step-circle">
                    <span v-if="n.state === 'done'" class="step-icon">✓</span>
                    <span v-else-if="n.state === 'conflict'" class="step-icon">!</span>
                    <span v-else-if="n.state === 'skipped'" class="step-icon">–</span>
                    <span v-else-if="n.state === 'running'" class="step-dot" />
                    <span v-else class="step-index">{{ idx }}</span>
                  </div>
                  <div class="step-label" :title="n.sub ? `${n.label} ${n.sub}` : n.label">{{ n.label }}</div>
                  <div v-if="n.sub" class="step-sub">{{ n.sub }}</div>
                </div>
              </template>
            </div>

            <!-- 执行中：进度信息 -->
            <div v-if="execState === 'running'" class="exec-panel running-panel">
              <div class="running-spinner" />
              <div class="running-text">
                <template v-if="isLocal">正在压缩本分支提交…</template>
                <template v-else-if="squashState === 'running'">正在压缩为 1 个提交…</template>
                <template v-else>
                  挑拣中 {{ currentIndex + 1 }} / {{ pickOrder.length }}
                  <span class="running-subject">{{ pickOrder[currentIndex]?.subject }}</span>
                </template>
              </div>
            </div>

            <!-- 冲突中断面板 -->
            <div v-else-if="execState === 'conflict'" class="exec-panel conflict-panel">
              <div class="panel-title danger">挑拣「{{ pickOrder[currentIndex]?.short_hash }}」时产生冲突</div>
              <div class="panel-desc">请在编辑器中解决以下文件的冲突后回来继续；也可以选择取消本次提交（已完成的挑拣将保留）。</div>
              <div class="conflict-file-list">
                <div v-for="f in conflictFiles" :key="f" class="conflict-file">
                  <span class="conflict-mark">⚠</span>
                  <span class="conflict-path" :title="f">{{ f }}</span>
                  <button class="copy-btn" @click="copyPath(f)">{{ copiedPath === f ? "已复制" : "复制路径" }}</button>
                </div>
              </div>
              <div class="panel-actions">
                <button class="btn primary" @click="onResolvedContinue">已解决，继续</button>
                <button class="btn" @click="onAbortCurrent">取消本次提交</button>
                <button class="btn danger" @click="onRollbackRequest">全部回滚</button>
              </div>
            </div>

            <!-- 中止后去向面板 / 非冲突错误面板 -->
            <div v-else class="exec-panel abort-panel">
              <div v-if="execState === 'error'" class="panel-title danger">挑拣失败</div>
              <div v-else class="panel-title">已取消「{{ pickOrder[currentIndex]?.short_hash }}」的挑拣</div>
              <div class="panel-desc">
                <template v-if="execState === 'error'">{{ haltMessage }}（该提交已跳过）。</template>
                已完成 {{ doneCount }} 个挑拣，请选择接下来的操作：
              </div>
              <div class="panel-actions">
                <button v-if="currentIndex < pickOrder.length - 1" class="btn primary" @click="onContinueRemaining">继续剩余提交</button>
                <button class="btn" :class="{ primary: currentIndex >= pickOrder.length - 1 }" @click="onFinishEarly">结束并压缩已完成的</button>
                <button class="btn danger" @click="onRollbackRequest">全部回滚</button>
              </div>
            </div>
          </div>

          <!-- ===== 总结阶段 ===== -->
          <div v-else class="dialog-body summary-body">
            <div class="summary-card">
              <div class="summary-check">✓</div>
              <div class="summary-title">
                <template v-if="summary?.squashed">已将 {{ summary.picked }} 个提交压缩为 1 个</template>
                <template v-else>已挑拣 1 个提交（无需压缩）</template>
              </div>
              <div v-if="summary?.newHash" class="summary-hash">新提交：<code>{{ summary.newHash }}</code></div>
              <div class="summary-desc">当前分支已更新，提交历史已刷新</div>
            </div>
          </div>

          <!-- ===== 底部栏（按阶段切换） ===== -->
          <div v-if="phase === 'select'" class="dialog-footer">
            <span class="selected-count">已选 {{ selectedList.length }} 个</span>
            <button class="btn" @click="requestClose">取消</button>
            <button
              class="btn primary"
              :disabled="selectedList.length === 0"
              @click="startExecute"
            >
              执行压缩
            </button>
          </div>
          <div v-else-if="phase === 'execute'" class="dialog-footer">
            <span class="selected-count">
              {{ locked ? "执行中，请稍候…" : "流程已暂停，可选择上方操作或关闭弹窗（冲突将交由主界面处理）" }}
            </span>
          </div>
          <div v-else class="dialog-footer">
            <span class="selected-count" />
            <button class="btn primary" @click="close">完成</button>
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
  width: 90vw;
  height: 90vh;
  min-width: 1080px;
  min-height: 680px;
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

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.phase-badge {
  height: 18px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 999px;
}

.phase-badge.success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
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

.close-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.close-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.dialog-body {
  flex: 1;
  padding: 16px;
  display: flex;
  gap: 16px;
  overflow: hidden;
}

/* 左侧面板：选择与配置（宽度由拖拽分隔条控制，默认 60%） */
.left-panel {
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 拖拽分隔条（左右分栏）：始终可见的细线，hover/拖拽高亮 */
.resizer-v {
  flex-shrink: 0;
  width: 8px;
  cursor: col-resize;
  background: transparent;
  border-left: 1px solid var(--border-default);
  border-right: 1px solid var(--border-default);
  transition: background 150ms ease, border-color 150ms ease;
}

.resizer-v:hover,
.resizer-v.dragging {
  background: rgba(59, 130, 246, 0.12);
  border-color: var(--accent);
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
  gap: 8px;
  margin-bottom: 10px;
}

.form-row label {
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
  white-space: nowrap;
}

.form-row select,
.form-row input[type="text"] {
  flex: 1;
  min-width: 0;
  height: var(--ctrl-h);
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--ctrl-radius);
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
  font-family: inherit;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.form-row select:focus,
.form-row input[type="text"]:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.hint {
  margin-left: 4px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--fg-tertiary);
}

.commit-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
  background: var(--bg-base);
  padding: 4px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  margin-bottom: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: var(--ctrl-radius);
  color: var(--fg-tertiary);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.search-box input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg-primary);
  font-size: 13px;
  font-family: inherit;
}

.search-box input::placeholder {
  color: var(--fg-tertiary);
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
  margin: 1px 2px;
  padding: 0 10px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: 13px;
  transition: background 120ms ease;
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
  transition: all 120ms ease;
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

.btn.danger {
  border-color: color-mix(in srgb, var(--danger) 55%, transparent);
  color: var(--danger);
}

.btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-color: var(--danger);
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ===== 执行阶段 ===== */

.exec-body {
  flex-direction: column;
  gap: 14px;
}

/* 横向流水线 Stepper */
.stepper {
  display: flex;
  align-items: flex-start;
  gap: 0;
  padding: 14px 16px 12px;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  flex-shrink: 0;
}

.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 96px;
  flex-shrink: 0;
}

.step-circle {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--fg-tertiary);
  font-size: 12px;
  transition: all 200ms ease;
}

.step-index {
  font-size: 11px;
}

.step-label {
  margin-top: 6px;
  max-width: 88px;
  font-size: 12px;
  color: var(--fg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}

.step-sub {
  max-width: 88px;
  font-size: 11px;
  color: var(--fg-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-line {
  height: 2px;
  width: 36px;
  margin-top: 12px;
  background: var(--border-default);
  flex-shrink: 0;
  transition: background 250ms ease;
}

.step-line.filled {
  background: var(--accent);
}

/* 节点状态 */
.step-node.done .step-circle {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
  animation: step-pop 240ms ease;
}

.step-node.done .step-icon {
  font-size: 13px;
  font-weight: 700;
}

.step-node.running .step-circle {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
  animation: step-pulse 1.4s ease-in-out infinite;
}

.step-node.running .step-label {
  color: var(--accent);
  font-weight: 600;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.step-node.conflict .step-circle {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
  animation: step-shake 320ms ease;
}

.step-node.conflict .step-icon {
  font-weight: 700;
}

.step-node.conflict .step-label {
  color: var(--danger);
}

.step-node.skipped .step-circle {
  border-color: var(--border-default);
  color: var(--fg-tertiary);
  opacity: 0.65;
}

.step-node.skipped .step-label {
  text-decoration: line-through;
  color: var(--fg-tertiary);
}

@keyframes step-pop {
  0% {
    transform: scale(0.6);
  }
  60% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes step-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 8%, transparent);
  }
}

@keyframes step-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}

/* 执行面板（公共） */
.exec-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  overflow-y: auto;
}

.running-panel {
  justify-content: center;
  gap: 16px;
}

.running-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.running-text {
  font-size: 14px;
  color: var(--fg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.running-subject {
  max-width: 560px;
  font-size: 12px;
  color: var(--fg-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 冲突 / 中止面板 */
.conflict-panel {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border-default));
  align-items: stretch;
}

.abort-panel {
  align-items: stretch;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
  margin-bottom: 8px;
}

.panel-title.danger {
  color: var(--danger);
}

.panel-desc {
  font-size: 13px;
  color: var(--fg-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}

.conflict-file-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  padding: 6px;
  margin-bottom: 14px;
}

.conflict-file {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.conflict-file:hover {
  background: var(--bg-hover);
}

.conflict-mark {
  color: var(--danger);
  flex-shrink: 0;
}

.conflict-path {
  flex: 1;
  min-width: 0;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  color: var(--fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
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

.copy-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.panel-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

/* ===== 总结阶段 ===== */

.summary-body {
  align-items: center;
  justify-content: center;
}

.summary-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.summary-check {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--success) 16%, transparent);
  border: 2px solid var(--success);
  color: var(--success);
  font-size: 26px;
  font-weight: 700;
  animation: step-pop 320ms ease;
}

.summary-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--fg-primary);
}

.summary-hash {
  font-size: 13px;
  color: var(--fg-secondary);
}

.summary-hash code {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  color: var(--accent);
}

.summary-desc {
  font-size: 12px;
  color: var(--fg-tertiary);
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
