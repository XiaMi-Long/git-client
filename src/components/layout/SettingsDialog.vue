<!--
  @component SettingsDialog
  @description
    设置弹窗，居中模态。左侧分类导航（分支图谱风格）+ 右侧设置项（现代化扁平化控件）。
    分类：常规 / Git / AI 功能（占位）/ 关于。
    打开/关闭带淡入 + 缩放动画。
  @changeLog
    - 2026-07-30: Created. 设置弹窗（左右布局 + 动画）。
    - 2026-08-02: Redesigned. UI 改版：分支图谱导航 + 现代扁平控件（Segmented / 选项卡片 / 现代开关）。
    - 2026-09-24: Updated. 历史视图设置扩展为六种浏览模式。
    - 2026-09-24: Updated. 历史视图选择改为应用风格的可键盘操作菜单。
-->
<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import type { CommitHistoryView } from "@/stores/settings";
import { useDialog } from "@/composables/useDialog";
// 3.0 开发期间暂时停用 2.0 的手动更新检查。
// import { checkForUpdate, relaunchApp } from "@/utils/updater";

const emit = defineEmits<{ close: [] }>();

const themeStore = useThemeStore();
const settingsStore = useSettingsStore();
const { dialogState, showMessage, showConfirm, onConfirm, onCancel } = useDialog();

const historyViewOptions: Array<{ value: CommitHistoryView; label: string }> = [
  { value: "classic", label: "提交列表" },
  { value: "swimlane", label: "作者泳道" },
  { value: "graph", label: "分支拓扑" },
  { value: "file", label: "文件历史" },
  { value: "release", label: "版本标签" },
  { value: "activity", label: "提交活动" },
];
const historyViewPickerOpen = ref(false);
const historyViewPickerIndex = ref(0);
const historyViewPickerRoot = ref<HTMLElement | null>(null);
const historyViewPickerTrigger = ref<HTMLButtonElement | null>(null);
const selectedHistoryViewOption = computed(() =>
  historyViewOptions.find((option) => option.value === settingsStore.commitHistoryView) ?? historyViewOptions[0]
);
const selectedHistoryViewIndex = computed(() =>
  Math.max(0, historyViewOptions.findIndex((option) => option.value === settingsStore.commitHistoryView))
);

/**
 * 打开历史视图选项并将焦点放到指定选项。
 * @param {number} index - 初始聚焦选项的索引
 * @returns {Promise<void>} 完成菜单展开和焦点设置
 */
async function openHistoryViewPicker(index: number): Promise<void> {
  historyViewPickerIndex.value = (index + historyViewOptions.length) % historyViewOptions.length;
  historyViewPickerOpen.value = true;
  await nextTick();
  historyViewPickerRoot.value
    ?.querySelector<HTMLButtonElement>(`[data-history-view-index="${historyViewPickerIndex.value}"]`)
    ?.focus();
}

/**
 * 收起历史视图选项菜单。
 * @param {boolean} [returnFocus] - 是否将焦点返回到触发按钮
 * @returns {void} 更新菜单状态并按需恢复焦点
 */
function closeHistoryViewPicker(returnFocus = true): void {
  historyViewPickerOpen.value = false;
  if (returnFocus) void nextTick(() => historyViewPickerTrigger.value?.focus());
}

/**
 * 切换历史视图选择菜单的展开状态。
 * @returns {void} 展开菜单或收起当前菜单
 */
function toggleHistoryViewPicker(): void {
  if (historyViewPickerOpen.value) {
    closeHistoryViewPicker(false);
    return;
  }
  void openHistoryViewPicker(selectedHistoryViewIndex.value);
}

/**
 * 持久化选择的历史视图并关闭菜单。
 * @param {CommitHistoryView} value - 目标历史视图
 * @returns {void} 更新设置并将焦点返回触发按钮
 */
function selectHistoryView(value: CommitHistoryView): void {
  settingsStore.setCommitHistoryView(value);
  closeHistoryViewPicker();
}

/**
 * 在菜单中移动选项焦点并循环到列表另一端。
 * @param {number} index - 要聚焦的选项索引
 * @returns {void} 更新活动索引并聚焦对应选项
 */
function focusHistoryViewOption(index: number): void {
  historyViewPickerIndex.value = (index + historyViewOptions.length) % historyViewOptions.length;
  void nextTick(() => {
    historyViewPickerRoot.value
      ?.querySelector<HTMLButtonElement>(`[data-history-view-index="${historyViewPickerIndex.value}"]`)
      ?.focus();
  });
}

