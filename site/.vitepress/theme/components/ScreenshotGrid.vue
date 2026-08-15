<!--
  @component ScreenshotGrid
  @description
    首页产品截图区：每个功能模块一个截图格。
    将截图放到 site/public/screenshots/ 下、文件名与 id 一致（如 repos.png）即自动显示；
    缺失时显示虚线占位（含提示路径），方便后续补图。
  @usage
    <ScreenshotGrid />
  @约定
    screenshots/repos.png        多仓库标签页
    screenshots/swimlane.png     提交泳道图
    screenshots/commit-list.png  提交历史
    screenshots/diff.png         diff 阅读
    screenshots/staging.png      暂存与提交
    screenshots/branches.png     分支管理
-->
<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";

const slots = [
  { id: "repos", title: "多仓库标签页" },
  { id: "swimlane", title: "提交泳道图" },
  { id: "commit-list", title: "提交历史" },
  { id: "diff", title: "diff 阅读" },
  { id: "staging", title: "暂存与提交" },
  { id: "branches", title: "分支管理" },
];

// 记录加载失败的截图 → 显示占位
const missing = ref<Record<string, boolean>>({});
function onError(id: string) {
  missing.value[id] = true;
}
</script>

<template>
  <div class="shot-grid">
    <figure v-for="s in slots" :key="s.id" class="shot">
      <div class="shot-frame">
        <img
          v-if="!missing[s.id]"
          :src="withBase(`/screenshots/${s.id}.png`)"
          :alt="s.title"
          loading="lazy"
          @error="onError(s.id)"
        />
        <div v-else class="shot-placeholder">
          <span class="ph-icon">🖼️</span>
          <span class="ph-text">待添加截图</span>
          <span class="ph-hint">screenshots/{{ s.id }}.png</span>
        </div>
      </div>
      <figcaption>{{ s.title }}</figcaption>
    </figure>
  </div>
</template>

<style scoped>
.shot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 16px 0;
}

.shot {
  margin: 0;
}

.shot-frame {
  position: relative;
  aspect-ratio: 16 / 10;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  background: var(--vp-c-bg-alt);
  display: flex;
  align-items: center;
  justify-content: center;
}

.shot-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.shot-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-3);
}

.ph-icon {
  font-size: 28px;
}

.ph-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.ph-hint {
  font-size: 11px;
  font-family: var(--vp-font-family-mono, monospace);
}

figcaption {
  margin-top: 8px;
  text-align: center;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
</style>
