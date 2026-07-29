<!--
  @component ContextMenu
  @description
    通用右键菜单 / 下拉菜单，Teleport 到 body 避免被父容器裁剪。
    点击菜单外部（mousedown）或菜单项后关闭。
  @usage
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="items" @close="menu=null" />
  @changeLog
    - 2026-07-29: Created. 用于分支右键操作（9.x）。
    - 2026-07-29: Fixed. 关闭机制改用 mousedown + contains，避免点击外部不关闭。
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

defineProps<{
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{ close: [] }>();

const rootEl = ref<HTMLElement | null>(null);

// 点击菜单外部时关闭（mousedown 比 click 早，避免与打开事件冲突）
function onDocMouseDown(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocMouseDown);
});
</script>

<template>
  <Teleport to="body">
    <div ref="rootEl" class="context-menu" :style="{ left: x + 'px', top: y + 'px' }" @contextmenu.prevent>
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
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 4px 0;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  height: 28px;
  padding: 0 16px;
  background: transparent;
  border: none;
  color: var(--fg-primary);
  font-size: 13px;
  cursor: pointer;
}

.menu-item:hover:not(:disabled) {
  background: var(--bg-panel);
}

.menu-item.danger {
  color: var(--danger);
}

.menu-item:disabled {
  color: var(--fg-tertiary);
  cursor: default;
}

.menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border-default);
}
</style>
