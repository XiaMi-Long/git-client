<!--
  @component TopBar
  @description
    顶栏 - 仓库标签页（打开 / 切换 / 关闭）、当前分支、拉取 / 推送按钮、搜索框、主题切换。
  @workflow
    1. [+] 按钮调系统目录选择对话框 -> openRepo 校验并加载 -> 启动文件监听。
    2. 标签单击切换激活仓库，× 关闭仓库。
    3. 搜索框 300ms 防抖后驱动提交列表过滤（6.7）。
    4. 拉取 / 推送为占位，数据接入在 10 组。
  @changeLog
    - 2026-07-29: Created. 布局骨架。
    - 2026-07-29: Updated. 接入仓库打开与标签动态化（5.1 / 5.2 / 5.3）。
    - 2026-07-29: Updated. 搜索框接入提交列表过滤（6.7）。
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import ThemeToggle from "@/components/ThemeToggle.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();

// 错误提示（如无效目录），3 秒后自动消失
const errorMsg = ref<string | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string) {
  errorMsg.value = msg;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    errorMsg.value = null;
  }, 3000);
}

// 当前分支名
const currentBranch = computed(() => {
  const repo = repoStore.activeRepo;
  if (!repo) return null;
  const branch = repo.branches.find((b) => b.is_current);
  return branch?.name ?? repo.status?.current_branch ?? null;
});

// 搜索框本地值，300ms 防抖后同步到 commitStore（6.7）
const localSearch = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(localSearch, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    commitStore.setSearch(val);
  }, 300);
});

// 打开仓库：选目录 -> 校验 -> 加载
async function handleOpenRepo() {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  try {
    await repoStore.openRepo(selected);
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

async function handleCloseRepo(id: string) {
  await repoStore.closeRepo(id);
}

function handleSwitchRepo(id: string) {
  repoStore.setActive(id);
}
</script>

<template>
  <div class="top-bar">
    <!-- 仓库标签页 -->
    <div class="repo-tabs">
      <div
        v-for="tab in repoStore.repos"
        :key="tab.id"
        class="repo-tab"
        :class="{ active: tab.id === repoStore.activeId }"
        :title="tab.path"
        @click="handleSwitchRepo(tab.id)"
      >
        <span>{{ tab.name }}</span>
        <span class="repo-close" @click.stop="handleCloseRepo(tab.id)">×</span>
      </div>
      <button class="repo-tab-add" title="打开仓库" @click="handleOpenRepo">+</button>
    </div>

    <!-- 当前分支 + 拉取/推送 -->
    <div class="actions">
      <button
        class="branch-select"
        :disabled="!currentBranch"
        :title="currentBranch ? '切换分支' : '未打开仓库'"
      >
        <span class="branch-dot" />
        <span>{{ currentBranch ?? "未打开仓库" }}</span>
        <span class="caret">▾</span>
      </button>
      <button class="action-btn" title="拉取 (Ctrl+P)" :disabled="!repoStore.activeRepo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>拉取</span>
      </button>
      <button class="action-btn" title="推送 (Ctrl+Shift+P)" :disabled="!repoStore.activeRepo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>推送</span>
      </button>
    </div>

    <!-- 搜索框 + 主题 -->
    <div class="right">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input v-model="localSearch" type="text" placeholder="搜索提交信息 / 作者 / 哈希" />
      </div>
      <ThemeToggle />
    </div>

    <!-- 错误提示条 -->
    <div v-if="errorMsg" class="error-bar">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  height: 40px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-default);
  padding: 0 8px;
  gap: 12px;
  flex-shrink: 0;
  position: relative;
}

/* 仓库标签页 */
.repo-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

.repo-tab {
  height: 28px;
  padding: 0 8px 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--fg-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
}

.repo-tab.active {
  color: var(--fg-primary);
  border-bottom-color: var(--accent);
}

.repo-close {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  color: var(--fg-tertiary);
  font-size: 14px;
  opacity: 0;
}

.repo-tab:hover .repo-close {
  opacity: 1;
}

.repo-close:hover {
  background: var(--bg-elevated);
  color: var(--danger);
}

.repo-tab-add {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 16px;
  cursor: pointer;
  border-radius: 2px;
}

.repo-tab-add:hover {
  background: var(--bg-elevated);
  color: var(--fg-primary);
}

/* 操作区 */
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-primary);
  font-size: 13px;
  cursor: pointer;
}

.branch-select:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.branch-select:disabled {
  opacity: 0.5;
  cursor: default;
}

.branch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.caret {
  font-size: 10px;
  color: var(--fg-tertiary);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 右侧 */
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  width: 240px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-tertiary);
  transition: border-color 150ms ease;
}

.search-box:focus-within {
  border-color: var(--accent);
}

.search-box input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg-primary);
  font-size: 13px;
}

.search-box input::placeholder {
  color: var(--fg-tertiary);
}

/* 错误提示条 */
.error-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  transform: translateY(100%);
  background: var(--danger);
  color: #fff;
  font-size: 12px;
  padding: 6px 12px;
  z-index: 10;
}
</style>
