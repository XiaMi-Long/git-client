/**
 * 设置状态管理
 * 字体（代码等宽大小 / 界面字体族）、git 路径、默认打开目录、远程分支操作保护等
 * 持久化到 localStorage；主题复用 theme store，不在此重复
 */
import { defineStore } from "pinia";
import { ref } from "vue";

const SETTINGS_KEY = "git-client-settings";

interface SettingsData {
  fontSize: number;
  gitPath: string;
  defaultOpenDir: string;
  protectRemote: boolean;
  protectRemoteRename: boolean;
  protectRemoteDelete: boolean;
  uiFontFamily: string;
}

/** 界面字体族选项（key -> 实际 CSS font-family 栈） */
export const UI_FONT_OPTIONS = [
  { key: "system", label: "系统默认", font: '"Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif' },
  { key: "msyh", label: "微软雅黑", font: '"Microsoft YaHei", "Microsoft YaHei UI", sans-serif' },
  { key: "simsun", label: "宋体", font: 'SimSun, "Microsoft YaHei", serif' },
  { key: "simhei", label: "黑体", font: 'SimHei, "Microsoft YaHei", sans-serif' },
  { key: "dengxian", label: "等线", font: 'DengXian, "Microsoft YaHei", sans-serif' },
];

export const useSettingsStore = defineStore("settings", () => {
  // 等宽字体大小（12-16，默认 13），影响代码 / diff / 哈希区
  const fontSize = ref(13);
  // git 可执行文件路径（留空用系统 PATH）
  const gitPath = ref("");
  // 默认打开目录
  const defaultOpenDir = ref("");
  // 远程分支操作保护（默认全开，防止误操作）
  const protectRemote = ref(true);
  const protectRemoteRename = ref(true);
  const protectRemoteDelete = ref(true);
  // 界面字体族 key（默认系统默认）
  const uiFontFamily = ref("system");

  /** 从 localStorage 加载并应用 */
  function load() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved) as SettingsData;
        fontSize.value = data.fontSize ?? 13;
        gitPath.value = data.gitPath ?? "";
        defaultOpenDir.value = data.defaultOpenDir ?? "";
        protectRemote.value = data.protectRemote ?? true;
        protectRemoteRename.value = data.protectRemoteRename ?? true;
        protectRemoteDelete.value = data.protectRemoteDelete ?? true;
        uiFontFamily.value = data.uiFontFamily ?? "system";
      } catch {
        // 忽略损坏数据
      }
    }
    applyFontSize();
    applyUIFont();
  }

  function persist() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        fontSize: fontSize.value,
        gitPath: gitPath.value,
        defaultOpenDir: defaultOpenDir.value,
        protectRemote: protectRemote.value,
        protectRemoteRename: protectRemoteRename.value,
        protectRemoteDelete: protectRemoteDelete.value,
        uiFontFamily: uiFontFamily.value,
      })
    );
  }

  /** 应用代码区等宽字体大小到 CSS 变量 */
  function applyFontSize() {
    document.documentElement.style.setProperty("--mono-font-size", fontSize.value + "px");
  }

  /** 应用界面字体族到 CSS 变量 */
  function applyUIFont() {
    const opt = UI_FONT_OPTIONS.find((o) => o.key === uiFontFamily.value);
    const font = opt?.font ?? UI_FONT_OPTIONS[0].font;
    document.documentElement.style.setProperty("--ui-font-family", font);
  }

  function setFontSize(size: number) {
    fontSize.value = size;
    applyFontSize();
    persist();
  }

  function setGitPath(path: string) {
    gitPath.value = path;
    persist();
  }

  function setDefaultOpenDir(dir: string) {
    defaultOpenDir.value = dir;
    persist();
  }

  /** 远程分支保护总开关（关闭后子开关生效） */
  function setProtectRemote(v: boolean) {
    protectRemote.value = v;
    persist();
  }

  function setProtectRemoteRename(v: boolean) {
    protectRemoteRename.value = v;
    persist();
  }

  function setProtectRemoteDelete(v: boolean) {
    protectRemoteDelete.value = v;
    persist();
  }

  /** 设置界面字体族（即时生效） */
  function setUiFontFamily(key: string) {
    uiFontFamily.value = key;
    applyUIFont();
    persist();
  }

  return {
    fontSize,
    gitPath,
    defaultOpenDir,
    protectRemote,
    protectRemoteRename,
    protectRemoteDelete,
    uiFontFamily,
    uiFontOptions: UI_FONT_OPTIONS,
    load,
    applyFontSize,
    applyUIFont,
    setFontSize,
    setGitPath,
    setDefaultOpenDir,
    setProtectRemote,
    setProtectRemoteRename,
    setProtectRemoteDelete,
    setUiFontFamily,
  };
});
