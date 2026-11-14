<!--
  @component RewriteApp
  @description
    GitTrail 3.0 新应用壳：项目列表、主头部、提交列表、Review、设置、分支浏览和远程快捷操作。
    旧 MainView 不再挂载；工作区/提交框/旧历史视图不在此入口出现。

  @workflow
    1. 启动恢复项目，应用项目顺序/别名/上次激活项，加载真实分支、储藏和提交。
    2. 项目点击切换；拖拽排序；右键重命名/移除；真实路径不改。
    3. 提交列表按日期分组；搜索/分页/错误态；点击打开真实 Review。
    4. 头部切换当前和所有分支的范围，其他分支使用独立预览。同步、储藏和设置仍从头部进入。窗口控制走 Tauri。
    5. 分支完整操作、冲突、储藏写操作在后续任务接入本壳。

  @changeLog
    - 2026-11-04: Created. 新应用壳与真实项目/提交/Review/设置/远程读取。
    - 2026-11-06: Updated. 明确单个和批量添加的目录选择提示，并补充选择窗口的异常反馈。
    - 2026-11-06: Updated. 补齐顶部内边距和窗口按钮间隙的拖动区域，保留按钮的普通点击行为。
    - 2026-11-06: Updated. 顶栏常驻拉取和推送数量，接入过程反馈及进入项目、窗口回焦时的自动获取。
    - 2026-11-07: Updated. 顶部标题同时展示软件内别名和原始目录名，补充长名称提示与拖动区域。
    - 2026-11-07: Updated. 分支菜单支持标记和取消标记，星标按项目保存。
    - 2026-11-07: Updated. 项目右键菜单支持复制仓库目录的绝对路径。
    - 2026-11-07: Updated. 提交搜索框支持近半年作者快捷筛选，并保留关键词。
    - 2026-11-07: Updated. 提交右键菜单支持复制提交信息。
    - 2026-11-07: Updated. 首屏恢复项目行，优先加载上次项目，再补齐其他项目的分支摘要。
    - 2026-11-07: Updated. 提交区只在应用首次加载时显示等待提示，切换时直接等查询结果。
    - 2026-11-07: Updated. 远程获取改为手动触发，更多菜单对长上游名称提供悬停提示。
    - 2026-11-07: Updated. 提交列表根据时间格式分配列宽，长时间文案可悬停查看。
    - 2026-11-07: Updated. 非当前分支通过独立弹窗查看历史和执行手动同步。
    - 2026-11-07: Updated. 共用提交搜索组件，并让搜索框换行后从左侧开始。
    - 2026-11-10: Updated. 分支预览中的提交右键菜单支持 Cherry-pick，产生冲突时关闭预览并进入冲突处理。
    - 2026-11-10: Updated. 本地分支支持双击直接检出，单击仍打开该分支的提交预览。
    - 2026-11-10: Updated. 作者筛选支持多选与清除；顶栏“更多”改为“获取远程”，移除重复的上游设置入口。
    - 2026-11-13: Updated. 接入项目命令与 dist 快捷工具，移除侧栏无已知差异文案。
    - 2026-11-13: Updated. 上游分支选择统一使用公共选择框。
    - 2026-11-14: Updated. 项目栏支持手动分组、拖拽/右键归组、分组内快捷添加项目、折叠和分组管理。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useRepoStore, type RepoTab } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { useRepoWatcher } from "@/composables/useRepoWatcher";
import AppSelect from "@/components/AppSelect.vue";
import type { BranchPreviewTarget } from "./composables/useBranchPreview";
import { useGitActions, type GitActionResult } from "./composables/useGitActions";
import type { BranchInfo, CommitInfo, FileDiff, StashInfo } from "@/types/git";
import { useCommitSearch } from "./composables/useCommitSearch";
import { useProjectLayout, type ProjectGroup } from "./composables/useProjectLayout";
import { useRemoteSync, type RemoteSyncAction } from "./composables/useRemoteSync";
import { authorMark, authorTone } from "./utils/author";
import { dateKey, formatTime, groupLabel } from "./utils/date";
import BranchPreviewDialog from "./components/BranchPreviewDialog.vue";
import ProjectTools from "./components/ProjectTools.vue";
import CommitSearchBox from "./components/CommitSearchBox.vue";
import ReviewDialog from "./components/ReviewDialog.vue";
import SettingsView from "./components/SettingsView.vue";
import ConflictDialog from "./components/ConflictDialog.vue";
import GitFailureDialog from "./components/GitFailureDialog.vue";
import StashViewDialog from "./components/StashViewDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const settingsStore = useSettingsStore();
const themeStore = useThemeStore();
const layout = useProjectLayout();
// 在首屏渲染前恢复项目行和显示偏好，Git 读取留到挂载后。
repoStore.restoreRepos();
const startupProjectPath = layout.hydrate(repoStore.repos, repoStore.activeRepo?.path ?? null);
const actions = useGitActions();
const actionBusy = actions.busy;
const gitOperation = actions.operation;
const gitConflictedFiles = actions.conflictedFiles;

const appWindow = getCurrentWindow();
const isMaximized = ref(false);
let unlistenResized: (() => void) | null = null;

const booting = ref(true);
// 提交区的大提示只用于首屏，用户切换项目或分支后便收起。
const showStartupHistoryNotice = ref(true);
const view = ref<"commits" | "settings">("commits");
const railCollapsed = ref(false);
let railUserSet = false;
const projectQuery = ref("");
const addingProjects = ref(false);
const addingMode = ref<"single" | "batch" | null>(null);
const commitSearch = useCommitSearch({
  scope: () => {
    const repo = repoStore.activeRepo;
    return repo ? {
      repoId: repo.id,
      path: repo.path,
      branch: commitStore.queryBranch,
      allBranches: commitStore.queryAllBranches,
      headRef: commitStore.currentBranch?.full_name,
    } : null;
  },
  selectedAuthors: () => repoStore.activeRepo ? commitStore.authorFilters : [],
  setKeyword: commitStore.setSearch,
  setAuthors: commitStore.setAuthorFilters,
});
const { searchInput, authorOptionsOpen, openAuthorOptions, closeAuthorOptions, clearCommitFilters } = commitSearch;
const dragPath = ref<string | null>(null);
const dragOverPath = ref<string | null>(null);

const branchOpen = ref(false);
const branchButton = ref<HTMLButtonElement | null>(null);
const branchPreview = ref<BranchPreviewTarget | null>(null);
const stashOpen = ref(false);

// 单击会打开模态预览，必须等双击判定结束再执行，避免弹窗抢在第二次点击前出现。
const BRANCH_SINGLE_CLICK_DELAY = 240;
let branchClickTimer: ReturnType<typeof setTimeout> | null = null;

const projectMenu = ref<{ x: number; y: number; repo: RepoTab } | null>(null);
const commitMenu = ref<{ x: number; y: number; commit: CommitInfo; index: number } | null>(null);
const branchMenu = ref<{ x: number; y: number; branch: BranchInfo; remote: boolean } | null>(null);
const groupMenu = ref<{ x: number; y: number; group: ProjectGroup } | null>(null);
const projectDialog = ref<{ mode: "rename" | "remove"; repo: RepoTab; value: string } | null>(null);
const projectDialogInput = ref<HTMLInputElement | null>(null);
const groupDialog = ref<{
  mode: "create" | "rename" | "remove";
  group: ProjectGroup | null;
  value: string;
  /** 从项目右键新建分组时，创建后自动把该项目移入。 */
  projectPath?: string;
} | null>(null);
const groupDialogInput = ref<HTMLInputElement | null>(null);
const dragOverGroupId = ref<string | null>(null);
const dragOverUngrouped = ref(false);

type BranchDialogMode =
  | "create"
  | "rename"
  | "delete"
  | "merge"
  | "upstream"
  | "fromRemote"
  | "deleteRemote"
  | "checkoutDirty";

interface BranchDialogState {
  mode: BranchDialogMode;
  branch: BranchInfo;
  value: string;
}

const branchDialog = ref<BranchDialogState | null>(null);
const branchDialogInput = ref<HTMLInputElement | null>(null);

type StashDialogMode = "create" | "drop" | "batchDrop";
const stashDialog = ref<{ mode: StashDialogMode; stash: StashInfo | null; value: string } | null>(null);
const stashDialogInput = ref<HTMLInputElement | null>(null);
const stashView = ref<{ stash: StashInfo; files: FileDiff[] } | null>(null);
const selectedStashes = ref<Set<string>>(new Set());

const reviewOpen = ref(false);
const reviewCommit = ref<CommitInfo | null>(null);
const reviewIndex = ref(0);
const reviewTrigger = ref<HTMLElement | null>(null);
const conflictDialogOpen = ref(false);

const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const activeRepo = computed(() => repoStore.activeRepo);
const activeProjectLoading = computed(() => {
  const waitingForSelection = !activeRepo.value && Boolean(repoStore.pendingActivationId);
  return booting.value || waitingForSelection || Boolean(activeRepo.value?.loading);
});
const waitingForCommitContent = computed(() => activeRepo.value
  ? commitStore.loading && !commitStore.commits.length
  : activeProjectLoading.value);
const hasCommitFilters = computed(() => Boolean(commitStore.authorFilters.length || commitStore.search.trim()));
const sortedProjects = computed(() => layout.sortProjects(repoStore.repos));
const groupList = computed(() => layout.groups.value);
const hasGroups = computed(() => groupList.value.length > 0);
const normalizedProjectQuery = computed(() => projectQuery.value.trim().toLowerCase());

/** 侧栏展示的一段：真实分组、未分组，或还没有分组时的平铺列表。 */
interface ProjectSection {
  key: string;
  group: ProjectGroup | null;
  projects: RepoTab[];
  flat: boolean;
}

/**
 * 项目搜索同时匹配显示名、目录名和完整路径。
 * @param repo - 仓库
 * @returns 是否命中当前搜索词
 */
function matchesProjectQuery(repo: RepoTab): boolean {
  const query = normalizedProjectQuery.value;
  return !query || `${layout.displayName(repo)} ${repo.name} ${repo.path}`.toLowerCase().includes(query);
}

const visibleProjects = computed(() => sortedProjects.value.filter(matchesProjectQuery));
const groupedProjects = computed(() => {
  const byGroup = new Map<string, RepoTab[]>();
  const ungrouped: RepoTab[] = [];
  for (const repo of visibleProjects.value) {
    const group = layout.groupOf(repo.path);
    if (group) {
      const members = byGroup.get(group.id);
      if (members) {
        members.push(repo);
      } else {
        byGroup.set(group.id, [repo]);
      }
    } else {
      ungrouped.push(repo);
    }
  }
  return { byGroup, ungrouped };
});
const visibleGroups = computed(() => {
  const query = normalizedProjectQuery.value;
  return groupList.value
    .map((group) => ({ group, projects: groupedProjects.value.byGroup.get(group.id) ?? [] }))
    .filter((entry) => !query || entry.projects.length > 0);
});
const visibleUngrouped = computed(() => groupedProjects.value.ungrouped);
const visibleSections = computed<ProjectSection[]>(() => {
  // 没有分组时保持原来的平铺项目列表。
  if (!hasGroups.value) {
    return [{ key: "flat", group: null, projects: visibleProjects.value, flat: true }];
  }
  const sections: ProjectSection[] = visibleGroups.value.map((entry) => ({
    key: entry.group.id, group: entry.group, projects: entry.projects, flat: false,
  }));
  // 有分组时保留未分组区域作为拖出目标；搜索没有命中时不再占位。
  if (!normalizedProjectQuery.value || visibleUngrouped.value.length) {
    sections.push({ key: "ungrouped", group: null, projects: visibleUngrouped.value, flat: false });
  }
  return sections;
});
const visibleProjectCount = computed(() => visibleGroups.value.reduce((total, entry) => total + entry.projects.length, 0)
  + visibleUngrouped.value.length);
const groupDialogTitle = computed(() => {
  const mode = groupDialog.value?.mode;
  return mode === "rename" ? "重命名分组" : mode === "remove" ? "删除分组" : "新建分组";
});
const groupDialogDescription = computed(() => {
  const dialog = groupDialog.value;
  if (!dialog) return "";
  if (dialog.mode === "create") {
    return dialog.projectPath
      ? "创建后会把当前项目移入这个分组；分组只影响左侧列表，不会修改仓库目录。"
      : "分组只影响左侧列表，不会修改仓库目录。创建后把项目拖进来即可。";
  }
  if (dialog.mode === "rename") {
    return "只改变左侧分组名称，不影响组内项目。";
  }
  const count = dialog.group ? groupProjectCount(dialog.group) : 0;
  return count
    ? `删除分组「${dialog.group?.name}」后，组内 ${count} 个项目会回到未分组，不会从项目列表移除。`
    : `删除空分组「${dialog.group?.name}」？不会影响已打开的项目。`;
});

