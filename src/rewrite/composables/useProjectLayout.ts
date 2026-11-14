/**
 * 项目展示偏好：顺序、显示别名、上次激活项、分支标记和手动分组。
 * 只影响软件内展示，不修改真实仓库路径或 Git 配置；数据持久化在 localStorage。
 *
 * @changeLog
 *   - 2026-11-04: Created. 新 UI 项目拖拽排序、显示别名与当前项目恢复。
 *   - 2026-11-07: Updated. 按仓库路径和完整分支引用保存星标。
 *   - 2026-11-14: Updated. 项目栏支持手动分组、分组折叠和归属持久化。
 */
import { ref } from "vue";
import type { RepoTab } from "@/stores/repo";

const LAYOUT_KEY = "gittrail-project-layout";
// 未分组是侧栏自动生成的区域，不作为可重名的真实分组。
const RESERVED_GROUP_NAME = "未分组";

/** 用户创建的项目分组，组内项目按项目顺序展示。 */
export interface ProjectGroup {
  id: string;
  name: string;
  /** 折叠后只保留组标题，状态在重启后保留。 */
  collapsed: boolean;
}

/** 项目列表的本地展示状态 */
interface ProjectLayoutSnapshot {
  /** 仓库路径顺序 */
  order: string[];
  /** 路径 -> 软件内显示别名 */
  aliases: Record<string, string>;
  /** 上次激活仓库路径 */
  activePath: string | null;
  /** 每个仓库路径下已标记的完整 Git 引用名 */
  markedBranchRefs: Record<string, string[]>;
  /** 手动创建的分组，数组顺序就是侧栏顺序。 */
  groups: ProjectGroup[];
  /** 仓库路径 -> 分组 id，没有记录的项目显示在未分组区域。 */
  groupByPath: Record<string, string>;
}

const order = ref<string[]>([]);
const aliases = ref<Record<string, string>>({});
const activePath = ref<string | null>(null);
const markedBranchRefs = ref<Record<string, string[]>>({});
const groups = ref<ProjectGroup[]>([]);
const groupByPath = ref<Record<string, string>>({});
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
    // 旧布局没有分支标记，直接按空记录恢复，并保留已有顺序和别名。
    const savedBranchMarks = Object.entries(parsed.markedBranchRefs ?? {})
      .filter(([, refNames]) => Array.isArray(refNames))
      .map(([repoPath, refNames]) => [repoPath, refNames.filter((refName) => typeof refName === "string")] as const);

    // 分组数据来自本机 localStorage，逐项校验，损坏的条目只丢弃自身。
    const savedGroups: ProjectGroup[] = [];
    const groupIds = new Set<string>();
    const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
    for (const candidate of rawGroups) {
      if (!candidate || typeof candidate !== "object") continue;
      const id = typeof candidate.id === "string" ? candidate.id : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!id || !name || name === RESERVED_GROUP_NAME || groupIds.has(id)) continue;
      groupIds.add(id);
      savedGroups.push({ id, name, collapsed: candidate.collapsed === true });
    }
    const savedGroupByPath: Record<string, string> = {};
    if (parsed.groupByPath && typeof parsed.groupByPath === "object") {
      for (const [repoPath, groupId] of Object.entries(parsed.groupByPath)) {
        if (typeof repoPath === "string" && typeof groupId === "string" && groupIds.has(groupId)) {
          savedGroupByPath[repoPath] = groupId;
        }
      }
    }

    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((item) => typeof item === "string") : [],
      aliases: parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases as Record<string, string> : {},
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
      markedBranchRefs: Object.fromEntries(savedBranchMarks),
      groups: savedGroups,
      groupByPath: savedGroupByPath,
    };
  } catch {
    return null;
  }
}

/**
 * 将当前项目展示偏好写入本地布局快照。
 * @returns {void}
 */
function writeSnapshot(): void {
  const snapshot: ProjectLayoutSnapshot = {
    order: order.value,
    aliases: aliases.value,
    activePath: activePath.value,
    markedBranchRefs: markedBranchRefs.value,
    groups: groups.value,
    groupByPath: groupByPath.value,
  };
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(snapshot));
  } catch {
    // 本地存储不可用时，仍保留本次会话的展示状态。
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
    writeSnapshot();
  }, 120);
}

/**
 * 项目列表布局 composable（模块级单例，供应用壳与项目栏共享）。
 */
