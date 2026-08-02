<!--
  @component ContextMenu
  @description
    通用右键菜单 / 下拉菜单，Teleport 到 body 避免被父容器裁剪。
    点击菜单外部（mousedown）或菜单项后关闭。扁平化样式，hover 高亮。
  @usage
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="items" @close="menu=null" />
  @changeLog
    - 2026-07-29: Created. 用于分支右键操作（9.x）。
    - 2026-07-29: Fixed. 关闭机制改用 mousedown + contains。
    - 2026-07-30: Updated. 样式优化（圆角、间距、hover、快捷键提示位）。
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

const props = defineProps<{
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{ close: [] }>();

const rootEl = ref<HTMLElement | null>(null);
// 实际渲染位置：超出可视区域时自动翻转/收敛
const pos = ref({ x: props.x, y: props.y });

// 点击菜单外部时关闭（mousedown 比 click 早，避免与打开事件冲突）
function onDocMouseDown(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown);
  // 菜单渲染后测量尺寸，超出窗口可视区域时调整位置（右/下翻转）
  const el = rootEl.value;
  if (el) {
    const rect = el.getBoundingClientRect();
    let nx = props.x;
    let ny = props.y;
    const margin = 4;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    pos.value = { x: nx, y: ny };
  }
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocMouseDown);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootEl"
      class="context-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.divider" class="menu-divider" />
        <button
          v-else
          class="menu-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="item.action(); emit('close')"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  height: 30px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 2px;
  color: var(--fg-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 100ms ease;
}

.menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.menu-item.danger {
  color: var(--danger);
}

.menu-item.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}

.menu-item:disabled {
  color: var(--fg-tertiary);
  cursor: default;
}

.menu-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-default);
}
</style>