const currentBranch = computed<BranchInfo | null>(
  () => activeRepo.value?.branches.find((branch) => branch.is_current) ?? null,
);
const localBranches = computed(() => (activeRepo.value?.branches ?? []).filter((branch) => !branch.is_remote));
const remoteBranches = computed(() => (activeRepo.value?.branches ?? []).filter((branch) => branch.is_remote));
const upstreamOptions = computed(() => remoteBranches.value.map((branch) => ({ value: branch.name, label: branch.name })));
const markedBranchRefs = computed(() => {
  const repoPath = activeRepo.value?.path;
  return new Set(repoPath ? layout.getMarkedBranchRefs(repoPath) : []);
});
const remoteSync = useRemoteSync(showToast);
const syncBusy = remoteSync.busy;
const syncAction = remoteSync.currentAction;
const syncFeedback = remoteSync.feedback;
const syncFeedbackTitle = remoteSync.feedbackTitle;
const syncError = remoteSync.error;
const syncFailure = remoteSync.failure;
const syncFailureOpen = remoteSync.failureOpen;
const syncFailureRetryable = remoteSync.canRetryFailure;
const openSyncFailure = remoteSync.openFailure;
const closeSyncFailure = remoteSync.dismissFailure;
const retrySyncFailure = remoteSync.retryFailure;
const syncDisabled = computed(() => !activeRepo.value || activeProjectLoading.value || syncBusy.value || !!actionBusy.value);
const showSyncFeedback = computed(() => !activeProjectLoading.value || syncBusy.value || Boolean(actionBusy.value));
const branchLabel = computed(() => {
  if (activeProjectLoading.value && !activeRepo.value?.branchSummaryReady) {
    return "正在读取分支…";
  }
  if (commitStore.scope === "all") return "所有分支";
  return commitStore.browseBranch || currentBranch.value?.name || "未检出";
});
const stashCount = computed(() => activeRepo.value?.stashes.length ?? 0);
const stashes = computed(() => activeRepo.value?.stashes ?? []);
const selectedStashCount = computed(() => selectedStashes.value.size);
const allStashesSelected = computed(
  () => stashes.value.length > 0 && stashes.value.every((stash) => selectedStashes.value.has(stash.index)),
);
const remoteDeleteProtected = computed(
  () => settingsStore.protectRemote && settingsStore.protectRemoteDelete,
);
const hasWorkingChanges = computed(() => {
  const status = activeRepo.value?.status;
  if (!status) return false;
  return status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length > 0;
});
const conflictLabel = computed(() => {
  if (gitOperation.value === "cherrypicking") return "挑拣冲突";
  if (gitOperation.value === "merging") return "合并冲突";
  if (gitOperation.value === "rebasing") return "rebase 冲突";
  if (gitOperation.value === "conflict") return "冲突";
  return "";
});
// 领先/落后数量由常驻按钮展示，此处仅保留独立的工作区状态。
const statusText = computed(() => {
  const status = activeRepo.value?.status;
  if (!status) {
    return "正在读取工作区";
  }
  const changedFileCount = status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length;
  return changedFileCount ? `${changedFileCount} 个改动` : "工作区干净";
});

interface GroupedCommit {
  key: string;
  label: string;
  items: Array<{ commit: CommitInfo; index: number }>;
}

const groupedCommits = computed<GroupedCommit[]>(() => {
  const groups = new Map<string, GroupedCommit>();
  commitStore.commits.forEach((commit, index) => {
    const key = dateKey(commit.author_date);
    if (!groups.has(key)) groups.set(key, { key, label: groupLabel(key), items: [] });
    groups.get(key)!.items.push({ commit, index });
  });
  return Array.from(groups.values());
});

const displayTitle = computed(() => {
  if (view.value === "settings") return "设置";
  return activeRepo.value ? layout.displayName(activeRepo.value) : "GitTrail";
});

// 项目设置别名后保留原目录名作为辅助标识，方便在多个相似项目间辨认。
const originalProjectName = computed(() => {
  const repo = activeRepo.value;
  if (!repo || view.value === "settings") {
    return "";
  }
  return displayTitle.value === repo.name ? "" : repo.name;
});

/**
 * 显示原型风格轻提示。
 * @param message - 文案
 * @returns {void}
 */
function showToast(message: string): void {
  toastMessage.value = message;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastVisible.value = false; }, 2200);
}

/**
 * 复制文本并提示结果。
 * @param value - 文本
 * @param successMessage - 成功文案
 * @returns {Promise<void>}
 */
async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast("复制失败");
  }
}

/**
 * 项目缩写，用于折叠态项目栏。
 * @param repo - 仓库
 * @returns 1～2 个字符
 */
function projectInitials(repo: RepoTab): string {
  const name = layout.displayName(repo);
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  return (parts.length > 1 ? parts.map((part) => part[0]).join("") : name.slice(0, 2)).slice(0, 2).toUpperCase();
}

/**
 * 项目行副标题：当前分支 + ahead/behind。
 * @param repo - 仓库
 * @returns 文案
 */
function projectMeta(repo: RepoTab): string {
  // 首屏项目尚未读取分支时，避免把占位数据当成未检出或已同步。
  if (!repo.branchSummaryReady) {
    if (repo.loading || repoStore.pendingActivationId === repo.id) {
      return "正在读取…";
    }
    return repo.error ? "读取失败" : "待加载";
  }
  const branch = repo.branches.find((item) => item.is_current);
  const projectLabels = [branch?.name ?? "未检出"];
  if (branch?.ahead) {
    projectLabels.push(`${branch.ahead} 未推送`);
  }
  if (branch?.behind) {
    projectLabels.push(`${branch.behind} 待拉取`);
  }

  // 侧栏依赖本地远程引用，零差异不代表刚刚检查过远程，未配置上游时也不能宣称已同步。
  if (branch && !branch.upstream) {
    projectLabels.push("未设置上游");
  }
  return projectLabels.join(" · ");
}

/**
 * 按设置显示提交时间：相对时间或绝对时间。
 * @param commit - 提交
 * @returns 时间文案
 */
function commitTime(commit: CommitInfo): string {
  if (settingsStore.timeFormat === "relative" && commit.relative_date) {
    return commit.relative_date;
  }
  return formatTime(commit.author_date);
}

/**
 * 关闭其他浮层，避免多个菜单重叠。
 * @returns {void}
 */
function closeFloatingPanels(): void {
  branchOpen.value = false;
  stashOpen.value = false;
  closeAuthorOptions();
  projectMenu.value = null;
  commitMenu.value = null;
  branchMenu.value = null;
  groupMenu.value = null;
}

/**
 * 优先激活上次打开的项目，失效时按项目栏顺序寻找可用仓库。
 * @returns {Promise<void>}
 */
async function boot(): Promise<void> {
  try {
    const projects = sortedProjects.value;
    const target = projects.find((repo) => repo.path === startupProjectPath) ?? projects[0];
    if (target) {
      const fallbackIds = projects.filter((repo) => repo.id !== target.id).map((repo) => repo.id);
      await repoStore.setActive(target.id, fallbackIds);
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  } finally {
    booting.value = false;
  }
}

/**
 * 选择项目（真实 repoStore 激活 + 提交切换）。
 * @param repo - 目标仓库
 * @returns {Promise<void>}
 */
async function selectProject(repo: RepoTab): Promise<void> {
  showStartupHistoryNotice.value = false;
  closeFloatingPanels();
  view.value = "commits";
  // 首次打开时若点击了失效项目，仍可从其余项目中找到可用仓库。
  const fallbackIds = activeRepo.value
    ? []
    : sortedProjects.value.filter((item) => item.id !== repo.id).map((item) => item.id);
  await repoStore.setActive(repo.id, fallbackIds);
}

/**
 * 添加项目：系统目录选择 -> Git 校验 -> 写入项目布局。
 * @param multiple - 是否允许在系统窗口中多选项目目录；false 时只选择一个目录
 * @param targetGroup - 指定时把新项目和已打开的项目移入该分组；null 表示普通添加
 * @returns {Promise<void>}
 */
async function addProject(multiple: boolean, targetGroup: ProjectGroup | null = null): Promise<void> {
  // 目录选择和添加过程共用互斥状态，避免两个入口同时发起添加。
  if (addingProjects.value) {
    return;
  }
  // 从分组菜单进入时先收起菜单，系统窗口关闭后不要再盖住侧栏。
  groupMenu.value = null;
  projectMenu.value = null;
  // 顶部加号/批量入口继续显示加载态，分组入口不误导顶部按钮。
  addingMode.value = targetGroup ? null : (multiple ? "batch" : "single");
  addingProjects.value = true;
  const groupLabel = targetGroup ? `「${targetGroup.name}」` : "";
  const addTitle = targetGroup
    ? `添加项目到${groupLabel}`
    : (multiple ? "批量添加项目" : "添加单个项目");

  try {
    // 1. 根据入口启用单选或多选；取消选择时保留现有项目和激活状态。
    const selected = await open({
      title: multiple ? `${addTitle}（按住 Ctrl 或 Shift 多选文件夹）` : addTitle,
      directory: true,
      multiple,
      defaultPath: settingsStore.defaultOpenDir || undefined,
    });
    if (!selected) {
      return;
    }
    const selectedProjectPaths = Array.isArray(selected) ? selected : [selected];
    if (!selectedProjectPaths.length) {
      return;
    }

    // 2. 逐个复用仓库校验和打开流程；单个失败不阻断其余项目，已打开的目录不重复添加。
    const previousActiveId = repoStore.activeId;
    const addedProjectPaths: string[] = [];
    const movedProjectPaths: string[] = [];
    let failedProjectCount = 0;

    for (const projectPath of selectedProjectPaths) {
      const existingProject = repoStore.repos.find((repo) => repo.path === projectPath);
      if (existingProject) {
        // 分组添加时，已打开的项目直接移动归属，避免用户再次从列表移除后重加。
        const currentGroup = layout.groupOf(projectPath);
        if (targetGroup && currentGroup?.id !== targetGroup.id && placeProjectInGroup(projectPath, targetGroup)) {
          movedProjectPaths.push(projectPath);
        }
        continue;
      }
      try {
        await repoStore.openRepo(projectPath);
        addedProjectPaths.push(projectPath);
        if (targetGroup) {
          placeProjectInGroup(projectPath, targetGroup);
        }
      } catch {
        failedProjectCount += 1;
      }
    }

    // 3. 成功项目追加到现有顺序末尾，并沿用原来保留当前项目的行为。
    if (addedProjectPaths.length || movedProjectPaths.length) {
      if (addedProjectPaths.length) {
        layout.saveOrder([...new Set([...layout.order.value, ...addedProjectPaths])]);
      }
      const targetId = previousActiveId && repoStore.repos.some((repo) => repo.id === previousActiveId)
        ? previousActiveId
        : repoStore.repos.find((repo) => repo.path === addedProjectPaths[0])?.id;
      if (targetId) {
        await repoStore.setActive(targetId);
      }
      layout.setActivePath(repoStore.activeRepo?.path ?? null);
      view.value = "commits";
      closeFloatingPanels();
      // 分组添加后清掉搜索，确保新项目/移动后的项目能在目标分组里看到。
      if (targetGroup) {
        projectQuery.value = "";
      }
    }

    // 4. 根据实际添加结果反馈，避免将部分失败或全部重复误报为全部成功。
    const failedSuffix = failedProjectCount ? `，${failedProjectCount} 个失败` : "";
    if (targetGroup && (addedProjectPaths.length || movedProjectPaths.length)) {
      if (addedProjectPaths.length && movedProjectPaths.length) {
        showToast(`已添加 ${addedProjectPaths.length} 个项目，另有 ${movedProjectPaths.length} 个移入${groupLabel}${failedSuffix}`);
      } else if (addedProjectPaths.length) {
        showToast(addedProjectPaths.length === 1
          ? `项目已添加到${groupLabel}${failedSuffix}`
          : `已添加 ${addedProjectPaths.length} 个项目到${groupLabel}${failedSuffix}`);
      } else {
        showToast(movedProjectPaths.length === 1
          ? `项目已移入${groupLabel}${failedSuffix}`
          : `已将 ${movedProjectPaths.length} 个项目移入${groupLabel}${failedSuffix}`);
      }
    } else if (addedProjectPaths.length) {
      showToast(multiple
        ? `已添加 ${addedProjectPaths.length} 个项目${failedSuffix}`
        : "项目已打开");
    } else if (failedProjectCount) {
      showToast("没有添加成功，请检查所选目录是否为 Git 仓库");
    } else if (targetGroup) {
      showToast(`所选项目已在${groupLabel}中`);
    } else {
      showToast("所选项目已在列表中");
    }
  } catch (error) {
    // 原生目录选择直接调用 Tauri，没有公共错误提示，需要在此反馈窗口打开失败等异常。
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    addingProjects.value = false;
    addingMode.value = null;
  }
}

/**
 * 打开项目右键菜单。
 * @param event - 右键事件
 * @param repo - 仓库
 * @returns {void}
 */
function openProjectContext(event: MouseEvent, repo: RepoTab): void {
  if (view.value === "settings") view.value = "commits";
  branchOpen.value = false;
  stashOpen.value = false;
  commitMenu.value = null;
  branchMenu.value = null;
  groupMenu.value = null;
  // 分组越多菜单越高，靠近窗口底部时向上收，避免菜单被裁掉。
  const estimatedHeight = 260 + groupList.value.length * 30;
  projectMenu.value = {
    x: event.clientX,
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - estimatedHeight - 12)),
    repo,
  };
}

