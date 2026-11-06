/**
 * 项目列表显示布局：顺序、显示别名、上次激活项目。
 * 只影响软件内展示，不修改真实仓库路径或 Git 配置；数据持久化在 localStorage。
 *
 * @changeLog
 *   - 2026-11-04: Created. 新 UI 项目拖拽排序、显示别名与当前项目恢复。
 */
import { ref } from "vue";
import type { RepoTab } from "@/stores/repo";

const LAYOUT_KEY = "gittrail-project-layout";

/** 项目列表的本地展示状态 */
interface ProjectLayoutSnapshot {
  /** 仓库路径顺序 */
  order: string[];
  /** 路径 -> 软件内显示别名 */
  aliases: Record<string, string>;
  /** 上次激活仓库路径 */
  activePath: string | null;
}

const order = ref<string[]>([]);
const aliases = ref<Record<string, string>>({});
const activePath = ref<string | null>(null);
let hydrated = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 读取并校验本地布局快照。
 * @returns 合法的布局快照；缺失或损坏时返回 null
 */
function readSnapshot(): ProjectLayoutSnapshot | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectLayoutSnapshot>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((item) => typeof item === "string") : [],
      aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases as Record<string, string> : {},
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
    };
  } catch {
    return null;
  }
}

/**
 * 延迟写入，避免拖拽过程中高频写 localStorage。
 * @returns {void}
 */
function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const snapshot: ProjectLayoutSnapshot = {
      order: order.value,
      aliases: aliases.value,
      activePath: activePath.value,
    };
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(snapshot));
    } catch {
      // 隐私模式/配额限制下忽略持久化失败，不阻断当前界面
    }
  }, 120);
}

/**
 * 项目列表布局 composable（模块级单例，供应用壳与项目栏共享）。
 */
export function useProjectLayout() {
  /**
   * 在仓库恢复后应用本地顺序/别名/当前项目。
   * @param repos - 已恢复的仓库列表
   * @param fallbackActivePath - 无保存激活项时的回退路径
   * @returns 需要激活的仓库路径
   */
  function hydrate(repos: RepoTab[], fallbackActivePath: string | null = null): string | null {
    if (hydrated) return activePath.value;

    const saved = readSnapshot();
    if (saved) {
      order.value = saved.order;
      aliases.value = saved.aliases;
      activePath.value = saved.activePath;
    }

    const paths = repos.map((repo) => repo.path);
    if (!order.value.length) {
      order.value = paths;
    } else {
      // 旧布局中没有的新项目追加到末尾，避免打开后被隐藏
      const known = new Set(order.value);
      order.value = [...order.value.filter((path) => paths.includes(path)), ...paths.filter((path) => !known.has(path))];
    }

    if (!activePath.value || !paths.includes(activePath.value)) {
      activePath.value = fallbackActivePath && paths.includes(fallbackActivePath)
        ? fallbackActivePath
        : paths[0] ?? null;
    }

    hydrated = true;
    scheduleWrite();
    return activePath.value;
  }

  /**
   * 按保存顺序排序项目；未知路径保持输入末尾顺序。
   * @param repos - 当前仓库列表
   * @returns 用于展示的排序副本
   */
  function sortProjects(repos: RepoTab[]): RepoTab[] {
    const rank = new Map(order.value.map((path, index) => [path, index]));
    return [...repos].sort((left, right) => {
      const leftRank = rank.get(left.path) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.path) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
  }

  /**
   * 获取软件内项目显示名。
   * @param repo - 仓库
   * @returns 别名或目录名
   */
  function displayName(repo: RepoTab): string {
    return (aliases.value[repo.path] || "").trim() || repo.name;
  }

  /**
   * 保存当前展示顺序；调用方传入已排序路径。
   * @param paths - 新的项目路径顺序
   * @returns {void}
   */
  function saveOrder(paths: string[]) {
    order.value = [...paths];
    scheduleWrite();
  }

  /**
   * 设置/清除项目显示别名。
   * @param path - 仓库路径
   * @param alias - 新别名；空字符串恢复目录名
   * @returns {void}
   */
  function setAlias(path: string, alias: string) {
    const next = alias.trim();
    const nextAliases = { ...aliases.value };
    if (next) {
      nextAliases[path] = next;
    } else {
      delete nextAliases[path];
    }
    aliases.value = nextAliases;
    scheduleWrite();
  }

  /**
   * 记录当前激活仓库。
   * @param path - 仓库路径；null 表示无项目
   * @returns {void}
   */
  function setActivePath(path: string | null) {
    activePath.value = path;
    scheduleWrite();
  }

  /**
   * 从布局中移除项目（不删除磁盘目录）。
   * @param path - 仓库路径
   * @returns {void}
   */
  function removeProject(path: string) {
    order.value = order.value.filter((item) => item !== path);
    const nextAliases = { ...aliases.value };
    delete nextAliases[path];
    aliases.value = nextAliases;
    if (activePath.value === path) activePath.value = null;
    scheduleWrite();
  }

  return {
    order,
    aliases,
    activePath,
    hydrate,
    sortProjects,
    displayName,
    saveOrder,
    setAlias,
    setActivePath,
    removeProject,
  };
}
