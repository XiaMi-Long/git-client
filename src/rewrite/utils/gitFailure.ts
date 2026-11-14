/**
 * @description
 *   把远程操作的原始失败文本整理成状态栏摘要、可操作建议和详情原文。
 * @workflow
 *   先去外层的中文标签和命令包装，再按常见失败特征匹配建议，最后挑最说明问题的一行作为摘要。
 * @dataFormat
 *   输入是后端返回的原始错误字符串，输出只用于展示，不修改后端消息本身。
 * @changeLog
 *   - 2026-11-14: Created. 远程操作失败时统一提供摘要、建议与详情。
 */

/** 一类常见失败的特征、状态栏摘要和操作建议。 */
interface FailurePattern {
  /** 在 git 输出中定位该类失败的片段。 */
  pattern: RegExp;
  /** 状态栏使用的一行说明。 */
  summary: string;
  /** 用户可以立即执行的下一步。 */
  hint: string;
}

/** 详情弹窗和状态栏共用的展示字段。 */
export interface GitFailureView {
  /** 状态栏使用的一行说明。 */
  summary: string;
  /** 可操作建议，未命中常见原因时为空。 */
  hint: string | null;
  /** 去掉外层标签后的原始输出，保留 git 的多行提示。 */
  detail: string;
}

// 后端会给拉取、推送等失败加一层中文前缀，详情里不重复展示。
const MESSAGE_PREFIX = /^[^\s:：]{1,8}失败[:：]\s*/;
// GitError 的 Display 会在 stderr 外面再包一层命令说明，两种退出码写法都要兼容。
const COMMAND_PREFIX = /^git\s*命令失败\s*(?:\([^)]*\))?\s*[:：]\s*/;
// warning / hint / info 属于附带提示，选摘要时排在真正的错误之后。
const NOISE_PREFIX = /^(?:warning|hint|info)[:：]/i;
// 按“越具体越靠前”排列，命中第一条后不再继续匹配。
const FAILURE_PATTERNS: readonly FailurePattern[] = [
  {
    // 应用给 git 关了终端交互，凭据失效会直接失败，凭据管理器也会给出同样的提示。
    pattern: /could not read (?:username|password)|authentication failed|terminal prompts disabled|unable to persist credentials|invalid username or password|http 401/i,
    summary: "远程鉴权失败，需要重新登录",
    hint: "远程凭据可能已失效：先在终端里对项目执行一次 git pull 或 git fetch 完成登录，或更新系统凭据管理器里的账号，再点「重试」。",
  },
  {
    pattern: /\[rejected\]|non-fast-forward|fetch first|failed to push some refs/i,
    summary: "远程有新提交，请先拉取",
    hint: "远程分支比本地新：先拉取合并远程提交，再推送。",
  },
  {
    pattern: /not possible to fast-forward|diverging branches|have divergent branches|need to specify how to reconcile/i,
    summary: "本地与远程已分叉，无法直接快进",
    hint: "先「获取远程」确认差异，再决定合并或变基；也可以在 git 配置里统一 pull.ff 或 pull.rebase 策略。",
  },
  {
    pattern: /would be overwritten|your local changes|please commit your changes|please move or remove them|cannot pull with rebase/i,
    summary: "本地改动会被覆盖，请先提交或储藏",
    hint: "先提交或储藏当前改动再拉取，避免覆盖尚未保存的修改。",
  },
  {
    pattern: /could not resolve host|connection timed out|connection refused|failed to connect|unable to access|could not resolve proxy|network is unreachable|rpc failed|early eof/i,
    summary: "无法连接远程仓库",
    hint: "检查网络、代理或 VPN 设置，确认能访问该仓库地址后重试。",
  },
  {
    pattern: /repository .* not found|does not appear to be a git repository|no such remote/i,
    summary: "远程仓库不存在或地址已变更",
    hint: "确认远程地址仍然有效（终端里执行 git remote -v），仓库是否被改名或删除。",
  },
  {
    pattern: /permission denied|you do not have permission|http 403|access denied/i,
    summary: "没有访问远程仓库的权限",
    hint: "确认当前账号对目标仓库有读写权限，或换用有权限的账号、SSH 密钥。",
  },
];

/**
 * 去掉后端添加的操作前缀和命令包装，只留下 git 自己的输出。
 * @param raw - 后端返回的原始错误文本
 * @returns 适合在详情弹窗展示的原文
 */
function stripWrapper(raw: string): string {
  let text = raw.trim();
  // 前缀可能叠加两层（例如“拉取失败: git 命令失败 (exit=1): …”），逐步剥离到稳定为止。
  for (let step = 0; step < 2; step += 1) {
    const stripped = text.replace(MESSAGE_PREFIX, "").replace(COMMAND_PREFIX, "").trim();
    if (stripped === text) {
      break;
    }
    text = stripped;
  }
  return text || raw.trim();
}

/**
 * 从多行输出里挑出最能说明问题的一行。
 * @param detail - 已去掉外层标签的输出
 * @returns 状态栏使用的单行摘要
 */
function pickSummaryLine(detail: string): string {
  const lines = detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // fatal / error 是 git 对失败原因的正式表述，优先于前面的警告。
  const fatal = lines.find((line) => /^(?:fatal|error)\b/i.test(line));
  if (fatal) {
    return fatal;
  }
  const meaningful = lines.filter((line) => !NOISE_PREFIX.test(line));
  return meaningful[meaningful.length - 1] ?? lines[lines.length - 1] ?? "远程操作失败";
}

/**
 * 整理一次远程操作失败，供状态栏摘要和详情弹窗共用。
 * @param raw - 后端返回的原始错误文本
 * @returns 摘要、建议和详情原文
 */
export function inspectGitFailure(raw: string): GitFailureView {
  const detail = stripWrapper(raw);
  const matched = FAILURE_PATTERNS.find((item) => item.pattern.test(detail));
  return {
    detail,
    summary: matched?.summary ?? pickSummaryLine(detail),
    hint: matched?.hint ?? null,
  };
}
