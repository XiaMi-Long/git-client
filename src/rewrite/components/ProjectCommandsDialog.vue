<!--
  @component ProjectCommandsDialog
  @description
    展示当前项目的脚本列表及实时执行日志，关闭弹窗前停止命令及其子进程。
  @usage
    传入打开时固定的 target，close 通知父级清理弹窗。requestClose 供项目切换复用。
  @dataFormat
    target 包含项目路径、显示名和检出分支，脚本与任务状态来自 useProjectCommands。
  @changeLog
    - 2026-11-13: Created. 实现已确认的双栏脚本执行及日志界面。
    - 2026-11-13: Updated. 使用 build 标题，并在弹窗头部提供打开 dist。
    - 2026-11-13: Updated. 日志底部提供逐行输入，支持回车及发送按钮。
    - 2026-11-13: Updated. 用 xterm.js 替换纯文本日志及独立输入框，支持完整终端交互。
    - 2026-11-13: Updated. 包管理器改用公共选择框，统一展开菜单样式。
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AppSelect from "@/components/AppSelect.vue";
import { useProjectCommands, type ProjectCommandTarget } from "../composables/useProjectCommands";
import { useProjectTerminal } from "../composables/useProjectTerminal";

const props = defineProps<{
  /** 打开弹窗时捕获的项目，执行和停止都以此路径为准。 */
  target: ProjectCommandTarget;
}>();
const emit = defineEmits<{
  /** 任务停止并收齐日志后通知父级关闭弹窗。 */
  close: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const terminalArea = ref<HTMLDivElement | null>(null);
const terminal = useProjectTerminal(terminalArea, {
  input: (text) => writeInput(text),
  resize: (size) => resizeTerminal(size),
});
const {
  info, task, managerChoice, loading, starting, stopping, closing, openingDist, running, busy,
  inputEnabled, writeInput, resizeTerminal,
  manifestMessage, statusText, commandText, initialize, openDist, runScript, stopTask, prepareClose,
} = useProjectCommands(props.target, terminal);

// 自动选项随项目识别结果更新，运行日志刷新时保持选项数组稳定。
const managerOptions = computed(() => [
  { value: "", label: `自动${info.value?.manager ? ` / ${info.value.manager}` : ""}` },
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "yarn", label: "yarn" },
  { value: "bun", label: "bun" },
] as const);

/**
 * 将公共选择框的字符串映射回已支持的包管理器，保持命令模块的枚举约束。
 * @param managerValue - 用户在包管理器菜单中确认的选项值
 * @returns void
 */
function setManagerChoice(managerValue: string): void {
  const selectedManager = managerOptions.value.find((option) => option.value === managerValue);
  if (selectedManager) {
    managerChoice.value = selectedManager.value;
  }
}

/**
 * 停止原项目的命令后关闭，所有关闭入口和项目切换共用此方法。
 * @returns 关闭处理完成
 */
async function requestClose(): Promise<void> {
  if (await prepareClose()) {
    emit("close");
  }
}

// 结束或关闭过程中立即停止接受按键，终端仍保留选中和复制日志的能力。
watch(inputEnabled, terminal.setInputEnabled, { immediate: true, flush: "sync" });

onMounted(() => {
  dialog.value?.showModal();
  terminal.mountTerminal();
  void initialize();
});

defineExpose({ requestClose });
</script>

