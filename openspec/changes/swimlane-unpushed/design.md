# 泳道图显示未推送提交 设计

## Context

- `CommitList.vue` 经典列表已有「未推送」徽章：通过 `git_get_log` 查询 `branch: "${upstream}..${branch}"`（如 `origin/main..main`）拿到未推送提交 hash 集合，渲染 `.unpushed-badge`。
- 该集合目前是 `CommitList.vue` 的局部 `ref`，泳道图组件（`CommitSwimlane.vue`，由 `CommitList` 在 swimlane 模式下渲染）无法访问。
- `commitStore.commits` 是两种视图的共同数据源；`repoStore.activeRepo.branches` 已含每个分支的 `upstream` / `ahead`。

## Goals / Non-Goals

**Goals:**
- 泳道图与经典列表显示一致的「未推送」标识。
- 未推送数据单一来源（store），消除两处重复加载与不一致。
- 语义沿用现定义：相对当前分支上游 `@{upstream}..HEAD` 的领先提交；无上游则不标记。

**Non-Goals:**
- 不改后端 `git_get_log`（范围查询已足够）。
- 不做“每个分支各自未推送”的扩展（与经典列表现行为一致，仅当前分支语义）。
- 不解决未推送超 100 条截断问题（沿用现有限制）。

## Decisions

**D1. 未推送数据放 commit store**
在 `commitStore` 中新增：
- `unpushedHashes = ref<Set<string>>(new Set())`
- `currentBranch` / `currentAhead` computed（从 `repoStore.activeRepo.branches` 推导）
- `loadUnpushed()`：与现有 `CommitList` 相同的 `git_get_log` 范围查询 + `seq` 竞态保护
- 监听 `[branch名, ahead数, repo id]`：ahead>0 时加载，否则清空
在 store 内用 `watch` 实现（Pinia setup store 支持），使两种视图无论挂载与否都拿到一致数据。

备选：在 `CommitSwimlane.vue` 内复制一份 `loadUnpushed`。→ 两处数据源易失同步，排除。

**D2. 泳道图徽章位置与样式**
泳道图行结构：时间列 + 作者列（圆点 + subject）。在 `subject` 后追加「未推送」徽章，复用经典列表 `.unpushed-badge` 的视觉（绿色 pill，11px），scoped 样式在 `CommitSwimlane.vue` 内定义（与经典列表 CSS 一致）。

**D3. 经典列表最小改动**
`CommitList.vue` 删除局部 `unpushedHashes` / `unpushedSeq` / `loadUnpushed` / 对应 watcher，模板改用 `commitStore.unpushedHashes.has(c.hash)`。`currentBranch` / `currentBehind` / `currentRemoteRef` 仍保留（用于远程提示等其它功能）。

## Risks / Trade-offs

- [store 内 watch 的触发时机] → 监听三元组（分支名/ahead/仓库 id），与经典列表原 watcher 等价；`refreshRepo` 替换 `branches` 数组即触发。
- [竞态：快速切换分支] → 沿用 `seq` 序号丢弃过期响应。
- [泳道图行宽挤压] → 徽章仅在未推送提交显示，且短小（`未推送` 3 字），subject 有 ellipsis，可接受。

## Migration Plan

1. `commitStore` 新增未推送状态 + 加载 + 监听。
2. `CommitList.vue` 改用 store 数据。
3. `CommitSwimlane.vue` 渲染徽章。
4. 前端构建验证 + 运行验证两种视图。

## Open Questions

- 无。
