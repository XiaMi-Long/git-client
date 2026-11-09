/**
 * @description
 *   管理用户手动执行的顶栏远程操作及其反馈，按项目保存检查结果。
 * @dataFormat
 *   ahead/behind 来自 repoStore 中当前检出分支；检查时间和错误按仓库路径保存，仅在本次运行中有效。
 * @workflow
 *   1. 捕获操作所属的仓库和上游，复用 Git 操作互斥器执行 fetch/pull/push。
 *   2. 原子读取分支和工作区状态，只更新原仓库；仍激活原项目时刷新提交与冲突视图。
 *   3. 成功后记录检查时间，失败保留既有数据并在顶栏反馈。
 * @changeLog
 *   - 2026-11-06: Created. 实现常驻同步操作、过程反馈和按项目节流的自动获取。
 *   - 2026-11-07: Updated. 远程同步读取到分支后同步更新侧栏摘要的就绪状态。
 *   - 2026-11-07: Updated. 移除自动获取，改由用户手动触发远程操作。
 */
import { computed, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRepoStore } from "@/stores/repo";
import { useCommitStore } from "@/stores/commit";
import type { BranchInfo, RemoteResult, WorkingAreaStatus } from "@/types/git";
import { useGitActions, type GitActionResult } from "./useGitActions";

/** 顶栏提供的手动远程操作。 */
export type RemoteSyncAction = "fetch" | "pull" | "push";

/** 单个仓库的最近检查结果，上游改变后不沿用旧上游的检查结论。 */
interface RemoteCheck {
  /** 最近一次操作检查的上游，不能把旧上游的成功结论用于新上游。 */
  upstream: string | null;
  /** 仅远程命令及分支状态读取成功后更新。 */
  checkedAt: number | null;
  /** 保留实际失败原因，直到下一次针对该上游的操作开始。 */
  error: string | null;
}

/** 固定一次操作的真实目标，切换项目不会改变在途命令。 */
interface RemoteTask {
  /** 本次打开项目的身份，关闭后重开同一路径也不复用旧身份。 */
  repoId: string;
  /** 原生命令执行路径，开始后不再跟随激活项目变化。 */
  repoPath: string;
  repoName: string;
  /** 固定实际检出分支名称，用于向用户说明操作目标。 */
  branchName: string;
  action: RemoteSyncAction;
}

const ACTION_LABELS: Record<RemoteSyncAction, string> = {
  fetch: "获取远程",
  pull: "拉取",
  push: "推送",
};

/**
 * 管理手动远程操作，复用现有 Git 互斥器，并按仓库隔离检查结果。
 * @param onSuccess - 操作成功时调用，过程和错误由返回的响应式状态展示
 * @returns 当前操作、过程文案、错误详情、检查提示与手动执行方法
 * @reasoning 远程操作与其他 Git 操作共用互斥器，请求返回时用户可能已切换项目，因此目标必须在开始时固定。
 * @changeLog
 * - 2026-11-06: Created. 拆分远程同步的状态、生命周期及异步处理。
 */
