/**
 * 新 Review 视图的轻量代码高亮。
 * 只处理常见注释/字符串/标签/关键字/颜色/数字/函数名，输出已转义 HTML。
 *
 * @changeLog
 *   - 2026-11-04: Created. 从确认原型迁移代码配色 tokenizer。
 */

const CODE_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(<\/?[A-Za-z][^>]*>)|(\b(?:const|let|var|function|return|import|from|export|if|else|for|while|new|class|interface|type|async|await|true|false|null|undefined|typeof|in|of)\b)|(#[0-9a-fA-F]{3,8}\b)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*(?=\())/g;

/**
 * 转义 HTML 文本，避免 diff 内容注入。
 * @param value - 原始文本
 * @returns 可插入 v-html 的安全文本
 */
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char;
  });
}

/**
 * 按原型 token 规则高亮一行代码。
 * @param text - 原始代码行
 * @returns 带 tok-* span 的安全 HTML
 */
export function highlightCode(text: string): string {
  let output = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CODE_TOKEN.lastIndex = 0;

  while ((match = CODE_TOKEN.exec(text))) {
    output += escapeHtml(text.slice(lastIndex, match.index));
    let className = "tok-fn";
    if (match[1]) className = "tok-comment";
    else if (match[2]) className = "tok-string";
    else if (match[3]) className = "tok-tag";
    else if (match[4]) className = "tok-keyword";
    else if (match[5] || match[6]) className = "tok-number";
    output += `<span class="${className}">${escapeHtml(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }

  output += escapeHtml(text.slice(lastIndex));
  return output;
}
