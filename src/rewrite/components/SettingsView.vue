<!--
  @component SettingsView
  @description
    新 UI 设置页：外观（界面主题、代码对比主题、密度与代码预览）并保留旧版 Git 路径、
    默认目录、远程保护、储藏名模板和时间格式设置。

  @usage
    <SettingsView />

  @changeLog
    - 2026-11-04: Created. 原型设置页生产化，保留旧设置能力。
    - 2026-11-07: Updated. 增加代码对比主题选择和即时配色预览。
-->
<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { CODE_THEME_OPTIONS, useThemeStore, type Density, type ThemeMode } from "@/stores/theme";
import { highlightCode } from "../utils/highlight";

const themeStore = useThemeStore();
const settingsStore = useSettingsStore();

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const densityOptions: Array<{ value: Density; label: string }> = [
  { value: "comfortable", label: "舒适 56" },
  { value: "compact", label: "紧凑 48" },
];

const previewLines = [
  { type: "hunk", text: "@@ -12,3 +12,4 @@" },
  { type: "ctx", no: 12, text: "// 按选定范围展示提交" },
  { type: "del", no: 13, text: 'const scope = "current"' },
  { type: "add", no: 13, text: 'const scope = "all"' },
  { type: "add", no: 14, text: "const pageSize = 100" },
  { type: "ctx", no: 15, text: "const rows = computed(() => commits.value)" },
];

/**
 * 读取输入框新值并持久化，避免只改 store 不落本地。
 * @param setter - settings store 的保存函数
 * @param event - 输入事件
 * @returns {void}
 */
function persistInput(setter: (value: string) => void, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  if (target) setter(target.value);
}

/**
 * 读取复选框状态并持久化。
 * @param setter - settings store 的保存函数
 * @param event - change 事件
 * @returns {void}
 */
function persistCheck(setter: (value: boolean) => void, event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (target) setter(target.checked);
}

/**
 * 保存时间格式，收窄 select 的字符串值。
 * @param event - change 事件
 * @returns {void}
 */
function persistTimeFormat(event: Event): void {
  const target = event.target as HTMLSelectElement | null;
  if (target && (target.value === "relative" || target.value === "absolute")) {
    settingsStore.setTimeFormat(target.value);
  }
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-sections">
      <section class="settings-section">
        <h2>外观</h2>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">主题</div>
            <div class="setting-desc">跟随系统，或固定浅色 / 深色。切换即时生效。</div>
          </div>
          <div class="segmented" role="group" aria-label="主题">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              :class="{ active: themeStore.themeMode === option.value }"
              :aria-pressed="themeStore.themeMode === option.value"
              @click="themeStore.setThemeMode(option.value)"
            >{{ option.label }}</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">代码对比</div>
            <div class="setting-desc">独立设置代码高亮和增删行底色，预览与对比视图即时更新。</div>
          </div>
          <select
            class="settings-input compact"
            :value="themeStore.codeTheme"
            aria-label="代码对比主题"
            @change="persistInput(themeStore.setCodeTheme, $event)"
          >
            <option v-for="option in CODE_THEME_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div class="code-preview">
          <div class="preview-bar">
            <span>对比视图 · {{ themeStore.codeThemeLabel }}</span>
            <span class="preview-meta">src/components/CommitList.vue</span>
          </div>
          <div class="preview-code">
            <template v-for="(line, index) in previewLines" :key="index">
              <div v-if="line.type === 'hunk'" class="preview-line hunk">{{ line.text }}</div>
              <div v-else class="preview-line" :class="line.type">
                <span class="ln">{{ line.no }}</span>
                <span class="sign">{{ line.type === "add" ? "+" : line.type === "del" ? "-" : "" }}</span>
                <span class="code" v-html="highlightCode(line.text)"></span>
              </div>
            </template>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2>布局</h2>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">提交行高</div>
            <div class="setting-desc">舒适适合阅读，紧凑适合小窗口。</div>
          </div>
          <div class="segmented" role="group" aria-label="提交行高">
            <button
              v-for="option in densityOptions"
              :key="option.value"
              type="button"
              :class="{ active: themeStore.density === option.value }"
              :aria-pressed="themeStore.density === option.value"
              @click="themeStore.setDensity(option.value)"
            >{{ option.label }}</button>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2>Git</h2>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">Git 路径</div>
            <div class="setting-desc">留空使用系统 PATH 中的 git。</div>
          </div>
          <input class="settings-input" :value="settingsStore.gitPath" placeholder="系统 PATH" @change="persistInput(settingsStore.setGitPath, $event)">
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">默认打开目录</div>
            <div class="setting-desc">打开项目时优先定位的目录。</div>
          </div>
          <input class="settings-input" :value="settingsStore.defaultOpenDir" placeholder="选择目录" @change="persistInput(settingsStore.setDefaultOpenDir, $event)">
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">储藏名模板</div>
            <div class="setting-desc">支持 ${branch} ${yyyy} ${mm} ${dd} ${HH} ${MM} ${ss}。</div>
          </div>
          <input class="settings-input" :value="settingsStore.stashNameTemplate" @change="persistInput(settingsStore.setStashNameTemplate, $event)">
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">提交时间格式</div>
            <div class="setting-desc">相对时间或绝对时间。</div>
          </div>
          <select class="settings-input compact" :value="settingsStore.timeFormat" @change="persistTimeFormat">
            <option value="relative">相对时间</option>
            <option value="absolute">绝对时间</option>
          </select>
        </div>
      </section>

      <section class="settings-section">
        <h2>远程保护</h2>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">保护远程分支</div>
            <div class="setting-desc">总开关开启时，按下面子项阻止高风险远程操作。</div>
          </div>
          <label class="settings-check">
            <input type="checkbox" :checked="settingsStore.protectRemote" @change="persistCheck(settingsStore.setProtectRemote, $event)">
            <span>开启</span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">禁止重命名远程分支</div>
            <div class="setting-desc">总开关开启时生效。</div>
          </div>
          <label class="settings-check">
            <input type="checkbox" :checked="settingsStore.protectRemoteRename" @change="persistCheck(settingsStore.setProtectRemoteRename, $event)">
            <span>保护</span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">禁止删除远程分支</div>
            <div class="setting-desc">总开关开启时生效。</div>
          </div>
          <label class="settings-check">
            <input type="checkbox" :checked="settingsStore.protectRemoteDelete" @change="persistCheck(settingsStore.setProtectRemoteDelete, $event)">
            <span>保护</span>
          </label>
        </div>
      </section>

      <section class="settings-section">
        <h2>关于</h2>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">版本</div>
            <div class="setting-desc">GitTrail 3.0 UI 重写分支。</div>
          </div>
          <span class="setting-value">0.3.0</span>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <div class="setting-title">数据</div>
            <div class="setting-desc">项目列表、提交、分支、储藏与差异均来自本地 Git。</div>
          </div>
          <span class="setting-value">local</span>
        </div>
      </section>
    </div>
  </div>
</template>
