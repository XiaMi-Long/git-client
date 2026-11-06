/**
 * 提交时间与日期分组工具。
 *
 * @changeLog
 *   - 2026-11-04: Created. 真实 author_date 的本地日期分组和时间格式。
 */

/**
 * 获取本地日期 key（YYYY-MM-DD）。
 * @param iso - ISO 时间
 * @returns 本地日期 key；非法时间返回空串
 */
export function dateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 生成日期分组标题：今天 / 昨天 / M月D日。
 * @param key - dateKey 结果
 * @returns 中文分组标签
 */
export function groupLabel(key: string): string {
  if (!key) return "未知日期";
  const today = dateKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday.toISOString());

  if (key === today) return "今天";
  if (key === yesterdayKey) return "昨天";
  const parts = key.split("-");
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

/**
 * 格式化提交时间（本地 HH:mm）。
 * @param iso - ISO 时间
 * @returns 24 小时时间；非法时回退原始片段
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 格式化完整日期时间（本地 YYYY-MM-DD HH:mm）。
 * @param iso - ISO 时间
 * @returns 可读日期时间
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace("T", " ");
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