/**
 * 打开项目重命名对话框。
 * @param repo - 仓库
 * @returns {Promise<void>}
 */
async function openRenameDialog(repo: RepoTab): Promise<void> {
  projectMenu.value = null;
  projectDialog.value = { mode: "rename", repo, value: layout.displayName(repo) };
  await nextTick();
  projectDialogInput.value?.focus();
  projectDialogInput.value?.select();
}

/**
 * 打开移除项目确认。
 * @param repo - 仓库
 * @returns {void}
 */
function openRemoveDialog(repo: RepoTab): void {
  projectMenu.value = null;
  projectDialog.value = { mode: "remove", repo, value: "" };
}

/**
 * 确认项目显示名/移除；移除只影响软件列表，不删目录。
 * @returns {Promise<void>}
 */
async function confirmProjectDialog(): Promise<void> {
  const dialog = projectDialog.value;
  if (!dialog) return;

  if (dialog.mode === "rename") {
    const alias = dialog.value.trim();
    if (!alias) {
      showToast("显示名称不能为空");
      return;
    }
    layout.setAlias(dialog.repo.path, alias === dialog.repo.name ? "" : alias);
    projectDialog.value = null;
    showToast(`项目显示为 ${layout.displayName(dialog.repo)}`);
    return;
  }

  projectDialog.value = null;
  await repoStore.closeRepo(dialog.repo.id);
  layout.removeProject(dialog.repo.path);
  const next = sortedProjects.value[0];
  if (!repoStore.activeRepo) {
    await commitStore.switchRepo();
  } else if (next) {
    layout.setActivePath(repoStore.activeRepo.path);
  }
  showToast("已从项目列表移除");
}

/**
 * 统计分组内的全部项目，不受搜索过滤影响。
 * @param group - 分组
 * @returns 项目数量
 */
function groupProjectCount(group: ProjectGroup): number {
  return sortedProjects.value.reduce((total, repo) => (
    layout.groupOf(repo.path)?.id === group.id ? total + 1 : total
  ), 0);
}

/**
 * 判断当前激活项目是否在这个分组内，用于折叠状态下仍能看出所在分组。
 * @param section - 分组展示段
 * @returns 是否包含当前项目
 */
function sectionHasActiveProject(section: ProjectSection): boolean {
  const active = activeRepo.value;
  return Boolean(active && section.group && layout.groupOf(active.path)?.id === section.group.id);
}

/**
 * 项目拖拽开始，清掉上一次的放置高亮。
 * @param repo - 被拖动的项目
 * @returns {void}
 */
function startProjectDrag(repo: RepoTab): void {
  dragPath.value = repo.path;
  dragOverPath.value = null;
  dragOverGroupId.value = null;
  dragOverUngrouped.value = false;
}

/**
 * 拖到项目行上时只高亮该行，并清除分组标题的高亮。
 * @param repo - 目标项目
 * @returns {void}
 */
function dragOverProject(repo: RepoTab): void {
  if (!dragPath.value) return;
  dragOverPath.value = repo.path;
  dragOverGroupId.value = null;
  dragOverUngrouped.value = false;
}

/**
 * 清理项目拖拽过程中的所有高亮和目标，拖拽取消时复用。
 * @returns {void}
 */
function clearDragState(): void {
  dragPath.value = null;
  dragOverPath.value = null;
  dragOverGroupId.value = null;
  dragOverUngrouped.value = false;
}

/**
 * 把一个项目放进目标分组；移入时顺带放到组内最后，避免新项目插到组中间。
 * @param path - 项目路径
 * @param group - 目标分组；null 表示移出到未分组
 * @returns 是否完成归属更新
 */
function placeProjectInGroup(path: string, group: ProjectGroup | null): boolean {
  const memberPaths = group
    ? new Set(sortedProjects.value
      .filter((repo) => layout.groupOf(repo.path)?.id === group.id)
      .map((repo) => repo.path))
    : new Set<string>();
  if (!layout.setGroup(path, group?.id ?? null)) {
    return false;
  }
  if (!group) {
    return true;
  }

  const order = sortedProjects.value.map((repo) => repo.path).filter((item) => item !== path);
  let insertAt = order.length;
  for (let index = order.length - 1; index >= 0; index -= 1) {
    if (memberPaths.has(order[index])) {
      insertAt = index + 1;
      break;
    }
  }
  order.splice(insertAt, 0, path);
  layout.saveOrder(order);
  return true;
}

/**
 * 从项目右键菜单把项目移入/移出分组。
 * @param repo - 项目
 * @param group - 目标分组；null 表示移出
 * @returns {void}
 */
function moveProjectToGroup(repo: RepoTab, group: ProjectGroup | null): void {
  projectMenu.value = null;
  const currentGroup = layout.groupOf(repo.path);
  if ((currentGroup?.id ?? null) === (group?.id ?? null)) {
    return;
  }
  if (placeProjectInGroup(repo.path, group)) {
    showToast(group ? `已移入分组「${group.name}」` : "已移出分组");
  }
}

/**
 * 拖到分组标题时切换目标高亮；未分组标题复用同一套状态。
 * @param section - 分组展示段
 * @returns {void}
 */
function dragOverSection(section: ProjectSection): void {
  if (!dragPath.value) return;
  dragOverPath.value = null;
  if (section.group) {
    dragOverGroupId.value = section.group.id;
    dragOverUngrouped.value = false;
  } else if (!section.flat) {
    dragOverGroupId.value = null;
    dragOverUngrouped.value = true;
  }
}

/**
 * 离开分组标题时只清除该标题的高亮，避免拖动经过子元素时闪到别的组。
 * @param section - 分组展示段
 * @returns {void}
 */
function dragLeaveSection(section: ProjectSection): void {
  if (section.group && dragOverGroupId.value === section.group.id) {
    dragOverGroupId.value = null;
  }
  if (!section.group && !section.flat) {
    dragOverUngrouped.value = false;
  }
}

/**
 * 拖到分组标题后放下，groupId 为空表示放入未分组。
 * @param groupId - 目标分组 id 或 null
 * @returns {void}
 */
function dropOnGroup(groupId: string | null): void {
  const path = dragPath.value;
  clearDragState();
  if (!path) return;
  const group = groupId ? layout.groupById(groupId) : null;
  if (groupId && !group) return;
  if ((layout.groupOf(path)?.id ?? null) === (group?.id ?? null)) {
    return;
  }
  if (placeProjectInGroup(path, group)) {
    showToast(group ? `已移入分组「${group.name}」` : "已移出分组");
  }
}

/**
 * 分组标题放下时转交统一的归属更新。
 * @param section - 分组展示段
 * @returns {void}
 */
function dropOnSection(section: ProjectSection): void {
  if (section.flat) return;
  dropOnGroup(section.group?.id ?? null);
}

/**
 * 项目拖拽：拖到另一个项目上时先处理跨组归属，再调整项目顺序。
 * @param fromPath - 拖拽项目路径，未从项目行开始拖动时为空
 * @param toPath - 目标项目路径
 * @returns {void}
 */
function moveProject(fromPath: string | null, toPath: string): void {
  clearDragState();
  if (!fromPath || !toPath || fromPath === toPath) return;
  const sourceGroup = layout.groupOf(fromPath);
  const targetGroup = layout.groupOf(toPath);
  if ((sourceGroup?.id ?? null) !== (targetGroup?.id ?? null)) {
    if (!placeProjectInGroup(fromPath, targetGroup)) {
      return;
    }
    showToast(targetGroup ? `已移入分组「${targetGroup.name}」` : "已移出分组");
  }

  const list = sortedProjects.value.map((repo) => repo.path);
  const fromIndex = list.indexOf(fromPath);
  const toIndex = list.indexOf(toPath);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  layout.saveOrder(list);
}

/**
 * 折叠/展开一个分组；未分组标题不触发。
 * @param section - 分组展示段
 * @returns {void}
 */
function toggleSection(section: ProjectSection): void {
  // 搜索时分组被强制展开以显示命中项，此时不改变保存的折叠状态。
  if (section.group && !normalizedProjectQuery.value) {
    layout.toggleGroup(section.group.id);
  }
}

/**
 * 打开分组右键菜单。
 * @param event - 右键事件
 * @param group - 分组
 * @returns {void}
 */
function openGroupContext(event: MouseEvent, group: ProjectGroup): void {
  if (view.value === "settings") view.value = "commits";
  closeFloatingPanels();
  groupMenu.value = {
    x: event.clientX,
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 220)),
    group,
  };
}

/**
 * 从分组标题右侧的管理按钮打开菜单，菜单贴着按钮左下方。
 * @param event - 点击事件
 * @param group - 分组
 * @returns {void}
 */
function openGroupMenuFromButton(event: MouseEvent, group: ProjectGroup): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (view.value === "settings") view.value = "commits";
  closeFloatingPanels();
  groupMenu.value = {
    x: rect.left,
    y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 220)),
    group,
  };
}

/**
 * 展示段右键菜单转交到分组菜单。
 * @param event - 右键事件
 * @param section - 分组展示段
 * @returns {void}
 */
function openSectionContext(event: MouseEvent, section: ProjectSection): void {
  if (!section.group) return;
  openGroupContext(event, section.group);
}

/**
 * 展示段的管理按钮转交到分组菜单。
 * @param event - 点击事件
 * @param section - 分组展示段
 * @returns {void}
 */
function openSectionMenu(event: MouseEvent, section: ProjectSection): void {
  if (!section.group) return;
  event.stopPropagation();
  openGroupMenuFromButton(event, section.group);
}

/**
 * 打开新建分组对话框；从项目右键进入时创建后自动移入该项目。
 * @param projectPath - 可选的待移入项目路径
 * @returns {Promise<void>}
 */
async function openCreateGroup(projectPath: string | null = null): Promise<void> {
  closeFloatingPanels();
  groupDialog.value = { mode: "create", group: null, value: "", projectPath: projectPath ?? undefined };
  await nextTick();
  groupDialogInput.value?.focus();
  groupDialogInput.value?.select();
}

/**
 * 打开重命名分组对话框。
 * @param group - 分组
 * @returns {Promise<void>}
 */
async function openRenameGroup(group: ProjectGroup): Promise<void> {
  groupMenu.value = null;
  groupDialog.value = { mode: "rename", group, value: group.name };
  await nextTick();
  groupDialogInput.value?.focus();
  groupDialogInput.value?.select();
}

/**
 * 打开删除分组确认；组内项目会回到未分组。
 * @param group - 分组
 * @returns {void}
 */
function openRemoveGroup(group: ProjectGroup): void {
  groupMenu.value = null;
  groupDialog.value = { mode: "remove", group, value: "" };
}

/**
 * 分组名称输入框回车：输入法确认候选词时不提交，避免中文名称被提前创建。
 * @param event - 输入框收到的键盘事件
 * @returns {void}
 */
function submitGroupDialog(event: KeyboardEvent): void {
  if (event.isComposing) {
    return;
  }
  event.preventDefault();
  confirmGroupDialog();
}

