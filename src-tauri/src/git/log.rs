// git log 分页查询模块
// 使用 --format 与 --skip/-n 实现分页
// 依据: design.md D3/D6, tasks 2.3

use std::path::Path;

use serde::Serialize;

use super::executor::GitExecutor;
use super::types::GitResult;

/// 每页默认提交数
pub const PAGE_SIZE: usize = 100;

/// 提交信息
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    /// 完整哈希
    pub hash: String,
    /// 短哈希（7位）
    pub short_hash: String,
    /// 提交信息摘要（首行）
    pub subject: String,
    /// 提交信息正文（不含摘要行）
    pub body: Option<String>,
    /// 作者名
    pub author_name: String,
    /// 作者邮箱
    pub author_email: String,
    /// 作者时间（ISO 8601 格式字符串）
    pub author_date: String,
    /// 相对时间描述（如 "2 hours ago"）
    pub relative_date: String,
    /// 提交者名
    pub committer_name: String,
    /// 提交时间（ISO 8601 格式字符串）
    pub commit_date: String,
    /// 父提交哈希列表
    pub parents: Vec<String>,
    /// 是否为合并提交
    pub is_merge: bool,
    /// 当前分支是否包含此提交的 ref 名称
    pub refs: Vec<String>,
}

/// 日志查询参数
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct LogQuery {
    /// 起始偏移量（--skip）
    pub skip: usize,
    /// 每页数量（-n）
    pub limit: usize,
    /// 分支名（可选，默认当前分支）
    pub branch: Option<String>,
    /// 搜索关键词（匹配提交信息/作者/哈希）
    pub search: Option<String>,
    /// 是否查询所有分支（--all），为 true 时忽略 branch
    pub all_branches: bool,
}

impl Default for LogQuery {
    fn default() -> Self {
        Self {
            skip: 0,
            limit: PAGE_SIZE,
            branch: None,
            search: None,
            all_branches: false,
        }
    }
}

/// git log 格式化占位符，使用 ASCII 分隔符方便解析
/// 字段顺序: hash | short_hash | subject | body | author_name | author_email
///        | author_date | relative_date | committer_name | commit_date | parents | refs
const LOG_FORMAT: &str = "%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%aI%x1f%ar%x1f%cn%x1f%cI%x1f%P%x1f%d";

/// 条目分隔符（record separator）
#[allow(dead_code)]
const RECORD_SEP: &str = "\x1e";
/// 字段分隔符（unit separator）
const FIELD_SEP: &str = "\x1f";

impl GitExecutor {
    /// 分页查询提交日志（2.3）
    pub async fn get_log(repo_path: &Path, query: &LogQuery) -> GitResult<Vec<CommitInfo>> {
        // 搜索模式：提交信息 / 作者 / 哈希 任一匹配（OR），合并去重
        if let Some(search) = &query.search {
            let s = search.trim();
            if !s.is_empty() {
                return Self::get_log_search(repo_path, query, s).await;
            }
        }

        let args = Self::build_log_args(query, None);
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = Self::run_git(repo_path, &arg_refs).await?;
        Self::parse_log(&output)
    }

    /// 构建 git log 基础参数（不含搜索过滤）
    fn build_log_args(query: &LogQuery, search: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = vec![
            "log".to_string(),
            format!("--format={LOG_FORMAT}"),
            "-z".to_string(),
            format!("--skip={}", query.skip),
            format!("-n{}", query.limit),
        ];

        // 分支范围：all_branches 用 --all，否则指定分支或默认 HEAD
        if query.all_branches {
            args.push("--all".to_string());
        } else if let Some(branch) = &query.branch {
            args.push(branch.clone());
        }

        if search.is_some() {
            args.push("--regexp-ignore-case".to_string());
        }

        args
    }

