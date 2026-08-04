<!--
  @component FileTypeIcon
  @description
    文件类型图标：根据文件路径解析 vscode-icons 风格彩色图标（本地内嵌，离线可用）。
    与变更状态字母（A/M/D）共存：类型图标展示文件后缀类型，字母保留原语义。
-->
<script setup lang="ts">
import { computed } from "vue";
import { resolveFileIcon } from "@/utils/fileIcon";

const props = withDefaults(defineProps<{ path: string; size?: number }>(), {
  size: 16,
});

const icon = computed(() => resolveFileIcon(props.path));
</script>

<template>
  <img
    class="file-type-icon"
    :src="icon"
    :width="size"
    :height="size"
    alt=""
    draggable="false"
  />
</template>

<style scoped>
.file-type-icon {
  flex-shrink: 0;
  vertical-align: middle;
  user-select: none;
  pointer-events: none;
}
</style>
