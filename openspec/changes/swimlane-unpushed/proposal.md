# 泳道图显示未推送提交（swimlane-unpushed）

## Why

经典提交列表已能显示「未推送」徽章（本地领先上游的提交），但泳道图模式（V2）渲染的是 `commitStore.commits`，拿不到 `CommitList.vue` 局部的 `unpushedHashes` 集合，因此泳道图里看不到哪些本地提交尚未推送。需要让两种视图共用同一份未推送数据。

## What Changes

- 将「未推送提交 hash 集合」的加载逻辑从 `CommitList.vue` 上移到 `commitStore`（单一数据源，含竞态保护与分支/仓库切换监听）。
- `CommitList.vue`（经典列表）改用 store 提供的 `unpushedHashes`，行为不变。
- `CommitSwimlane.vue`（泳道图）在提交行内为未推送提交渲染「未推送」徽章，样式与经典列表一致（绿色）。
- 语义：未推送 = 相对当前分支上游（`@{upstream}..HEAD`）领先的本地提交；仅当前分支视图有意义，与经典列表现有行为保持一致。

## Capabilities

### New Capabilities

- `commit-history`: 提交历史展示能力（本次新增“未推送提交标识”相关需求：经典列表与泳道图两种视图均能标识本地未推送提交）。

### Modified Capabilities

（无。`openspec/specs/` 暂无已归档的基线规范。）

## Impact

- `src/stores/commit.ts`：新增 `unpushedHashes` 状态与 `loadUnpushed` 加载逻辑、监听。
- `src/components/layout/CommitList.vue`：移除局部未推送逻辑，改用 store。
- `src/components/layout/CommitSwimlane.vue`：渲染「未推送」徽章。
- 后端无改动（复用现有 `git_get_log` 范围查询 `upstream..branch`）。
- 风险：与经典列表行为保持一致；超过 100 条未推送时集合截断（沿用现有限制）。