/**
 * 处理历史视图菜单中的方向键、确认键、Home/End、Escape 和 Tab。
 * @param {KeyboardEvent} event - 菜单选项的键盘事件
 * @returns {void} 移动焦点、确认选择或收起菜单
 */
function onHistoryViewMenuKeydown(event: KeyboardEvent): void {
  const activeIndex = historyViewPickerIndex.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusHistoryViewOption(activeIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusHistoryViewOption(activeIndex - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusHistoryViewOption(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusHistoryViewOption(historyViewOptions.length - 1);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectHistoryView(historyViewOptions[activeIndex].value);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeHistoryViewPicker();
  } else if (event.key === "Tab") {
    closeHistoryViewPicker(false);
  }
}

/**
 * 处理触发按钮的键盘展开和 Escape 收起。
 * @param {KeyboardEvent} event - 历史视图触发按钮的键盘事件
 * @returns {void} 展开菜单、移动焦点或恢复对话框 Escape 行为
 */
function onHistoryViewTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && historyViewPickerOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    closeHistoryViewPicker();
  } else if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    void openHistoryViewPicker(selectedHistoryViewIndex.value + offset);
  }
}

/**
 * 点击视图选择器以外区域时关闭菜单。
 * @param {MouseEvent} event - 文档级鼠标按下事件
 * @returns {void} 仅在点击外部时收起菜单
 */
function onHistoryViewPointerDown(event: MouseEvent): void {
  if (historyViewPickerOpen.value && !historyViewPickerRoot.value?.contains(event.target as Node)) {
    closeHistoryViewPicker(false);
  }
}

// 分类（含描述，右侧头部展示）
const categories = [
  { key: "general", label: "常规", desc: "界面外观与交互偏好" },
  { key: "git", label: "Git", desc: "git 行为与环境配置" },
  { key: "ai", label: "AI 功能", desc: "智能辅助（规划中）" },
  { key: "about", label: "关于", desc: "版本与技术信息" },
];
const activeCategory = ref("general");

// 动画控制：挂载后显示，关闭时先动画再 emit
const show = ref(false);
onMounted(() => {
  show.value = true;
});

function close() {
  show.value = false;
  // 等待 leave 动画完成再通知父卸载
  setTimeout(() => emit("close"), 150);
}

// Esc 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
onMounted(() => document.addEventListener("mousedown", onHistoryViewPointerDown));
onUnmounted(() => document.removeEventListener("mousedown", onHistoryViewPointerDown));

// git 版本检测
const gitVersion = ref("");
const detecting = ref(false);
async function detectGit() {
  detecting.value = true;
  try {
    const info = await invoke<{ version: string }>("git_detect_version");
    gitVersion.value = info.version;
  } catch {
    gitVersion.value = "检测失败";
  } finally {
    detecting.value = false;
  }
}

