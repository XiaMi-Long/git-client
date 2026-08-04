/**
 * 应用自动更新（基于 tauri-plugin-updater + GitHub Releases）
 *
 * 发布流程：
 *   1. 修改 tauri.conf.json 的 version
 *   2. npm run tauri build（生成 setup.exe + .sig + latest.json）
 *   3. 上传 3 个文件到 GitHub Releases（latest.json 作为资产名）
 *
 * 注意：构建时需要 TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
 * 环境变量（私钥在 E:/私人项目/.tauri-key/，勿提交到仓库）
 */
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateCheckResult =
  | { status: "none" }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

/**
 * 检查并下载更新（不自动重启）
 * - 无更新返回 none
 * - 有更新则下载安装，返回 downloaded（调用方提示重启）
 * - 失败返回 error
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) return { status: "none" };
    // 下载并静默安装（NSIS passive 模式，无弹窗）
    await update.downloadAndInstall();
    return { status: "downloaded", version: update.version };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 重启应用（安装完成后调用） */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}