<template>
  <dialog ref="dialog" class="project-command-dialog" aria-labelledby="project-command-title" @cancel.prevent="requestClose" @click.self="requestClose">
    <div class="command-layout">
      <!-- 项目身份、包管理器和关闭入口 -->
      <header class="command-header">
        <div class="command-heading">
          <h2 id="project-command-title" :title="target.name">build · {{ target.name }}</h2>
          <p :title="target.path">{{ target.path }}<span v-if="target.branch"> · {{ target.branch }}</span></p>
        </div>
        <button class="icon-control command-dist" type="button" :disabled="loading || openingDist || closing || !info?.dist_exists" :aria-busy="openingDist" @click="openDist">打开 dist</button>
        <label class="command-manager">
          <span>包管理器</span>
          <AppSelect :model-value="managerChoice" class="command-manager-select" :options="managerOptions" :disabled="busy" aria-label="包管理器" @update:model-value="setManagerChoice" />
        </label>
        <button class="close-btn" type="button" :disabled="closing" aria-label="关闭 build" autofocus @click="requestClose">×</button>
      </header>

      <div class="command-body">
        <!-- 实际 package.json 脚本列表 -->
        <section class="command-scripts" aria-label="项目脚本" :aria-busy="loading">
          <p v-if="manifestMessage" class="command-empty">{{ manifestMessage }}</p>
          <ul v-else>
            <li v-for="script in info?.scripts ?? []" :key="script.name" :class="{ selected: task?.script === script.name }">
              <div class="command-script-heading">
                <strong :title="script.name">{{ script.name }}</strong>
                <button class="command-run" type="button" :disabled="busy" :aria-label="`执行 ${script.name}`" @click="runScript(script)">
                  <svg v-if="running && task?.script === script.name" class="sync-spinner" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13 8a5 5 0 0 1-8.5 3.5M3 8a5 5 0 0 1 8.5-3.5"/></svg>
                  <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m5 3 8 5-8 5Z"/></svg>
                  <span>执行</span>
                </button>
              </div>
              <code :title="script.command">{{ script.command }}</code>
            </li>
          </ul>
        </section>

        <!-- 当前任务的命令、退出结果和持续输出 -->
        <section class="command-console" aria-label="命令日志">
          <div class="command-console-header">
            <code :title="commandText">{{ commandText ? `$ ${commandText}` : '' }}</code>
            <span class="command-state" :class="task?.status" role="status">{{ statusText }}</span>
            <button class="icon-control command-stop" type="button" :disabled="(!running && !starting) || stopping || closing" @click="stopTask">停止</button>
          </div>
          <!-- PTY 终端直接接收输入；Esc 交给脚本，避免误关闭正在交互的任务 -->
          <div ref="terminalArea" class="command-output" aria-label="执行日志" @keydown.esc.stop.prevent />
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.project-command-dialog {
  position: fixed;
  inset: 0;
  width: min(80vw, 1600px, calc(100% - 48px));
  height: min(86vh, calc(100% - 48px));
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

.project-command-dialog::backdrop { background: rgba(18, 24, 31, 0.5); }
.command-layout { display: flex; flex-direction: column; height: 100%; }
.command-header { display: flex; align-items: center; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--border); }
.command-heading { flex: 1; min-width: 0; }
.command-heading h2 { margin: 0; color: var(--text-strong); font-size: 18px; font-weight: 600; }
.command-heading p { margin: 6px 0 0; color: var(--muted); font: 12px/1.5 var(--mono); }
.command-heading h2, .command-heading p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-header .close-btn { flex-shrink: 0; }
.command-dist { flex-shrink: 0; font-size: 12px; white-space: nowrap; }
.command-manager { display: flex; align-items: center; flex-shrink: 0; gap: 8px; font-size: 12px; color: var(--muted); }
.command-manager-select { min-width: 120px; font: 12px var(--mono); }
.command-body { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr); flex: 1; min-height: 0; }
.command-scripts { overflow: auto; border-right: 1px solid var(--border); }
.command-scripts ul { margin: 0; padding: 8px; list-style: none; }
.command-scripts li { margin-bottom: 4px; padding: 12px; border-radius: var(--radius-sm); }
.command-scripts li.selected { background: var(--accent-soft); }
.command-script-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.command-script-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 600 13px var(--mono); }
.command-scripts code { display: -webkit-box; margin-top: 7px; overflow: hidden; overflow-wrap: anywhere; color: var(--muted); font: 11px/1.6 var(--mono); -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.command-run { display: inline-flex; align-items: center; flex-shrink: 0; gap: 4px; padding: 5px 7px; border-radius: 6px; color: var(--accent-strong); font-size: 11px; }
.command-run:not(:disabled):hover { background: var(--hover); }
.command-run:disabled { opacity: 0.5; cursor: default; }
.command-empty { padding: 16px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.command-console { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--code-bg); }
.command-console-header { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 20px; border-bottom: 1px solid var(--border); }
.command-console-header > code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font: 12px var(--mono); }
.command-state { max-width: 50%; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.command-state.running { color: var(--accent-strong); }
.command-state.succeeded { color: var(--success); }
.command-state.failed { color: var(--danger); }
.command-stop { flex-shrink: 0; font-size: 12px; }
.command-output { flex: 1; min-width: 0; min-height: 0; padding: 16px 20px; overflow: hidden; }
.command-output :deep(.xterm) { height: 100%; }
</style>
