/**
 * 仓库文件变更监听 composable
 * 封装 Tauri 事件 listen("repo-changed")，供工作区 / 提交列表在文件变更后刷新
 * 依据: tasks 3.3
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onUnmounted } from "vue";

/**
 * 监听后端 "repo-changed" 事件，文件变更时触发回调
 * @param onChange - 收到变更通知时的回调（通常为刷新工作区 / 列表）
 * @returns start 开始监听、stop 停止监听
 */
export function useRepoWatcher(onChange: () => void) {
  let unlisten: UnlistenFn | null = null;

  /** 开始监听 */
  async function start() {
    if (unlisten) return;
    unlisten = await listen("repo-changed", () => {
      onChange();
    });
  }

  /** 停止监听 */
  function stop() {
    unlisten?.();
    unlisten = null;
  }

  onUnmounted(() => {
    stop();
  });

  return { start, stop };
}
