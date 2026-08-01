/**
 * 统一对话框 composable
 * 管理 ConfirmDialog 状态，提供 showConfirm / showMessage，替代原生 message/confirm
 * 依据: UI 规范弹窗统一
 */
import { ref } from "vue";

interface DialogState {
  title: string;
  message: string;
  hideCancel?: boolean;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

export function useDialog() {
  const dialogState = ref<DialogState | null>(null);

  /** 确认对话框，返回是否确认 */
  function showConfirm(title: string, msg: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => {
      dialogState.value = { title, message: msg, danger, resolve: (v) => resolve(v) };
    });
  }

  /** 消息提示对话框（仅确定按钮） */
  function showMessage(title: string, msg: string): Promise<void> {
    return new Promise((resolve) => {
      dialogState.value = { title, message: msg, hideCancel: true, resolve: () => resolve() };
    });
  }

  function onConfirm() {
    dialogState.value?.resolve(true);
    dialogState.value = null;
  }

  function onCancel() {
    dialogState.value?.resolve(false);
    dialogState.value = null;
  }

  return { dialogState, showConfirm, showMessage, onConfirm, onCancel };
}