export function useProjectLayout() {
  /**
   * 在仓库恢复后应用本地项目展示偏好。
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
      markedBranchRefs.value = saved.markedBranchRefs;
      groups.value = saved.groups;
      groupByPath.value = saved.groupByPath;
    }

    const paths = repos.map((repo) => repo.path);
    if (!order.value.length) {
      order.value = paths;
    } else {
      // 旧布局中没有的新项目追加到末尾，避免打开后被隐藏
      const known = new Set(order.value);
      order.value = [...order.value.filter((path) => paths.includes(path)), ...paths.filter((path) => !known.has(path))];
    }

    // 目录已被移除的项目不再保留分组归属，重新加回时从可用的组重新开始。
    const visiblePaths = new Set(paths);
    groupByPath.value = Object.fromEntries(
      Object.entries(groupByPath.value).filter(([path]) => visiblePaths.has(path)),
    );

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
   * 创建一个手动分组；名称去除首尾空格后不能为空且不能重名。
   * @param name - 用户输入的分组名称
   * @returns 新分组；名称无效或重复时返回 null
   */
  function createGroup(name: string): ProjectGroup | null {
    const nextName = name.trim();
    if (!nextName || nextName === RESERVED_GROUP_NAME) return null;
    const duplicate = groups.value.some((group) => group.name.trim().toLowerCase() === nextName.toLowerCase());
    if (duplicate) return null;
    const group: ProjectGroup = { id: crypto.randomUUID(), name: nextName, collapsed: false };
    groups.value = [...groups.value, group];
    scheduleWrite();
    return group;
  }

  /**
   * 修改分组名称，名称规则与新建一致。
   * @param id - 分组 id
   * @param name - 新名称
   * @returns 是否完成重命名
   */
  function renameGroup(id: string, name: string): boolean {
    const nextName = name.trim();
    const target = groups.value.find((group) => group.id === id);
    if (!nextName || !target || nextName === RESERVED_GROUP_NAME) return false;
    const duplicate = groups.value.some((group) => group.id !== id
      && group.name.trim().toLowerCase() === nextName.toLowerCase());
    if (duplicate) return false;
    groups.value = groups.value.map((group) => group.id === id ? { ...group, name: nextName } : group);
    scheduleWrite();
    return true;
  }

  /**
   * 删除分组，组内项目回到未分组；项目本身和磁盘目录都不动。
   * @param id - 分组 id
   * @returns {void}
   */
  function removeGroup(id: string): void {
    groups.value = groups.value.filter((group) => group.id !== id);
    const nextGroupByPath = { ...groupByPath.value };
    for (const [path, groupId] of Object.entries(nextGroupByPath)) {
      if (groupId === id) delete nextGroupByPath[path];
    }
    groupByPath.value = nextGroupByPath;
    scheduleWrite();
  }

  /**
   * 折叠或展开分组，折叠状态随布局一起保存。
   * @param id - 分组 id
   * @returns {void}
   */
  function toggleGroup(id: string): void {
    groups.value = groups.value.map((group) => group.id === id ? { ...group, collapsed: !group.collapsed } : group);
    scheduleWrite();
  }

  /**
   * 将一个项目移入分组，传 null 表示移出到未分组；移入后自动展开目标分组。
   * @param path - 仓库路径
   * @param groupId - 目标分组 id 或 null
   * @returns 是否完成归属更新
   */
  function setGroup(path: string, groupId: string | null): boolean {
    const group = groupId ? groups.value.find((item) => item.id === groupId) : null;
    if (groupId && !group) return false;
    const nextGroupByPath = { ...groupByPath.value };
    if (group) {
      nextGroupByPath[path] = group.id;
      // 拖入后自动展开，避免项目被折叠状态藏起来。
      if (group.collapsed) {
        groups.value = groups.value.map((item) => item.id === group.id ? { ...item, collapsed: false } : item);
      }
    } else {
      delete nextGroupByPath[path];
    }
    groupByPath.value = nextGroupByPath;
    scheduleWrite();
    return true;
  }

  /**
   * 读取项目所属分组，未分组时返回 null。
   * @param path - 仓库路径
   * @returns 分组或 null
   */
  function groupOf(path: string): ProjectGroup | null {
    const groupId = groupByPath.value[path];
    return groupId ? groups.value.find((group) => group.id === groupId) ?? null : null;
  }

  /**
   * 按 id 读取分组，供拖拽目标重新确认当前名称和折叠状态。
   * @param id - 分组 id
   * @returns 分组或 null
   */
  function groupById(id: string): ProjectGroup | null {
    return groups.value.find((group) => group.id === id) ?? null;
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
   * 读取指定仓库的分支标记。
   * @param path - 仓库路径
   * @returns 已标记的完整 Git 引用名
   */
  function getMarkedBranchRefs(path: string): readonly string[] {
    return markedBranchRefs.value[path] ?? [];
  }

  /**
   * 切换指定仓库分支的标记，更新后立即保存。
   * @param path - 仓库路径
   * @param fullName - 完整 Git 引用名，包含本地或远程引用的前缀
   * @returns {void}
   */
  function toggleBranchMark(path: string, fullName: string): void {
    const currentRefs = getMarkedBranchRefs(path);
    const nextRefs = currentRefs.includes(fullName)
      ? currentRefs.filter((refName) => refName !== fullName)
      : [...currentRefs, fullName];

    // 取消最后一个标记时移除空记录。
    if (nextRefs.length) {
      markedBranchRefs.value[path] = nextRefs;
    } else {
      delete markedBranchRefs.value[path];
    }
    writeSnapshot();
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
    delete markedBranchRefs.value[path];
    const nextGroupByPath = { ...groupByPath.value };
    delete nextGroupByPath[path];
    groupByPath.value = nextGroupByPath;
    if (activePath.value === path) activePath.value = null;
    scheduleWrite();
  }

  return {
    order,
    aliases,
    activePath,
    groups,
    hydrate,
    sortProjects,
    displayName,
    saveOrder,
    createGroup,
    renameGroup,
    removeGroup,
    toggleGroup,
    setGroup,
    groupOf,
    groupById,
    setAlias,
    setActivePath,
    getMarkedBranchRefs,
    toggleBranchMark,
    removeProject,
  };
}
