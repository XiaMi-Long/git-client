# 泳道图未推送标识 任务清单

## 1. 共享数据

- [x] 1.1 在 `src/stores/commit.ts` 新增 `unpushedHashes` 状态、`currentBranch`/`currentAhead` computed、`loadUnpushed()`（复用 `git_get_log` 范围查询 + seq 竞态保护）并监听分支/领先数/仓库变化自动加载或清空，导出 `unpushedHashes`

## 2. 视图接入

- [x] 2.1 `src/components/layout/CommitList.vue` 移除局部未推送逻辑，改用 `commitStore.unpushedHashes`
- [x] 2.2 `src/components/layout/CommitSwimlane.vue` 在提交行 subject 后渲染「未推送」徽章（绿色 pill，样式与经典列表一致）

## 3. 验证

- [x] 3.1 前端 `vue-tsc` + `vite build` 通过
- [x] 3.2 运行验证：有未推送提交的仓库在经典列表与泳道图均显示「未推送」；无上游/已推送不显示；切换分支数据更新
