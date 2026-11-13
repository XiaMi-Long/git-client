/**
 * @description
 *   管理 build 弹窗中的 xterm.js 实例、主题、输出队列和尺寸监听。
 * @workflow
 *   挂载终端后同步尺寸，按顺序渲染 PTY 输出，将键盘事件交给任务模块，卸载时释放资源。
 * @changeLog
 *   - 2026-11-13: Created. 用成熟终端组件承接交互输入和彩色日志。
 */
import { onScopeDispose, type Ref } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/** PTY 和显示层共同使用的字符网格尺寸。 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 任务模块提供的输入和尺寸变更入口，不由显示层决定执行哪个项目。 */
interface TerminalHandlers {
  input: (text: string) => void;
  resize: (size: TerminalSize) => void;
}

/** 任务模块只通过这些方法更新终端，避免依赖 xterm 的内部对象。 */
export interface ProjectTerminalView {
  reset: (output: string) => void;
  write: (output: string) => void;
  getSize: () => TerminalSize;
  focus: () => void;
}

// 初始回滚空间随输出扩充，避免引入固定行数截断而改变已确认的日志保留行为。
const INITIAL_SCROLLBACK_LINES = 10000;
// 每批最多传入 64 KiB 字符，避免大日志重放占满 xterm 自身的待解析缓冲。
const OUTPUT_BATCH_CHARACTERS = 64 * 1024;

/**
 * 创建与当前弹窗生命周期一致的终端显示层。
 * @param host - 弹窗中留给终端的容器
 * @param handlers - 绑定当前任务的键盘输入及尺寸同步方法
 * @returns 挂载、输入开关和供任务模块调用的终端方法
 */
