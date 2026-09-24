<!--
  @component FileHistoryView
  @description
    按任意 Git 仓库内的绝对文件或目录路径浏览提交历史，可从提交文件列表直接带入路径。

  @usage
    <FileHistoryView :active="historyView === 'file'" @select="selectCommit" />

  @dataFormat
    读取目标 Git 仓库的 CommitInfo 列表、分支范围和共享搜索词；输出携带仓库路径的提交选择与右键事件。

  @workflow
    1. 用户输入绝对路径，或从文件列表快捷进入。
    2. 后端定位路径所属 Git 仓库，视图将目标绝对路径转换为仓库相对 pathspec 并分页读取 git log。
    3. 选择提交后复用现有右侧文件列表和 diff。

  @changeLog
    - 2026-09-24: Created. 新增文件和目录历史视图。
    - 2026-09-24: Updated. 支持任意 Git 仓库内的绝对路径并以目标仓库读取提交详情。
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useCommitStore } from "@/stores/commit";
import { useRepoStore } from "@/stores/repo";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo, LogQuery } from "@/types/git";
import HistoryCommitRows from "./HistoryCommitRows.vue";

const props = defineProps<{
  /** 是否正在显示文件历史视图 */
  active: boolean;
}>();

const emit = defineEmits<{
  /** 选择提交并更新右侧详情 */
  (e: "select", hash: string, repositoryPath: string): void;
  /** 提交行的右键事件 */
  (e: "contextmenu", event: MouseEvent, commit: CommitInfo, repositoryPath: string): void;
}>();

const repoStore = useRepoStore();
const commitStore = useCommitStore();
const selectionStore = useSelectionStore();
const pathInput = ref(toDisplayAbsolutePath(commitStore.fileHistoryPath));
const pathQuery = ref("");
const targetRepositoryPath = ref("");
const resolvingPath = ref(false);
const commits = ref<CommitInfo[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const queryError = ref("");
let requestSequence = 0;
let pathResolutionSequence = 0;
let loadedQueryKey = "";

// 路径或全局提交条件变化时只在视图可见时查询；切走再回来不会清除列表滚动位置。
const queryKey = computed(() => JSON.stringify([
  repoStore.activeRepo?.id,
  repoStore.activeRepo?.path,
  targetRepositoryPath.value,
  pathQuery.value,
  commitStore.scope,
  commitStore.browseBranch,
  commitStore.search,
]));
// 标记路径所属仓库是否就是应用当前打开的仓库。
const isActiveRepository = computed(() =>
  sameRepositoryRoot(targetRepositoryPath.value, repoStore.activeRepo?.path)
);
// 本仓库路径复用应用路径，外部仓库则保留 Git 返回的根目录。
const commitRepositoryContext = computed(() =>
  isActiveRepository.value ? repoStore.activeRepo?.path ?? targetRepositoryPath.value : targetRepositoryPath.value
);
// 仅在右侧详情当前指向同一个仓库时高亮文件历史中的提交。
const selectedHash = computed(() =>
  sameRepositoryRoot(targetRepositoryPath.value, selectionStore.commitRepositoryPath ?? "")
    ? selectionStore.commitHash
    : null
);

/**
 * 规范化 Windows 或 POSIX 绝对路径，并拒绝试图越过文件系统根目录的路径。
 * @param {string} value - 用户输入的绝对文件或目录路径
 * @returns {string | null} 使用正斜杠的规范化绝对路径；无效或相对路径返回 null
 */
function normalizeAbsolutePath(value: string): string | null {
  const path = value.trim().replace(/\\/g, "/");
  const drivePrefix = /^[a-z]:\//i.test(path) ? path.slice(0, 3) : "";
  const isUncPath = path.startsWith("//");
  const isPosixPath = !isUncPath && path.startsWith("/");
  if (!drivePrefix && !isUncPath && !isPosixPath) return null;

  const prefix = drivePrefix || (isUncPath ? "//" : "/");
  const pathSegments = path.slice(prefix.length).split("/");
  const normalizedSegments: string[] = [];
  for (const segment of pathSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (normalizedSegments.length === 0) return null;
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment);
  }

  if (isUncPath && normalizedSegments.length < 2) return null;
  return `${prefix}${normalizedSegments.join("/")}`;
}