/**
 * 确认分组新建、重命名或删除。
 * @returns {void}
 */
function confirmGroupDialog(): void {
  const dialog = groupDialog.value;
  if (!dialog) return;

  if (dialog.mode === "remove") {
    if (!dialog.group) return;
    const name = dialog.group.name;
    const count = groupProjectCount(dialog.group);
    layout.removeGroup(dialog.group.id);
    groupDialog.value = null;
    showToast(count ? `已删除分组「${name}」，${count} 个项目已移到未分组` : `已删除分组「${name}」`);
    return;
  }

  const name = dialog.value.trim();
  if (!name) {
    showToast("分组名称不能为空");
    return;
  }
  if (name === "未分组") {
    showToast("「未分组」是保留名称");
    return;
  }
  const duplicate = groupList.value.some((group) => group.id !== dialog.group?.id
    && group.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showToast("分组名称已存在");
    return;
  }

  if (dialog.mode === "create") {
    const group = layout.createGroup(name);
    if (!group) {
      showToast("分组名称已存在");
      return;
    }
    // 新分组即使为空也要可见，避免当前搜索词把它过滤掉。
    projectQuery.value = "";
    const project = dialog.projectPath
      ? repoStore.repos.find((repo) => repo.path === dialog.projectPath)
      : null;
    if (project && placeProjectInGroup(project.path, group)) {
      showToast(`已新建分组「${group.name}」，并移入项目`);
    } else {
      showToast(`已新建分组「${group.name}」`);
    }
  } else if (dialog.group) {
    if (!layout.renameGroup(dialog.group.id, name)) {
      showToast("分组名称已存在");
      return;
    }
    showToast(`分组已重命名为「${name}」`);
  }
  groupDialog.value = null;
}

/**
 * 打开分支 ⋯ 菜单。
 * @param event - 点击事件
 * @param branch - 分支
 * @param remote - 是否远程分支
 * @returns {void}
 */
function openBranchMenu(event: MouseEvent, branch: BranchInfo, remote: boolean): void {
  cancelBranchClick();
  projectMenu.value = null;
  commitMenu.value = null;
  branchMenu.value = { x: event.clientX, y: event.clientY, branch, remote };
}

/**
 * 切换当前项目下指定分支的星标，并收起分支操作菜单。
 * @param branch - 用户打开操作菜单的分支
 * @returns {void}
 */
function toggleBranchMark(branch: BranchInfo): void {
  const repoPath = activeRepo.value?.path;
  // 等待启动恢复结束，避免用尚未恢复的布局覆盖已有偏好。
  if (booting.value || !repoPath) {
    return;
  }

  layout.toggleBranchMark(repoPath, branch.full_name);
  branchMenu.value = null;
}

/**
 * 打开分支对话框。
 * @param mode - 对话框类型
 * @param branch - 分支
 * @param value - 初始输入/上游
 * @returns {Promise<void>}
 */
async function openBranchDialog(mode: BranchDialogMode, branch: BranchInfo, value = ""): Promise<void> {
  cancelBranchClick();
  branchMenu.value = null;
  branchOpen.value = false;
  const initial = value
    || (mode === "rename" ? branch.name : "")
    || (mode === "upstream" ? (branch.upstream || remoteBranches.value[0]?.name || "") : "")
    || (mode === "fromRemote" ? (branch.name.split("/").slice(1).join("/") || branch.name) : "");
  branchDialog.value = { mode, branch, value: initial };
  await nextTick();
  branchDialogInput.value?.focus();
  branchDialogInput.value?.select();
}

/**
 * 从当前分支打开新建分支对话框。
 * @returns {Promise<void>}
 */
async function openCreateBranch(): Promise<void> {
  const base = currentBranch.value ?? localBranches.value[0];
  if (!base) {
    showToast("没有可用的本地分支");
    return;
  }
  await openBranchDialog("create", base);
}

/**
 * 分支对话框文案。
 * @returns 标题/描述/确认文案/危险色
 */
const branchDialogCopy = computed(() => {
  const dialog = branchDialog.value;
  if (!dialog) return { title: "", description: "", confirm: "确定", danger: false };
  switch (dialog.mode) {
    case "create":
      return { title: "新建分支", description: `从当前分支 ${currentBranch.value?.name ?? "未检出"} 创建并检出。`, confirm: "创建", danger: false };
    case "rename":
      return { title: "重命名分支", description: `本地分支 ${dialog.branch.name}。`, confirm: "保存", danger: false };
    case "delete":
      return { title: "删除分支", description: `删除本地分支 ${dialog.branch.name}，提交仍会保留。`, confirm: "删除", danger: true };
    case "merge":
      return { title: "合并分支", description: `将 ${dialog.branch.name} 合并到 ${currentBranch.value?.name ?? "当前分支"}。`, confirm: "合并", danger: false };
    case "upstream":
      return { title: "设置上游", description: `为 ${dialog.branch.name} 选择跟踪的远程分支。`, confirm: "保存", danger: false };
    case "fromRemote":
      return { title: "从远程创建分支", description: `基于 ${dialog.branch.name} 创建本地分支并检出。`, confirm: "创建", danger: false };
    case "deleteRemote":
      return { title: "删除远程分支", description: `删除 ${dialog.branch.name}。本地分支不受影响。`, confirm: "删除", danger: true };
    case "checkoutDirty":
      return {
        title: "先储藏再切换",
        description: `工作区还有未提交改动，切换到 ${dialog.branch.name} 前会先创建一条储藏。`,
        confirm: "储藏并切换",
        danger: false,
      };
  }
  return { title: "", description: "", confirm: "确定", danger: false };
});

/**
 * 显示 Git 操作结果。
 * @param result - 操作结果
 * @returns {void}
 */
function showActionResult(result: GitActionResult | null): void {
  if (!result) return;
  showToast(result.message);
  if (!result.ok) {
    void actions.refreshOperation();
  }
}

/**
 * 打开冲突处理弹窗。
 * @returns {void}
 */
function openConflictDialog(): void {
  if (gitOperation.value === "normal") return;
  conflictDialogOpen.value = true;
}

/**
 * 标记冲突文件已解决（内部 git add）。
 * @param file - 仓库相对路径
 * @returns {Promise<void>}
 */
async function resolveConflictFile(file: string): Promise<void> {
  showActionResult(await actions.markResolved(file));
}

/**
 * 使用系统默认程序打开冲突文件，用户在外部编辑器解决。
 * @param file - 仓库相对路径
 * @returns {Promise<void>}
 */