    /// 搜索模式：提交信息 / 作者 / 哈希 任一匹配（OR），合并去重后返回前 100 条
    /// 说明：git log 的 --grep 与 --author 是 AND 关系，无法一条命令实现 OR，
    /// 因此分三次查询（message / author / hash）合并去重。
    async fn get_log_search(repo_path: &Path, query: &LogQuery, search: &str) -> GitResult<Vec<CommitInfo>> {
        const SEARCH_CAP: usize = 100;
        let mut merged: Vec<CommitInfo> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 搜索查询不应用分页（合并后统一截断）
        let base = LogQuery {
            skip: 0,
            limit: SEARCH_CAP,
            ..query.clone()
        };

        // 1. 提交信息搜索
        let mut args = Self::build_log_args(&base, Some(search));
        args.push(format!("--grep={search}"));
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        if let Ok(out) = Self::run_git(repo_path, &refs).await {
            if let Ok(commits) = Self::parse_log(&out) {
                for c in commits {
                    if seen.insert(c.hash.clone()) {
                        merged.push(c);
                    }
                }
            }
        }

        // 2. 作者搜索
        if merged.len() < SEARCH_CAP {
            let mut args = Self::build_log_args(&base, Some(search));
            args.push(format!("--author={search}"));
            let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            if let Ok(out) = Self::run_git(repo_path, &refs).await {
                if let Ok(commits) = Self::parse_log(&out) {
                    for c in commits {
                        if seen.insert(c.hash.clone()) {
                            merged.push(c);
                        }
                    }
                }
            }
        }

        // 3. 哈希前缀搜索（git rev-parse 验证后显示该提交本身）
        if merged.len() < SEARCH_CAP
            && Self::run_git(repo_path, &["rev-parse", "--verify", "--quiet", search])
                .await
                .is_ok()
        {
            let args = vec![
                "log".to_string(),
                format!("--format={LOG_FORMAT}"),
                "-z".to_string(),
                "-n1".to_string(),
                search.to_string(),
            ];
            let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            if let Ok(out) = Self::run_git(repo_path, &refs).await {
                if let Ok(commits) = Self::parse_log(&out) {
                    for c in commits {
                        if seen.insert(c.hash.clone()) {
                            merged.push(c);
                        }
                    }
                }
            }
        }

        merged.truncate(SEARCH_CAP);
        Ok(merged)
    }

    /// 解析 git log --format 输出
    fn parse_log(raw: &str) -> GitResult<Vec<CommitInfo>> {
        let mut commits = Vec::new();

        // -z 格式以 null 分隔记录
        for record in raw.split('\0') {
            if record.is_empty() {
                continue;
            }

            let fields: Vec<&str> = record.split(FIELD_SEP).collect();
            if fields.len() < 12 {
                continue;
            }

            let hash = fields[0].to_string();
            let short_hash = fields[1].to_string();
            let subject = fields[2].to_string();
            let body_raw = fields[3].to_string();
            let body = if body_raw.is_empty() {
                None
            } else {
                Some(body_raw.trim_end().to_string())
            };
            let author_name = fields[4].to_string();
            let author_email = fields[5].to_string();
            let author_date = fields[6].to_string();
            let relative_date = fields[7].to_string();
            let committer_name = fields[8].to_string();
            let commit_date = fields[9].to_string();
            let parents_str = fields[10].to_string();
            let refs_str = fields[11].to_string();

            let parents: Vec<String> = if parents_str.is_empty() {
                Vec::new()
            } else {
                parents_str.split_whitespace().map(String::from).collect()
            };

            let is_merge = parents.len() > 1;

            // 解析 refs，格式如 " (HEAD -> main, origin/main)"
            // 注意：trim() 会去掉 %d 输出的前缀空格，因此直接 strip 左右括号即可
            let refs: Vec<String> = if refs_str.is_empty() {
                Vec::new()
            } else {
                let trimmed = refs_str.trim();
                let inner = trimmed
                    .strip_prefix('(')
                    .and_then(|s| s.strip_suffix(')'))
                    .unwrap_or(trimmed);
                inner.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
            };

            commits.push(CommitInfo {
                hash,
                short_hash,
                subject,
                body,
                author_name,
                author_email,
                author_date,
                relative_date,
                committer_name,
                commit_date,
                parents,
                is_merge,
                refs,
            });
        }

        Ok(commits)
    }

    /// 获取提交总数（用于分页计算）
    pub async fn get_commit_count(repo_path: &Path, branch: Option<&str>) -> GitResult<usize> {
        let mut args = vec!["rev-list", "--count"];
        if let Some(b) = branch {
            args.push(b);
        } else {
            args.push("HEAD");
        }
        let output = Self::run_git(repo_path, &args).await?;
        Ok(output.trim().parse().unwrap_or(0))
    }
}
