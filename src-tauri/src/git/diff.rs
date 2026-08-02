// git diff 解析模块
// 解析统一格式 diff 输出为 hunk/行结构
// 依据: design.md D3/D7, tasks 2.4

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::GitResult;

/// diff 行类型
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineType {
    /// 上下文行（未变更）
    Context,
    /// 新增行
    Added,
    /// 删除行
    Deleted,
    /// hunk 头（@@ ... @@）
    HunkHeader,
    /// 文件头（+++ / ---）
    FileHeader,
    /// diff 头（diff --git ...）
    DiffHeader,
    /// 普通信息行（如 index 行）
    Meta,
}

/// 单行 diff 内容
#[derive(Debug, Clone, Serialize)]
pub struct DiffLine {
    /// 行类型
    pub line_type: DiffLineType,
    /// 行内容（不含前缀 +/-/空格）
    pub content: String,
    /// 旧文件行号（上下文行和删除行有）
    pub old_line_no: Option<u32>,
    /// 新文件行号（上下文行和新增行有）
    pub new_line_no: Option<u32>,
}

/// 一个 hunk（连续的变更块）
#[derive(Debug, Clone, Serialize)]
pub struct DiffHunk {
    /// hunk 头文本（如 "@@ -10,5 +10,7 @@"）
    pub header: String,
    /// 旧文件起始行号
    pub old_start: u32,
    /// 旧文件行数
    pub old_count: u32,
    /// 新文件起始行号
    pub new_start: u32,
    /// 新文件行数
    pub new_count: u32,
    /// hunk 内的所有行
    pub lines: Vec<DiffLine>,
}

/// 单个文件的完整 diff
#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    /// 旧文件路径
    pub old_path: String,
    /// 新文件路径
    pub new_path: String,
    /// 文件是否为新文件
    pub is_new: bool,
    /// 文件是否被删除
    pub is_deleted: bool,
    /// 文件是否为重命名
    pub is_renamed: bool,
    /// 旧文件模式
    pub old_mode: Option<String>,
    /// 新文件模式
    pub new_mode: Option<String>,
    /// 所有 hunk
    pub hunks: Vec<DiffHunk>,
    /// 新增行数
    pub additions: u32,
    /// 删除行数
    pub deletions: u32,
}

impl GitExecutor {
    /// 获取工作区某文件的 diff（未暂存）
    pub async fn get_working_diff(repo_path: &Path, file_path: &str) -> GitResult<Vec<FileDiff>> {
        let output = Self::run_git(
            repo_path,
            &["diff", "--", file_path],
        )
        .await?;
        Self::parse_diff(&output)
    }

    /// 获取已暂存某文件的 diff
    pub async fn get_staged_diff(repo_path: &Path, file_path: &str) -> GitResult<Vec<FileDiff>> {
        let output = Self::run_git(
            repo_path,
            &["diff", "--cached", "--", file_path],
        )
        .await?;
        Self::parse_diff(&output)
    }

    /// 获取指定提交中某文件的 diff
    pub async fn get_commit_diff(
        repo_path: &Path,
        commit_hash: &str,
        file_path: Option<&str>,
    ) -> GitResult<Vec<FileDiff>> {
        let args: Vec<&str> = match file_path {
            Some(path) => vec!["diff", commit_hash, "^{commit}", "--", path],
            None => vec!["show", commit_hash, "--format=", "--no-color"],
        };

        let output = Self::run_git(repo_path, &args).await?;
        Self::parse_diff(&output)
    }

    /// 获取两个提交之间的 diff
    pub async fn get_range_diff(
        repo_path: &Path,
        old_commit: &str,
        new_commit: &str,
    ) -> GitResult<Vec<FileDiff>> {
        let output = Self::run_git(
            repo_path,
            &["diff", old_commit, new_commit],
        )
        .await?;
        Self::parse_diff(&output)
    }

