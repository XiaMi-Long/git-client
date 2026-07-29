/**
 * 可拖拽分隔条 composable
 * 支持水平（左右分栏，改变宽度）与垂直（上下分栏，改变高度）拖拽，改变相邻面板尺寸
 * 依据: docs/ui-spec.md §1.1 分隔条规范
 */
import { ref, onUnmounted } from "vue";

type Orientation = "horizontal" | "vertical";

interface ResizableOptions {
  /** 拖拽方向：horizontal 改宽度，vertical 改高度 */
  orientation: Orientation;
  /** 初始尺寸（px） */
  initial: number;
  /** 最小尺寸（px） */
  min: number;
  /** 最大尺寸（px） */
  max: number;
  /** 是否反向：被控面板在分隔条右侧或下方时为 true（拖拽方向与尺寸增减相反） */
  reverse?: boolean;
}

/**
 * 创建一个可拖拽改变尺寸的响应式尺寸
 * @param opts - 拖拽选项
 * @returns size 当前尺寸、dragging 是否拖拽中、onMouseDown 绑定到分隔条元素
 */
export function useResizable(opts: ResizableOptions) {
  const size = ref(opts.initial);
  const dragging = ref(false);

  // 拖拽起点坐标与起始尺寸，拖拽期间保持
  let startPos = 0;
  let startSize = 0;

  function onMouseMove(e: MouseEvent) {
    if (!dragging.value) return;
    const current = opts.orientation === "horizontal" ? e.clientX : e.clientY;
    const delta = current - startPos;
    // reverse 时反向（右侧 / 下方面板：鼠标右移尺寸减小）
    const next = opts.reverse ? startSize - delta : startSize + delta;
    // 限制在 min/max 范围内
    size.value = Math.min(opts.max, Math.max(opts.min, next));
  }

  function onMouseUp() {
    dragging.value = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    dragging.value = true;
    startPos = opts.orientation === "horizontal" ? e.clientX : e.clientY;
    startSize = size.value;
    // 拖拽时全局光标与禁止选中文本，避免抖动
    document.body.style.cursor =
      opts.orientation === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  onUnmounted(() => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  });

  return { size, dragging, onMouseDown };
}
