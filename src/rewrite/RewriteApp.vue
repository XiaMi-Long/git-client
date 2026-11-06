<!--
  @component RewriteApp
  @description
    GitTrail 3.0 新应用壳：项目列表、主头部、提交列表、Review、设置、分支浏览和远程快捷操作。
    旧 MainView 不再挂载；工作区/提交框/旧历史视图不在此入口出现。

  @workflow
    1. 启动恢复项目，应用项目顺序/别名/上次激活项，加载真实分支、储藏和提交。
    2. 项目点击切换；拖拽排序；右键重命名/移除；真实路径不改。
    3. 提交列表按日期分组；搜索/分页/错误态；点击打开真实 Review。
    4. 头部切换分支浏览范围、fetch/pull/push、储藏列表、设置页；窗口控制走 Tauri。
    5. 分支完整操作、冲突、储藏写操作在后续任务接入本壳。

  @changeLog
    - 2026-11-04: Created. 新应用壳与真实项目/提交/Review/设置/远程读取。
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
import { useGitActions, type GitActionResult } from "./composables/useGitActions";
import type { BranchInfo, CommitInfo, FileDiff, RemoteResult, StashInfo } from "@/types/git";
import { useProjectLayout } from "./composables/useProjectLayout";
import { authorMark, authorTone } from "./utils/author";
import { dateKey, formatTime, groupLabel } from "./utils/date";
import ReviewDialog from "./components/ReviewDialog.vue";
import SettingsView from "./components/SettingsView.vue";
import ConflictDialog from "./components/ConflictDialog.vue";
import StashViewDialog from "./components/StashViewDialog.vue";

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const settingsStore = useSettingsStore();
const themeStore = useThemeStore();
const layout = useProjectLayout();
const actions = useGitActions();
const actionBusy = actions.busy;
const gitOperation = actions.operation;
const gitConflictedFiles = actions.conflictedFiles;

const appWindow = getCurrentWindow();
const isMaximized = ref(false);
let unlistenResized: (() => void) | null = null;

const booting = ref(true);
const view = ref<"commits" | "settings">("commits");
const railCollapsed = ref(false);
let railUserSet = false;
const projectQuery = ref("");
const addingProjects = ref(false);
const addingMode = ref<"single" | "batch" | null>(null);
const localSearch = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const dragPath = ref<string | null>(null);
const dragOverPath = ref<string | null>(null);

const branchOpen = ref(false);
const syncOpen = ref(false);
const stashOpen = ref(false);
const syncBusy = ref(false);

const projectMenu = ref<{ x: number; y: number; repo: RepoTab } | null>(null);
const commitMenu = ref<{ x: number; y: number; commit: CommitInfo; index: number } | null>(null);
const branchMenu = ref<{ x: number; y: number; branch: BranchInfo; remote: boolean } | null>(null);
const projectDialog = ref<{ mode: "rename" | "remove"; repo: RepoTab; value: string } | null>(null);
const projectDialogInput = ref<HTMLInputElement | null>(null);

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
const sortedProjects = computed(() => layout.sortProjects(repoStore.repos));
const visibleProjects = computed(() => {
  const query = projectQuery.value.trim().toLowerCase();
  if (!query) return sortedProjects.value;
  return sortedProjects.value.filter((repo) => {
    const haystack = `${layout.displayName(repo)} ${repo.name} ${repo.path}`.toLowerCase();
    return haystack.includes(query);
  });
});