    /// 解析统一格式 diff 输出
    pub fn parse_diff(raw: &str) -> GitResult<Vec<FileDiff>> {
        let mut files: Vec<FileDiff> = Vec::new();
        let mut current_file: Option<FileDiff> = None;
        let mut current_hunk: Option<DiffHunk> = None;

        let mut old_line: u32 = 0;
        let mut new_line: u32 = 0;

        for line in raw.lines() {
            // diff --git a/path b/path
            if line.starts_with("diff --git ") {
                // 保存上一个 hunk 和 file
                Self::finalize_hunk(&mut current_file, &mut current_hunk);
                Self::finalize_file(&mut files, &mut current_file);

                let (old_path, new_path) = Self::parse_diff_git_header(line);
                current_file = Some(FileDiff {
                    old_path,
                    new_path,
                    is_new: false,
                    is_deleted: false,
                    is_renamed: false,
                    old_mode: None,
                    new_mode: None,
                    hunks: Vec::new(),
                    additions: 0,
                    deletions: 0,
                });
                continue;
            }

            // new file mode
            if line.starts_with("new file mode ") {
                if let Some(ref mut f) = current_file {
                    f.is_new = true;
                    f.new_mode = Some(line["new file mode ".len()..].to_string());
                }
                continue;
            }

            // deleted file mode
            if line.starts_with("deleted file mode ") {
                if let Some(ref mut f) = current_file {
                    f.is_deleted = true;
                    f.old_mode = Some(line["deleted file mode ".len()..].to_string());
                }
                continue;
            }

            // old mode
            if line.starts_with("old mode ") {
                if let Some(ref mut f) = current_file {
                    f.old_mode = Some(line["old mode ".len()..].to_string());
                }
                continue;
            }

            // new mode (non-new-file)
            if line.starts_with("new mode ") {
                if let Some(ref mut f) = current_file {
                    f.new_mode = Some(line["new mode ".len()..].to_string());
                }
                continue;
            }

            // rename from / rename to
            if line.starts_with("rename from ") {
                if let Some(ref mut f) = current_file {
                    f.is_renamed = true;
                    f.old_path = line["rename from ".len()..].to_string();
                }
                continue;
            }
            if line.starts_with("rename to ") {
                if let Some(ref mut f) = current_file {
                    f.is_renamed = true;
                    f.new_path = line["rename to ".len()..].to_string();
                }
                continue;
            }

            // --- a/path
            if line.starts_with("--- ") {
                if let Some(ref mut f) = current_file {
                    if line == "--- /dev/null" {
                        f.is_new = true;
                    }
                }
                continue;
            }

            // +++ b/path
            if line.starts_with("+++ ") {
                if let Some(ref mut f) = current_file {
                    if line == "+++ /dev/null" {
                        f.is_deleted = true;
                    }
                }
                continue;
            }

            // hunk header: @@ -start,count +start,count @@
            if line.starts_with("@@ ") {
                Self::finalize_hunk(&mut current_file, &mut current_hunk);

                let (old_start, old_count, new_start, new_count) = Self::parse_hunk_header(line);

                old_line = old_start;
                new_line = new_start;

                current_hunk = Some(DiffHunk {
                    header: line.to_string(),
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    lines: Vec::new(),
                });
                continue;
            }

            // diff 内容行
            if current_hunk.is_some() {
                let hunk = current_hunk.as_mut().unwrap();

                if line.starts_with('+') {
                    let content = &line[1..];
                    hunk.lines.push(DiffLine {
                        line_type: DiffLineType::Added,
                        content: content.to_string(),
                        old_line_no: None,
                        new_line_no: Some(new_line),
                    });
                    new_line += 1;
                    if let Some(ref mut f) = current_file {
                        f.additions += 1;
                    }
                } else if line.starts_with('-') {
                    let content = &line[1..];
                    hunk.lines.push(DiffLine {
                        line_type: DiffLineType::Deleted,
                        content: content.to_string(),
                        old_line_no: Some(old_line),
                        new_line_no: None,
                    });
                    old_line += 1;
                    if let Some(ref mut f) = current_file {
                        f.deletions += 1;
                    }
                } else if line.starts_with(' ') || line.is_empty() {
                    let content = if line.is_empty() { "" } else { &line[1..] };
                    hunk.lines.push(DiffLine {
                        line_type: DiffLineType::Context,
                        content: content.to_string(),
                        old_line_no: Some(old_line),
                        new_line_no: Some(new_line),
                    });
                    if !line.is_empty() {
                        old_line += 1;
                        new_line += 1;
                    }
                } else if line.starts_with("\\ ") {
                    // "\ No newline at end of file"
                    hunk.lines.push(DiffLine {
                        line_type: DiffLineType::Meta,
                        content: line.to_string(),
                        old_line_no: None,
                        new_line_no: None,
                    });
                }
            }
        }

        // 保存最后一个 hunk 和 file
        Self::finalize_hunk(&mut current_file, &mut current_hunk);
        Self::finalize_file(&mut files, &mut current_file);

        Ok(files)
    }

