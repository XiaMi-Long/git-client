<!--
  @component GitFailureDialog
  @description
    远程操作失败时展示完整输出和可操作建议，并允许对原操作直接重试。
    状态栏被收起后仍可从这个弹窗复制细节，报错不再只有被截断的一行。
  @usage
    父组件在 failureOpen 时打开，retry 表示重新执行同一条远程操作，close 只关闭弹窗。
  @dataFormat
    detail 为后端原始错误文本（已去掉外层标签），hint 为按失败特征给出的建议；
    canRetry 为 false 时说明目标项目已不在当前界面，只提供查看和复制。
  @changeLog
    - 2026-11-14: Created. 远程操作失败的详情展示、复制与重试入口。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  /** 失败的远程操作名称，用作标题和复制内容的第一行。 */
  title: string;
  /** 项目、分支与上游等操作目标。 */
  context: string;
  /** 完整错误原文，保留 git 的多行提示。 */
  detail: string;
  /** 针对常见失败原因的建议，没有匹配时为空。 */
  hint: string | null;
  /** 目标项目仍在当前界面时才允许重试。 */
  canRetry: boolean;
}>();

const emit = defineEmits<{
  /** 用户要求重新执行同一条远程操作。 */
  retry: [];
  /** 用户关闭详情弹窗。 */
  close: [];
}>();

/** 复制按钮的短暂反馈，避免另开一层提示遮挡详情。 */
type CopyState = "idle" | "copied" | "failed";

const dialog = ref<HTMLDialogElement | null>(null);
const copyState = ref<CopyState>("idle");
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const copyLabel = computed(() => {
  if (copyState.value === "copied") {
    return "已复制";
  }
  return copyState.value === "failed" ? "复制失败" : "复制详情";
});

/**
 * 复制操作名称、目标和完整输出，方便贴到终端或反馈里继续排查。
 * @returns 复制结束
 */
async function copyDetail(): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${props.title}\n${props.context}\n\n${props.detail}`);
    copyState.value = "copied";
  } catch {
    copyState.value = "failed";
  }
  if (copyTimer) {
    clearTimeout(copyTimer);
  }
  copyTimer = setTimeout(() => {
    copyState.value = "idle";
    copyTimer = null;
  }, 2000);
}

onMounted(() => {
  dialog.value?.showModal();
});

onBeforeUnmount(() => {
  if (copyTimer) {
    clearTimeout(copyTimer);
  }
});
</script>

<template>
  <dialog
    ref="dialog"
    class="git-failure-dialog"
    aria-labelledby="git-failure-title"
    aria-describedby="git-failure-detail"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <div class="failure-layout">
      <!-- 失败类型、操作目标与关闭入口 -->
      <header class="failure-header">
        <span class="failure-mark" aria-hidden="true">!</span>
        <div class="failure-heading">
          <h2 id="git-failure-title">{{ title }}</h2>
          <p :title="context">{{ context }}</p>
        </div>
        <button class="close-btn" type="button" aria-label="关闭失败详情" autofocus @click="emit('close')">×</button>
      </header>

      <section class="failure-body">
        <!-- 常见原因的可操作建议，原始输出始终保留在下方 -->
        <p v-if="hint" class="failure-hint">{{ hint }}</p>
        <pre id="git-failure-detail" class="failure-detail" tabindex="0">{{ detail }}</pre>
      </section>

      <footer class="failure-actions">
        <button class="icon-control" type="button" @click="copyDetail">{{ copyLabel }}</button>
        <div class="failure-actions-end">
          <button class="icon-control" type="button" @click="emit('close')">关闭</button>
          <button v-if="canRetry" class="icon-control failure-retry" type="button" @click="emit('retry')">重试</button>
        </div>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.git-failure-dialog {
  position: fixed;
  inset: 0;
  width: min(560px, calc(100% - 48px));
  max-height: min(78vh, 640px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

.git-failure-dialog::backdrop { background: rgba(18, 24, 31, 0.5); }
.failure-layout { display: flex; flex-direction: column; max-height: inherit; }
.failure-header { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }

/* 警示标记与失败文案同色，避免和普通信息提示混淆。 */
.failure-mark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  border-radius: 50%;
  background: var(--danger-soft);
  color: var(--danger);
  font: 700 13px/1 var(--mono);
}

.failure-heading { flex: 1; min-width: 0; }
.failure-heading h2 { margin: 0; color: var(--text-strong); font-size: 16px; font-weight: 600; }
.failure-heading p,
.failure-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.failure-heading p { margin: 6px 0 0; color: var(--muted); font: 12px/1.5 var(--mono); }
.failure-header .close-btn { flex-shrink: 0; }
.failure-body { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; padding: 16px 24px; }

.failure-hint {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--warning);
  border-radius: var(--radius-sm);
  background: var(--warning-soft);
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
}

/* 原始输出按终端习惯保留换行和缩进，长行折行后仍可全选复制。 */
.failure-detail {
  flex: 1;
  min-height: 96px;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--code-text);
  font: 12px/1.6 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.failure-detail:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.failure-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 24px 20px; }
.failure-actions-end { display: flex; align-items: center; gap: 8px; }

/* 重试是失败后的主要动作，用强调色与关闭区分。 */
.failure-retry { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
</style>
