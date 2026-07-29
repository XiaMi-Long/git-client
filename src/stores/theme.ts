/**
 * 主题状态管理
 * 负责暗色/亮色切换与 localStorage 持久化
 * 依据: design.md D9 - 主题用 CSS 变量，不引入 i18n 框架
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

const STORAGE_KEY = "git-client-theme";

export const useThemeStore = defineStore("theme", () => {
  // 是否暗色主题（默认暗色）
  const isDark = ref(true);

  // 当前主题名称
  const themeName = computed(() => (isDark.value ? "dark" : "light"));

  /**
   * 从 localStorage 初始化主题
   */
  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      isDark.value = saved === "dark";
    }
    applyTheme();
  }

  /**
   * 切换亮暗主题
   */
  function toggleTheme() {
    isDark.value = !isDark.value;
    localStorage.setItem(STORAGE_KEY, themeName.value);
    applyTheme();
  }

  /**
   * 设置指定主题
   * @param theme - "dark" | "light"
   */
  function setTheme(theme: "dark" | "light") {
    isDark.value = theme === "dark";
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme();
  }

  /**
   * 将主题属性应用到 document.documentElement
   */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", themeName.value);
  }

  return {
    isDark,
    themeName,
    initTheme,
    toggleTheme,
    setTheme,
  };
});