/**
 * 校验绝对路径位于目标仓库内，并转换为 Git 接受的相对路径。
 * @param {string} absolutePath - 规范化后的绝对路径
 * @param {string} repositoryPath - 当前仓库的绝对根路径
 * @returns {string | null} 仓库相对路径；路径在仓库外或路径格式不一致时返回 null
 */
function toRepositoryRelativePath(absolutePath: string, repositoryPath: string): string | null {
  // 两端使用同一套绝对路径规范化，避免分隔符和点路径影响仓库边界判断。
  const normalizedPath = normalizeAbsolutePath(absolutePath);
  const normalizedRoot = normalizeAbsolutePath(repositoryPath);
  if (!normalizedPath || !normalizedRoot) return null;

  // Windows 盘符和 UNC 路径比较时忽略大小写；POSIX 路径仍区分大小写。
  const rootIsWindows = /^[a-z]:\//i.test(normalizedRoot) || normalizedRoot.startsWith("//");
  const pathIsWindows = /^[a-z]:\//i.test(normalizedPath) || normalizedPath.startsWith("//");
  if (rootIsWindows !== pathIsWindows) return null;

  const comparisonRoot = normalizedRoot.replace(/\/$/, "") || "/";
  const comparisonPath = normalizedPath.replace(/\/$/, "") || "/";
  const foldedRoot = rootIsWindows ? comparisonRoot.toLowerCase() : comparisonRoot;
  const foldedPath = rootIsWindows ? comparisonPath.toLowerCase() : comparisonPath;
  if (foldedPath === foldedRoot) return ".";

  const rootPrefix = comparisonRoot.endsWith("/") ? comparisonRoot : `${comparisonRoot}/`;
  const foldedPrefix = rootIsWindows ? rootPrefix.toLowerCase() : rootPrefix;
  if (!foldedPath.startsWith(foldedPrefix)) return null;
  return comparisonPath.slice(rootPrefix.length);
}

/**
 * 比较两个 Git 仓库根路径，按操作系统路径规则处理大小写。
 * @param {string} firstPath - 第一个仓库根路径
 * @param {string | undefined} secondPath - 第二个仓库根路径
 * @returns {boolean} 两个路径是否指向同一仓库
 */
function sameRepositoryRoot(firstPath: string, secondPath: string | undefined): boolean {
  if (!secondPath) return false;
  const normalizedFirst = normalizeAbsolutePath(firstPath);
  const normalizedSecond = normalizeAbsolutePath(secondPath);
  if (!normalizedFirst || !normalizedSecond) return false;

  const firstIsWindows = /^[a-z]:\//i.test(normalizedFirst) || normalizedFirst.startsWith("//");
  const secondIsWindows = /^[a-z]:\//i.test(normalizedSecond) || normalizedSecond.startsWith("//");
  if (firstIsWindows !== secondIsWindows) return false;

  return firstIsWindows
    ? normalizedFirst.toLowerCase() === normalizedSecond.toLowerCase()
    : normalizedFirst === normalizedSecond;
}

/**
 * 将文件列表提供的仓库相对路径显示为绝对路径，并直接保留已提供的绝对路径。
 * @param {string} relativePath - 共享状态中的仓库相对路径
 * @returns {string} 用于输入框展示的绝对路径
 */
function toDisplayAbsolutePath(relativePath: string): string {
  // 外部仓库快捷入口已提供绝对路径，直接规范化显示，不再拼接当前仓库根目录。
  const absolutePath = normalizeAbsolutePath(relativePath);
  if (absolutePath) return absolutePath;

  const repositoryPath = repoStore.activeRepo?.path;
  if (!repositoryPath) return relativePath;
  if (!relativePath || relativePath === ".") return repositoryPath;

  const separator = repositoryPath.includes("\\") ? "\\" : "/";
  const trimmedRoot = repositoryPath.replace(/[\\/]+$/, "");
  const root = trimmedRoot || (separator === "/" ? "/" : `${repositoryPath.slice(0, 2)}\\`);
  const suffix = relativePath.replace(/[\\/]/g, separator);
  return `${root}${/[\\/]$/.test(root) ? "" : separator}${suffix}`;
}