async function openConflictFile(file: string): Promise<void> {
  const repo = activeRepo.value;
  if (!repo) return;
  const absolute = `${repo.path.replace(/[\\/]+$/, "")}\\${file.replace(/\//g, "\\")}`;
  try {
    await openShell(absolute);
  } catch (e) {
    showToast(`无法打开文件：${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 检查残留冲突标记。
 * @returns {Promise<void>}
 */
async function checkConflictMarkers(): Promise<void> {
  const markers = await actions.checkConflictMarkers();
  if (!markers.length) {
    showToast("未发现残留冲突标记");
    return;
  }
  showToast(`仍残留冲突标记：${markers.join(", ")}`);
}

/**
 * 继续当前冲突操作；继续前再次校验文件和标记。
 * @returns {Promise<void>}
 */
async function continueConflict(): Promise<void> {
  if (gitConflictedFiles.value.length) {
    showToast("还有未解决的冲突文件");
    return;
  }
  const markers = await actions.checkConflictMarkers();
  if (markers.length) {
    showToast(`仍残留冲突标记：${markers.join(", ")}`);
    return;
  }
  const result = await actions.continueOperation();
  showActionResult(result);
  if (result.ok) {
    conflictDialogOpen.value = false;
    await actions.refreshOperation();
  }
}

/**
 * 中止当前冲突操作。
 * @returns {Promise<void>}
 */
async function abortConflict(): Promise<void> {
  const result = await actions.abortOperation();
  showActionResult(result);
  if (result.ok) conflictDialogOpen.value = false;
}

/**
 * 确认分支对话框并执行真实 Git 操作。
 * @returns {Promise<void>}
 */
async function confirmBranchDialog(): Promise<void> {
  const dialog = branchDialog.value;
  if (!dialog || actionBusy.value) return;
  const branch = dialog.branch;
  const value = dialog.value.trim();

  if ((dialog.mode === "create" || dialog.mode === "rename" || dialog.mode === "fromRemote") && !value) {
    showToast("分支名不能为空");
    return;
  }
  if ((dialog.mode === "rename" || dialog.mode === "fromRemote") && /\s/.test(value)) {
    showToast("分支名不能含空格");
    return;
  }
  if (dialog.mode === "upstream" && !dialog.value) {
    showToast("没有可用的远程分支");
    return;
  }
  if (dialog.mode === "deleteRemote" && remoteDeleteProtected.value) {
    showToast("远程分支删除受保护，请先在设置中关闭保护");
    return;
  }

  branchDialog.value = null;
  let result: GitActionResult | null = null;
  switch (dialog.mode) {
    case "create":
      result = await actions.createBranch(value);
      break;
    case "rename":
      result = await actions.renameBranch(branch.name, value);
      break;
    case "delete":
      result = await actions.deleteBranch(branch.name);
      break;
    case "merge":
      result = await actions.mergeBranch(branch.name);
      break;
    case "upstream":
      result = await actions.setUpstream(branch.name, dialog.value);
      break;
    case "fromRemote":
      result = await actions.createFromRemote(value, branch.name);
      break;
    case "deleteRemote":
      result = await actions.deleteRemoteBranch(branch.name);
      break;
    case "checkoutDirty":
      result = await actions.checkoutBranch(branch, true);
      break;
  }
  showActionResult(result);
}

/**
 * 检出分支：脏工作区先询问是否储藏。
 * @param branch - 分支
 * @returns {Promise<void>}
 */
async function checkoutBranch(branch: BranchInfo): Promise<void> {
  if (branch.is_current) return;
  if (gitOperation.value !== "normal") {
    showToast("请先处理当前冲突，再切换分支");
    return;
  }
  if (hasWorkingChanges.value) {
    await openBranchDialog("checkoutDirty", branch);
    return;
  }
  showActionResult(await actions.checkoutBranch(branch));
}

/**
 * 分支行内拉取。
 * @param branch - 分支
 * @returns {Promise<void>}
 */
async function pullBranch(branch: BranchInfo): Promise<void> {
  cancelBranchClick();
  branchOpen.value = false;
  showActionResult(await actions.pullBranch(branch));
}

/**
 * 打开新建储藏对话框，名称按设置模板预填。
 * @returns {Promise<void>}
 */
async function openCreateStash(): Promise<void> {
  if (!hasWorkingChanges.value) {
    showToast("没有可储藏的改动");
    return;
  }
  stashOpen.value = false;
  stashDialog.value = {
    mode: "create",
    stash: null,
    value: settingsStore.renderStashName(undefined, currentBranch.value?.name),
  };
  await nextTick();
  stashDialogInput.value?.focus();
  stashDialogInput.value?.select();
}

/**
 * 打开删除储藏确认。
 * @param stash - 储藏
 * @returns {void}
 */
function openDropStash(stash: StashInfo): void {
  stashDialog.value = { mode: "drop", stash, value: "" };
}

/**
 * 勾选/取消单条储藏。
 * @param index - stash 引用
 * @param checked - 是否选中
 * @returns {void}
 */
function toggleStash(index: string, checked: boolean): void {
  const next = new Set(selectedStashes.value);
  if (checked) next.add(index);
  else next.delete(index);
  selectedStashes.value = next;
}

/**
 * 全选/取消全选当前储藏。
 * @param checked - 是否全选
 * @returns {void}
 */
function toggleAllStashes(checked: boolean): void {
  selectedStashes.value = checked
    ? new Set(stashes.value.map((stash) => stash.index))
    : new Set();
}

/**
 * 打开批量删除储藏确认。
 * @returns {void}
 */
function openBatchDropStashes(): void {
  if (!selectedStashes.value.size) return;
  stashDialog.value = { mode: "batchDrop", stash: null, value: "" };
}

/**
 * 确认新建/删除储藏。
 * @returns {Promise<void>}
 */
async function confirmStashDialog(): Promise<void> {
  const dialog = stashDialog.value;
  if (!dialog) return;
  if (dialog.mode === "create" && !dialog.value.trim()) {
    showToast("储藏名称不能为空");
    return;
  }
  if (dialog.mode === "create" && !hasWorkingChanges.value) {
    showToast("没有可储藏的改动");
    return;
  }
  if (dialog.mode === "batchDrop" && !selectedStashes.value.size) {
    showToast("没有选中的储藏");
    return;
  }
  if (dialog.mode === "batchDrop") {
    const indices = [...selectedStashes.value];
    stashDialog.value = null;
    const result = await actions.dropStashes(indices);
    selectedStashes.value = new Set();
    showActionResult(result);
    return;
  }

  stashDialog.value = null;
  if (dialog.mode === "create") {
    showActionResult(await actions.createStash(dialog.value.trim()));
    return;
  }
  if (dialog.stash) {
    const result = await actions.dropStash(dialog.stash.index);
    const next = new Set(selectedStashes.value);
    next.delete(dialog.stash.index);
    selectedStashes.value = next;
    showActionResult(result);
  }
}

/**
 * 应用储藏。
 * @param stash - 储藏
 * @returns {Promise<void>}
 */
async function applyStash(stash: StashInfo): Promise<void> {
  stashOpen.value = false;
  showActionResult(await actions.applyStash(stash.index));
}

/**
 * 查看储藏 diff。
 * @param stash - 储藏
 * @returns {Promise<void>}
 */
async function openStashView(stash: StashInfo): Promise<void> {
  stashOpen.value = false;
  const files = await actions.showStash(stash.index);
  if (!files.length) {
    showToast("这条储藏没有可显示的文本差异");
    return;
  }
  stashView.value = { stash, files };
}

/**
 * Cherry-pick 提交到当前分支；冲突时打开冲突处理。
 * @param commit - 提交
 * @returns {Promise<void>}
 */
async function cherryPickCommit(commit: CommitInfo): Promise<void> {
  commitMenu.value = null;
  closeFloatingPanels();
  const result = await actions.cherryPick(commit.hash);
  showActionResult(result);
  await actions.refreshOperation();
  if (gitOperation.value !== "normal") {
    openConflictDialog();
  }
}

/**
 * 打开提交右键菜单。
 * @param event - 右键事件
 * @param commit - 提交
 * @param index - 当前列表索引
 * @returns {void}
 */
function openCommitContext(event: MouseEvent, commit: CommitInfo, index: number): void {
  branchOpen.value = false;
  stashOpen.value = false;
  projectMenu.value = null;
  branchMenu.value = null;
  commitMenu.value = { x: event.clientX, y: event.clientY, commit, index };
}

/**
 * 按提交消息格式复制标题和可选正文，然后收起菜单。
 * @param commit - 右键菜单关联的提交
 * @returns {void}
 */
function copyCommitMessage(commit: CommitInfo): void {
  const commitMessage = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
  void copyText(commitMessage, "已复制提交信息");
  commitMenu.value = null;
}

/**
 * 打开 Review；记录触发元素用于关闭后恢复焦点。
 * @param index - 提交列表索引
 * @param trigger - 触发行
 * @returns {void}
 */
function openReview(index: number, trigger: HTMLElement | null = null): void {
  const commit = commitStore.commits[index];
  if (!commit) return;
  closeFloatingPanels();
  reviewTrigger.value = trigger;
  reviewCommit.value = commit;
  reviewIndex.value = index;
  reviewOpen.value = true;
}

/**
 * 关闭 Review 并把焦点还给提交行。
 * @returns {void}
 */
function closeReview(): void {
  reviewOpen.value = false;
  reviewCommit.value = null;
  const trigger = reviewTrigger.value;
  reviewTrigger.value = null;
  if (trigger && trigger.isConnected) trigger.focus();
}

/**
 * Review 内切换上一个/下一个提交。
 * @param delta - -1/1
 * @returns {void}
 */
function stepReview(delta: number): void {
  const next = reviewIndex.value + delta;
  if (next < 0 || next >= commitStore.commits.length) return;
  reviewIndex.value = next;
  reviewCommit.value = commitStore.commits[next];
}

/**
 * 取消尚未执行的分支单击动作。
 * @returns {void}
 */
function cancelBranchClick(): void {
  if (branchClickTimer) {
    clearTimeout(branchClickTimer);
    branchClickTimer = null;
  }
}

/**
 * 本地分支行单击：延迟打开分支历史预览，为双击检出留出判定时间。
 * @param event - 点击事件，detail 表示同一位置的连续点击次数
 * @param branch - 本地分支
 * @returns {void}
 * @reasoning 单击会打开原生模态预览；若立即执行，双击的第二次点击会被弹窗拦截，
 * 因此先等双击判定结束，再决定打开预览还是让 dblclick 执行检出。
 */
function onLocalBranchClick(event: MouseEvent, branch: BranchInfo): void {
  // 双击产生的第二次 click 交给 dblclick 处理，不能再排一次预览动作。
  if (event.detail > 1) {
    cancelBranchClick();
    return;
  }
  cancelBranchClick();
  branchClickTimer = setTimeout(() => {
    branchClickTimer = null;
    selectBranch(branch);
  }, BRANCH_SINGLE_CLICK_DELAY);
}

/**
 * 本地分支行双击：直接检出该分支，脏工作区和冲突状态沿用现有保护。
 * @param branch - 本地分支
 * @returns 检出及提示更新结束
 */
async function onLocalBranchDblClick(branch: BranchInfo): Promise<void> {
  cancelBranchClick();
  if (branch.is_current) {
    selectBranch(branch);
    return;
  }
  branchOpen.value = false;
  await checkoutBranch(branch);
}

/**
 * 本地分支行的悬停提示，补充双击检出说明。
 * @param branch - 本地分支
 * @returns 上游状态和双击操作提示
 */
function localBranchTitle(branch: BranchInfo): string {
  const upstreamText = branch.upstream ? `上游 ${branch.upstream}` : "未设置上游";
  return branch.is_current ? upstreamText : `${upstreamText}；双击检出`;
}

/**
 * 在主列表选择当前或所有分支，其他分支单独打开预览。
 * @param branch - 分支信息或主列表的范围选项
 * @returns {void}
 */
function selectBranch(branch: BranchInfo | "all" | null): void {
  cancelBranchClick();
  branchOpen.value = false;
  if (branch === "all") {
    showStartupHistoryNotice.value = false;
    commitStore.setScope("all");
    return;
  }
  if (!branch || branch.is_current) {
    showStartupHistoryNotice.value = false;
    commitStore.browseTo(null);
    return;
  }

  const repo = repoStore.activeRepo;
  // 项目失效时不能将旧分支关联到其他仓库。
  if (!repo) {
    return;
  }
  closeFloatingPanels();
  branchPreview.value = {
    repoId: repo.id,
    repoPath: repo.path,
    repoName: layout.displayName(repo),
    branch,
  };
}

/**
 * 关闭分支预览，并把键盘焦点交还给分支入口。
 * @returns 焦点恢复后结束
 */
async function closeBranchPreview(): Promise<void> {
  branchPreview.value = null;
  await nextTick();
  branchButton.value?.focus();
}

/**
 * 分支预览中的 Cherry-pick 产生冲突后，关闭预览并打开主界面的冲突处理。
 * @returns void
 * @reasoning 分支预览使用原生 dialog 顶层，冲突弹窗必须先关闭预览才能显示；
 * 这里的操作状态与预览共用 useGitActions，冲突文件也由主界面统一处理。
 */
function openConflictFromPreview(): void {
  branchPreview.value = null;
  openConflictDialog();
}

/**
 * 提交列表滚动到底部时加载下一页。
 * @param event - 滚动事件
 * @returns {void}
 */
function onCommitScroll(event: Event): void {
  const target = event.target as HTMLElement;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
    if (commitStore.hasMore && !commitStore.loadingMore && !commitStore.loading && !commitStore.search.trim()) {
      void commitStore.loadMore();
    }
  }
}

/**
 * 收起菜单并执行远程操作，过程、结果和目标隔离由同步 Hook 管理。
 * @param action - 获取远程、拉取或推送当前检出分支
 * @returns {Promise<void>}
 */
async function runRemote(action: RemoteSyncAction): Promise<void> {
  await remoteSync.execute(action);
}

/**
 * 切换设置页；离开时关闭浮层。
 * @returns {void}
 */
function toggleSettings(): void {
  closeFloatingPanels();
  reviewOpen.value = false;
  view.value = view.value === "settings" ? "commits" : "settings";
}

/**
 * 折叠/展开项目栏；用户操作后不再自动覆盖。
 * @returns {void}
 */
function toggleRail(): void {
  railUserSet = true;
  railCollapsed.value = !railCollapsed.value;
}

/**
 * 小窗口自动折叠项目栏。
 * @returns {void}
 */
function syncRail(): void {
  if (railUserSet) return;
  railCollapsed.value = window.innerWidth < 1100;
}

/**
 * 关闭右键菜单。
 * @returns {void}
 */
function closeContextMenus(): void {
  projectMenu.value = null;
  commitMenu.value = null;
  branchMenu.value = null;
  groupMenu.value = null;
}

/**
 * 全局点击/键盘收起浮层与对话框。
 * @param event - 鼠标事件
 * @returns {void}
 */
function onDocumentMouseDown(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (!target.closest(".context-menu")) closeContextMenus();
  if (!target.closest(".branch-wrap")) branchOpen.value = false;
  if (!target.closest(".stash-wrap")) stashOpen.value = false;
}

/**
 * 全局 Esc 与搜索快捷键。
 * @param event - 键盘事件
 * @returns {void}
 */
function onDocumentKeydown(event: KeyboardEvent): void {
  // 命令弹窗自行处理 Esc 和焦点，主界面快捷键不干预运行中的任务。
  if (event.target instanceof Element && event.target.closest(".project-command-dialog")) {
    return;
  }
  // 预览和提交审查各自处理键盘，避免快捷键将焦点移到弹窗外。
  if (branchPreview.value) {
    return;
  }
  if (event.key === "Escape") {
    if (projectDialog.value || groupDialog.value || projectMenu.value || commitMenu.value || groupMenu.value) {
      projectDialog.value = null;
      groupDialog.value = null;
      closeContextMenus();
      return;
    }
    if (branchOpen.value || stashOpen.value || authorOptionsOpen.value) {
      closeFloatingPanels();
      return;
    }
    if (view.value === "settings") {
      view.value = "commits";
      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (searchInput.value) {
      closeFloatingPanels();
      searchInput.value.focus();
      openAuthorOptions();
    }
  }
}

/**
 * 窗口最大化状态同步。
 * @returns {Promise<void>}
 */
async function refreshMaximized(): Promise<void> {
  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch {
    // 浏览器预览或窗口 API 不可用时保持默认
  }
}

/**
 * 最小化窗口。
 * @returns {void}
 */
function minimizeWindow(): void {
  void appWindow.minimize();
}

/**
 * 最大化/还原窗口。
 * @returns {void}
 */
function toggleMaximizeWindow(): void {
  void appWindow.toggleMaximize();
}

/**
 * 关闭窗口。
 * @returns {void}
 */
function closeWindow(): void {
  void appWindow.close();
}

const { start: startWatcher } = useRepoWatcher(() => {
  if (!repoStore.activeRepo) return;
  void repoStore.refreshActive();
  void commitStore.loadCommits();
  void actions.refreshOperation();
});

watch(() => repoStore.activeId, async (id) => {
  branchPreview.value = null;
  if (!id) {
    showStartupHistoryNotice.value = false;
    return;
  }
  if (!booting.value) {
    view.value = "commits";
    showStartupHistoryNotice.value = false;
  }
  booting.value = false;
  selectedStashes.value = new Set();
  closeFloatingPanels();
  reviewOpen.value = false;
  conflictDialogOpen.value = false;
  layout.setActivePath(repoStore.activeRepo?.path ?? null);
  const historyLoad = commitStore.switchRepo().finally(() => {
    showStartupHistoryNotice.value = false;
  });
  await Promise.all([historyLoad, actions.refreshOperation()]);
});

// 当前项目的本地数据与首屏提交准备完后，再启动一次后台摘要补齐。
let projectSummariesStarted = false;
const canLoadProjectSummaries = computed(() => {
  return !activeProjectLoading.value && !repoStore.pendingActivationId && !commitStore.loading && !addingProjects.value;
});
watch(canLoadProjectSummaries, (ready) => {
  if (!ready || projectSummariesStarted) {
    return;
  }
  projectSummariesStarted = true;
  void repoStore.loadProjectSummaries();
}, { flush: "post" });

watch(stashes, (list) => {
  const valid = new Set([...selectedStashes.value].filter((index) => list.some((stash) => stash.index === index)));
  if (valid.size !== selectedStashes.value.size) selectedStashes.value = valid;
}, { deep: true });

// 分支菜单收起后丢弃尚未执行的单击，避免菜单都关了才弹出预览。
watch(branchOpen, (open) => {
  if (!open) {
    cancelBranchClick();
  }
});

onMounted(async () => {
  syncRail();
  window.addEventListener("resize", syncRail);
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("keydown", onDocumentKeydown);
  void boot();
  await startWatcher();
  await refreshMaximized();
  try {
    unlistenResized = await appWindow.onResized(() => { void refreshMaximized(); });
  } catch {
    // 非 Tauri 环境忽略
  }
});

onUnmounted(() => {
  if (unlistenResized) unlistenResized();
  window.removeEventListener("resize", syncRail);
  document.removeEventListener("mousedown", onDocumentMouseDown);
  document.removeEventListener("keydown", onDocumentKeydown);
  if (toastTimer) clearTimeout(toastTimer);
  if (branchClickTimer) clearTimeout(branchClickTimer);
});
</script>

<template>
  <div class="app" :class="{ rail: railCollapsed }">
    <aside class="projects" aria-label="项目">
      <div class="brand">
        <span class="brand-full">GitTrail</span>
        <span class="brand-short" aria-hidden="true">GT</span>
      </div>

      <div class="projects-tools">
        <div class="tools-row">
          <span class="projects-label">项目</span>
          <div class="tools-actions">
            <button class="icon-btn add-btn" type="button" :disabled="addingProjects" :aria-label="addingMode === 'single' ? '正在添加项目' : '打开单个项目'" :title="addingMode === 'single' ? '正在添加项目' : '打开单个项目'" @click="addProject(false)">
              <svg v-if="addingMode !== 'single'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
              <svg v-else class="add-spin" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 0 1-8.5 3.5"/><path d="M3 8a5 5 0 0 1 8.5-3.5"/></svg>
            </button>
            <button class="icon-btn batch-add-btn" type="button" :disabled="addingProjects" :aria-label="addingMode === 'batch' ? '正在批量添加项目' : '批量添加项目'" :title="addingMode === 'batch' ? '正在批量添加项目' : '批量添加项目（按住 Ctrl 或 Shift 多选文件夹）'" @click="addProject(true)">
              <svg v-if="addingMode !== 'batch'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H6l1.2 1.4H13a1 1 0 0 1 1 1V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z"/><path d="M8 8v3M6.5 9.5h3"/></svg>
              <svg v-else class="add-spin" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 0 1-8.5 3.5"/><path d="M3 8a5 5 0 0 1 8.5-3.5"/></svg>
            </button>
            <button class="icon-btn group-add-btn" type="button" aria-label="新建分组" title="新建分组" @click="openCreateGroup()">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="11" height="8" rx="1.6"/><path d="M5 2.5h8.5v8"/></svg>
            </button>
            <button class="icon-btn rail-toggle" type="button" :aria-label="railCollapsed ? '展开项目栏' : '折叠项目栏'" :title="railCollapsed ? '展开项目栏' : '折叠项目栏'" @click="toggleRail">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>
            </button>
          </div>
        </div>
        <label class="project-search">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
          <input v-model="projectQuery" type="text" placeholder="搜索项目" aria-label="搜索项目">
        </label>
      </div>

      <div class="project-list" role="list" @dragover.prevent @drop.prevent="clearDragState()">
        <section
          v-for="section in visibleSections"
          :key="section.key"
          class="project-group"
          :class="{
            flat: section.flat,
            ungrouped: !section.group && !section.flat,
            collapsed: !!section.group?.collapsed && !normalizedProjectQuery,
            'has-active': sectionHasActiveProject(section),
          }"
          :role="section.flat ? undefined : 'group'"
          :aria-label="section.flat ? undefined : (section.group?.name ?? '未分组')"
        >
          <div
            v-if="!section.flat"
            class="project-group-header"
            :class="{ 'drag-over': section.group ? dragOverGroupId === section.group.id : dragOverUngrouped, searching: !!normalizedProjectQuery }"
            :role="section.group && !normalizedProjectQuery ? 'button' : undefined"
            :tabindex="section.group && !normalizedProjectQuery ? 0 : undefined"
            :aria-expanded="section.group && !normalizedProjectQuery ? !section.group.collapsed : undefined"
            :aria-label="section.group ? `${section.group.name}，${section.projects.length} 个项目` : undefined"
            :title="section.group ? `${section.group.name}（${section.projects.length} 个项目）` : '未分组'"
            @click="toggleSection(section)"
            @keydown.enter.self.prevent="toggleSection(section)"
            @keydown.space.self.prevent="toggleSection(section)"
            @contextmenu.prevent="openSectionContext($event, section)"
            @dragover.prevent="dragOverSection(section)"
            @dragleave="dragLeaveSection(section)"
            @drop.prevent="dropOnSection(section)"
          >
            <svg v-if="section.group" class="project-group-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 5 5 5-5"/></svg>
            <span class="project-group-name">{{ section.group?.name ?? "未分组" }}</span>
            <span class="project-group-count">{{ section.projects.length }}</span>
            <button
              v-if="section.group"
              class="project-group-add"
              type="button"
              :disabled="addingProjects"
              :aria-label="`添加项目到「${section.group?.name ?? ''}」`"
              :title="`添加项目到「${section.group?.name ?? ''}」`"
              @click.stop="addProject(false, section.group)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
            </button>
            <button v-if="section.group" class="project-group-more" type="button" :aria-label="`管理分组 ${section.group?.name ?? ''}`" title="管理分组" @click.stop="openSectionMenu($event, section)">⋯</button>
          </div>

          <div
            v-show="section.flat || !section.group?.collapsed || railCollapsed || normalizedProjectQuery"
            class="project-group-items"
            @dragover.prevent="dragOverSection(section)"
            @drop.prevent="dropOnSection(section)"
          >
            <div
              v-for="repo in section.projects"
              :key="repo.path"
              class="project"
              :class="{ active: repo.id === repoStore.activeId, dragging: dragPath === repo.path, 'drag-over': dragOverPath === repo.path }"
              role="button"
              tabindex="0"
              draggable="true"
              :title="repo.path"
              :aria-current="repo.id === repoStore.activeId ? 'true' : 'false'"
              @click="selectProject(repo)"
              @keydown.enter.prevent="selectProject(repo)"
              @keydown.space.prevent="selectProject(repo)"
              @contextmenu.prevent="openProjectContext($event, repo)"
              @dragstart="startProjectDrag(repo)"
              @dragover.prevent.stop="dragOverProject(repo)"
              @dragleave="dragOverPath = dragOverPath === repo.path ? null : dragOverPath"
              @drop.prevent.stop="moveProject(dragPath, repo.path)"
              @dragend="clearDragState()"
            >
              <span class="project-dot" aria-hidden="true"></span>
              <span class="project-content">
                <span class="project-name">{{ layout.displayName(repo) }}</span>
                <span class="project-branch">{{ projectMeta(repo) }}</span>
              </span>
              <span class="project-initials" aria-hidden="true">{{ projectInitials(repo) }}</span>
            </div>

            <p v-if="!section.flat && !section.projects.length && !normalizedProjectQuery" class="project-group-empty">
              {{ section.group ? "空分组，拖项目进来" : "拖到这里移出分组" }}
            </p>
          </div>
        </section>

        <div v-if="!visibleProjectCount" class="project-empty">
          {{ repoStore.repos.length ? "没有匹配的项目" : "还没有打开项目" }}
        </div>
      </div>

      <div class="projects-footer">
        <button class="settings-btn" :class="{ active: view === 'settings' }" type="button" @click="toggleSettings">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="6" cy="4" r="1.4" fill="currentColor"/><circle cx="10" cy="8" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/></svg>
          <span class="settings-label">设置</span>
        </button>
      </div>
    </aside>

    <main class="main">
      <!-- Tauri 的裸拖动标记只响应直接命中的元素，外层内边距也需要标记，才能覆盖顶部空白。 -->
      <header class="main-header" data-tauri-drag-region>
        <div class="header-top" data-tauri-drag-region>
          <div class="project-heading" data-tauri-drag-region>
            <h1 class="project-title" :title="displayTitle" data-tauri-drag-region>{{ displayTitle }}</h1>
            <span
              v-if="originalProjectName"
              class="project-original-name"
              :title="`原始目录名 ${originalProjectName}\n${activeRepo?.path}`"
              data-tauri-drag-region
            >{{ originalProjectName }}</span>
          </div>
          <div class="header-drag" data-tauri-drag-region aria-hidden="true"></div>
          <!-- 标记按钮组本身，使按钮间隙可以拖动；按钮自身未标记，仍按原来的点击行为处理。 -->
          <div class="window-controls" data-tauri-drag-region aria-label="窗口控制">
            <button class="window-btn theme-btn" type="button" aria-label="切换主题" title="切换主题" @click="themeStore.toggleTheme()">
              <svg class="icon-sun" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"/></svg>
              <svg class="icon-moon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/></svg>
            </button>
            <button class="window-btn" type="button" aria-label="最小化" title="最小化" @click="minimizeWindow">
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.2"><path d="M2 7h6"/></svg>
            </button>
            <button class="window-btn" type="button" :aria-label="isMaximized ? '还原' : '最大化'" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximizeWindow">
              <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="6" height="6" rx="1"/></svg>
              <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M3.5 3.5h4v4h-4z"/><path d="M2.5 2.5v4h4v-4z"/></svg>
            </button>
            <button class="window-btn close" type="button" aria-label="关闭" title="关闭" @click="closeWindow">
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.2"><path d="m2 2 6 6M8 2 2 8"/></svg>
            </button>
          </div>
        </div>

        <div v-if="view === 'commits'" class="header-bottom">
          <div class="header-tools">
            <div class="branch-wrap">
              <button ref="branchButton" class="branch-btn" type="button" :disabled="activeProjectLoading" aria-haspopup="menu" :aria-expanded="branchOpen" title="浏览分支" @click.stop="branchOpen = !branchOpen; stashOpen = false">
                <span>{{ branchLabel }}</span>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>
              </button>
              <div v-if="branchOpen" class="popover" role="menu">
                <div class="popover-head branch-head">
                  <span>本地分支</span>
                  <button class="branch-create" type="button" title="新建分支" @click.stop="openCreateBranch">新建</button>
                </div>
                <div class="popover-row" :class="{ 'active-row': commitStore.scope === 'current' && branchLabel === branch.name }" v-for="branch in localBranches" :key="branch.full_name">
                  <button
                    type="button"
                    class="popover-item"
                    :class="{ active: commitStore.scope === 'current' && branchLabel === branch.name }"
                    :title="localBranchTitle(branch)"
                    @click="onLocalBranchClick($event, branch)"
                    @dblclick="onLocalBranchDblClick(branch)"
                  >
                    <span class="branch-label">
                      <span class="branch-name">{{ branch.name }}</span>
                      <span v-if="markedBranchRefs.has(branch.full_name)" class="branch-mark" role="img" aria-label="已标记" title="已标记">★</span>
                    </span>
                    <span v-if="branch.is_current" class="check" aria-hidden="true">✓</span>
                  </button>
                  <div class="popover-actions" @dblclick.stop>
                    <button class="branch-action" type="button" :disabled="!!actionBusy" title="拉取" aria-label="拉取" @click.stop="pullBranch(branch)">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7"/><path d="M3 13.5h10"/></svg>
                    </button>
                    <button class="branch-action" type="button" :disabled="!!actionBusy" title="分支操作" aria-label="分支操作" @click.stop="openBranchMenu($event, branch, false)">
                      <span class="branch-more" aria-hidden="true">⋯</span>
                    </button>
                  </div>
                </div>
                <div v-if="remoteBranches.length" class="popover-subhead">远程分支</div>
                <div class="popover-row" v-for="branch in remoteBranches" :key="branch.full_name">
                  <button type="button" class="popover-item remote" :class="{ active: branchLabel === branch.name }" @click="selectBranch(branch)">
                    <span class="branch-label">
                      <span class="branch-name">{{ branch.name }}</span>
                      <span v-if="markedBranchRefs.has(branch.full_name)" class="branch-mark" role="img" aria-label="已标记" title="已标记">★</span>
                    </span>
                  </button>
                  <div class="popover-actions">
                    <button class="branch-action" type="button" :disabled="!!actionBusy" title="远程分支操作" aria-label="远程分支操作" @click.stop="openBranchMenu($event, branch, true)">
                      <span class="branch-more" aria-hidden="true">⋯</span>
                    </button>
                  </div>
                </div>
                <div class="popover-subhead">范围</div>
                <div class="popover-row">
                  <button type="button" class="popover-item" :class="{ active: commitStore.scope === 'all' }" @click="selectBranch('all')">
                    <span>所有分支</span>
                    <span v-if="commitStore.scope === 'all'" class="check" aria-hidden="true">✓</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 同步操作和数量保持常驻，菜单收起后仍能看到进行中状态。 -->
            <div class="tool-wrap">
              <button
                class="icon-control sync-action"
                :class="{ 'has-updates': !!currentBranch?.behind }"
                type="button"
                :disabled="syncDisabled || !currentBranch?.upstream"
                :aria-busy="syncAction === 'pull'"
                :title="currentBranch?.upstream ? `拉取当前检出分支 ${currentBranch.name}，上游 ${currentBranch.upstream}` : '请先在分支菜单的 ⋯ 中设置当前分支上游'"
                @click="runRemote('pull')"
              >
                <svg v-if="syncAction === 'pull'" class="sync-spinner" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 0 1-8.5 3.5M3 8a5 5 0 0 1 8.5-3.5"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>
                <span>{{ syncAction === 'pull' ? '拉取中…' : '拉取' }}</span>
                <span v-if="syncAction !== 'pull'" class="sync-count">{{ currentBranch?.upstream ? currentBranch.behind : '—' }}</span>
              </button>
              <button
                class="icon-control sync-action"
                :class="{ 'has-updates': !!currentBranch?.ahead }"
                type="button"
                :disabled="syncDisabled || !currentBranch?.upstream"
                :aria-busy="syncAction === 'push'"
                :title="currentBranch?.upstream ? `推送当前检出分支 ${currentBranch.name}，上游 ${currentBranch.upstream}` : '请先在分支菜单的 ⋯ 中设置当前分支上游'"
                @click="runRemote('push')"
              >
                <svg v-if="syncAction === 'push'" class="sync-spinner" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 0 1-8.5 3.5M3 8a5 5 0 0 1 8.5-3.5"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M3 13.5h10"/></svg>
                <span>{{ syncAction === 'push' ? '推送中…' : '推送' }}</span>
                <span v-if="syncAction !== 'push'" class="sync-count">{{ currentBranch?.upstream ? currentBranch.ahead : '—' }}</span>
              </button>
              <button
                class="icon-control sync-action"
                type="button"
                :aria-busy="syncAction === 'fetch'"
                :disabled="syncDisabled"
                title="获取远程更新（fetch）"
                @click="runRemote('fetch')"
              >
                <svg :class="{ 'sync-spinner': syncAction === 'fetch' }" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 0 1-8.5 3.5"/><path d="M3 8a5 5 0 0 1 8.5-3.5"/><path d="M11.5 2v3h-3"/><path d="M4.5 14v-3h3"/></svg>
                <span>{{ syncAction === 'fetch' ? '获取中…' : '获取远程' }}</span>
              </button>

              <div class="stash-wrap">
                <button class="icon-control stash-btn" type="button" :disabled="activeProjectLoading" :aria-expanded="stashOpen" title="储藏" @click.stop="stashOpen = !stashOpen; branchOpen = false">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5h11v8h-11z"/><path d="M2 2.5h12v2.5H2z"/><path d="M6 8.5h4"/></svg>
                  <span class="stash-count">{{ activeProjectLoading ? '—' : stashCount }}</span>
                </button>
                <div v-if="stashOpen" class="popover stash-popover">
                  <div class="stash-head">
                    <span class="stash-title">储藏 · {{ stashCount }}</span>
                    <button class="stash-create" type="button" @click="openCreateStash">新建储藏</button>
                  </div>
                  <div v-if="stashes.length" class="stash-toolbar">
                    <label class="stash-select-all">
                      <input type="checkbox" :checked="allStashesSelected" @change="toggleAllStashes(($event.target as HTMLInputElement).checked)">
                      <span>全选</span>
                    </label>
                    <button class="stash-batch-delete" type="button" :disabled="!selectedStashCount" @click="openBatchDropStashes">
                      {{ selectedStashCount ? `删除 ${selectedStashCount}` : "删除选中" }}
                    </button>
                  </div>
                  <div v-if="!stashes.length" class="stash-empty">这个项目还没有储藏</div>
                  <div v-for="stash in stashes" :key="stash.index" class="stash-row">
                    <label class="stash-check">
                      <input
                        type="checkbox"
                        :checked="selectedStashes.has(stash.index)"
                        :aria-label="`选择储藏 ${stash.message}`"
                        @change="toggleStash(stash.index, ($event.target as HTMLInputElement).checked)"
                      >
                    </label>
                    <div class="stash-main">
                      <div class="stash-message" :title="stash.message">{{ stash.message }}</div>
                      <div class="stash-meta">{{ stash.branch }} · {{ stash.hash }}</div>
                    </div>
                    <div class="stash-actions">
                      <button class="stash-action" type="button" title="应用" aria-label="应用储藏" :disabled="!!actionBusy" @click.stop="applyStash(stash)">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7M5 6.5 8 9.5l3-3"/><path d="M3 13.5h10"/></svg>
                      </button>
                      <button class="stash-action" type="button" title="查看" aria-label="查看储藏" :disabled="!!actionBusy" @click.stop="openStashView(stash)">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4Z"/><circle cx="8" cy="8" r="1.8"/></svg>
                      </button>
                      <button class="stash-action" type="button" title="删除" aria-label="删除储藏" :disabled="!!actionBusy" @click.stop="openDropStash(stash)">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9"/><path d="M6.5 7v4M9.5 7v4"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="showSyncFeedback" class="sync-feedback" :class="{ error: syncError && !actionBusy }" role="status" aria-live="polite">
              <!-- 摘要只展示一行，点击回到含完整 git 输出的详情与重试 -->
              <button
                v-if="syncError && !actionBusy"
                class="sync-error-link"
                type="button"
                title="查看完整错误与重试"
                @click="openSyncFailure"
              >{{ syncFeedback }}</button>
              <span v-else :title="syncFeedbackTitle">{{ syncFeedback }}</span>
              <button v-if="syncError && !syncDisabled" class="sync-retry" type="button" @click="runRemote('fetch')">重新检查</button>
            </div>
            <span class="status">{{ statusText }}</span>
          </div>

          <CommitSearchBox :controller="commitSearch" />
        </div>
      </header>

      <div v-if="view === 'commits' && gitOperation !== 'normal'" class="conflict-bar">
        <span class="conflict-state">{{ conflictLabel }}</span>
        <span class="conflict-info">{{ gitConflictedFiles.length }} 个文件待解决</span>
        <div class="conflict-bar-actions">
          <button type="button" @click="openConflictDialog">查看冲突</button>
          <button type="button" class="primary" :disabled="gitConflictedFiles.length > 0 || gitOperation === 'conflict' || gitOperation === 'rebasing' || !!actionBusy" @click="continueConflict">继续</button>
          <button type="button" :disabled="!!actionBusy" @click="abortConflict">中止</button>
        </div>
      </div>

      <div
        v-if="view === 'commits'"
        class="commit-scroll"
        :class="{ 'relative-time': settingsStore.timeFormat === 'relative' }"
        :aria-busy="waitingForCommitContent"
        @scroll="onCommitScroll"
      >
        <div v-if="!activeRepo && !activeProjectLoading" class="empty">
          <h2>{{ repoStore.repos.length ? "请选择一个项目" : "还没有打开项目" }}</h2>
          <p>{{ repoStore.repos.length ? "点击左侧项目读取仓库内容。" : "从左侧打开一个 Git 仓库开始。" }}</p>
        </div>
        <template v-else-if="waitingForCommitContent">
          <div v-if="showStartupHistoryNotice && !hasCommitFilters" class="empty">
            <h2>正在加载提交…</h2>
            <p>正在读取当前仓库的 Git 历史。</p>
          </div>
        </template>
        <div v-else-if="commitStore.error && !commitStore.commits.length" class="empty">
          <h2>提交读取失败</h2>
          <p>{{ commitStore.error }}</p>
          <button class="empty-action" type="button" @click="commitStore.loadCommits()">重试</button>
        </div>
        <div v-else-if="!commitStore.commits.length" class="empty">
          <h2>{{ hasCommitFilters ? "没有匹配的提交" : "这个分支还没有提交" }}</h2>
          <p>{{ hasCommitFilters ? "换一个关键词，或清除筛选条件。" : "换一个项目，或切换到其他分支。" }}</p>
          <button v-if="hasCommitFilters" class="empty-action" type="button" @click="clearCommitFilters">清除筛选</button>
        </div>
        <template v-else>
          <section v-for="group in groupedCommits" :key="group.key" class="date-group">
            <div class="date-head">
              <span class="date-label">{{ group.label }}</span>
              <span class="date-count">{{ group.items.length }} 个提交</span>
            </div>
            <div
              v-for="entry in group.items"
              :key="entry.commit.hash"
              class="commit-row"
              :style="{ '--i': Math.min(entry.index, 6) }"
              role="button"
              tabindex="0"
              :aria-label="`打开审查：${entry.commit.subject}`"
              @click="openReview(entry.index, $event.currentTarget as HTMLElement)"
              @keydown.enter.prevent="openReview(entry.index, $event.currentTarget as HTMLElement)"
              @contextmenu.prevent="openCommitContext($event, entry.commit, entry.index)"
            >
              <span class="commit-time" :title="commitTime(entry.commit)">{{ commitTime(entry.commit) }}</span>
              <span class="avatar" :class="`tone-${authorTone(entry.commit.author_name)}`" aria-hidden="true" :title="entry.commit.author_name">
                {{ authorMark(entry.commit.author_name) }}
              </span>
              <div class="commit-main">
                <div class="commit-subject">{{ entry.commit.subject }}</div>
                <div class="commit-meta">
                  <span class="hash">{{ entry.commit.short_hash }}</span>
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span>{{ entry.commit.author_name }}</span>
                  <template v-if="entry.commit.refs.length">
                    <span class="meta-dot" aria-hidden="true">·</span>
                    <template v-for="(ref, refIndex) in entry.commit.refs" :key="ref">
                      <span v-if="refIndex" class="meta-dot" aria-hidden="true">·</span>
                      <span class="ref" :class="{ remote: ref.startsWith('origin/') }">{{ ref }}</span>
                    </template>
                  </template>
                  <span v-if="commitStore.unpushedHashes.has(entry.commit.hash)" class="unpushed">未推送</span>
                  <span v-if="entry.commit.is_merge" class="merge-badge">merge</span>
                </div>
              </div>
              <span class="commit-action">查看改动 <span aria-hidden="true">→</span></span>
            </div>
          </section>
          <button v-if="commitStore.hasMore && !commitStore.search" class="load-more" type="button" :disabled="commitStore.loadingMore" @click="commitStore.loadMore()">
            {{ commitStore.loadingMore ? "加载中…" : "加载更早的提交" }}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>
          </button>
        </template>
      </div>

      <div v-else class="settings-view">
        <SettingsView />
      </div>
      <ProjectTools :project="activeRepo ? { path: activeRepo.path, name: layout.displayName(activeRepo), branch: currentBranch?.name ?? '' } : null" />
    </main>

    <div
      v-if="projectMenu"
      class="context-menu project-menu"
      :style="{ left: `${projectMenu.x}px`, top: `${projectMenu.y}px`, maxHeight: `calc(100vh - ${projectMenu.y + 16}px)` }"
      role="menu"
    >
      <div class="menu-header">
        <div class="menu-hash">{{ layout.displayName(projectMenu.repo) }}</div>
        <div v-if="layout.groupOf(projectMenu.repo.path)" class="menu-subject">分组 · {{ layout.groupOf(projectMenu.repo.path)?.name }}</div>
      </div>
      <button class="menu-item" type="button" @click="copyText(projectMenu.repo.path, '已复制绝对路径'); projectMenu = null">
        <span>复制绝对路径</span>
      </button>
      <button class="menu-item" type="button" @click="openRenameDialog(projectMenu.repo)"><span>重命名显示名…</span><span class="hint">只改显示</span></button>
      <div class="menu-sep"></div>
      <template v-if="groupList.length">
        <div class="menu-label">移入分组</div>
        <button v-for="group in groupList" :key="group.id" class="menu-item" type="button" @click="moveProjectToGroup(projectMenu.repo, group)">
          <span class="menu-option-name">{{ group.name }}</span>
          <span v-if="layout.groupOf(projectMenu.repo.path)?.id === group.id" class="hint">当前</span>
        </button>
        <button class="menu-item" type="button" :disabled="!layout.groupOf(projectMenu.repo.path)" @click="moveProjectToGroup(projectMenu.repo, null)">
          <span>移出分组</span>
        </button>
      </template>
      <button class="menu-item" type="button" @click="openCreateGroup(projectMenu.repo.path)">
        <span>新建分组并移入…</span>
      </button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" type="button" @click="openRemoveDialog(projectMenu.repo)"><span>从列表移除</span></button>
    </div>

    <div v-if="groupMenu" class="context-menu" :style="{ left: `${groupMenu.x}px`, top: `${groupMenu.y}px` }" role="menu">
      <div class="menu-header">
        <div class="menu-hash">分组 · {{ groupProjectCount(groupMenu.group) }} 个项目</div>
        <div class="menu-subject">{{ groupMenu.group.name }}</div>
      </div>
      <button class="menu-item" type="button" :disabled="addingProjects" @click="addProject(false, groupMenu.group)">
        <span>添加项目…</span>
      </button>
      <div class="menu-sep"></div>
      <button class="menu-item" type="button" @click="openRenameGroup(groupMenu.group)"><span>重命名分组…</span></button>
      <button class="menu-item" type="button" :disabled="!!normalizedProjectQuery" @click="layout.toggleGroup(groupMenu.group.id); groupMenu = null">
        <span>{{ groupMenu.group.collapsed ? "展开分组" : "折叠分组" }}</span>
        <span v-if="normalizedProjectQuery" class="hint">搜索中</span>
      </button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" type="button" @click="openRemoveGroup(groupMenu.group)">
        <span>删除分组</span><span class="hint">项目保留</span>
      </button>
    </div>

    <div v-if="commitMenu" class="context-menu" :style="{ left: `${commitMenu.x}px`, top: `${commitMenu.y}px` }" role="menu">
      <div class="menu-header"><div class="menu-hash">{{ commitMenu.commit.short_hash }}</div><div class="menu-subject">{{ commitMenu.commit.subject }}</div></div>
      <button class="menu-item" type="button" @click="openReview(commitMenu.index); commitMenu = null"><span>查看改动</span><span class="hint">Enter</span></button>
      <button class="menu-item" type="button" @click="cherryPickCommit(commitMenu.commit)"><span>Cherry-pick 到当前分支</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" type="button" @click="copyCommitMessage(commitMenu.commit)"><span>复制提交信息</span></button>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.short_hash, '已复制短哈希'); commitMenu = null"><span>复制短哈希</span></button>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.hash, '已复制完整哈希'); commitMenu = null"><span>复制完整哈希</span></button>
    </div>

    <div v-if="branchMenu" class="context-menu" :style="{ left: `${branchMenu.x}px`, top: `${branchMenu.y}px` }" role="menu">
      <div class="menu-header">
        <div class="menu-hash">{{ branchMenu.remote ? "远程" : "本地" }} · {{ branchMenu.branch.name }}</div>
        <div v-if="branchMenu.branch.upstream" class="menu-subject">上游 {{ branchMenu.branch.upstream }}</div>
      </div>
      <!-- 标记后保留分支列表，让用户看到星标即时更新。 -->
      <button class="menu-item" type="button" :disabled="booting" @mousedown.stop @click="toggleBranchMark(branchMenu.branch)">
        <span>{{ markedBranchRefs.has(branchMenu.branch.full_name) ? "取消标记" : "标记分支" }}</span>
      </button>
      <div class="menu-sep"></div>
      <template v-if="!branchMenu.remote">
        <button class="menu-item" type="button" :disabled="branchMenu.branch.is_current" @click="checkoutBranch(branchMenu.branch); branchMenu = null">
          <span>检出</span><span v-if="branchMenu.branch.is_current" class="hint">当前</span>
        </button>
        <button class="menu-item" type="button" @click="openBranchDialog('rename', branchMenu.branch)"><span>重命名…</span></button>
        <button class="menu-item danger" type="button" :disabled="branchMenu.branch.is_current" @click="openBranchDialog('delete', branchMenu.branch)"><span>删除</span></button>
        <button class="menu-item" type="button" :disabled="branchMenu.branch.is_current" @click="openBranchDialog('merge', branchMenu.branch)"><span>合并到当前分支</span></button>
        <button class="menu-item" type="button" @click="openBranchDialog('upstream', branchMenu.branch)"><span>设置上游…</span><span class="hint">{{ branchMenu.branch.upstream || "未设置" }}</span></button>
        <button class="menu-item" type="button" :disabled="!!actionBusy" @click="pullBranch(branchMenu.branch); branchMenu = null"><span>拉取</span></button>
        <div class="menu-sep"></div>
        <button class="menu-item" type="button" @click="copyText(branchMenu.branch.name, '已复制分支名'); branchMenu = null"><span>复制分支名</span></button>
      </template>
      <template v-else>
        <button class="menu-item" type="button" @click="openBranchDialog('fromRemote', branchMenu.branch)"><span>从远程创建本地分支…</span></button>
        <button class="menu-item danger" type="button" :disabled="remoteDeleteProtected" @click="openBranchDialog('deleteRemote', branchMenu.branch)">
          <span>删除远程分支</span><span v-if="remoteDeleteProtected" class="hint">受保护</span>
        </button>
        <div class="menu-sep"></div>
        <button class="menu-item" type="button" @click="copyText(branchMenu.branch.name, '已复制远程分支名'); branchMenu = null"><span>复制远程分支名</span></button>
      </template>
    </div>

    <div v-if="branchDialog" class="action-backdrop" @click.self="branchDialog = null">
      <section class="action-dialog" role="dialog" aria-modal="true" tabindex="-1" @keydown.esc.prevent="branchDialog = null">
        <h2 class="action-title">{{ branchDialogCopy.title }}</h2>
        <p class="action-desc">{{ branchDialogCopy.description }}</p>
        <div class="action-body">
          <label v-if="branchDialog.mode === 'upstream'" class="action-field">
            <span>远程分支</span>
            <AppSelect v-model="branchDialog.value" :options="upstreamOptions" ariaLabel="远程分支" />
          </label>
          <label v-else-if="branchDialog.mode === 'create' || branchDialog.mode === 'rename' || branchDialog.mode === 'fromRemote'" class="action-field">
            <span>分支名</span>
            <input ref="branchDialogInput" v-model="branchDialog.value" placeholder="例如 feat/next-step" @keydown.enter.prevent="confirmBranchDialog()">
          </label>
        </div>
        <div class="action-actions">
          <button class="action-btn secondary" type="button" @click="branchDialog = null">取消</button>
          <button class="action-btn" :class="branchDialogCopy.danger ? 'danger' : 'primary'" type="button" :disabled="!!actionBusy" @click="confirmBranchDialog()">
            {{ actionBusy ? "处理中…" : branchDialogCopy.confirm }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="projectDialog" class="action-backdrop" @click.self="projectDialog = null">
      <section class="action-dialog" role="dialog" aria-modal="true" tabindex="-1" @keydown.esc.prevent="projectDialog = null">
        <h2 class="action-title">{{ projectDialog.mode === "rename" ? "重命名项目" : "移除项目" }}</h2>
        <p class="action-desc">{{ projectDialog.mode === "rename" ? "只改变软件内显示名称，不改仓库目录。" : "从项目列表移除，不会删除磁盘目录。" }}</p>
        <div v-if="projectDialog.mode === 'rename'" class="action-body">
          <label class="action-field">
            <span>显示名称</span>
            <input ref="projectDialogInput" v-model="projectDialog.value" :placeholder="projectDialog.repo.name" @keydown.enter.prevent="confirmProjectDialog()">
          </label>
        </div>
        <div class="action-actions">
          <button class="action-btn secondary" type="button" @click="projectDialog = null">取消</button>
          <button class="action-btn" :class="projectDialog.mode === 'remove' ? 'danger' : 'primary'" type="button" @click="confirmProjectDialog()">
            {{ projectDialog.mode === "rename" ? "保存" : "移除" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="groupDialog" class="action-backdrop" @click.self="groupDialog = null">
      <section class="action-dialog" role="dialog" aria-modal="true" tabindex="-1" @keydown.esc.prevent="groupDialog = null">
        <h2 class="action-title">{{ groupDialogTitle }}</h2>
        <p class="action-desc">{{ groupDialogDescription }}</p>
        <div v-if="groupDialog.mode !== 'remove'" class="action-body">
          <label class="action-field">
            <span>分组名称</span>
            <input
              ref="groupDialogInput"
              v-model="groupDialog.value"
              maxlength="30"
              placeholder="例如 beta / main / dev"
              @keydown.enter="submitGroupDialog"
            >
          </label>
        </div>
        <div class="action-actions">
          <button class="action-btn secondary" type="button" @click="groupDialog = null">取消</button>
          <button
            class="action-btn"
            :class="groupDialog.mode === 'remove' ? 'danger' : 'primary'"
            type="button"
            @click="confirmGroupDialog()"
          >
            {{ groupDialog.mode === "create" ? "创建" : groupDialog.mode === "rename" ? "保存" : "删除分组" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="stashDialog" class="action-backdrop" @click.self="stashDialog = null">
      <section class="action-dialog" role="dialog" aria-modal="true" tabindex="-1" @keydown.esc.prevent="stashDialog = null">
        <h2 class="action-title">
          {{ stashDialog.mode === "create" ? "新建储藏" : stashDialog.mode === "batchDrop" ? "批量删除储藏" : "删除储藏" }}
        </h2>
        <p class="action-desc">
          {{ stashDialog.mode === "create"
            ? "把当前全部改动收起，之后可以再应用。"
            : stashDialog.mode === "batchDrop"
              ? `删除选中的 ${selectedStashCount} 条储藏，无法恢复。`
              : `删除 ${stashDialog.stash?.message ?? "这条储藏"}，无法恢复。` }}
        </p>
        <div v-if="stashDialog.mode === 'create'" class="action-body">
          <label class="action-field">
            <span>储藏名称</span>
            <input ref="stashDialogInput" v-model="stashDialog.value" @keydown.enter.prevent="confirmStashDialog()">
          </label>
        </div>
        <div class="action-actions">
          <button class="action-btn secondary" type="button" @click="stashDialog = null">取消</button>
          <button class="action-btn" :class="stashDialog.mode === 'create' ? 'primary' : 'danger'" type="button" :disabled="!!actionBusy" @click="confirmStashDialog()">
            {{ actionBusy ? "处理中…" : stashDialog.mode === "create" ? "储藏" : stashDialog.mode === "batchDrop" ? "删除选中" : "删除" }}
          </button>
        </div>
      </section>
    </div>

    <BranchPreviewDialog v-if="branchPreview" :target="branchPreview" @close="closeBranchPreview" @conflict="openConflictFromPreview" />

    <ReviewDialog
      v-if="reviewOpen && reviewCommit && activeRepo"
      :commit="reviewCommit"
      :repo-path="activeRepo.path"
      :index="reviewIndex"
      :total="commitStore.commits.length"
      @close="closeReview"
      @step="stepReview"
    />

    <ConflictDialog
      v-if="conflictDialogOpen"
      :operation="gitOperation"
      :files="gitConflictedFiles"
      :busy="!!actionBusy"
      @close="conflictDialogOpen = false"
      @resolve="resolveConflictFile"
      @open-file="openConflictFile"
      @check="checkConflictMarkers"
      @continue="continueConflict"
      @abort="abortConflict"
    />

    <StashViewDialog
      v-if="stashView"
      :stash="stashView.stash"
      :files="stashView.files"
      @close="stashView = null"
    />

    <GitFailureDialog
      v-if="syncFailureOpen && syncFailure"
      :title="syncFailure.title"
      :context="syncFailure.context"
      :detail="syncFailure.detail"
      :hint="syncFailure.hint"
      :can-retry="syncFailureRetryable"
      @retry="retrySyncFailure"
      @close="closeSyncFailure"
    />

    <div class="toast" :class="{ show: toastVisible }" role="status" aria-live="polite">{{ toastMessage }}</div>
  </div>
</template>
