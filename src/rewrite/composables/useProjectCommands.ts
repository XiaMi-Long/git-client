/**
 * @description
 *   管理单个项目命令弹窗的脚本、包管理器、执行结果和实时日志。
 * @workflow
 *   先订阅任务通知并恢复快照，执行时绑定打开弹窗时的项目，关闭前停止任务。
 * @changeLog
 *   - 2026-11-13: Created. 接入前端项目脚本执行和当前应用会话的日志恢复。
 *   - 2026-11-13: Updated. 在弹窗内打开 dist，并在停止后刷新目录可用状态。
 *   - 2026-11-13: Updated. 运行中的命令支持发送一行输入，任务变化后丢弃旧输入结果。
 *   - 2026-11-13: Updated. 接入 PTY 输入、尺寸同步和 Tauri Channel 增量输出。
 *   - 2026-11-13: Updated. 增加命令输入草稿，并在项目根目录执行手动输入的命令行。
 *   - 2026-11-14: Updated. 终端 Ctrl+C 由后端结算为已停止，关闭失败时在状态栏说明原因。
 */
import { computed, onScopeDispose, ref } from "vue";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ProjectTerminalView, TerminalSize } from "./useProjectTerminal";

/** 可用于执行 package.json scripts 的包管理器。 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** 弹窗打开时固定的项目，切换项目后仍用此身份停止原任务。 */
export interface ProjectCommandTarget {
  path: string;
  name: string;
  branch: string;
}

/** package.json 中的脚本名及原始命令内容。 */
export interface ProjectScript {
  name: string;
  command: string;
}

/** 根目录脚本、自动识别结果和 dist 可用状态。 */
export interface ProjectCommandInfo {
  scripts: ProjectScript[];
  manager: PackageManager | null;
  manifest_status: "ready" | "missing" | "invalid" | "empty";
  detail: string | null;
  dist_exists: boolean;
}

/** 后端保留的最近一次执行快照，revision 用于识别同任务的新输出。 */
interface ProjectTaskSnapshot {
  task_id: number;
  project_path: string;
  script: string;
  command: string;
  status: "running" | "succeeded" | "failed" | "stopped";
  exit_code: number | null;
  output: string;
  revision: number;
}

/** PTY 有序推送的新输出和状态，初始化时按任务及 revision 去重。 */
interface TerminalEvent {
  task_id: number;
  revision: number;
  output: string;
  status: ProjectTaskSnapshot["status"];
  exit_code: number | null;
}

const MANIFEST_ERROR = "package.json 读取失败";
const MANAGER_ERROR = "未找到所选包管理器";
const STOP_ERROR = "停止命令失败，请重试";

/**
 * 管理当前弹窗的命令与日志，不依赖主列表的筛选和 Git 操作状态。
 * @param target - 打开弹窗时固定的真实项目目录和显示信息
 * @param terminal - 显示层提供的输出、快照恢复和尺寸接口
 * @returns 脚本和日志状态、初始化、执行及关闭前停止方法
 */
