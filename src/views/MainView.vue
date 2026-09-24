<!--
  @component MainView
  @description
    三栏主视图容器 - 自定义标题栏 + 顶栏 + (侧栏 | 提交列表 | 右侧上下分栏) + 状态栏。
    侧栏、中右、右侧上下三处分隔条均可拖拽调整尺寸。工作区模式时右侧底部显示提交框。
  @usage <MainView />
  @workflow
    1. 自定义标题栏固定 32px，顶栏固定 40px，状态栏固定 24px，中间 main-body 占满剩余高度。
    2. 侧栏宽度可拖拽（160-360px）。
    3. 中右分隔条拖拽调整右侧面板宽度（320-800px，反向），提交列表占剩余。
    4. 右侧上方文件列表高度可拖拽，下方 diff 占剩余。
    5. 工作区模式时右侧底部出现提交框。
    6. 挂载时启动文件监听，变更时刷新激活仓库。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 接入文件变更监听（3.3）、中右可拖拽分隔条。
    - 2026-07-29: Updated. 工作区模式提交框（7.2）、修复中右拖拽反向。
    - 2026-09-24: Updated. 接入提交文件列表到文件历史视图的快捷切换。
    - 2026-09-24: Updated. 文件历史快捷路径可指向当前项目之外的 Git 仓库。
-->
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import TitleBar from "@/components/layout/TitleBar.vue";
import TopBar from "@/components/layout/TopBar.vue";
import Sidebar from "@/components/layout/Sidebar.vue";
import CommitList from "@/components/layout/CommitList.vue";
import FileList from "@/components/layout/FileList.vue";
import DiffViewer from "@/components/layout/DiffViewer.vue";
import CommitBox from "@/components/layout/CommitBox.vue";
import StatusBar from "@/components/layout/StatusBar.vue";
import ToastContainer from "@/components/layout/ToastContainer.vue";
import GlobalProgress from "@/components/layout/GlobalProgress.vue";
import ConfirmDialog from "@/components/layout/ConfirmDialog.vue";
import { useResizable } from "@/composables/useResizable";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import { useCommitStore } from "@/stores/commit";
import { useSettingsStore } from "@/stores/settings";
import { useRepoWatcher } from "@/composables/useRepoWatcher";
import { useDialog } from "@/composables/useDialog";
// 3.0 开发期间暂时停用 2.0 的自动更新检查。
// import { checkForUpdate, relaunchApp } from "@/utils/updater";

const repoStore = useRepoStore();
const selectionStore = useSelectionStore();
const commitStore = useCommitStore();
const settingsStore = useSettingsStore();
const { dialogState, showConfirm, onConfirm, onCancel } = useDialog();

/**
 * 从提交文件列表打开对应文件的历史。
 * @param {string} path - 文件的绝对路径
 * @returns {void} 更新文件历史路径并切换视图
 */
function openFileHistory(path: string): void {
  commitStore.setFileHistoryPath(path);
  settingsStore.setCommitHistoryView("file");
}
// 3.0 开发期间暂时停用启动时的自动更新检查。
// let updateTimer: ReturnType<typeof setTimeout> | null = null;
// 文件变更时刷新当前仓库 + 重新检测冲突状态（后端 500ms 防抖后 emit "repo-changed"）
const { start: startWatcher } = useRepoWatcher(() => {
  repoStore.refreshActive();
  // 外部编辑器解决冲突后，重新检测操作状态（watcher 排除 .git，git add 不触发，但文件编辑会触发）
  selectionStore.loadOperationState();
});

// 侧栏宽度（左右拖拽，面板在左）
const { size: sidebarWidth, onMouseDown: onSidebarResize } = useResizable({
  orientation: "horizontal",
  initial: 260,
  min: 180,
  max: 400,
});

// 右侧面板宽度（中右拖拽，面板在右 -> reverse）
const { size: rightWidth, onMouseDown: onRightResize } = useResizable({
  orientation: "horizontal",
  initial: 500,
  min: 320,
  max: 900,
  reverse: true,
});

