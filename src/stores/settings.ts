/**
 * 设置状态管理
 * 字体大小、git 路径、默认打开目录等，持久化到 localStorage
 * 主题复用 theme store，不在此重复
 */
import { defineStore } from "pinia";
import { ref } from "vue";

const SETTINGS_KEY = "git-client-settings";

interface SettingsData {
  fontSize: number;
  gitPath: string;
  defaultOpenDir: string;
}

export const useSettingsStore = defineStore("settings", () => {
  // 等宽字体大小（12-16，默认 13）
  const fontSize = ref(13);
  // git 可执行文件路径（留空用系统 PATH）
  const gitPath = ref("");
  // 默认打开目录
  const defaultOpenDir = ref("");

  /** 从 localStorage 加载并应用 */
  function load() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved) as SettingsData;
        fontSize.value = data.fontSize ?? 13;
        gitPath.value = data.gitPath ?? "";
        defaultOpenDir.value = data.defaultOpenDir ?? "";
      } catch {
        // 忽略损坏数据
      }
    }
    applyFontSize();
  }

  function persist() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        fontSize: fontSize.value,
        gitPath: gitPath.value,
        defaultOpenDir: defaultOpenDir.value,
      })
    );
  }

  /** 应用字体大小到 CSS 变量 */
  function applyFontSize() {
    document.documentElement.style.setProperty("--mono-font-size", fontSize.value + "px");
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

  return {
    fontSize,
    gitPath,
    defaultOpenDir,
    load,
    applyFontSize,
    setFontSize,
    setGitPath,
    setDefaultOpenDir,
  };
});