    /// 解析 diff --git 头
    fn parse_diff_git_header(line: &str) -> (String, String) {
        // "diff --git a/path b/path" 或 "diff --git a/path with spaces b/path with spaces"
        let rest = &line["diff --git ".len()..];

        // 尝试匹配 "a/... b/..."
        if let Some(idx) = rest.find(" b/") {
            let old = &rest[..idx];
            let new = &rest[idx + 3..];
            let old_path = old.strip_prefix("a/").unwrap_or(old).to_string();
            let new_path = new.strip_prefix("b/").unwrap_or(new).to_string();
            return (old_path, new_path);
        }

        // fallback: 整行作为同一路径
        let path = rest.to_string();
        (path.clone(), path)
    }

    /// 解析 hunk 头，提取 old/new 的 start 和 count
    fn parse_hunk_header(line: &str) -> (u32, u32, u32, u32) {
        // "@@ -10,5 +12,7 @@ context"
        let old_start = Self::extract_range(line, '-');
        let new_start = Self::extract_range(line, '+');

        // 提取逗号后的 count
        let old_count = Self::extract_count(line, '-');
        let new_count = Self::extract_count(line, '+');

        (old_start, old_count, new_start, new_count)
    }

    /// 从 hunk 头提取起始行号
    fn extract_range(line: &str, sign: char) -> u32 {
        let sign_str = sign.to_string();
        if let Some(idx) = line.find(&format!("{sign_str}")) {
            let after = &line[idx + 1..];
            let num: String = after
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            num.parse().unwrap_or(0)
        } else {
            0
        }
    }

    /// 从 hunk 头提取行数
    fn extract_count(line: &str, sign: char) -> u32 {
        let sign_str = sign.to_string();
        if let Some(idx) = line.find(&format!("{sign_str}")) {
            let after = &line[idx + 1..];
            // 跳过数字，找逗号
            let skip = after
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .count();
            let after_num = &after[skip..];
            if after_num.starts_with(',') {
                let count: String = after_num[1..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                count.parse().unwrap_or(1)
            } else {
                // 没有逗号，默认为 1
                1
            }
        } else {
            0
        }
    }

    /// 将当前 hunk 存入 file
    fn finalize_hunk(
        current_file: &mut Option<FileDiff>,
        current_hunk: &mut Option<DiffHunk>,
    ) {
        if let (Some(file), Some(hunk)) = (current_file.as_mut(), current_hunk.take()) {
            file.hunks.push(hunk);
        }
    }

    /// 将当前 file 存入结果列表
    fn finalize_file(files: &mut Vec<FileDiff>, current_file: &mut Option<FileDiff>) {
        if let Some(file) = current_file.take() {
            files.push(file);
        }
    }
}
