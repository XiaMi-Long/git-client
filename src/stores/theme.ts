/**
 * 界面主题、密度与代码对比主题的状态管理
 * 支持 system/light/dark 与 comfortable/compact，持久化到 localStorage；
 * 同时保留旧版 light/dark 切换入口的兼容方法。
 *
 * @changeLog
 *   - 2026-11-04: Updated. 增加 system 模式、密度，并兼容旧主题 key。
 *   - 2026-11-07: Updated. 独立保存和恢复代码对比主题。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

/** 新主题偏好 key，与原型/新 UI 一致 */
const THEME_KEY = "gittrail-theme";
/** 旧版主题 key，用于迁移旧用户选择 */
const LEGACY_THEME_KEY = "git-client-theme";
/** 密度 key */
const DENSITY_KEY = "gittrail-density";
/** 代码主题使用独立的本地键，界面明暗切换时可保留已选配色。 */
const CODE_THEME_KEY = "gittrail-code-theme";

/** 代码主题选项。固定主题的值对应 code-themes.css 中的配色标识。 */
export const CODE_THEME_OPTIONS = [
  { value: "follow", label: "跟随界面" },
  { value: "github-light", label: "GitHub Light" },
  { value: "github-dark", label: "GitHub Dark" },
  { value: "one-dark", label: "One Dark" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
] as const;

/** 本地保存的代码主题标识。跟随界面时使用现有的浅色或深色配色。 */
export type CodeTheme = (typeof CODE_THEME_OPTIONS)[number]["value"];
const DEFAULT_CODE_THEME: CodeTheme = "follow";

export type ThemeMode = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export const useThemeStore = defineStore("theme", () => {
  const themeMode = ref<ThemeMode>("system");
  const density = ref<Density>("comfortable");
  const codeTheme = ref<CodeTheme>(DEFAULT_CODE_THEME);
  const systemDark = ref(media.matches);
  let mediaBound = false;

  const resolvedMode = computed<"light" | "dark">(() => {
    if (themeMode.value === "dark") return "dark";
    if (themeMode.value === "light") return "light";
    return systemDark.value ? "dark" : "light";
  });

  const isDark = computed(() => resolvedMode.value === "dark");
  const themeName = computed(() => resolvedMode.value);
  const codeThemeLabel = computed(
    () => CODE_THEME_OPTIONS.find((option) => option.value === codeTheme.value)?.label ?? CODE_THEME_OPTIONS[0].label,
  );

  /**
   * 将界面主题、密度和代码主题写入文档根元素，供样式变量使用。
   * @returns {void}
   */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", resolvedMode.value);
    document.documentElement.setAttribute("data-density", density.value);
    document.documentElement.setAttribute("data-code-theme", codeTheme.value);
  }

  /**
   * 恢复界面主题、密度和代码主题。代码主题缺失或无效时使用跟随界面。
   * @returns {void}
   */
  function initTheme() {
    // 1. 优先读取当前的界面主题，再兼容旧版明暗偏好。
    let savedMode = localStorage.getItem(THEME_KEY);
    if (savedMode !== "system" && savedMode !== "light" && savedMode !== "dark") {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      savedMode = legacy === "light" || legacy === "dark" ? legacy : "system";
      localStorage.setItem(THEME_KEY, savedMode);
    }
    themeMode.value = savedMode as ThemeMode;

    // 2. 恢复密度与代码主题。旧版用户首次进入时继续使用原有配色。
    const savedDensity = localStorage.getItem(DENSITY_KEY);
    density.value = savedDensity === "compact" ? "compact" : "comfortable";
    const savedCodeTheme = localStorage.getItem(CODE_THEME_KEY);
    const savedCodeThemeOption = CODE_THEME_OPTIONS.find((option) => option.value === savedCodeTheme);
    codeTheme.value = savedCodeThemeOption?.value ?? DEFAULT_CODE_THEME;

    // 3. 同步系统明暗变化，再应用已恢复的设置。
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
   * 保存已选代码主题，并同步更新预览和实际对比视图。
   * @param themeId - 代码对比下拉框提交的预设标识
   * @returns void
   */
  function setCodeTheme(themeId: string): void {
    const selectedTheme = CODE_THEME_OPTIONS.find((option) => option.value === themeId);
    // 只有已定义配色的预设才可保存，避免无效标识在重启后造成样式错乱。
    if (!selectedTheme) {
      return;
    }
    localStorage.setItem(CODE_THEME_KEY, selectedTheme.value);
    codeTheme.value = selectedTheme.value;
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
    codeTheme,
    codeThemeLabel,
    resolvedMode,
    isDark,
    themeName,
    initTheme,
    applyTheme,
    setThemeMode,
    setCodeTheme,
    setTheme,
    toggleTheme,
    setDensity,
  };
});
