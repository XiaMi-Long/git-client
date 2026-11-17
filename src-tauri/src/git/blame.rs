// git blame 查询模块
// 读取指定版本文件每行的最后修改作者，供提交审查按行展示作者。
//
// @changeLog
//   - 2026-11-16: Created. 支持审查弹窗按行读取作者信息。

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::GitResult;

/// 单行 blame 结果。
#[derive(Debug, Clone, Serialize)]
pub struct BlameLine {
    /// 文件中的最终行号（从 1 开始）。
    pub line: u32,
    /// 最后修改该行的作者名。
    pub author_name: String,
    /// 作者邮箱，用于区分同名作者和悬停提示。
    pub author_email: String,
    /// 最后修改该行的完整提交哈希。
    pub commit_hash: String,
    /// 提交短哈希，供界面展示。
    pub short_hash: String,
    /// 最后修改该行的提交时间（Unix 秒），供「提交时间」列展示。
    pub author_time: i64,
    /// 提交标题，供悬停提示。
    pub summary: String,
}

/// blame 命令最长执行时间，避免大文件或复杂历史长期占用前端请求。
const BLAME_TIMEOUT: Duration = Duration::from_secs(30);

impl GitExecutor {
    /// 读取指定版本文件每行的最后修改作者。
    /// @param repo_path - 仓库目录
    /// @param revision - 提交哈希或引用
    /// @param file_path - 仓库相对路径
    /// @returns 按最终行号排列的 blame 记录
    pub async fn blame_file(
        repo_path: &Path,
        revision: &str,
        file_path: &str,
    ) -> GitResult<Vec<BlameLine>> {
        let output = Self::run_git_with_timeout(
            repo_path,
            &["blame", "--line-porcelain", revision, "--", file_path],
            BLAME_TIMEOUT,
        )
        .await?;
        Ok(Self::parse_blame_porcelain(&output))
    }

    /// 解析 `git blame --line-porcelain` 输出。
    /// @param raw - 命令标准输出
    /// @returns 每行作者信息；无法识别的块会被跳过
    fn parse_blame_porcelain(raw: &str) -> Vec<BlameLine> {
        let mut result = Vec::new();
        let mut commit_hash = String::new();
        let mut final_line = 0u32;
        let mut author_name = String::new();
        let mut author_email = String::new();
        let mut author_time = 0i64;
        let mut summary = String::new();

        for line in raw.lines() {
            // 1. 内容行以制表符开头，当前块元数据完整后生成一行。
            if line.starts_with('\t') {
                if final_line > 0 {
                    result.push(BlameLine {
                        line: final_line,
                        author_name: if author_name.is_empty() {
                            "未知作者".to_string()
                        } else {
                            author_name.clone()
                        },
                        author_email: author_email.clone(),
                        short_hash: commit_hash.chars().take(7).collect(),
                        commit_hash: commit_hash.clone(),
                        author_time,
                        summary: summary.clone(),
                    });
                }
                final_line = 0;
                continue;
            }

            // 2. 先识别元数据行，避免 summary 等文本被当作新的块头。
            if let Some(value) = line.strip_prefix("author ") {
                author_name = value.to_string();
                continue;
            }
            if let Some(value) = line.strip_prefix("author-mail ") {
                author_email = value
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string();
                continue;
            }
            if let Some(value) = line.strip_prefix("author-time ") {
                author_time = value.trim().parse::<i64>().unwrap_or(0);
                continue;
            }
            if let Some(value) = line.strip_prefix("summary ") {
                summary = value.to_string();
                continue;
            }

            // 3. 块头格式：提交哈希 原始行号 最终行号 [组内行数]。
            if let Some((hash, line_number)) = Self::parse_blame_header(line) {
                commit_hash = hash.to_string();
                final_line = line_number;
                author_name.clear();
                author_email.clear();
                author_time = 0;
                summary.clear();
            }
        }

        result
    }

    /// 解析 blame 输出的块头。
    /// @param line - 当前输出行
    /// @returns 提交哈希和最终行号；不是块头时为空
    fn parse_blame_header(line: &str) -> Option<(&str, u32)> {
        let mut fields = line.split_whitespace();
        let hash = fields.next()?.trim_start_matches('^');
        let _original_line = fields.next()?;
        let final_line = fields.next()?.parse::<u32>().ok()?;
        let is_object_id = matches!(hash.len(), 40 | 64)
            && hash.bytes().all(|byte| byte.is_ascii_hexdigit());
        if !is_object_id {
            return None;
        }
        Some((hash, final_line))
    }
}
