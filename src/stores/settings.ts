/**
 * 设置状态管理
 * 字体大小、git 路径、默认打开目录、远程分支操作保护、存储名模板等，持久化到 localStorage
 * 主题复用 theme store，不在此重复
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
  stashNameTemplate: string;
}

/** 存储名模板支持的占位符说明 */
export const STASH_TEMPLATE_HINT =
  "支持占位符：${yyyy} ${mm} ${dd} ${HH} ${MM} ${ss}，如 weiwenyu-${yyyy}-${mm}";

export const useSettingsStore = defineStore("settings", () => {
  // 等宽字体大小（12-16，默认 13）
  const fontSize = ref(13);
  // git 可执行文件路径（留空用系统 PATH）
  const gitPath = ref("");
  // 默认打开目录
  const defaultOpenDir = ref("");
  // 远程分支操作保护（默认全开，防止误操作）
  // 总开关关闭后，下面的子开关决定是否仍禁止对应操作
  const protectRemote = ref(true);
  // 禁止重命名远程分支
  const protectRemoteRename = ref(true);
  // 禁止删除远程分支
  const protectRemoteDelete = ref(true);
  // 存储（stash）名模板，默认时间格式 yyyy-mm-dd-时-分
  const stashNameTemplate = ref("${yyyy}-${mm}-${dd}-${HH}-${MM}");

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
        stashNameTemplate.value = data.stashNameTemplate ?? "${yyyy}-${mm}-${dd}-${HH}-${MM}";
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
        protectRemote: protectRemote.value,
        protectRemoteRename: protectRemoteRename.value,
        protectRemoteDelete: protectRemoteDelete.value,
        stashNameTemplate: stashNameTemplate.value,
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

  /** 设置存储名模板 */
  function setStashNameTemplate(tpl: string) {
    stashNameTemplate.value = tpl;
    persist();
  }

  /** 按模板渲染存储名（替换 ${yyyy} ${mm} ${dd} ${HH} ${MM} ${ss} 占位符） */
  function renderStashName(template?: string): string {
    const tpl = template ?? stashNameTemplate.value;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const map: Record<string, string> = {
      yyyy: String(d.getFullYear()),
      mm: pad(d.getMonth() + 1),
      dd: pad(d.getDate()),
      HH: pad(d.getHours()),
      MM: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
    };
    return tpl.replace(/\$\{(\w+)\}/g, (_, k: string) => map[k] ?? `\${${k}}`);
  }

  return {
    fontSize,
    gitPath,
    defaultOpenDir,
    protectRemote,
    protectRemoteRename,
    protectRemoteDelete,
    stashNameTemplate,
    load,
    applyFontSize,
    setFontSize,
    setGitPath,
    setDefaultOpenDir,
    setProtectRemote,
    setProtectRemoteRename,
    setProtectRemoteDelete,
    setStashNameTemplate,
    renderStashName,
  };
});