export function useProjectCommands(target: ProjectCommandTarget, terminal: ProjectTerminalView) {
  const info = ref<ProjectCommandInfo | null>(null);
  const task = ref<ProjectTaskSnapshot | null>(null);
  const managerChoice = ref<PackageManager | "">("");
  // 头部命令行的内容，脚本和手动命令共用；启动失败时仍保留用户尝试的命令。
  const commandDraft = ref("");
  const loading = ref(true);
  const starting = ref(false);
  const stopping = ref(false);
  const closing = ref(false);
  const openingDist = ref(false);
  const operationError = ref("");
  let startPending: Promise<ProjectTaskSnapshot> | null = null;
  // 停止按钮和关闭动作共用同一请求，关闭时可等待正在进行的停止。
  let stopPending: Promise<boolean> | null = null;
  let snapshotSequence = 0;
  // 一个 Channel 只对应一次订阅，旧订阅和旧键盘输入不能影响新的任务。
  let connectionSequence = 0;
  let inputQueue = Promise.resolve();
  let resizeQueue = Promise.resolve();
  let resizeSequence = 0;
  let disposed = false;

  const manager = computed(() => managerChoice.value || info.value?.manager || null);
  const running = computed(() => task.value?.status === "running");
  const inputEnabled = computed(() => running.value && !loading.value && !starting.value && !stopping.value && !closing.value);
  // 没有任务运行时命令输入行可以编辑，回车会作为新的手动命令启动。
  const commandInputEnabled = computed(() => !loading.value && !starting.value && !stopping.value && !closing.value && !running.value);
  const busy = computed(() => loading.value || starting.value || stopping.value || closing.value || running.value);
  const manifestMessage = computed(() => {
    if (info.value?.manifest_status === "missing") {
      return "当前项目根目录没有 package.json";
    }
    if (info.value?.manifest_status === "empty") {
      return "当前项目没有可执行脚本";
    }
    return info.value?.manifest_status === "invalid" ? MANIFEST_ERROR : "";
  });
  const statusText = computed(() => {
    if (operationError.value) {
      return operationError.value;
    }
    if (starting.value || running.value) {
      return "执行中";
    }
    if (task.value?.status === "succeeded") {
      return "执行成功";
    }
    if (task.value?.status === "stopped") {
      return "已停止";
    }
    if (task.value?.status === "failed") {
      return `执行失败（退出码 ${task.value.exit_code ?? "—"}）`;
    }
    return manifestMessage.value || "选择左侧命令执行";
  });

  /**
   * 将原生错误详情写到现有日志区域，不新增弹出提示。
   * @param error - IPC 或文件操作返回的原始错误
   * @returns void
   */
  function reportError(error: unknown): void {
    if (!disposed) {
      terminal.write(`\r\n${String(error).replace(/\r?\n/g, "\r\n")}\r\n`);
    }
  }

  /**
   * 读取项目目录和脚本状态，任务结束后同时更新 dist 是否可用。
   * @returns 本次读取完成
   */
  async function refreshInfo(): Promise<void> {
    const result = await invoke<ProjectCommandInfo>("project_get_command_info", { path: target.path });
    if (!disposed) {
      info.value = result;
    }
  }

  /**
   * 打开弹窗所属项目的 dist，失败详情继续显示在当前日志区域。
   * @returns 系统打开请求完成
   */
  async function openDist(): Promise<void> {
    const canOpenDist = info.value?.dist_exists && !loading.value && !openingDist.value && !closing.value;
    if (!canOpenDist) {
      return;
    }
    openingDist.value = true;
    try {
      await invoke("project_open_dist", { path: target.path });
    } catch (error) {
      if (!disposed) {
        reportError(error);
      }
      // 构建可能已经清理目录，重新读取以更新按钮的禁用状态。
      await refreshInfo().catch(() => {});
    } finally {
      openingDist.value = false;
    }
  }

  /**
   * 按用户输入顺序写入原任务，保留控制字符且不自行补换行。
   * @param text - xterm 生成的按键、粘贴或终端响应
   * @returns void
   */
  function writeInput(text: string): void {
    const runningTask = task.value;
    if (!inputEnabled.value || !runningTask) {
      return;
    }
    inputQueue = inputQueue.then(async () => {
      // 排队期间若已停止或换成另一条命令，丢弃原按键，不能重定向到新任务。
      if (!inputEnabled.value || task.value?.task_id !== runningTask.task_id) {
        return;
      }
      await invoke("project_write_command_input", {
        path: runningTask.project_path, taskId: runningTask.task_id, text,
      });
    }).catch((error: unknown) => {
      if (inputEnabled.value && task.value?.task_id === runningTask.task_id) {
        reportError(error);
      }
    });
  }

  /**
   * 串行同步终端尺寸，连续拖动窗口时只发送队列中最新的一次尺寸。
   * @param size - xterm 适配容器后得到的字符行列
   * @returns void
   */
  function resizeTerminal(size: TerminalSize): void {
    const runningTask = task.value;
    if (!runningTask || runningTask.status !== "running") {
      return;
    }
    const requestSequence = ++resizeSequence;
    resizeQueue = resizeQueue.then(async () => {
      const stillCurrent = !disposed && requestSequence === resizeSequence
        && task.value?.task_id === runningTask.task_id && inputEnabled.value;
      if (!stillCurrent) {
        return;
      }
      await invoke("project_resize_command_terminal", {
        path: runningTask.project_path, taskId: runningTask.task_id, ...size,
      });
    }).catch((error: unknown) => {
      if (inputEnabled.value && task.value?.task_id === runningTask.task_id) {
        reportError(error);
      }
    });
  }

  /**
   * 应用尚未包含在快照中的输出，保持 xterm 原始控制序列和退出状态一致。
   * @param event - 当前 Channel 收到的一块输出或最终状态
   * @returns void
   */
  function receiveTerminalEvent(event: TerminalEvent): void {
    const currentTask = task.value;
    const isNewOutput = !disposed && currentTask?.task_id === event.task_id
      && event.revision > currentTask.revision;
    if (!isNewOutput || !currentTask) {
      return;
    }
    terminal.write(event.output);
    task.value = { ...currentTask, revision: event.revision, status: event.status, exit_code: event.exit_code };
    if (currentTask.status === "running" && event.status !== "running") {
      void refreshInfo().catch(reportError);
    }
  }

  /**
   * 在 IPC 回执前缓存输出，快照交接后按 revision 消除重复和竞态。
   * @returns Channel 以及取得启动或恢复快照后的激活方法
   */
  function createConnection() {
    const requestSequence = ++connectionSequence;
    const pendingEvents: TerminalEvent[] = [];
    let ready = false;
    const channel = new Channel<TerminalEvent>((event) => {
      if (disposed || requestSequence !== connectionSequence) {
        return;
      }
      if (!ready) {
        pendingEvents.push(event);
        return;
      }
      receiveTerminalEvent(event);
    });
    return {
      channel,
      /**
       * 恢复一次完整快照，再接上初始化期间排队的增量输出。
       * @param snapshot - 同一把后端状态锁下取得的任务记录
       * @returns void
       */
      activate(snapshot: ProjectTaskSnapshot | null): void {
        if (disposed || requestSequence !== connectionSequence) {
          return;
        }
        task.value = snapshot;
        if (snapshot) {
          commandDraft.value = snapshot.command;
        }
        terminal.reset(snapshot?.output ?? "");
        ready = true;
        for (const event of pendingEvents) {
          receiveTerminalEvent(event);
        }
        pendingEvents.length = 0;
      },
    };
  }

  /**
   * 恢复任务快照，忽略关闭弹窗及较早请求返回的结果。
   * @returns 本次快照读取完成
   */
  async function refreshTask(): Promise<void> {
    const requestSequence = ++snapshotSequence;
    const snapshot = await invoke<ProjectTaskSnapshot | null>("project_get_command_task", { path: target.path });
    if (disposed || requestSequence !== snapshotSequence) {
      return;
    }
    const currentTask = task.value;
    const alreadyReceived = snapshot?.task_id === currentTask?.task_id
      && (snapshot?.revision ?? -1) <= (currentTask?.revision ?? -1);
    if (alreadyReceived) {
      return;
    }
    const taskFinished = task.value?.status === "running" && snapshot?.status !== "running";
    task.value = snapshot;
    if (snapshot) {
      commandDraft.value = snapshot.command;
    }
    terminal.reset(snapshot?.output ?? "");
    if (taskFinished) {
      await refreshInfo();
    }
  }

  /**
   * 先建立事件订阅再恢复快照，防止初始化期间漏掉任务完成通知。
   * @returns 弹窗数据初始化完成
   */
  async function initialize(): Promise<void> {
    try {
      // 订阅与快照原子交接，读取本身不会启动脚本。
      const connection = createConnection();
      await Promise.all([
        refreshInfo(),
        invoke<ProjectTaskSnapshot | null>("project_attach_command_terminal", {
          path: target.path, onEvent: connection.channel,
        }).then(connection.activate),
      ]);
      if (!disposed && info.value?.detail) {
        reportError(info.value.detail);
      }
    } catch (error) {
      if (!disposed) {
        operationError.value = MANIFEST_ERROR;
        reportError(error);
      }
    } finally {
      loading.value = false;
    }
  }

  /**
   * 清空上一条输出并启动任务，脚本和手动命令共用启动、快照及失败处理。
   * @param displayCommand - 命令输入行和任务快照中显示的命令文本
   * @param invokeStart - 使用本次订阅建立启动请求
   * @returns 启动命令及快照同步完成
   */
  async function launchTask(
    displayCommand: string,
    invokeStart: (onEvent: Channel<TerminalEvent>) => Promise<ProjectTaskSnapshot>,
  ): Promise<void> {
    // 1. 先清空本次界面输出并记录启动请求，关闭流程会等待同一请求。
    starting.value = true;
    operationError.value = "";
    snapshotSequence++;
    terminal.reset("");
    task.value = null;
    commandDraft.value = displayCommand;
    const connection = createConnection();
    const pending = invokeStart(connection.channel);
    startPending = pending;

    // 2. 先恢复启动快照，再按序接上回执返回前已经收到的终端输出。
    try {
      const snapshot = await pending;
      if (!disposed) {
        connection.activate(snapshot);
      }
    } catch (error) {
      if (!disposed) {
        operationError.value = String(error) === MANAGER_ERROR ? MANAGER_ERROR : "执行失败（退出码 —）";
        reportError(error);
      }
    } finally {
      starting.value = false;
      startPending = null;
      const canFocusTerminal = !disposed && !closing.value && running.value;
      if (canFocusTerminal) {
        resizeTerminal(terminal.getSize());
        terminal.focus();
      }
    }
  }

  /**
   * 在打开时的项目目录执行选中的脚本，重复点击与关闭期间不能再启动。
   * @param script - 根目录 package.json 中的脚本
   * @returns 启动命令及快照同步完成
   */
  function runScript(script: ProjectScript): Promise<void> {
    // 仅空闲时允许执行，包管理器由自动识别或手动选择得到。
    if (busy.value) {
      return Promise.resolve();
    }
    const selectedManager = manager.value;
    if (!selectedManager) {
      operationError.value = MANAGER_ERROR;
      return Promise.resolve();
    }
    return launchTask(`${selectedManager} run ${script.name}`, (onEvent) =>
      invoke<ProjectTaskSnapshot>("project_run_command", {
        path: target.path, script: script.name, manager: selectedManager,
        ...terminal.getSize(), onEvent,
      }));
  }

  /**
   * 在项目根目录执行命令输入行的手动命令，使用与脚本相同的终端和停止流程。
   * @param commandLine - 用户确认的整行命令
   * @returns 启动命令及快照同步完成
   */
  function runCommand(commandLine: string): Promise<void> {
    const command = commandLine.trim();
    if (busy.value || !command) {
      return Promise.resolve();
    }
    return launchTask(command, (onEvent) =>
      invoke<ProjectTaskSnapshot>("project_run_shell_command", {
        path: target.path, command, ...terminal.getSize(), onEvent,
      }));
  }

  /**
   * 等待尚在启动的命令，再停止其进程树并读取最终日志。
   * @returns 停止成功时为 true，失败时保留弹窗和错误详情
   */
  async function stopActiveTask(): Promise<boolean> {
    stopping.value = true;
    // 上一次停止失败的提示随本次重试一起清掉，结果出来后再按实际结果写回。
    if (operationError.value === STOP_ERROR) {
      operationError.value = "";
    }

    // 1. 尚未返回任务身份时等待启动结束，防止关闭比进程启动更早完成。
    try {
      if (startPending) {
        await startPending.catch(() => null);
      }
      // 路径失效也应能停止已知任务，查询失败时保留上次取得的任务身份。
      await refreshTask().catch((error: unknown) => {
        reportError(error);
      });

      // 2. 按任务自己的项目和 ID 停止，结果中包含排空后的日志。
      const runningTask = task.value;
      if (runningTask?.status === "running") {
        const snapshot = await invoke<ProjectTaskSnapshot | null>("project_stop_command", {
          path: runningTask.project_path, taskId: runningTask.task_id,
        });
        if (!disposed) {
          task.value = snapshot;
          // 停止回执可能早于 Channel 的最后几块输出，完整快照保证关闭前日志不缺失。
          terminal.reset(snapshot?.output ?? "");
        }
        // 停止时也可能已经生成产物目录，弹窗中的入口需要同步可用状态。
        await refreshInfo().catch((error: unknown) => {
          reportError(error);
        });
      }
      return true;
    } catch (error) {
      reportError(error);
      // 停止没有完成时弹窗会保持打开，原因必须出现在状态栏，不能只写进日志。
      operationError.value = STOP_ERROR;
      return false;
    } finally {
      stopping.value = false;
    }
  }

  /**
   * 合并停止按钮和关闭动作发起的请求，避免关闭时遗漏正在进行的停止。
   * @returns 当前任务的停止结果
   */
  function stopTask(): Promise<boolean> {
    if (!stopPending) {
      stopPending = stopActiveTask().finally(() => {
        stopPending = null;
      });
    }
    return stopPending;
  }

  /**
   * 统一关闭入口，只有命令退出和日志收齐后才允许弹窗关闭。
   * @returns 是否完成关闭前清理
   */
  async function prepareClose(): Promise<boolean> {
    if (closing.value) {
      return false;
    }
    closing.value = true;
    const stopped = await stopTask();
    closing.value = false;
    return stopped;
  }

  onScopeDispose(() => {
    disposed = true;
    snapshotSequence++;
    connectionSequence++;
    // 父级意外卸载时仍等待启动回执，并只清理该任务，不能遗留刚启动的子进程。
    const cleanupTask = startPending ?? Promise.resolve(task.value);
    void cleanupTask.then((snapshot) => {
      if (snapshot?.status === "running") {
        return invoke("project_stop_command", { path: snapshot.project_path, taskId: snapshot.task_id });
      }
    }).catch(() => {});
  });

  return {
    info, task, managerChoice, manager, loading, starting, stopping, closing, openingDist, running, busy,
    inputEnabled, commandInputEnabled, commandDraft, resizeTerminal, writeInput,
    manifestMessage, statusText, initialize, openDist, runScript, runCommand, stopTask, prepareClose,
  };
}