/* 3.0 开发期间暂时停用 2.0 的手动更新检查逻辑。
const updateState = ref<"idle" | "checking" | "done" | "error">("idle");
const updateMsg = ref("");
async function checkUpdate() {
  if (updateState.value === "checking") return;
  updateState.value = "checking";
  updateMsg.value = "";
  const r = await checkForUpdate();
  if (r.status === "none") {
    updateState.value = "idle";
    await showMessage("检查更新", "当前已是最新版本");
  } else if (r.status === "downloaded") {
    updateState.value = "done";
    const ok = await showConfirm(
      "更新就绪",
      `新版本 ${r.version} 已下载完成，重启应用以生效？`,
      false
    );
    if (ok) await relaunchApp();
  } else {
    updateState.value = "error";
    updateMsg.value = r.message;
    await showMessage("检查更新失败", r.message);
  }
}
*/
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="show" class="overlay" @click.self="close">
        <div class="settings-dialog">
          <!-- 左侧分类：分支图谱风格导航 -->
          <div class="settings-sidebar">
            <div class="settings-title">设置</div>
            <nav class="category-nav">
              <div
                v-for="(cat, i) in categories"
                :key="cat.key"
                class="category-item"
                :class="{ active: activeCategory === cat.key }"
                @click="activeCategory = cat.key"
              >
                <span class="cat-node">
                  <i class="node-dot" />
                  <i v-if="i < categories.length - 1" class="node-line" />
                </span>
                <span class="cat-label">{{ cat.label }}</span>
              </div>
            </nav>
            <div class="sidebar-foot">git-client</div>
          </div>

          <!-- 右侧设置项 -->
          <div class="settings-content">
            <div class="content-header">
              <div class="header-title">
                <span class="header-label">{{ categories.find((c) => c.key === activeCategory)?.label }}</span>
                <span class="header-desc">{{ categories.find((c) => c.key === activeCategory)?.desc }}</span>
              </div>
              <button class="close-btn" title="关闭" @click="close">✕</button>
            </div>

            <div class="settings-group">
              <!-- 常规 -->
              <div v-if="activeCategory === 'general'">
                <div class="setting-card">
                  <div class="card-title">界面</div>

                  <div class="setting-row">
                    <label>主题</label>
                    <div class="segmented">
                      <button
                        class="seg"
                        :class="{ active: themeStore.isDark }"
                        @click="themeStore.setTheme('dark')"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                        暗色
                      </button>
                      <button
                        class="seg"
                        :class="{ active: !themeStore.isDark }"
                        @click="themeStore.setTheme('light')"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="4" />
                          <line x1="12" y1="1" x2="12" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="23" />
                          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                          <line x1="1" y1="12" x2="3" y2="12" />
                          <line x1="21" y1="12" x2="23" y2="12" />
                          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                        亮色
                      </button>
                    </div>
                  </div>

                  <div class="setting-row">
                    <label>时间显示</label>
                    <div class="segmented">
                      <button
                        class="seg"
                        :class="{ active: settingsStore.timeFormat === 'relative' }"
                        @click="settingsStore.setTimeFormat('relative')"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        相对时间
                      </button>
                      <button
                        class="seg"
                        :class="{ active: settingsStore.timeFormat === 'absolute' }"
                        @click="settingsStore.setTimeFormat('absolute')"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        绝对时间
                      </button>
                    </div>
                  </div>

                  <div class="setting-row">
                    <label id="commit-history-view-label">提交历史视图</label>
                    <div ref="historyViewPickerRoot" class="history-view-picker">
                      <button
                        ref="historyViewPickerTrigger"
                        class="history-view-trigger"
                        type="button"
                        role="combobox"
                        aria-haspopup="listbox"
                        aria-labelledby="commit-history-view-label"
                        aria-controls="commit-history-view-options"
                        :aria-expanded="historyViewPickerOpen"
                        :aria-activedescendant="historyViewPickerOpen ? `history-view-option-${historyViewOptions[historyViewPickerIndex].value}` : undefined"
                        @click="toggleHistoryViewPicker"
                        @keydown="onHistoryViewTriggerKeydown"
                      >
                        <span>{{ selectedHistoryViewOption.label }}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      <div
                        v-if="historyViewPickerOpen"
                        id="commit-history-view-options"
                        class="history-view-options"
                        role="listbox"
                        aria-labelledby="commit-history-view-label"
                        @keydown.stop="onHistoryViewMenuKeydown"
                      >
                        <button
                          v-for="(option, index) in historyViewOptions"
                          :id="`history-view-option-${option.value}`"
                          :key="option.value"
                          :data-history-view-index="index"
                          class="history-view-option"
                          :class="{ selected: settingsStore.commitHistoryView === option.value }"
                          type="button"
                          role="option"
                          :aria-selected="settingsStore.commitHistoryView === option.value"
                          :tabindex="historyViewPickerIndex === index ? 0 : -1"
                          @focus="historyViewPickerIndex = index"
                          @click="selectHistoryView(option.value)"
                        >
                          <span>{{ option.label }}</span>
                          <span v-if="settingsStore.commitHistoryView === option.value" class="history-view-check" aria-hidden="true">✓</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="hint">可在历史工具栏快速切换列表、作者泳道、分支拓扑、文件历史、版本标签和提交活动。</div>
                  <div class="hint">作者泳道：行 = 提交，列 = 作者（当前用户第一，其余按提交频率），可横向滚动。</div>

                  <div class="hint">提交记录列表中的时间展示：相对「2 小时前」或绝对「2026-08-01 14:30」</div>
                </div>
              </div>

              <!-- Git -->
              <div v-else-if="activeCategory === 'git'">
                <div class="setting-card">
                  <div class="card-title">Git 环境</div>

                  <div class="setting-row">
                    <label>git 路径</label>
                    <input
                      type="text"
                      :value="settingsStore.gitPath"
                      placeholder="留空使用系统 PATH"
                      @change="settingsStore.setGitPath(($event.target as HTMLInputElement).value)"
                    />
                  </div>

                  <div class="setting-row">
                    <label>git 版本</label>
                    <button class="detect-btn" :disabled="detecting" @click="detectGit">
                      {{ detecting ? "检测中…" : "检测版本" }}
                    </button>
                    <span v-if="gitVersion" class="git-version">{{ gitVersion }}</span>
                  </div>

                  <div class="setting-row">
                    <label>默认打开目录</label>
                    <input
                      type="text"
                      :value="settingsStore.defaultOpenDir"
                      placeholder="留空使用上次目录"
                      @change="settingsStore.setDefaultOpenDir(($event.target as HTMLInputElement).value)"
                    />
                  </div>

                  <div class="setting-row">
                    <label>存储名模板</label>
                    <input
                      type="text"
                      :value="settingsStore.stashNameTemplate"
                      placeholder="${branch}-${yyyy}-${mm}-${dd}-${HH}-${MM}"
                      @change="settingsStore.setStashNameTemplate(($event.target as HTMLInputElement).value)"
                    />
                  </div>
                  <div class="hint">创建存储的默认名称，支持 ${'${branch}'} ${'${yyyy}'} ${'${mm}'} ${'${dd}'} ${'${HH}'} ${'${MM}'} ${'${ss}'} 占位符</div>
                </div>

                <div class="setting-card">
                  <div class="card-title">远程更新提示</div>

                  <div class="switch-row">
                    <span class="switch-label">显示提示行</span>
                    <button
                      class="switch"
                      :class="{ on: settingsStore.enableRemoteHint }"
                      @click.stop.prevent="settingsStore.setEnableRemoteHint(!settingsStore.enableRemoteHint)"
                    >
                      <span class="switch-thumb" />
                    </button>
                  </div>
                  <div class="hint">当前分支远程有新提交时，提交列表上方显示「有 N 条新提交可查看」</div>

                  <div class="sub-label">展开方式</div>
                  <div class="radio-cards">
                    <button
                      class="radio-card"
                      :class="{ active: settingsStore.remoteHintExpandMode === 'click' }"
                      @click="settingsStore.setRemoteHintExpandMode('click')"
                    >
                      <span class="rc-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                      <span class="rc-body">
                        <span class="rc-title">点击展开</span>
                        <span class="rc-desc">先显示提示文字，点击后展开列表</span>
                      </span>
                      <span class="rc-check">
                        <svg v-if="settingsStore.remoteHintExpandMode === 'click'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    </button>
                    <button
                      class="radio-card"
                      :class="{ active: settingsStore.remoteHintExpandMode === 'auto' }"
                      @click="settingsStore.setRemoteHintExpandMode('auto')"
                    >
                      <span class="rc-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="8" y1="6" x2="21" y2="6" />
                          <line x1="8" y1="12" x2="21" y2="12" />
                          <line x1="8" y1="18" x2="21" y2="18" />
                          <line x1="3" y1="6" x2="3.01" y2="6" />
                          <line x1="3" y1="12" x2="3.01" y2="12" />
                          <line x1="3" y1="18" x2="3.01" y2="18" />
                        </svg>
                      </span>
                      <span class="rc-body">
                        <span class="rc-title">直接显示列表</span>
                        <span class="rc-desc">打开即列出待拉取提交，无提示行</span>
                      </span>
                      <span class="rc-check">
                        <svg v-if="settingsStore.remoteHintExpandMode === 'auto'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>

                <div class="setting-card">
                  <div class="card-title">远程分支操作保护</div>

                  <div class="switch-row">
                    <span class="switch-label">总开关（一键全保护）</span>
                    <button
                      class="switch"
                      :class="{ on: settingsStore.protectRemote }"
                      @click="settingsStore.setProtectRemote(!settingsStore.protectRemote)"
                    >
                      <span class="switch-thumb" />
                    </button>
                  </div>
                  <div class="hint">开启后远程分支右键禁止重命名 / 删除，防止误操作</div>

                  <div class="switch-row sub">
                    <span class="switch-label">禁止删除远程分支</span>
                    <button
                      class="switch"
                      :class="{ on: settingsStore.protectRemoteDelete, disabled: settingsStore.protectRemote }"
                      :disabled="settingsStore.protectRemote"
                      @click="settingsStore.setProtectRemoteDelete(!settingsStore.protectRemoteDelete)"
                    >
                      <span class="switch-thumb" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- AI 功能 -->
              <div v-else-if="activeCategory === 'ai'">
                <div class="setting-card">
                  <div class="card-title">AI 功能</div>
                  <div class="empty-hint">
                    <span class="empty-icon">◌</span>
                    <p>敬请期待</p>
                    <p class="empty-sub">智能辅助功能正在规划中</p>
                  </div>
                </div>
              </div>

              <!-- 关于 -->
              <div v-else-if="activeCategory === 'about'">
                <div class="setting-card">
                  <div class="card-title">关于</div>
                  <div class="about-row"><label>应用</label><span class="mono">GitTrail</span></div>
                  <div class="about-row"><label>版本</label><span class="mono">0.2.0</span></div>
                  <div class="about-row"><label>仓库</label><span class="mono">XiaMi-Long/git-client</span></div>
                  <div class="about-row"><label>技术栈</label><span class="mono">Tauri 2 · Vue 3 · Rust</span></div>
                  <!-- 3.0 开发期间暂时隐藏 2.0 的检查更新入口。
                  <div class="about-row">
                    <label>更新</label>
                    <div class="about-update">
                      <button class="update-btn" :disabled="updateState === 'checking'" @click="checkUpdate">
                        {{ updateState === "checking" ? "检查中…" : "检查更新" }}
                      </button>
                      <span v-if="updateState === 'error'" class="update-error" :title="updateMsg">更新检查失败</span>
                      <span v-else-if="updateState === 'done'" class="update-done">已下载，重启生效</span>
                    </div>
                  </div>
                  -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.settings-dialog {
  width: 860px;
  height: 620px;
  max-width: 90vw;
  max-height: 90vh;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  display: flex;
  overflow: hidden;
}

