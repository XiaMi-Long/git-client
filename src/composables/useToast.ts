/**
 * Toast 提示 composable（模块级单例）
 * 右下角气泡提示，操作开始时给用户瞬时反馈
 */
import { ref } from "vue";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

// 模块级单例：所有组件共享同一份 toast 列表
const toasts = ref<ToastItem[]>([]);
let seq = 0;

/** 自动消失时长 */
const DURATION = 2500;

function push(type: ToastType, message: string, duration = DURATION) {
  const id = ++seq;
  toasts.value.push({ id, type, message });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, duration);
}

export function useToast() {
  return {
    toasts,
    info: (msg: string) => push("info", msg),
    success: (msg: string) => push("success", msg),
    error: (msg: string) => push("error", msg),
  };
}
