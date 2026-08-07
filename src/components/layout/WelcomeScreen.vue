<!--
  @component WelcomeScreen
  @description
    欢迎空状态：一个仓库都未打开时展示。
    品牌标识 + 点阵球（ThinkingOrb）+ 打开仓库按钮，支持拖拽文件夹直接打开仓库。
  @usage <WelcomeScreen />（MainView 在 repos 为空时渲染）
  @changeLog
    - 2026-08-07: Created. delight - 首次启动体验与拖拽打开。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo";
import { useDialog } from "@/composables/useDialog";
import ThinkingOrb from "./ThinkingOrb.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const repoStore = useRepoStore();
const { dialogState, showMessage, onConfirm, onCancel } = useDialog();

// 拖拽悬停高亮
const dragging = ref(false);
const opening = ref(false);
let unlistenDrop: (() => void) | null = null;

/** 取路径的父目录（兼容 Windows 反斜杠） */
function parentDir(p: string): string {
  return p.replace(/[\\/][^\\/]+[\\/]?$/, "");
}

/** 拖入的路径可能是仓库目录本身，也可能是仓库内的文件，逐级向上尝试 */
async function resolveRepoPath(p: string): Promise<string | null> {
  let cur = p;
  for (let i = 0; i < 3; i++) {
    if (!cur) return null;
    try {
      await repoStore.openRepo(cur);
      return cur;
    } catch {
      const parent = parentDir(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
  return null;
}

async function handleDropPath(p: string) {
  if (opening.value) return;
  opening.value = true;
  try {
    const opened = await resolveRepoPath(p);
    if (!opened) {
      await showMessage("无法打开", "拖入的目录不是有效的 Git 仓库");
    }
  } finally {
    opening.value = false;
  }
}

async function handleOpenClick() {
  // 与顶栏「+」同流程：目录选择对话框
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  try {
    await repoStore.openRepo(selected);
  } catch (e) {
    await showMessage("无法打开", e instanceof Error ? e.message : String(e));
  }
}

onMounted(async () => {
  // 原生拖放事件（webview 级），悬停 / 释放 / 离开；非 Tauri 环境容错跳过
  try {
    unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
      const t = event.payload.type;
      if (t === "enter" || t === "over") {
        dragging.value = true;
      } else if (t === "leave") {
        dragging.value = false;
      } else if (t === "drop") {
        dragging.value = false;
        const paths = event.payload.paths;
        if (paths && paths.length > 0) handleDropPath(paths[0]);
      }
    });
  } catch {
    // 浏览器等非 Tauri 环境无原生拖放能力，忽略
  }
});

onUnmounted(() => {
  unlistenDrop?.();
});
</script>

<template>
  <div class="welcome" :class="{ dragging }">
    <!-- 拖拽悬停提示层 -->
    <div v-if="dragging" class="drop-veil">
      <div class="drop-frame">
        <span class="drop-title">释放以打开仓库</span>
        <span class="drop-sub">支持仓库目录，或仓库内的任意文件</span>
      </div>
    </div>

    <div class="welcome-inner">
      <!-- 品牌标识：分支图形 -->
      <div class="brand-mark rise" style="--rise-delay: 0ms">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="2.6" />
          <circle cx="6" cy="18" r="2.6" />
          <circle cx="18" cy="8" r="2.6" />
          <path d="M6 8.6v6.8" />
          <path d="M18 10.6c0 3.2-2.8 4.4-5.6 4.9-1.9.3-3.4.9-4.4 2" />
        </svg>
      </div>

      <div class="title rise" style="--rise-delay: 60ms">
        <!-- AI 星芒：品牌名旁的轻闪烁元素，暗示 AI 属性 -->
        <svg class="ai-spark" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l1.8 8.2L22 12l-8.2 1.8L12 22l-1.8-8.2L2 12l8.2-1.8L12 2z" />
        </svg>
        GitAura
      </div>
      <div class="subtitle rise" style="--rise-delay: 110ms">
        打开一个本地仓库，开始管理你的提交与分支
      </div>
      <div class="ai-hint rise" style="--rise-delay: 150ms">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l1.8 8.2L22 12l-8.2 1.8L12 22l-1.8-8.2L2 12l8.2-1.8L12 2z" />
        </svg>
        AI 能力即将接入
      </div>

      <!-- 点阵球：安静的生命感 -->
      <div class="orb rise" style="--rise-delay: 160ms">
        <ThinkingOrb :size="64" />
      </div>

      <button
        class="open-btn rise"
        style="--rise-delay: 220ms"
        :disabled="opening"
        @click="handleOpenClick"
      >
        {{ opening ? "打开中…" : "打开仓库" }}
      </button>

      <div class="drop-hint rise" style="--rise-delay: 270ms">
        或将仓库文件夹拖入窗口
      </div>
    </div>

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
.welcome {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-base);
}

/* 极淡的品牌色晕光：呼应启动页的身份，但保持产品级克制 */
.welcome::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(50% 40% at 20% 12%, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 62%),
    radial-gradient(45% 42% at 84% 88%, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 65%);
  pointer-events: none;
}

.welcome-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px;
}

/* 入场：轻微上浮淡入，逐项错峰（backwards 填充保证降级时内容可见） */
.rise {
  animation: rise-in 420ms cubic-bezier(0.25, 1, 0.5, 1) backwards;
  animation-delay: var(--rise-delay, 0ms);
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.brand-mark {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  margin-bottom: 4px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--fg-primary);
  letter-spacing: 0.02em;
}

/* AI 星芒：标题旁缓慢闪烁，亮暗主题均用 accent */
.ai-spark {
  color: var(--accent);
  animation: spark-twinkle 2.6s ease-in-out infinite;
}

@keyframes spark-twinkle {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

.subtitle {
  font-size: 13px;
  color: var(--fg-secondary);
}

.ai-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--accent);
}

.orb {
  margin: 6px 0 2px;
}

.open-btn {
  height: 32px;
  padding: 0 22px;
  background: var(--accent);
  border: none;
  border-radius: var(--ctrl-radius);
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 150ms ease, transform 120ms ease;
}

.open-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.open-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.open-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.drop-hint {
  font-size: 12px;
  color: var(--fg-tertiary);
}

/* 拖拽悬停：全屏提示层 */
.drop-veil {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-base));
}

.drop-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 72px;
  border: 2px dashed color-mix(in srgb, var(--accent) 65%, transparent);
  border-radius: var(--radius-lg);
}

.drop-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

.drop-sub {
  font-size: 12px;
  color: var(--fg-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .rise {
    animation: none;
  }
  .ai-spark {
    animation: none;
  }
}
</style>
