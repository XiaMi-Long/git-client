## Why

移除自动远程检查后，用户从 VS Code 等外部工具修改仓库时，需要一个明确的本地刷新入口；需要同步远程引用时，也需要主动触发 Fetch。Fetch 必须有结束时间，避免网络异常时操作一直处于忙碌状态。

## What Changes

- 在提交工具栏增加“刷新”和“获取远程”两个独立操作。
- “刷新”只重新读取当前仓库的本地状态、提交列表和当前选中 diff，不访问网络。
- “获取远程”调用独立的 Tauri 命令执行 Fetch，不合并、不切换分支；结束后刷新本地展示。
- Fetch 超过 30 秒时终止 Git 子进程、结束进度并显示错误；失败后仍刷新本地展示。

## Capabilities

### New Capabilities
- `repository-refresh`: 手动刷新本地仓库展示，并按需 Fetch 远程引用。

### Modified Capabilities

## Impact

- 前端提交工具栏及仓库、提交、选择状态 store。
- Tauri Git 命令注册和 Git Fetch 执行器。
- 新增 `git_fetch(path) -> Result<(), String>` 命令；不新增事件或数据格式。