/* ===== 左侧分类：分支图谱风格 ===== */
.settings-sidebar {
  width: 176px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.settings-title {
  padding: 18px 16px 14px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--fg-primary);
}

.category-nav {
  flex: 1;
  padding: 4px 0;
}

.category-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 16px;
  cursor: pointer;
  transition: background 120ms ease;
}

.category-item:hover {
  background: var(--bg-hover);
}

/* 图谱节点 */
.cat-node {
  position: relative;
  width: 10px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.node-dot {
  position: relative;
  z-index: 1;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: var(--bg-panel);
  transition: all 150ms ease;
}

/* 节点连接竖线（除最后一项） */
.node-line {
  position: absolute;
  left: 50%;
  top: 50%;
  bottom: -50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border-default);
}

.category-item:last-child .node-line {
  display: none;
}

.category-item:hover .node-dot {
  border-color: var(--fg-tertiary);
}

.category-item.active .node-dot {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}

.cat-label {
  font-size: 13px;
  color: var(--fg-secondary);
  transition: color 120ms ease;
}

.category-item.active .cat-label {
  color: var(--accent);
  font-weight: 500;
}

.sidebar-foot {
  padding: 12px 16px;
  font-size: 11px;
  color: var(--fg-tertiary);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  opacity: 0.7;
}