export function useRemoteSync(onSuccess: (message: string) => void) {
  const repoStore = useRepoStore();
  const commitStore = useCommitStore();
  const gitActions = useGitActions();
  const checks = ref<Record<string, RemoteCheck>>({});
  const task = ref<RemoteTask | null>(null);
  let disposed = false;

  const currentBranch = computed(() => repoStore.activeRepo?.branches.find((branch) => branch.is_current));
  // 检查时间只适用于当时的上游，切换上游后重新检查，不能误报已同步。
  const currentCheck = computed(() => {
    const repo = repoStore.activeRepo;
    const check = repo ? checks.value[repo.path] : null;
    return check?.upstream === (currentBranch.value?.upstream ?? null) ? check : null;
  });
  const busy = computed(() => task.value !== null);
  const currentAction = computed(() => task.value?.repoId === repoStore.activeId ? task.value?.action : null);
  const error = computed(() => currentCheck.value?.error ?? null);
  const feedback = computed(() => {
    const runningTask = task.value;
    if (runningTask) {
      const targetLabel = runningTask.repoId === repoStore.activeId ? "" : `${runningTask.repoName} · `;
      return `${targetLabel}正在${ACTION_LABELS[runningTask.action]}…`;
    }
    if (gitActions.busy.value) {
      return `正在${gitActions.busy.value}…`;
    }
    if (error.value) {
      return error.value.trim().split(/\r?\n/)[0] || "远程操作失败";
    }
    if (!repoStore.activeRepo) {
      return "请先添加项目";
    }
    if (!currentBranch.value) {
      return "未检出分支";
    }
    if (!currentBranch.value.upstream) {
      return "未设置上游";
    }
    if (!currentCheck.value?.checkedAt) {
      return "尚未检查远程";
    }
    return currentBranch.value.ahead || currentBranch.value.behind ? "远程已检查" : "已同步";
  });
  const feedbackTitle = computed(() => {
    const runningTask = task.value;
    if (runningTask) {
      return `操作项目：${runningTask.repoName}；实际检出分支：${runningTask.branchName}；正在${ACTION_LABELS[runningTask.action]}`;
    }
    if (gitActions.busy.value) {
      return feedback.value;
    }
    if (error.value) {
      return error.value;
    }
    const checkedAt = currentCheck.value?.checkedAt;
    const checkedTime = checkedAt ? new Date(checkedAt).toLocaleTimeString("zh-CN") : "尚未检查";
    return `当前检出分支：${currentBranch.value?.name ?? "无"}；上游：${currentBranch.value?.upstream ?? "未设置"}；最近检查：${checkedTime}`;
  });

  /**
   * 一起读取操作目标的分支和工作区状态，读取失败时不覆盖已有数据。
   * @param target - 操作开始时固定的仓库和分支
   * @returns Promise<void>，两项数据均可用后更新原仓库；项目已关闭时不更新
   * @reasoning 远程检查必须确认新的 ahead/behind 已读回，不能沿用旧数量却把检查时间标为成功。
   * @changeLog
   * - 2026-11-06: Created. 为远程检查增加原子读取和原仓库身份校验。
   */
  async function refreshTarget(target: RemoteTask): Promise<void> {
    const [branches, status] = await Promise.all([
      invoke<BranchInfo[]>("git_list_branches", { path: target.repoPath }),
      invoke<WorkingAreaStatus>("git_get_status", { path: target.repoPath }),
    ]);
    const targetRepo = repoStore.repos.find((repo) => repo.id === target.repoId && repo.path === target.repoPath);
    // 原项目已关闭时，不把旧请求结果写入后来重新打开的同路径项目。
    if (disposed || !targetRepo) {
      return;
    }
    targetRepo.branches = branches;
    targetRepo.branchSummaryReady = true;
    targetRepo.status = status;

    if (repoStore.activeId === target.repoId) {
      await commitStore.loadCommits();
      if (repoStore.activeId === target.repoId) {
        await gitActions.refreshOperation();
      }
    }
  }

  /**
   * 执行用户选择的远程操作，立即登记过程状态，成功后更新时间，失败只保留一处错误反馈。
   * @param action - 远程命令类型，保持现有后端命令和请求参数
   * @returns Promise<void>，操作和相关状态刷新完成后结束
   * @reasoning 与分支、储藏等操作共用互斥器，防止执行远程命令时同时改动分支或提交。
   * @changeLog
   * - 2026-11-06: Created. 统一顶栏手动操作与自动检查的过程和结果。
   * - 2026-11-07: Updated. 执行入口只处理用户触发的命令。
   */
  async function execute(action: RemoteSyncAction): Promise<void> {
    const repo = repoStore.activeRepo;
    const isBlocked = disposed || !repo || busy.value || !!gitActions.busy.value;
    // 不允许在没有项目或已有 Git 操作时重复发送命令。
    if (isBlocked || !repo) {
      return;
    }
    const branch = currentBranch.value;
    // 拉取和推送必须明确上游；获取远程本身不要求当前分支配置上游。
    if (action !== "fetch" && !branch?.upstream) {
      return;
    }

    // 1. 固定目标并立即显示进度，旧检查时间保留至本次成功或失败得到明确结果。
    const target: RemoteTask = {
      repoId: repo.id,
      repoPath: repo.path,
      repoName: repo.name,
      branchName: branch?.name ?? "未检出",
      action,
    };
    const previousCheck = checks.value[repo.path];
    const upstream = branch?.upstream ?? null;
    checks.value[repo.path] = {
      upstream,
      checkedAt: previousCheck?.upstream === upstream ? previousCheck.checkedAt : null,
      error: null,
    };
    task.value = target;

    try {
      // 2. 共用 Git 互斥器；只在原仓库数据读取成功后将远程检查判定为成功。
      const result = await gitActions.runExclusive(`${ACTION_LABELS[action]} ${target.repoName}`, async (): Promise<GitActionResult> => {
        let commandResult: GitActionResult;
        if (action === "fetch") {
          await invoke("git_fetch", { path: target.repoPath });
          commandResult = { ok: true, message: "远程引用已更新" };
        } else {
          const reply = await invoke<RemoteResult>(action === "pull" ? "git_pull" : "git_push", { path: target.repoPath });
          commandResult = { ok: reply.success, message: reply.message };
        }
        try {
          await refreshTarget(target);
        } catch (refreshError) {
          // 命令成功但新状态读取失败时不能标为检查成功；命令本身失败时保留其主要错误原因。
          if (commandResult.ok) {
            throw refreshError;
          }
        }
        return commandResult;
      });

      // 3. 检查结果按原项目保存，失败原因在顶栏展示，用户可以重新获取。
      if (!disposed) {
        const check = checks.value[target.repoPath];
        check.error = result.ok ? null : result.message;
        if (result.ok) {
          check.checkedAt = Date.now();
          onSuccess(`${target.repoName} · ${result.message}`);
        }
      }
    } finally {
      task.value = null;
    }
  }

  onUnmounted(() => {
    disposed = true;
  });

  return { busy, currentAction, error, feedback, feedbackTitle, execute };
}
