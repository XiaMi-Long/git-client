<!--
  @component SettingsDialog
  @description
    设置弹窗，居中模态。左侧分类导航 + 右侧设置项。
    分类：常规 / Git / AI 功能（占位）/ 关于。
    打开/关闭带淡入 + 缩放动画。
  @workflow
    1. 父组件 v-if 挂载本组件 -> onMounted show=true 触发 enter 动画。
    2. 关闭（× / Esc / 点遮罩）-> show=false 触发 leave 动画 -> 150ms 后 emit close，父卸载。
  @changeLog
    - 2026-07-30: Created. 设置弹窗（左右布局 + 动画）。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";

const emit = defineEmits<{ close: [] }>();

const themeStore = useThemeStore();
const settingsStore = useSettingsStore();

// 分类
const categories = [
  { key: "general", label: "常规" },
  { key: "git", label: "Git" },
  { key: "ai", label: "AI 功能" },
  { key: "about", label: "关于" },
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
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="show" class="overlay" @click.self="close">
        <div class="settings-dialog">
          <!-- 左侧分类 -->
          <div class="settings-sidebar">
            <div class="settings-title">设置</div>
            <button
              v-for="cat in categories"
              :key="cat.key"
              class="category-item"
              :class="{ active: activeCategory === cat.key }"
              @click="activeCategory = cat.key"
            >
              {{ cat.label }}
            </button>
          </div>

          <!-- 右侧设置项 -->
          <div class="settings-content">
            <div class="content-header">
              <span>{{ categories.find((c) => c.key === activeCategory)?.label }}</span>
              <button class="close-btn" title="关闭" @click="close">×</button>
            </div>

            <!-- 常规 -->
            <div v-if="activeCategory === 'general'" class="settings-group">
              <div class="setting-card">
                <div class="card-title">界面</div>
                <div class="setting-row">
                  <label>主题</label>
                  <div class="theme-options">
                    <button :class="{ active: themeStore.isDark }" @click="themeStore.setTheme('dark')">
                      暗色
                    </button>
                    <button :class="{ active: !themeStore.isDark }" @click="themeStore.setTheme('light')">
                      亮色
                    </button>
                  </div>
                </div>
                <div class="setting-row">
                  <label>等宽字体大小</label>
                  <div class="font-size-control">
                    <input
                      type="range"
                      min="12"
                      max="16"
                      :value="settingsStore.fontSize"
                      @input="settingsStore.setFontSize(Number(($event.target as HTMLInputElement).value))"
                    />
                    <span class="font-size-value">{{ settingsStore.fontSize }}px</span>
                  </div>
                </div>
                <div class="hint">影响 diff / 代码 / 哈希等区域的等宽字体</div>
              </div>
            </div>

            <!-- Git -->
            <div v-else-if="activeCategory === 'git'" class="settings-group">
              <div class="setting-card">
                <div class="card-title">Git 环境</div>
                <div class="setting-row">
                  <label>git 可执行文件路径</label>
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
                    placeholder="${yyyy}-${mm}-${dd}-${HH}-${MM}"
                    @change="settingsStore.setStashNameTemplate(($event.target as HTMLInputElement).value)"
                  />
                </div>
                <div class="hint">
                  创建存储时的默认名称，支持占位符：${'${yyyy}'} ${'${mm}'} ${'${dd}'} ${'${HH}'} ${'${MM}'} ${'${ss}'}，
                  如 weiwenyu-${'${yyyy}'}-${'${mm}'}
                </div>
              </div>

              <!-- 远程更新提示 -->
              <div class="setting-card">
                <div class="card-title">远程更新提示</div>
                <div class="switch-row">
                  <span class="switch-label">当前分支远程有新提交时显示提示行</span>
                  <button
                    class="switch"
                    :class="{ on: settingsStore.enableRemoteHint }"
                    @click="settingsStore.setEnableRemoteHint(!settingsStore.enableRemoteHint)"
                  >
                    <span class="switch-thumb" />
                  </button>
                </div>
                <div class="hint">提交列表上方显示「当前分支有 N 条新提交可查看」</div>
                <div class="switch-row sub">
                  <span class="switch-label">展开方式</span>
                  <div class="mode-options">
                    <button
                      class="mode-btn"
                      :class="{ active: settingsStore.remoteHintExpandMode === 'click' }"
                      @click="settingsStore.setRemoteHintExpandMode('click')"
                    >
                      点击展开
                    </button>
                    <button
                      class="mode-btn"
                      :class="{ active: settingsStore.remoteHintExpandMode === 'auto' }"
                      @click="settingsStore.setRemoteHintExpandMode('auto')"
                    >
                      直接显示列表
                    </button>
                  </div>
                </div>
                <div class="hint">点击展开：显示提示文字，点击后才列出待拉取提交；直接显示：打开即列出</div>
              </div>

              <!-- 远程分支操作保护 -->
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
            <div v-else-if="activeCategory === 'ai'" class="settings-group">
              <div class="setting-card">
                <div class="card-title">AI 功能</div>
                <div class="empty-hint">敬请期待</div>
              </div>
            </div>

            <!-- 关于 -->
            <div v-else-if="activeCategory === 'about'" class="settings-group">
              <div class="setting-card">
                <div class="card-title">关于</div>
                <div class="about-row"><label>应用</label><span>Git 客户端</span></div>
                <div class="about-row"><label>版本</label><span>0.1.0</span></div>
                <div class="about-row"><label>仓库</label><span>github.com/XiaMi-Long/git-client</span></div>
                <div class="about-row"><label>技术栈</label><span>Tauri 2 + Vue 3</span></div>
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
  width: 840px;
  height: 600px;
  max-width: 90vw;
  max-height: 90vh;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  overflow: hidden;
}