/* ===== 右侧内容 ===== */
.settings-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  height: 48px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.header-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
}

.header-desc {
  font-size: 11.5px;
  color: var(--fg-tertiary);
}

.close-btn {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 120ms ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.settings-group {
  flex: 1;
  padding: 16px 18px;
  overflow-y: auto;
}

/* ===== 卡片 ===== */
.setting-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 16px 18px 8px;
  margin-bottom: 14px;
}

.card-title {
  position: relative;
  padding-left: 12px;
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-tertiary);
  letter-spacing: 0.5px;
}

/* 标题左侧 accent 竖条 */
.card-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0.85;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.setting-row label {
  width: 96px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

/* ===== 现代化输入框 ===== */
.setting-row input[type="text"] {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.setting-row input[type="text"]:hover {
  border-color: var(--border-strong);
}

.setting-row input[type="text"]:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
}

.history-view-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.history-view-trigger {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--fg-primary);
  background: var(--bg-input);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.history-view-trigger:hover,
.history-view-picker:focus-within .history-view-trigger {
  border-color: var(--border-strong);
}

.history-view-trigger:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
}

.history-view-trigger svg {
  flex-shrink: 0;
  color: var(--fg-tertiary);
}

.history-view-options {
  position: absolute;
  z-index: 200;
  top: calc(100% + 5px);
  right: 0;
  left: 0;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}