// 文件列表高度（上下拖拽，面板在上）
const { size: fileListHeight, onMouseDown: onFileListResize } = useResizable({
  orientation: "vertical",
  initial: 240,
  min: 120,
  max: 600,
});

onMounted(() => {
  startWatcher();
  // 窗口聚焦时刷新当前仓库的提交列表、工作区与冲突状态
  window.addEventListener("focus", onWindowFocus);

  // 3.0 开发期间暂时停用启动时的自动更新检查。
  // updateTimer = setTimeout(async () => {
  //   const r = await checkForUpdate();
  //   if (r.status === "downloaded") {
  //     const ok = await showConfirm(
  //       "发现新版本",
  //       `新版本 ${r.version} 已下载完成，重启应用以生效？`,
  //       false
  //     );
  //     if (ok) await relaunchApp();
  //   }
  //   // none / error 静默处理
  // }, 5000);
});

onUnmounted(() => {
  // 3.0 开发期间已停用自动更新计时器。
  // if (updateTimer) clearTimeout(updateTimer);
  window.removeEventListener("focus", onWindowFocus);
});

// 窗口显示且聚焦时刷新提交列表、工作区状态与冲突状态。
function onWindowFocus() {
  if (!repoStore.activeRepo) return;
  repoStore.refreshActive();
  commitStore.loadCommits();
  selectionStore.loadOperationState();
}
</script>

<template>
  <div class="main-view">
    <!-- 全局操作反馈：顶部进度条 + Toast 气泡 -->
    <GlobalProgress />
    <ToastContainer />

    <!-- 自定义窗口标题栏（无边框窗口，独立一行） -->
    <TitleBar />

    <!-- 顶栏 -->
    <TopBar />

    <!-- 主体三栏 -->
    <div class="main-body">
      <!-- 侧栏 -->
      <Sidebar class="pane-sidebar" :style="{ width: sidebarWidth + 'px' }" />

      <!-- 侧栏分隔条 -->
      <div class="resizer resizer-v" @mousedown="onSidebarResize" />

      <!-- 提交列表 -->
      <div class="pane-commit">
        <CommitList />
      </div>

      <!-- 中右分隔条 -->
      <div class="resizer resizer-v" @mousedown="onRightResize" />

      <!-- 右侧上下分栏 -->
      <div class="pane-right" :style="{ width: rightWidth + 'px' }">
        <FileList :style="{ height: fileListHeight + 'px' }" @file-history="openFileHistory" />
        <div class="resizer resizer-h" @mousedown="onFileListResize" />
        <div class="pane-diff">
          <DiffViewer />
        </div>
        <!-- 工作区模式提交框（7.2） -->
        <CommitBox v-if="selectionStore.isWorkingMode" class="pane-commit-box" />
      </div>
    </div>

    <!-- 状态栏 -->
    <StatusBar />

    <!-- 更新提示确认框 -->
    <ConfirmDialog
      v-if="dialogState"
      :title="dialogState.title"
      :message="dialogState.message"
      :hide-cancel="dialogState.hideCancel"
      :danger="dialogState.danger"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

.main-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.pane-sidebar {
  flex-shrink: 0;
}

.pane-commit {
  flex: 1;
  min-width: 280px;
  overflow: hidden;
}

.pane-right {
  flex-shrink: 0;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border-default);
}

.pane-diff {
  flex: 1;
  overflow: hidden;
}

/* 分隔条 - 扁平化 1px，hover 主色，拖拽区扩大到 5px 便于操作 */
.resizer {
  flex-shrink: 0;
  background: var(--border-default);
  transition: background 150ms ease;
  position: relative;
}

.resizer-v {
  width: 1px;
  cursor: col-resize;
}

.resizer-v::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -2px;
  width: 5px;
}

.resizer-v:hover {
  background: var(--accent);
}

.resizer-h {
  height: 1px;
  cursor: row-resize;
}

.resizer-h::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  height: 5px;
}

.resizer-h:hover {
  background: var(--accent);
}
</style>
