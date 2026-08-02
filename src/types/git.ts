/**
 * Git 数据类型定义
 * 与后端 src-tauri/src/git/ 的 serde 序列化结构对齐（snake_case，枚举 lowercase）
 */

/** 文件变更类型（对应后端 FileChangeType） */
export type FileChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechanged"
  | "untracked"
  | "conflicted";

/** 暂存状态（对应后端 StageStatus） */
export type StageStatus = "staged" | "unstaged" | "both";

/** 单个文件的 git 状态 */
export interface FileStatus {
  path: string;
  old_path: string | null;
  change_type: FileChangeType;
  stage_status: StageStatus;
  is_conflicted: boolean;
}

/** 工作区完整状态 */
export interface WorkingAreaStatus {
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: FileStatus[];
  conflicted: FileStatus[];
  current_branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** 分支信息 */
export interface BranchInfo {
  name: string;
  full_name: string;
  commit_hash: string;
  subject: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** 存储（stash）条目 */
export interface StashInfo {
  /** stash 引用名，如 stash@{0} */
  index: string;
  /** 存储消息（已去掉 On branch: 前缀） */
  message: string;
  /** 来源分支 */
  branch: string;
  /** 提交哈希 */
  hash: string;
}

/** 标签信息 */
export interface TagInfo {
  name: string;
  commit_hash: string;
  subject: string;
  is_annotated: boolean;
  date: string | null;
}

/** 提交信息（对应后端 CommitInfo） */
export interface CommitInfo {
  hash: string;
  short_hash: string;
  subject: string;
  body: string | null;
  author_name: string;
  author_email: string;
  /** ISO 8601 作者时间 */
  author_date: string;
  /** 相对时间描述，如 "2 hours ago" */
  relative_date: string;
  committer_name: string;
  commit_date: string;
  /** 父提交哈希列表 */
  parents: string[];
  is_merge: boolean;
  /** 关联的 ref 名称，如 "HEAD -> main" */
  refs: string[];
}

/** 日志查询参数（对应后端 LogQuery） */
export interface LogQuery {
  skip: number;
  limit: number;
  branch: string | null;
  search: string | null;
  /** 是否查询所有分支（--all），为 true 时忽略 branch */
  all_branches: boolean;
}

/** 分支操作结果（对应后端 BranchOperationResult） */
export interface BranchOperationResult {
  success: boolean;
  message: string;
  current_branch: string | null;
}

/** 两分支对比结果（对应后端 CompareResult） */
export interface CompareResult {
  ahead: number;
  behind: number;
}

/** 远程操作结果（对应后端 RemoteResult） */
export interface RemoteResult {
  success: boolean;
  message: string;
  has_conflict: boolean;
  status: WorkingAreaStatus | null;
}

/** 当前 git 操作状态（对应后端 OperationState） */
export type OperationState = "normal" | "merging" | "rebasing" | "cherrypicking" | "conflict";

/** diff 行类型（对应后端 DiffLineType） */
export type DiffLineType =
  | "context"
  | "added"
  | "deleted"
  | "hunkheader"
  | "fileheader"
  | "diffheader"
  | "meta";

/** 单行 diff 内容 */
export interface DiffLine {
  line_type: DiffLineType;
  content: string;
  old_line_no: number | null;
  new_line_no: number | null;
}

/** 一个 hunk（连续变更块） */
export interface DiffHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

/** 单个文件的完整 diff */
export interface FileDiff {
  old_path: string;
  new_path: string;
  is_new: boolean;
  is_deleted: boolean;
  is_renamed: boolean;
  old_mode: string | null;
  new_mode: string | null;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}