export function useProjectTerminal(host: Ref<HTMLDivElement | null>, handlers: TerminalHandlers) {
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let sizeObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let fitFrame: number | null = null;
  let disposed = false;
  let inputEnabled = false;
  let writing = false;
  let replaying = false;
  let resetPending = false;
  // 历史重放与实时输出分批处理，防止历史查询序列生成的响应被当作新输入。
  let pendingChunks: { output: string; replay: boolean }[] = [];

  /**
   * 将当前应用的代码区颜色和等宽字体应用到终端。
   * @returns void
   */
  function applyTheme(): void {
    if (!terminal || !host.value) {
      return;
    }
    const styles = getComputedStyle(host.value);
    terminal.options.fontFamily = styles.getPropertyValue("--mono").trim();
    terminal.options.theme = {
      background: styles.getPropertyValue("--code-bg").trim(),
      foreground: styles.getPropertyValue("--code-text").trim(),
      cursor: styles.getPropertyValue("--accent-strong").trim(),
      selectionBackground: styles.getPropertyValue("--accent-soft").trim(),
    };
  }

  /**
   * 合并同一帧的容器变化，隐藏或销毁后的终端不再测量。
   * @returns void
   */
  function scheduleFit(): void {
    if (disposed || fitFrame !== null) {
      return;
    }
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      const visibleHost = host.value;
      if (visibleHost && visibleHost.clientWidth > 0 && visibleHost.clientHeight > 0) {
        fitAddon?.fit();
      }
    });
  }

  /**
   * 等前一批输出渲染结束后再重置或追加，避免旧任务残留在新任务的屏幕中。
   * @returns void
   */
  function flushOutput(): void {
    const canFlush = terminal !== null && !disposed && !writing;
    if (!canFlush || !terminal) {
      return;
    }

    // 1. 只有前一批解析结束后才重置屏幕，避免旧输出在新任务中重新出现。
    if (resetPending) {
      terminal.reset();
      resetPending = false;
    }
    const restoringSnapshot = pendingChunks[0]?.replay ?? false;
    const batch: string[] = [];
    let batchLength = 0;
    // 2. 历史和实时输出不能混在一批，否则无法正确隔离终端的自动响应。
    while (pendingChunks.length > 0 && batchLength < OUTPUT_BATCH_CHARACTERS) {
      if (pendingChunks[0].replay !== restoringSnapshot) {
        break;
      }
      const nextChunk = pendingChunks[0].output;
      let characterCount = Math.min(nextChunk.length, OUTPUT_BATCH_CHARACTERS - batchLength);
      // 字符串按 UTF-16 切分，不能把一个 emoji 的高低代理项拆进两批。
      const lastCodeUnit = nextChunk.charCodeAt(characterCount - 1);
      const splitsSurrogatePair = characterCount < nextChunk.length
        && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff;
      if (splitsSurrogatePair) {
        characterCount++;
      }
      batch.push(nextChunk.slice(0, characterCount));
      batchLength += characterCount;
      if (characterCount === nextChunk.length) {
        pendingChunks.shift();
      } else {
        pendingChunks[0].output = nextChunk.slice(characterCount);
      }
    }
    const output = batch.join("");
    if (!output) {
      return;
    }

    // 历史控制序列可能请求终端响应，重放时不能把旧响应写进正在运行的脚本。
    replaying = restoringSnapshot;
    writing = true;
    const requiredScrollback = terminal.buffer.normal.length + output.length;
    if (requiredScrollback > (terminal.options.scrollback ?? 0)) {
      terminal.options.scrollback = requiredScrollback + INITIAL_SCROLLBACK_LINES;
    }
    terminal.write(output, () => {
      replaying = false;
      writing = false;
      flushOutput();
    });
  }

  /**
   * 切换到一个完整任务快照，清除尚未渲染的旧任务输出。
   * @param output - 后端保存的原始终端输出，包含 ANSI 控制序列
   * @returns void
   */
  function reset(output: string): void {
    resetPending = true;
    pendingChunks = output ? [{ output, replay: true }] : [];
    flushOutput();
  }

  /**
   * 追加本任务的新输出，由 xterm 自行处理颜色、回车和光标位置。
   * @param output - 按后端顺序送达的输出块
   * @returns void
   */
  function write(output: string): void {
    if (disposed || !output) {
      return;
    }
    pendingChunks.push({ output, replay: false });
    flushOutput();
  }

  /**
   * 获取已经适配容器的行列，挂载前使用标准终端尺寸。
   * @returns PTY 启动或调整尺寸时使用的字符网格
   */
  function getSize(): TerminalSize {
    return { cols: terminal?.cols ?? 80, rows: terminal?.rows ?? 24 };
  }

  /**
   * 执行脚本后将焦点交给终端，使用户可以直接回答脚本问题。
   * @returns void
   */
  function focus(): void {
    terminal?.focus();
  }

  /**
   * 仅运行中的任务接受输入，结束后的终端仍允许选择和复制日志。
   * @param enabled - 当前任务是否仍可接收输入
   * @returns void
   */
  function setInputEnabled(enabled: boolean): void {
    inputEnabled = enabled;
    if (terminal) {
      terminal.options.disableStdin = !enabled;
      terminal.options.cursorBlink = enabled;
    }
  }

  /**
   * 在原生弹窗显示后挂载终端，建立输入、主题和尺寸监听。
   * @returns void
   */
  function mountTerminal(): void {
    const canMount = host.value !== null && terminal === null && !disposed;
    if (!canMount || !host.value) {
      return;
    }
    // 1. 使用实际终端语义，保留 PTY 已处理的换行及脚本交互控制序列。
    terminal = new Terminal({
      fontSize: 12, lineHeight: 1.4, scrollback: INITIAL_SCROLLBACK_LINES,
      disableStdin: !inputEnabled, screenReaderMode: true, cursorStyle: "bar",
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    applyTheme();
    terminal.open(host.value);
    terminal.onData((text) => {
      if (inputEnabled && !replaying) {
        handlers.input(text);
      }
    });
    terminal.onResize((size) => handlers.resize(size));
    terminal.attachCustomKeyEventHandler((event) => {
      const copyingSelection = event.type === "keydown" && event.ctrlKey
        && event.key.toLowerCase() === "c" && terminal?.hasSelection();
      // 保留有选区时的系统复制；没有选区时 Ctrl+C 交给正在运行的程序。
      return !copyingSelection;
    });

    // 2. 原生弹窗已可测量，首次执行使用真实尺寸，后续窗口变化再异步适配。
    fitAddon.fit();
    sizeObserver = new ResizeObserver(scheduleFit);
    sizeObserver.observe(host.value);
    themeObserver = new MutationObserver(() => {
      applyTheme();
      scheduleFit();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "data-code-theme"],
    });
    void document.fonts.ready.then(scheduleFit);
    flushOutput();
  }

  onScopeDispose(() => {
    disposed = true;
    sizeObserver?.disconnect();
    themeObserver?.disconnect();
    if (fitFrame !== null) {
      cancelAnimationFrame(fitFrame);
    }
    pendingChunks = [];
    terminal?.dispose();
    terminal = null;
  });

  return { mountTerminal, reset, write, getSize, focus, setInputEnabled };
}