.history-view-option {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  color: var(--fg-secondary);
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.history-view-option:hover,
.history-view-option:focus-visible,
.history-view-option.selected {
  color: var(--fg-primary);
  background: var(--bg-hover);
  outline: none;
}

.history-view-check {
  color: var(--accent);
  font-size: 13px;
}

/* ===== Segmented Control（分段控制） ===== */
.segmented {
  display: flex;
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  padding: 3px;
  gap: 3px;
}

.seg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 7px;
  color: var(--fg-tertiary);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 160ms ease;
}

.seg svg {
  opacity: 0.8;
}

.seg:hover:not(.active) {
  color: var(--fg-primary);
  background: var(--bg-hover);
}

.seg.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
}

/* ===== 检测按钮 ===== */
.detect-btn {
  height: 30px;
  padding: 0 14px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--fg-secondary);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 150ms ease;
}

.detect-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.detect-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-version {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12.5px;
  color: var(--success);
}

/* ===== 提示文案 ===== */
.hint {
  position: relative;
  padding-left: 14px;
  margin-left: 108px;
  margin-top: -6px;
  margin-bottom: 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--fg-tertiary);
}

.hint::before {
  content: "↳";
  position: absolute;
  left: 0;
  color: var(--accent);
  opacity: 0.6;
}

.switch-row + .hint {
  margin-left: 0;
}

/* ===== 开关（现代化） ===== */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
  margin-bottom: 10px;
}

.switch-row.sub {
  padding-left: 16px;
}

.switch-label {
  font-size: 13px;
  color: var(--fg-primary);
}

.sub-label {
  margin-top: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--fg-tertiary);
}

.switch {
  position: relative;
  width: 40px;
  height: 22px;
  border: none;
  border-radius: 11px;
  background: var(--bg-input);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: background 200ms ease;
  flex-shrink: 0;
}

.switch .switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transition: transform 200ms cubic-bezier(0.4, 1.4, 0.6, 1);
}

.switch.on {
  background: var(--success);
}

.switch.on .switch-thumb {
  transform: translateX(18px);
}

.switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== 选项卡片（Radio Cards） ===== */
.radio-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

.radio-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  text-align: left;
  cursor: pointer;
  transition: all 160ms ease;
}

.radio-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.radio-card.active {
  border-color: var(--accent);
  background: rgba(59, 130, 246, 0.1);
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
}

.rc-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--fg-secondary);
  flex-shrink: 0;
  transition: all 160ms ease;
}

.radio-card.active .rc-icon {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rc-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rc-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-primary);
}

.rc-desc {
  font-size: 11px;
  color: var(--fg-tertiary);
  line-height: 1.4;
}

.rc-check {
  margin-left: auto;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  flex-shrink: 0;
}

/* ===== 空态 ===== */
.empty-hint {
  color: var(--fg-tertiary);
  text-align: center;
  padding: 32px 0;
}

.empty-icon {
  font-size: 26px;
  opacity: 0.5;
}

.empty-hint p {
  margin-top: 8px;
  font-size: 13px;
}

.empty-sub {
  font-size: 12px !important;
  opacity: 0.7;
}

/* ===== 关于：代码风格键值对 ===== */
.about-row {
  display: flex;
  align-items: baseline;
  padding: 10px 0;
  border-bottom: 1px dashed var(--border-default);
  font-size: 13px;
}

.about-row:last-child {
  border-bottom: none;
}

.about-row label {
  width: 80px;
  color: var(--fg-tertiary);
  font-size: 12px;
}

.about-row .mono {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12.5px;
  color: var(--fg-primary);
}

/* 检查更新按钮 */
.about-update {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-btn {
  height: var(--ctrl-h);
  padding: 0 16px;
  background: var(--accent);
  border: none;
  border-radius: var(--ctrl-radius);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: filter 150ms ease, opacity 150ms ease;
}

.update-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.update-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.update-error {
  font-size: 12px;
  color: var(--danger);
}

.update-done {
  font-size: 12px;
  color: var(--success);
}

/* ===== 动画 ===== */
.settings-enter-active,
.settings-leave-active {
  transition: opacity 150ms ease;
}

.settings-enter-active .settings-dialog,
.settings-leave-active .settings-dialog {
  transition: opacity 150ms ease, transform 150ms ease;
}

.settings-enter-from,
.settings-leave-to {
  opacity: 0;
}

.settings-enter-from .settings-dialog,
.settings-leave-to .settings-dialog {
  opacity: 0;
  transform: scale(0.96);
}
</style>
