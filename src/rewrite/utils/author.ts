/**
 * 提交作者展示工具：头像缩写与稳定色调。
 *
 * @changeLog
 *   - 2026-11-04: Created. 真实作者名派生头像，替代原型手写 initials。
 */

/** 头像低饱和色调数量，与 rewrite.css 的 tone-0..5 对齐 */
const AVATAR_TONES = 6;

/**
 * 根据作者名生成稳定的 0..5 色调索引。
 * @param name - 作者名
 * @returns 稳定色调索引
 */
export function authorTone(name: string): number {
  let hash = 0;
  for (const char of String(name)) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return hash % AVATAR_TONES;
}

/**
 * 生成头像缩写：中文取首字，英文取单词首字母（最多两位）。
 * @param name - 作者名
 * @param initials - 外部已有缩写（可选）
 * @returns 1～2 个字符的头像文本
 */
export function authorMark(name: string, initials = ""): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "?";

  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return trimmed.charAt(0);
  }

  const provided = initials.trim();
  if (provided) return provided.slice(0, 2).toUpperCase();

  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