/**
 * 按当前路径、分支和文本条件读取文件历史。
 * @param {boolean} [reset] - 是否从第一页重新读取
 * @returns {Promise<void>} 完成当前页或下一页查询
 */
async function loadFileHistory(reset = false): Promise<void> {
  if (resolvingPath.value) return;

  const path = targetRepositoryPath.value;
  const selectedAbsolutePath = pathQuery.value;
  const selectedPath = path ? toRepositoryRelativePath(selectedAbsolutePath, path) : null;
  if (!path || !selectedPath) {
    commits.value = [];
    hasMore.value = false;
    queryError.value = pathQuery.value
      ? "无法确定该绝对路径对应的 Git 仓库"
      : "请输入 Git 仓库中的绝对文件或目录路径";
    loading.value = false;
    loadingMore.value = false;
    return;
  }

  if (reset) {
    requestSequence++;
    commits.value = [];
    hasMore.value = true;
    queryError.value = "";
  }

  const sequence = requestSequence;
  const repositoryId = repoStore.activeRepo?.id;
  const selectedRepositoryPath = path;
  const query: LogQuery = {
    skip: reset ? 0 : commits.value.length,
    limit: 100,
    branch: isActiveRepository.value ? commitStore.queryBranch : null,
    search: commitStore.search.trim() || null,
    all_branches: isActiveRepository.value ? commitStore.queryAllBranches : commitStore.scope === "all",
    path: selectedPath,
  };

  if (reset) loading.value = true;
  else loadingMore.value = true;

  try {
    const result = await invoke<CommitInfo[]>("git_get_log", { path, query });
    if (
      sequence !== requestSequence
      || repositoryId !== repoStore.activeRepo?.id
      || selectedRepositoryPath !== targetRepositoryPath.value
      || selectedAbsolutePath !== pathQuery.value
    ) return;
    if (reset) commits.value = result;
    else commits.value.push(...result);
    hasMore.value = !query.search && result.length === query.limit;
  } catch (error) {
    if (
      sequence !== requestSequence
      || repositoryId !== repoStore.activeRepo?.id
      || selectedRepositoryPath !== targetRepositoryPath.value
      || selectedAbsolutePath !== pathQuery.value
    ) return;
    queryError.value = String(error);
    if (reset) commits.value = [];
    hasMore.value = false;
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

/**
 * 提交路径并触发新的文件历史查询。
 * @returns {Promise<void>} 定位路径所属仓库并刷新当前历史
 */
async function submitPath(): Promise<void> {
  const absolutePath = normalizeAbsolutePath(pathInput.value);
  if (!absolutePath) {
    pathResolutionSequence++;
    requestSequence++;
    resolvingPath.value = false;
    targetRepositoryPath.value = "";
    pathQuery.value = "";
    commits.value = [];
    loading.value = false;
    loadingMore.value = false;
    hasMore.value = false;
    loadedQueryKey = queryKey.value;
    queryError.value = "请输入有效的绝对文件或目录路径";
    return;
  }
  pathInput.value = absolutePath;
  await resolveFileHistoryPath(absolutePath, true);
}

/**
 * 定位绝对路径所属的 Git 仓库，并在成功后加载该路径历史。
 * @param {string} absolutePath - 规范化后的目标绝对路径
 * @param {boolean} updateSharedPath - 是否将成功路径写入共享快捷入口状态
 * @returns {Promise<void>} 完成仓库解析并更新查询条件
 */
async function resolveFileHistoryPath(absolutePath: string, updateSharedPath: boolean): Promise<void> {
  const sequence = ++pathResolutionSequence;
  const activeRepositoryId = repoStore.activeRepo?.id;
  requestSequence++;
  resolvingPath.value = true;
  targetRepositoryPath.value = "";
  pathQuery.value = "";
  commits.value = [];
  loading.value = false;
  loadingMore.value = false;
  hasMore.value = false;
  queryError.value = "";

  try {
    const repositoryPath = await invoke<string>("git_find_repository_root", { path: absolutePath });
    if (sequence !== pathResolutionSequence || activeRepositoryId !== repoStore.activeRepo?.id) return;

    resolvingPath.value = false;
    targetRepositoryPath.value = repositoryPath;
    pathQuery.value = absolutePath;
    if (updateSharedPath && commitStore.fileHistoryPath !== absolutePath) {
      commitStore.setFileHistoryPath(absolutePath);
    }
  } catch (error) {
    if (sequence !== pathResolutionSequence || activeRepositoryId !== repoStore.activeRepo?.id) return;
    resolvingPath.value = false;
    queryError.value = `该路径未找到可访问的 Git 仓库：${String(error)}`;
  }
}

/**
 * 将提交行右键事件转发给外层共享菜单。
 * @param {MouseEvent} event - 行上的右键事件
 * @param {CommitInfo} commit - 当前提交
 * @returns {void} 转发上下文事件
 */
function relayContextMenu(event: MouseEvent, commit: CommitInfo): void {
  emit("contextmenu", event, commit, commitRepositoryContext.value);
}

watch(
  () => commitStore.fileHistoryPath,
  (path) => {
    const absolutePath = toDisplayAbsolutePath(path);
    pathInput.value = absolutePath;
    if (!absolutePath) {
      pathResolutionSequence++;
      requestSequence++;
      resolvingPath.value = false;
      targetRepositoryPath.value = "";
      pathQuery.value = "";
      commits.value = [];
      loading.value = false;
      loadingMore.value = false;
      hasMore.value = false;
      queryError.value = "";
      return;
    }
    if (absolutePath !== pathQuery.value || !targetRepositoryPath.value) {
      void resolveFileHistoryPath(absolutePath, false);
    }
  },
  { immediate: true }
);

watch(
  [() => props.active, queryKey],
  ([active, key]) => {
    if (!active || key === loadedQueryKey) return;
    loadedQueryKey = key;
    void loadFileHistory(true);
  },
  { immediate: true }
);

watch(
  () => repoStore.activeRepo?.id,
  () => {
    pathResolutionSequence++;
    requestSequence++;
    resolvingPath.value = false;
    pathInput.value = "";
    pathQuery.value = "";
    targetRepositoryPath.value = "";
    commits.value = [];
    loading.value = false;
    loadingMore.value = false;
    hasMore.value = false;
    loadedQueryKey = "";
  }
);
</script>

<template>
  <div class="file-history-view">
    <form class="path-toolbar" @submit.prevent="submitPath">
      <label for="history-path">绝对路径</label>
      <input
        id="history-path"
        v-model="pathInput"
        type="text"
        placeholder="输入任意 Git 仓库中的绝对路径"
      />
      <button class="path-submit" type="submit" :disabled="resolvingPath">
        {{ resolvingPath ? "查找仓库…" : "查看历史" }}
      </button>
    </form>
    <div v-if="targetRepositoryPath && !isActiveRepository" class="repository-hint">
      外部仓库 · {{ commitStore.scope === "all" ? "查询所有分支" : "当前分支使用目标仓库 HEAD" }} · 提交只读
    </div>
    <div v-if="queryError" class="history-error">
      <span>{{ queryError }}</span>
      <button v-if="pathQuery" class="path-submit" @click="loadedQueryKey = ''; loadFileHistory(true)">重试</button>
    </div>
    <HistoryCommitRows
      :key="queryKey"
      :commits="commits"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :selected-hash="selectedHash"
      :empty-message="targetRepositoryPath ? '没有找到该路径的提交' : '输入 Git 仓库中的绝对路径以查看文件历史'"
      @select="emit('select', $event, commitRepositoryContext)"
      @load-more="loadFileHistory(false)"
      @contextmenu="relayContextMenu"
    />
  </div>
</template>

<style scoped>
.file-history-view {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.path-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-default);
}

.path-toolbar label {
  flex-shrink: 0;
  color: var(--fg-secondary);
  font-size: 12px;
}

.path-toolbar input {
  min-width: 0;
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-primary);
  background: var(--bg-panel);
  font-size: 13px;
  outline: none;
}

.path-toolbar input:focus {
  border-color: var(--accent);
}

.history-error {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  color: var(--danger);
  font-size: 12px;
}

.repository-hint {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-tertiary);
  font-size: 12px;
}

.path-submit {
  height: 28px;
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--fg-secondary);
  background: var(--bg-input);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
}

.path-submit:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--fg-primary);
  background: var(--bg-hover);
}

.path-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