/* 左侧分类 */
.settings-sidebar {
  width: 180px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-default);
  padding: 16px 0;
  flex-shrink: 0;
}

.settings-title {
  padding: 0 16px 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
}

.category-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 16px;
  background: transparent;
  border: none;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
  border-left: 2px solid transparent;
}

.category-item:hover {
  background: var(--bg-hover);
}

.category-item.active {
  background: var(--bg-elevated);
  color: var(--accent);
  border-left-color: var(--accent);
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-default);
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
  flex-shrink: 0;
}

.close-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--fg-tertiary);
  font-size: 18px;
  cursor: pointer;
  border-radius: 2px;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.settings-group {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

/* 设置区块卡片：按逻辑分组，视觉区分 */
.setting-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  padding: 16px 16px 8px;
  margin-bottom: 16px;
}

.card-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-tertiary);
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-default);
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.setting-row label {
  width: 130px;
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.setting-row input[type="text"] {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
}

.setting-row input[type="text"]:focus {
  border-color: var(--accent);
}

.font-size-control {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.font-size-control input[type="range"] {
  flex: 1;
}

.font-size-value {
  width: 40px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  color: var(--fg-primary);
}

.theme-options {
  display: flex;
  gap: 4px;
}

.theme-options button {
  height: 28px;
  padding: 0 16px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
}

.theme-options button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.detect-btn {
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 2px;
  color: var(--fg-secondary);
  font-size: 13px;
  cursor: pointer;
}

.detect-btn:hover:not(:disabled) {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.detect-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-version {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  color: var(--success);
}

.hint {
  margin-left: 130px;
  margin-top: -8px;
  font-size: 12px;
  color: var(--fg-tertiary);
}

/* 开关行后面的提示：无 label 对齐，直接左对齐 */
.switch-row + .hint {
  margin-left: 0;
  margin-top: 4px;
  margin-bottom: 12px;
}

/* 远程分支保护开关 */
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

/* 展开方式选择按钮 */
.mode-options {
  display: flex;
  gap: 6px;
}

.mode-btn {
  height: 24px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  color: var(--fg-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

.mode-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.mode-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.switch-label {
  font-size: 13px;
  color: var(--fg-secondary);
}

.switch {
  position: relative;
  width: 36px;
  height: 20px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--bg-input);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
  flex-shrink: 0;
}

.switch .switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--fg-tertiary);
  transition: transform 150ms ease, background 150ms ease;
}

.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}

.switch.on .switch-thumb {
  transform: translateX(16px);
  background: #fff;
}

.switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-hint {
  color: var(--fg-tertiary);
  font-size: 13px;
  text-align: center;
  padding: 40px 0;
}

.about-row {
  display: flex;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-default);
  font-size: 13px;
}

.about-row:last-child {
  border-bottom: none;
}

.about-row label {
  width: 100px;
  color: var(--fg-tertiary);
}

.about-row span {
  color: var(--fg-primary);
}

/* 动画：遮罩淡入 + 弹窗缩放淡入 */
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