const currentBranch = computed<BranchInfo | null>(
  () => activeRepo.value?.branches.find((branch) => branch.is_current) ?? null,
);
const localBranches = computed(() => (activeRepo.value?.branches ?? []).filter((branch) => !branch.is_remote));
const remoteBranches = computed(() => (activeRepo.value?.branches ?? []).filter((branch) => branch.is_remote));
const branchLabel = computed(() => {
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
const statusText = computed(() => {
  const branch = currentBranch.value;
  const status = activeRepo.value?.status;
  const bits: string[] = [];
  if (branch?.ahead) bits.push(`${branch.ahead} 未推送`);
  if (branch?.behind) bits.push(`${branch.behind} 待拉取`);
  if (!bits.length) bits.push("已同步");
  if (status) {
    const changed = status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length;
    bits.push(changed ? `${changed} 个改动` : "工作区干净");
  }
  return bits.join(" · ");
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
  const branch = repo.branches.find((item) => item.is_current);
  const bits = [branch?.name ?? "未检出"];
  if (branch?.ahead) bits.push(`${branch.ahead} 未推送`);
  if (branch?.behind) bits.push(`${branch.behind} 待拉取`);
  if (!branch?.ahead && !branch?.behind && branch) bits.push("已同步");
  return bits.join(" · ");
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
  syncOpen.value = false;
  stashOpen.value = false;
  projectMenu.value = null;
  commitMenu.value = null;
  branchMenu.value = null;
}

/**
 * 启动恢复项目与提交。
 * @returns {Promise<void>}
 */
async function boot(): Promise<void> {
  booting.value = true;
  try {
    await repoStore.restoreRepos();
    const activePath = layout.hydrate(repoStore.repos, repoStore.activeRepo?.path ?? null);
    const target = repoStore.repos.find((repo) => repo.path === activePath);
    if (target && target.id !== repoStore.activeId) {
      await repoStore.setActive(target.id);
    }
    await commitStore.switchRepo();
    layout.setActivePath(repoStore.activeRepo?.path ?? null);
    await actions.refreshOperation();
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
  if (repo.id === repoStore.activeId) {
    view.value = "commits";
    return;
  }
  closeFloatingPanels();
  await repoStore.setActive(repo.id);
  view.value = "commits";
}

/**
 * 添加项目：系统目录选择 -> Git 校验 -> 写入项目布局。
 * @returns {Promise<void>}
 */
async function addProject(multiple: boolean): Promise<void> {
  if (addingProjects.value) return;
  addingMode.value = multiple ? "batch" : "single";
  addingProjects.value = true;
  try {
    const selected = await open({
      directory: true,
      multiple,
      defaultPath: settingsStore.defaultOpenDir || undefined,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (!paths.length) return;

    const previousActive = repoStore.activeId;
    const added: string[] = [];
    let failed = 0;

    for (const path of paths) {
      if (repoStore.repos.some((repo) => repo.path === path)) continue;
      try {
        await repoStore.openRepo(path);
        added.push(path);
      } catch {
        failed += 1;
      }
    }

    if (added.length) {
      layout.saveOrder([...new Set([...layout.order.value, ...added])]);
      const targetId = previousActive && repoStore.repos.some((repo) => repo.id === previousActive)
        ? previousActive
        : repoStore.repos.find((repo) => repo.path === added[0])?.id;
      if (targetId) await repoStore.setActive(targetId);
      layout.setActivePath(repoStore.activeRepo?.path ?? null);
      view.value = "commits";
      closeFloatingPanels();
    }

    if (added.length) {
      showToast(multiple
        ? `已添加 ${added.length} 个项目${failed ? `，${failed} 个失败` : ""}`
        : "项目已打开");
    } else if (failed) {
      showToast("没有添加成功，请检查所选目录是否为 Git 仓库");
    } else {
      showToast("所选项目已在列表中");
    }
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
  syncOpen.value = false;
  stashOpen.value = false;
  commitMenu.value = null;
  branchMenu.value = null;
  projectMenu.value = { x: event.clientX, y: event.clientY, repo };
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
 * 项目拖拽排序。
 * @param fromPath - 拖拽项目路径
 * @param toPath - 目标项目路径
 * @returns {void}
 */
function moveProject(fromPath: string, toPath: string): void {
  if (!fromPath || !toPath || fromPath === toPath) return;
  const list = sortedProjects.value.map((repo) => repo.path);
  const fromIndex = list.indexOf(fromPath);
  const toIndex = list.indexOf(toPath);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  layout.saveOrder(list);
}

/**
 * 打开分支 ⋯ 菜单。
 * @param event - 点击事件
 * @param branch - 分支
 * @param remote - 是否远程分支
 * @returns {void}
 */
function openBranchMenu(event: MouseEvent, branch: BranchInfo, remote: boolean): void {
  projectMenu.value = null;
  commitMenu.value = null;
  branchMenu.value = { x: event.clientX, y: event.clientY, branch, remote };
}

/**
 * 打开分支对话框。
 * @param mode - 对话框类型
 * @param branch - 分支
 * @param value - 初始输入/上游
 * @returns {Promise<void>}
 */
async function openBranchDialog(mode: BranchDialogMode, branch: BranchInfo, value = ""): Promise<void> {
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
 * 从同步菜单设置当前分支上游。
 * @returns {Promise<void>}
 */
async function openCurrentUpstream(): Promise<void> {
  const branch = currentBranch.value;
  if (!branch) {
    showToast("当前没有可设置上游的分支");
    return;
  }
  await openBranchDialog("upstream", branch);
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
  syncOpen.value = false;
  stashOpen.value = false;
  projectMenu.value = null;
  branchMenu.value = null;
  commitMenu.value = { x: event.clientX, y: event.clientY, commit, index };
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
 * 分支浏览选择：本地/远程分支浏览历史；所有分支切换范围。
 * @param branch - 分支信息或 all
 * @returns {void}
 */
function selectBranch(branch: BranchInfo | "all" | null): void {
  branchOpen.value = false;
  if (branch === "all") {
    commitStore.setScope("all");
    return;
  }
  if (!branch || branch.is_current) {
    commitStore.browseTo(null);
    return;
  }
  commitStore.browseTo(branch.name);
}

/**
 * 提交搜索防抖；回车立即查询。
 * @returns {void}
 */
function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    commitStore.setSearch(localSearch.value);
  }, 300);
}

/**
 * 提交搜索回车，跳过防抖。
 * @returns {void}
 */
function applySearch(): void {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  commitStore.setSearch(localSearch.value);
}

/**
 * 清除提交搜索。
 * @returns {void}
 */
function clearSearch(): void {
  localSearch.value = "";
  commitStore.setSearch("");
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
 * 远程快捷操作：fetch/pull/push。
 * @param action - 操作
 * @returns {Promise<void>}
 */
async function runRemote(action: "fetch" | "pull" | "push"): Promise<void> {
  const repo = activeRepo.value;
  if (!repo || syncBusy.value || actionBusy.value) return;
  syncOpen.value = false;
  syncBusy.value = true;
  try {
    if (action === "fetch") {
      await invoke("git_fetch", { path: repo.path });
      showToast("远程引用已更新");
    } else {
      const result = await invoke<RemoteResult>(action === "pull" ? "git_pull" : "git_push", { path: repo.path });
      showToast(result.message);
    }
    await repoStore.refreshActive();
    await commitStore.loadCommits();
    await actions.refreshOperation();
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  } finally {
    syncBusy.value = false;
  }
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
  if (!target.closest(".sync-wrap")) syncOpen.value = false;
  if (!target.closest(".stash-wrap")) stashOpen.value = false;
}

/**
 * 全局 Esc 与搜索快捷键。
 * @param event - 键盘事件
 * @returns {void}
 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (projectDialog.value || projectMenu.value || commitMenu.value) {
      projectDialog.value = null;
      closeContextMenus();
      return;
    }
    if (branchOpen.value || syncOpen.value || stashOpen.value) {
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
    document.querySelector<HTMLInputElement>(".search-input")?.focus();
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

watch(() => repoStore.activeId, async (id, previous) => {
  if (booting.value || !id || id === previous) return;
  view.value = "commits";
  localSearch.value = "";
  selectedStashes.value = new Set();
  closeFloatingPanels();
  reviewOpen.value = false;
  conflictDialogOpen.value = false;
  await commitStore.switchRepo();
  layout.setActivePath(repoStore.activeRepo?.path ?? null);
  await actions.refreshOperation();
});

watch(stashes, (list) => {
  const valid = new Set([...selectedStashes.value].filter((index) => list.some((stash) => stash.index === index)));
  if (valid.size !== selectedStashes.value.size) selectedStashes.value = valid;
}, { deep: true });

onMounted(async () => {
  await boot();
  await nextTick();
  await startWatcher();
  await refreshMaximized();
  try {
    unlistenResized = await appWindow.onResized(() => { void refreshMaximized(); });
  } catch {
    // 非 Tauri 环境忽略
  }
  syncRail();
  window.addEventListener("resize", syncRail);
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("keydown", onDocumentKeydown);
});

onUnmounted(() => {
  if (unlistenResized) unlistenResized();
  window.removeEventListener("resize", syncRail);
  document.removeEventListener("mousedown", onDocumentMouseDown);
  document.removeEventListener("keydown", onDocumentKeydown);
  if (searchTimer) clearTimeout(searchTimer);
  if (toastTimer) clearTimeout(toastTimer);
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
            <button class="icon-btn batch-add-btn" type="button" :disabled="addingProjects" :aria-label="addingMode === 'batch' ? '正在批量添加项目' : '批量添加项目'" :title="addingMode === 'batch' ? '正在批量添加项目' : '批量添加项目（可多选）'" @click="addProject(true)">
              <svg v-if="addingMode !== 'batch'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H6l1.2 1.4H13a1 1 0 0 1 1 1V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z"/><path d="M8 8v3M6.5 9.5h3"/></svg>
              <svg v-else class="add-spin" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 0 1-8.5 3.5"/><path d="M3 8a5 5 0 0 1 8.5-3.5"/></svg>
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

      <div class="project-list" role="list">
        <div
          v-for="repo in visibleProjects"
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
          @dragstart="dragPath = repo.path"
          @dragover.prevent="dragOverPath = repo.path"
          @dragleave="dragOverPath = dragOverPath === repo.path ? null : dragOverPath"
          @drop.prevent="moveProject(dragPath, repo.path); dragPath = null; dragOverPath = null"
          @dragend="dragPath = null; dragOverPath = null"
        >
          <span class="project-dot" aria-hidden="true"></span>
          <span class="project-content">
            <span class="project-name">{{ layout.displayName(repo) }}</span>
            <span class="project-branch">{{ projectMeta(repo) }}</span>
          </span>
          <span class="project-initials" aria-hidden="true">{{ projectInitials(repo) }}</span>
        </div>

        <div v-if="!visibleProjects.length" class="project-empty">
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
      <header class="main-header">
        <div class="header-top" data-tauri-drag-region>
          <h1 class="project-title" data-tauri-drag-region>{{ displayTitle }}</h1>
          <div class="header-drag" data-tauri-drag-region aria-hidden="true"></div>
          <div class="window-controls" aria-label="窗口控制">
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
          <div class="branch-wrap">
            <button class="branch-btn" type="button" aria-haspopup="menu" :aria-expanded="branchOpen" title="切换分支" @click.stop="branchOpen = !branchOpen; syncOpen = false; stashOpen = false">
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
                  :title="branch.upstream ? `上游 ${branch.upstream}` : '未设置上游'"
                  @click="selectBranch(branch)"
                >
                  <span>{{ branch.name }}</span>
                  <span v-if="branch.is_current" class="check" aria-hidden="true">✓</span>
                </button>
                <div class="popover-actions">
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
                  <span>{{ branch.name }}</span>
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

          <span class="status">{{ statusText }}</span>

          <div class="tool-wrap">
            <div class="sync-wrap">
              <button class="icon-control" type="button" :aria-expanded="syncOpen" :disabled="syncBusy || !!actionBusy" title="远程操作" @click.stop="syncOpen = !syncOpen; branchOpen = false; stashOpen = false">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 0 1-8.5 3.5"/><path d="M3 8a5 5 0 0 1 8.5-3.5"/><path d="M11.5 2v3h-3"/><path d="M4.5 14v-3h3"/></svg>
              </button>
              <div v-if="syncOpen" class="popover sync-popover" role="menu">
                <button class="menu-item" type="button" :disabled="syncBusy" @click="runRemote('fetch')"><span>获取远程</span><span class="hint">fetch</span></button>
                <button class="menu-item" type="button" :disabled="syncBusy" @click="runRemote('pull')"><span>拉取当前分支</span><span class="hint">pull</span></button>
                <button class="menu-item" type="button" :disabled="syncBusy" @click="runRemote('push')"><span>推送当前分支</span><span class="hint">push</span></button>
                <div class="menu-sep"></div>
                <button class="menu-item" type="button" @click="syncOpen = false; openCurrentUpstream()"><span>设置当前分支上游…</span><span class="hint">{{ currentBranch?.upstream || "未设置" }}</span></button>
              </div>
            </div>

            <div class="stash-wrap">
              <button class="icon-control stash-btn" type="button" :aria-expanded="stashOpen" title="储藏" @click.stop="stashOpen = !stashOpen; branchOpen = false; syncOpen = false">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5h11v8h-11z"/><path d="M2 2.5h12v2.5H2z"/><path d="M6 8.5h4"/></svg>
                <span class="stash-count">{{ stashCount }}</span>
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

          <div class="search-wrap">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input
              v-model="localSearch"
              class="search-input"
              type="search"
              placeholder="搜索提交、作者或哈希"
              aria-label="搜索提交"
              autocomplete="off"
              spellcheck="false"
              @input="onSearchInput"
              @keydown.enter.prevent="applySearch"
              @keydown.esc.prevent="clearSearch"
            >
            <button v-if="localSearch" class="search-clear" type="button" aria-label="清除搜索" @click="clearSearch">×</button>
          </div>
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

      <div v-if="view === 'commits'" class="commit-scroll" @scroll="onCommitScroll">
        <div v-if="!activeRepo && !booting" class="empty">
          <h2>还没有打开项目</h2>
          <p>从左侧打开一个 Git 仓库开始。</p>
        </div>
        <div v-else-if="booting || (commitStore.loading && !commitStore.commits.length)" class="empty">
          <h2>正在加载提交…</h2>
          <p>正在读取当前仓库的 Git 历史。</p>
        </div>
        <div v-else-if="commitStore.error && !commitStore.commits.length" class="empty">
          <h2>提交读取失败</h2>
          <p>{{ commitStore.error }}</p>
          <button class="empty-action" type="button" @click="commitStore.loadCommits()">重试</button>
        </div>
        <div v-else-if="!commitStore.commits.length" class="empty">
          <h2>{{ commitStore.search ? "没有匹配的提交" : "这个分支还没有提交" }}</h2>
          <p>{{ commitStore.search ? "换一个关键词，或清除搜索。" : "换一个项目，或切换到其他分支。" }}</p>
          <button v-if="commitStore.search" class="empty-action" type="button" @click="clearSearch">清除搜索</button>
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
              <span class="commit-time">{{ commitTime(entry.commit) }}</span>
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
    </main>

    <div v-if="projectMenu" class="context-menu" :style="{ left: `${projectMenu.x}px`, top: `${projectMenu.y}px` }" role="menu">
      <div class="menu-header"><div class="menu-hash">{{ layout.displayName(projectMenu.repo) }}</div></div>
      <button class="menu-item" type="button" @click="openRenameDialog(projectMenu.repo)"><span>重命名显示名…</span><span class="hint">只改显示</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" type="button" @click="openRemoveDialog(projectMenu.repo)"><span>从列表移除</span></button>
    </div>

    <div v-if="commitMenu" class="context-menu" :style="{ left: `${commitMenu.x}px`, top: `${commitMenu.y}px` }" role="menu">
      <div class="menu-header"><div class="menu-hash">{{ commitMenu.commit.short_hash }}</div><div class="menu-subject">{{ commitMenu.commit.subject }}</div></div>
      <button class="menu-item" type="button" @click="openReview(commitMenu.index); commitMenu = null"><span>查看改动</span><span class="hint">Enter</span></button>
      <button class="menu-item" type="button" @click="cherryPickCommit(commitMenu.commit)"><span>Cherry-pick 到当前分支</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.short_hash, '已复制短哈希'); commitMenu = null"><span>复制短哈希</span></button>
      <button class="menu-item" type="button" @click="copyText(commitMenu.commit.hash, '已复制完整哈希'); commitMenu = null"><span>复制完整哈希</span></button>
    </div>

    <div v-if="branchMenu" class="context-menu" :style="{ left: `${branchMenu.x}px`, top: `${branchMenu.y}px` }" role="menu">
      <div class="menu-header">
        <div class="menu-hash">{{ branchMenu.remote ? "远程" : "本地" }} · {{ branchMenu.branch.name }}</div>
        <div v-if="branchMenu.branch.upstream" class="menu-subject">上游 {{ branchMenu.branch.upstream }}</div>
      </div>
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
            <select v-model="branchDialog.value">
              <option v-for="branch in remoteBranches" :key="branch.full_name" :value="branch.name">{{ branch.name }}</option>
            </select>
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

    <div class="toast" :class="{ show: toastVisible }" role="status" aria-live="polite">{{ toastMessage }}</div>
  </div>
</template>
