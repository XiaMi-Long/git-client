// git 模块通用类型定义
// 依据: design.md D3 - 结构化数据通过 IPC 返回前端

use std::fmt;

/// git 操作错误类型
#[derive(Debug)]
pub enum GitError {
    /// git 命令执行失败（exit code 非 0）
    CommandFailed {
        stderr: String,
        exit_code: Option<i32>,
    },
    /// git 未安装或不在 PATH 中
    NotInstalled,
    /// 输出解析失败
    ParseError(String),
    /// 版本号解析失败
    VersionParse(String),
    /// 仓库路径无效
    InvalidRepo(String),
    /// IO 错误
    Io(String),
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GitError::CommandFailed { stderr, exit_code } => {
                write!(f, "git 命令失败 (exit={exit_code:?}): {stderr}")
            }
            GitError::NotInstalled => write!(f, "未找到 git，请确认已安装并在 PATH 中"),
            GitError::ParseError(msg) => write!(f, "解析失败: {msg}"),
            GitError::VersionParse(msg) => write!(f, "版本解析失败: {msg}"),
            GitError::InvalidRepo(msg) => write!(f, "无效的仓库路径: {msg}"),
            GitError::Io(msg) => write!(f, "IO 错误: {msg}"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::NotInstalled
        } else {
            GitError::Io(e.to_string())
        }
    }
}

impl serde::Serialize for GitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// git 命令执行结果
pub type GitResult<T> = Result<T, GitError>;
