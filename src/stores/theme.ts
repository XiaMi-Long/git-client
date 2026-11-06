/**
 * 主题与密度状态管理
 * 支持 system/light/dark 与 comfortable/compact，持久化到 localStorage；
 * 同时保留旧版 light/dark 切换入口的兼容方法。
 *
 * @changeLog
 *   - 2026-11-04: Updated. 增加 system 模式、密度，并兼容旧主题 key。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

/** 新主题偏好 key，与原型/新 UI 一致 */
const THEME_KEY = "gittrail-theme";
/** 旧版主题 key，用于迁移旧用户选择 */
const LEGACY_THEME_KEY = "git-client-theme";
/** 密度 key */
const DENSITY_KEY = "gittrail-density";

export type ThemeMode = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export const useThemeStore = defineStore("theme", () => {
  const themeMode = ref<ThemeMode>("system");
  const density = ref<Density>("comfortable");
  const systemDark = ref(media.matches);
  let mediaBound = false;

  const resolvedMode = computed<"light" | "dark">(() => {
    if (themeMode.value === "dark") return "dark";
    if (themeMode.value === "light") return "light";
    return systemDark.value ? "dark" : "light";
  });

  const isDark = computed(() => resolvedMode.value === "dark");
  const themeName = computed(() => resolvedMode.value);

  /**
   * 将主题/密度应用到 documentElement，供所有 CSS token 使用。
   * @returns {void}
   */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", resolvedMode.value);
    document.documentElement.setAttribute("data-density", density.value);
  }

  /**
   * 初始化主题和密度：优先新 key，其次迁移旧 key，最后跟随系统。
   * @returns {void}
   */
  function initTheme() {
    let savedMode = localStorage.getItem(THEME_KEY);
    if (savedMode !== "system" && savedMode !== "light" && savedMode !== "dark") {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      savedMode = legacy === "light" || legacy === "dark" ? legacy : "system";
      localStorage.setItem(THEME_KEY, savedMode);
    }
    themeMode.value = savedMode as ThemeMode;

    const savedDensity = localStorage.getItem(DENSITY_KEY);
    density.value = savedDensity === "compact" ? "compact" : "comfortable";

    if (!mediaBound) {
      media.addEventListener("change", (event) => {
        systemDark.value = event.matches;
        if (themeMode.value === "system") applyTheme();
      });
      mediaBound = true;
    }
    applyTheme();
  }

  /**
   * 设置显式主题模式并持久化。
   * @param mode - system/light/dark
   * @returns {void}
   */
  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
    localStorage.setItem(THEME_KEY, mode);
    applyTheme();
  }

  /**
   * 兼容旧版 light/dark 设置入口。
   * @param theme - light/dark
   * @returns {void}
   */
  function setTheme(theme: "dark" | "light") {
    setThemeMode(theme);
  }

  /**
   * 头部快捷切换：在 light/dark 之间切换，system 模式按当前解析结果反向。
   * @returns {void}
   */
  function toggleTheme() {
    setThemeMode(isDark.value ? "light" : "dark");
  }

  /**
   * 设置密度并持久化。
   * @param next - comfortable/compact
   * @returns {void}
   */
  function setDensity(next: Density) {
    density.value = next === "compact" ? "compact" : "comfortable";
    localStorage.setItem(DENSITY_KEY, density.value);
    applyTheme();
  }

  return {
    themeMode,
    density,
    resolvedMode,
    isDark,
    themeName,
    initTheme,
    applyTheme,
    setThemeMode,
    setTheme,
    toggleTheme,
    setDensity,
  };
});
