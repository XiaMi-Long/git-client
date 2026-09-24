<!--
  @component CommitHistoryViews
  @description
    承载分支拓扑、文件历史、版本标签和提交活动四种补充历史视图。

  @usage
    <CommitHistoryViews :mode="historyView" @select="selectCommit" />

  @dataFormat
    接收当前补充视图标识；各子视图读取共享仓库范围并发出统一提交选择事件。

  @workflow
    1. 持续挂载子视图容器以保留各自滚动和筛选状态。
    2. 仅激活当前视图的数据查询。
    3. 将提交选择和右键事件转发给历史区外层。

  @changeLog
    - 2026-09-24: Created. 汇总四种扩展历史浏览模式。
    - 2026-09-24: Updated. 文件历史提交选择携带目标仓库路径。
-->
<script setup lang="ts">
import CommitActivityView from "./CommitActivityView.vue";
import CommitGraphView from "./CommitGraphView.vue";
import FileHistoryView from "./FileHistoryView.vue";
import ReleaseHistoryView from "./ReleaseHistoryView.vue";
import type { CommitHistoryView } from "@/stores/settings";
import type { CommitInfo } from "@/types/git";

const props = defineProps<{
  /** 当前补充历史视图 */
  mode: Extract<CommitHistoryView, "graph" | "file" | "release" | "activity">;
  /** 补充视图容器是否可见 */
  active: boolean;
}>();

const emit = defineEmits<{
  /** 选择提交并更新右侧详情 */
  (e: "select", hash: string, repositoryPath?: string): void;
  /** 提交行的右键事件 */
  (e: "contextmenu", event: MouseEvent, commit: CommitInfo, repositoryPath?: string): void;
}>();

/**
 * 将子视图的提交右键事件转发到历史区。
 * @param {MouseEvent} event - 子视图右键事件
 * @param {CommitInfo} commit - 当前提交
 * @param {string} [repositoryPath] - 提交所在仓库；未提供时使用当前激活仓库
 * @returns {void} 发出统一右键事件
 */
function relayContextMenu(event: MouseEvent, commit: CommitInfo, repositoryPath?: string): void {
  emit("contextmenu", event, commit, repositoryPath);
}
</script>

<template>
  <div class="commit-history-views">
    <CommitGraphView
      v-show="props.mode === 'graph'"
      :active="props.active && props.mode === 'graph'"
      @select="emit('select', $event)"
      @contextmenu="relayContextMenu"
    />
    <FileHistoryView
      v-show="props.mode === 'file'"
      :active="props.active && props.mode === 'file'"
      @select="(hash, repositoryPath) => emit('select', hash, repositoryPath)"
      @contextmenu="relayContextMenu"
    />
    <ReleaseHistoryView
      v-show="props.mode === 'release'"
      :active="props.active && props.mode === 'release'"
      @select="emit('select', $event)"
      @contextmenu="relayContextMenu"
    />
    <CommitActivityView
      v-show="props.mode === 'activity'"
      :active="props.active && props.mode === 'activity'"
      @select="emit('select', $event)"
      @contextmenu="relayContextMenu"
    />
  </div>
</template>

<style scoped>
.commit-history-views {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.commit-history-views > * {
  min-height: 0;
}
</style>
