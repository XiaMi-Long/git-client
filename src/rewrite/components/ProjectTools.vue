<!--
  @component ProjectTools
  @description
    主界面右下角的 build 直达入口，并管理命令弹窗的关闭和项目切换。
  @usage
    project 由当前项目路径、软件内显示名和检出分支组成，没有项目时入口禁用。
  @dataFormat
    打开弹窗时复制项目身份，切换后的关闭操作仍作用于原项目。
  @changeLog
    - 2026-11-13: Created. 新增快捷工具菜单和项目命令弹窗入口。
    - 2026-11-13: Updated. build 直接打开命令弹窗，dist 入口移入弹窗。
-->
<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ProjectCommandTarget } from "../composables/useProjectCommands";
import ProjectCommandsDialog from "./ProjectCommandsDialog.vue";

const props = defineProps<{
  /** 当前主界面激活的项目，没有激活项目时为空。 */
  project: ProjectCommandTarget | null;
}>();

const trigger = ref<HTMLButtonElement | null>(null);
const commandDialog = ref<InstanceType<typeof ProjectCommandsDialog> | null>(null);
const dialogTarget = ref<ProjectCommandTarget | null>(null);

/**
 * 捕获当前项目并打开命令弹窗，后续执行不再引用正在变化的 activeRepo。
 * @returns void
 */
function openCommands(): void {
  const project = props.project;
  // 已打开时不再创建重复的弹窗，未选择项目时保持入口禁用。
  if (!project || dialogTarget.value) {
    return;
  }
  dialogTarget.value = { ...project };
}

/**
 * 弹窗已完成停止后移除组件，将焦点交回快捷入口。
 * @returns 焦点恢复完成
 */
async function closeCommands(): Promise<void> {
  dialogTarget.value = null;
  await nextTick();
  trigger.value?.focus();
}

// 项目切换引发的弹窗关闭必须等待原命令停止，不能直接清空目标导致丢失进程身份。
watch(() => props.project?.path, async () => {
  await commandDialog.value?.requestClose();
});
</script>

<template>
  <!-- 右下角 build 直接打开命令弹窗 -->
  <div class="project-tools">
    <button ref="trigger" class="project-tools-trigger" type="button" :disabled="!project" :aria-expanded="!!dialogTarget" aria-haspopup="dialog" @click="openCommands">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 4 5-4 5M9 13h4"/></svg>
      <span>build</span>
    </button>
  </div>

  <!-- 项目命令弹窗，关闭前由其自身停止并保存最近一次日志 -->
  <ProjectCommandsDialog v-if="dialogTarget" ref="commandDialog" :target="dialogTarget" @close="closeCommands" />
</template>

<style scoped>
.project-tools { position: fixed; right: 20px; bottom: 20px; z-index: 30; }
.project-tools-trigger { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 13px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 12px; }
.project-tools-trigger:not(:disabled):hover { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
.project-tools-trigger:disabled { opacity: 0.5; cursor: default; }
</style>
