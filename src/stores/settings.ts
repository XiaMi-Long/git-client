/**
 * 设置状态管理
 * 字体大小、git 路径、默认打开目录、远程分支操作保护、存储名模板等，持久化到 localStorage
 * 主题复用 theme store，不在此重复
 */
import { defineStore } from "pinia";
import { ref } from "vue";

const SETTINGS_KEY = "git-client-settings";

interface SettingsData {
  gitPath: string;
  defaultOpenDir: string;
  protectRemote: boolean;
  protectRemoteRename: boolean;
  protectRemoteDelete: boolean;
  stashNameTemplate: string;
  enableRemoteHint: boolean;
  remoteHintExpandMode: "click" | "auto";
  timeFormat: "relative" | "absolute";
}

/** 存储名模板支持的占位符说明 */
export const STASH_TEMPLATE_HINT =
  "支持占位符：${yyyy} ${mm} ${dd} ${HH} ${MM} ${ss}，如 weiwenyu-${yyyy}-${mm}";

export const useSettingsStore = defineStore("settings", () => {
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
  // 存储（stash）名模板，默认 分支名 + 时间 yyyy-mm-dd-时-分
  const stashNameTemplate = ref("${branch}-${yyyy}-${mm}-${dd}-${HH}-${MM}");
  // 远程更新提示：当前分支远程有最新提交时，提交列表上方显示提示行（默认开）
  const enableRemoteHint = ref(true);
  // 展开方式：click 点击提示行才展开列表 / auto 直接显示列表
  const remoteHintExpandMode = ref<"click" | "auto">("click");
  // 提交记录时间显示：relative 相对时间（如 "2 hours ago"）/ absolute 绝对时间
  const timeFormat = ref<"relative" | "absolute">("relative");

  /** 从 localStorage 加载并应用 */
  function load() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved) as SettingsData;
        gitPath.value = data.gitPath ?? "";
        defaultOpenDir.value = data.defaultOpenDir ?? "";
        protectRemote.value = data.protectRemote ?? true;
        protectRemoteRename.value = data.protectRemoteRename ?? true;
        protectRemoteDelete.value = data.protectRemoteDelete ?? true;
        stashNameTemplate.value = data.stashNameTemplate ?? "${branch}-${yyyy}-${mm}-${dd}-${HH}-${MM}";
        enableRemoteHint.value = data.enableRemoteHint ?? true;
        remoteHintExpandMode.value = data.remoteHintExpandMode ?? "click";
        timeFormat.value = data.timeFormat ?? "relative";
      } catch {
        // 忽略损坏数据
      }
    }
  }

  function persist() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        gitPath: gitPath.value,
        defaultOpenDir: defaultOpenDir.value,
        protectRemote: protectRemote.value,
        protectRemoteRename: protectRemoteRename.value,
        protectRemoteDelete: protectRemoteDelete.value,
        stashNameTemplate: stashNameTemplate.value,
        enableRemoteHint: enableRemoteHint.value,
        remoteHintExpandMode: remoteHintExpandMode.value,
        timeFormat: timeFormat.value,
      })
    );
  }

  /** 应用字体大小到 CSS 变量 */

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

  /** 设置提交时间显示格式 */
  function setTimeFormat(fmt: "relative" | "absolute") {
    timeFormat.value = fmt;
    persist();
  }

  /** 远程更新提示开关 */
  function setEnableRemoteHint(v: boolean) {
    enableRemoteHint.value = v;
    persist();
  }

  /** 展开方式：click / auto */
  function setRemoteHintExpandMode(mode: "click" | "auto") {
    remoteHintExpandMode.value = mode;
    persist();
  }

  /** 按模板渲染存储名（替换 ${branch} ${yyyy} ${mm} ${dd} ${HH} ${MM} ${ss} 占位符） */
  function renderStashName(template?: string, branch?: string): string {
    const tpl = template ?? stashNameTemplate.value;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const map: Record<string, string> = {
      branch: branch ?? "",
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
    gitPath,
    defaultOpenDir,
    protectRemote,
    protectRemoteRename,
    protectRemoteDelete,
    stashNameTemplate,
    enableRemoteHint,
    remoteHintExpandMode,
    timeFormat,
    load,
    setGitPath,
    setDefaultOpenDir,
    setProtectRemote,
    setProtectRemoteRename,
    setProtectRemoteDelete,
    setStashNameTemplate,
    setTimeFormat,
    setEnableRemoteHint,
    setRemoteHintExpandMode,
    renderStashName,
  };
});
