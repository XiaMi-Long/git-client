/*
  GitTrail 静态原型逻辑
  @description
    项目切换、分支筛选、提交搜索、Review 弹窗、主题与密度设置；全部为演示数据。
  @changeLog
    - 2026-11-04: Created. 双主题、代码高亮、设置页、密度切换与分支行内拉取/提交。
*/
(() => {
  "use strict";

  /* ===== 演示数据 ===== */

  const FILES_LIST = [
    {
      path: "src/components/CommitList.vue",
      status: "M",
      add: 42,
      del: 18,
      hunks: [
        {
          header: "@@ -18,9 +18,13 @@",
          lines: [
            ` <div class="commit-scroll">`,
            `-  <CommitRow v-for="commit in commits" :key="commit.hash" />`,
            `+  <CommitRow`,
            `+    v-for="commit in visibleCommits"`,
            `+    :key="commit.hash"`,
            `+    @review="openReview(commit)"`,
            `+  />`,
            ` </div>`,
          ],
        },
        {
          header: "@@ -42,7 +46,10 @@",
          lines: [
            `-const rows = computed(() => commits.value)`,
            `+const rows = computed(() => visibleCommits.value)`,
            `+const reviewOpen = ref(false)`,
            `+`,
            ` watch(activeProject, () => {`,
            `   reviewOpen.value = false`,
            ` })`,
          ],
        },
      ],
    },
    {
      path: "src/components/ReviewDialog.vue",
      status: "A",
      add: 128,
      del: 0,
      hunks: [
        {
          header: "@@ -0,0 +1,15 @@",
          lines: [
            `+<script setup lang="ts">`,
            `+import { computed } from 'vue'`,
            `+import { useReview } from '@/composables/useReview'`,
            `+`,
            `+const review = useReview()`,
            `+const commit = computed(() => review.activeCommit)`,
            `+</script>`,
            `+`,
            `+<template>`,
            `+  <dialog :open="review.isOpen" class="review-dialog">`,
            `+    <header class="review-head">`,
            `+      <p class="review-label">提交审查</p>`,
            `+      <h2>{{ commit.subject }}</h2>`,
            `+    </header>`,
            `+  </dialog>`,
            `+</template>`,
          ],
        },
      ],
    },
    {
      path: "src/styles/tokens.css",
      status: "M",
      add: 24,
      del: 8,
      hunks: [
        {
          header: "@@ -1,10 +1,14 @@",
          lines: [
            ` :root {`,
            `-  --bg: #101827;`,
            `-  --accent: #3b82f6;`,
            `+  --ink: #101112;`,
            `+  --paper: #f2f3f4;`,
            `+  --signal: #ff4d00;`,
            `   --line: #d6d8da;`,
            ` }`,
          ],
        },
      ],
    },
  ];

  const FILES_SHELL = [
    {
      path: "src/App.vue",
      status: "M",
      add: 12,
      del: 40,
      hunks: [
        {
          header: "@@ -8,14 +8,10 @@",
          lines: [
            ` <template>`,
            `   <div class="app">`,
            `-    <StatusBar />`,
            `     <MainView />`,
            `   </div>`,
            ` </template>`,
            `-`,
            `-<style scoped>`,
            `-.status-bar { height: 24px; }`,
            `-</style>`,
          ],
        },
      ],
    },
    {
      path: "src/components/MainHeader.vue",
      status: "M",
      add: 36,
      del: 14,
      hunks: [
        {
          header: "@@ -6,12 +6,18 @@",
          lines: [
            ` <header class="main-header">`,
            `-  <nav class="toolbar">`,
            `-    <button>拉取</button>`,
            `-    <button>推送</button>`,
            `-  </nav>`,
            `+  <div class="title-row">`,
            `+    <h1>{{ project.name }}</h1>`,
            `+    <WindowControls />`,
            `+  </div>`,
            `+  <div class="status-row">`,
            `+    <BranchButton />`,
            `+    <span>{{ status }}</span>`,
            `+    <SearchInput />`,
            `+  </div>`,
            ` </header>`,
          ],
        },
      ],
    },
    {
      path: "src/stores/repo.ts",
      status: "M",
      add: 18,
      del: 6,
      hunks: [
        {
          header: "@@ -24,8 +24,12 @@",
          lines: [
            `-const ahead = ref(0)`,
            `+const ahead = computed(() => status.value?.ahead ?? 0)`,
            `+const unpushed = computed(() => status.value?.ahead ?? 0)`,
            ` const clean = computed(() => {`,
            `   return status.value?.staged.length === 0`,
            ` })`,
          ],
        },
      ],
    },
  ];

  const FILES_RAIL = [
    {
      path: "src/components/ProjectRail.vue",
      status: "A",
      add: 96,
      del: 0,
      hunks: [
        {
          header: "@@ -0,0 +1,18 @@",
          lines: [
            `+<script setup lang="ts">`,
            `+import { useRepoStore } from '@/stores/repo'`,
            `+const repo = useRepoStore()`,
            `+</script>`,
            `+`,
            `+<template>`,
            `+  <aside class="rail">`,
            `+    <button`,
            `+      v-for="project in repo.projects"`,
            `+      :key="project.id"`,
            `+      :class="{ active: project.id === repo.activeId }"`,
            `+      @click="repo.select(project.id)"`,
            `+    >`,
            `+      {{ project.name }}`,
            `+    </button>`,
            `+  </aside>`,
            `+</template>`,
          ],
        },
      ],
    },
    {
      path: "src/data/projects.ts",
      status: "M",
      add: 22,
      del: 4,
      hunks: [
        {
          header: "@@ -10,7 +10,12 @@",
          lines: [
            `-export const projects = ref([])`,
            `+export const projects = ref<Project[]>([`,
            `+  { id: 'git-client', name: 'git-client' },`,
            `+  { id: 'deepseek-harness', name: 'deepseek-harness' },`,
            `+])`,
            ` export const activeId = ref<string | null>(null)`,
          ],
        },
      ],
    },
    {
      path: "src/styles/rail.css",
      status: "A",
      add: 54,
      del: 0,
      hunks: [
        {
          header: "@@ -0,0 +1,16 @@",
          lines: [
            `+.rail {`,
            `+  width: 264px;`,
            `+  background: #101112;`,
            `+  color: #fff;`,
            `+}`,
            `+`,
            `+.rail .project.active {`,
            `+  background: #fff;`,
            `+  color: #101112;`,
            `+}`,
            `+`,
            `+.rail .project.active .branch {`,
            `+  color: #63676b;`,
            `+}`,
          ],
        },
      ],
    },
  ];

  const FILES_DIFF = [
    {
      path: "src/components/DiffView.vue",
      status: "M",
      add: 64,
      del: 22,
      hunks: [
        {
          header: "@@ -12,10 +12,16 @@",
          lines: [
            ` <div class="diff">`,
            `-  <pre>{{ rawDiff }}</pre>`,
            `+  <div`,
            `+    v-for="line in lines"`,
            `+    :key="line.key"`,
            `+    :class="['diff-line', line.type]"`,
            `+  >`,
            `+    <span class="ln">{{ line.newNo }}</span>`,
            `+    <code>{{ line.text }}</code>`,
            `+  </div>`,
            ` </div>`,
          ],
        },
        {
          header: "@@ -46,7 +52,9 @@",
          lines: [
            `-const lines = computed(() => parse(raw.value))`,
            `+const lines = computed(() =>`,
            `+  parse(raw.value, { wrap: props.wrap })`,
            `+)`,
          ],
        },
      ],
    },
    {
      path: "src/utils/diff.ts",
      status: "M",
      add: 30,
      del: 12,
      hunks: [
        {
          header: "@@ -18,9 +18,13 @@",
          lines: [
            `-export function parse(raw: string) {`,
            `+export function parse(raw: string, options: ParseOptions = {}) {`,
            `   const lines = raw.split('\\n')`,
            `-  return lines.map(toLine)`,
            `+  return lines.map((line) =>`,
            `+    toLine(line, options)`,
            `+  )`,
            ` }`,
          ],
        },
      ],
    },
    {
      path: "src/components/FileList.vue",
      status: "M",
      add: 10,
      del: 6,
      hunks: [
        {
          header: "@@ -8,8 +8,10 @@",
          lines: [
            ` <div class="files">`,
            `-  <div v-for="file in files" :key="file.path">`,
            `+  <button`,
            `+    v-for="file in files"`,
            `+    :key="file.path"`,
            `+    @click="$emit('select', file)"`,
            `+  >`,
            `     {{ file.path }}`,
            `-  </div>`,
            `+  </button>`,
            ` </div>`,
          ],
        },
      ],
    },
  ];

  function commit(hash, subject, author, initials, iso, refs, options = {}) {
    return {
      hash,
      short: hash.slice(0, 7),
      subject,
      author,
      initials,
      iso,
      refs,
      unpushed: Boolean(options.unpushed),
      files: options.files || FILES_LIST,
    };
  }

  const PROJECTS = [
    {
      id: "git-client",
      name: "git-client",
      path: "D:\\项目文件夹\\git-client",
      branch: "feat/ui-rewrite",
      ahead: 2,
      behind: 0,
      status: "干净",
      branches: ["feat/ui-rewrite", "main", "beta", "release"],
      remoteBranches: ["origin/feat/ui-rewrite", "origin/main", "origin/beta", "origin/release"],
      upstreams: { "feat/ui-rewrite": "origin/feat/ui-rewrite", main: "origin/main", beta: "origin/beta" },
      alias: "",
      stashes: [
        { message: "feat/ui-rewrite-2026-11-04-10-12", branch: "feat/ui-rewrite", hash: "0a1b2c3", files: 3 },
        { message: "main-2026-11-02-18-30", branch: "main", hash: "4d5e6f7", files: 1 },
      ],
      commits: [
        commit("3f2a1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b", "重写提交列表：项目切换、56px 行高与审查弹窗", "Yitao", "YT", "2026-11-04T14:22:00+08:00", ["feat/ui-rewrite"], { unpushed: true, files: FILES_LIST }),
        commit("8b1d0e2c4a6f8e0b2d4f6a8c0e2b4d6f8a0c2e4b", "移除底部状态栏，同步状态收进项目头部", "Yitao", "YT", "2026-11-04T11:08:00+08:00", ["feat/ui-rewrite"], { unpushed: true, files: FILES_SHELL }),
        commit("1c9e7f0a2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a", "新增审查弹窗：文件树与上下文件切换", "陈默", "CM", "2026-11-04T09:46:00+08:00", ["feat/ui-rewrite"], { files: FILES_RAIL }),
        commit("6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b", "补充审查弹窗的上一 / 下一个提交", "林可", "LK", "2026-11-03T18:40:00+08:00", ["feat/ui-rewrite"], { files: FILES_DIFF }),
        commit("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", "Merge branch 'feat/project-switcher'", "Yitao", "YT", "2026-11-03T16:12:00+08:00", ["main"], { files: FILES_RAIL }),
        commit("c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3", "fix: 日期分组在空仓库下不再报错", "陈默", "CM", "2026-11-02T10:27:00+08:00", ["main"], { files: FILES_LIST }),
        commit("7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b", "统一键盘操作：J/K、N/P、U/S", "林可", "LK", "2026-11-01T15:03:00+08:00", ["feat/ui-rewrite"], { files: FILES_SHELL }),
        commit("2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e", "调整审查弹窗的文件列表宽度", "Yitao", "YT", "2026-10-31T09:18:00+08:00", ["main", "origin/main"], { files: FILES_DIFF }),
      ],
    },
    {
      id: "deepseek-harness",
      name: "deepseek-harness",
      path: "D:\\项目文件夹\\deepseek-harness",
      branch: "master",
      ahead: 0,
      behind: 0,
      status: "干净",
      branches: ["master", "feat/review"],
      remoteBranches: ["origin/master", "origin/feat/review"],
      upstreams: { master: "origin/master" },
      alias: "",
      stashes: [
        { message: "master-2026-11-03-21-44", branch: "master", hash: "9b8a7c6", files: 2 },
      ],
      commits: [
        commit("9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d", "拆分 DSL 解析器，补上流式输出", "Kenji", "KJ", "2026-11-04T08:12:00+08:00", ["master"], { files: FILES_DIFF }),
        commit("2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c", "feat: 新增 review 工作流", "Dana", "DA", "2026-11-03T21:05:00+08:00", ["master"], { files: FILES_SHELL }),
        commit("6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f", "docs: 更新本地运行说明", "林可", "LK", "2026-11-01T14:30:00+08:00", ["master"], { files: FILES_RAIL }),
        commit("0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6", "chore: 升级依赖", "Kenji", "KJ", "2026-10-30T11:40:00+08:00", ["feat/review"], { files: FILES_DIFF }),
      ],
    },
    {
      id: "maid-atelier",
      name: "maid-atelier",
      path: "D:\\项目文件夹\\maid-atelier",
      branch: "main",
      ahead: 0,
      behind: 4,
      status: "干净",
      branches: ["main", "release"],
      remoteBranches: ["origin/main", "origin/release"],
      upstreams: { main: "origin/main" },
      alias: "",
      stashes: [],
      commits: [
        commit("4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b", "调整侧栏搜索的展开态", "林可", "LK", "2026-11-03T19:20:00+08:00", ["main"], { files: FILES_RAIL }),
        commit("8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", "fix: 主题切换时保持滚动位置", "陈默", "CM", "2026-11-02T13:10:00+08:00", ["main"], { files: FILES_SHELL }),
        commit("2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d", "新增作品卡片", "林可", "LK", "2026-10-31T17:45:00+08:00", ["main"], { files: FILES_DIFF }),
        commit("6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a", "release: 0.4.2", "Yitao", "YT", "2026-10-29T10:05:00+08:00", ["release"], { files: FILES_RAIL }),
      ],
    },
    {
      id: "design-skills",
      name: "design-skills",
      path: "D:\\项目文件夹\\design-skills",
      branch: "main",
      ahead: 1,
      behind: 0,
      status: "干净",
      branches: ["main"],
      remoteBranches: ["origin/main"],
      upstreams: { main: "origin/main" },
      alias: "",
      stashes: [
        { message: "main-2026-11-02-09-18", branch: "main", hash: "5c4b3a2", files: 1 },
      ],
      commits: [
        commit("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "补充 review 规则与状态清单", "Dana", "DA", "2026-11-04T07:30:00+08:00", ["main"], { files: FILES_LIST }),
        commit("5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e", "docs: 添加安装说明", "Yitao", "YT", "2026-11-02T16:20:00+08:00", ["main"], { files: FILES_RAIL }),
        commit("9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b", "feat: 新增 landing-page-design", "Dana", "DA", "2026-10-30T09:00:00+08:00", ["main"], { files: FILES_DIFF }),
      ],
    },
  ];

  /* ===== 状态 ===== */

  const THEME_KEY = "gittrail-theme";
  const DENSITY_KEY = "gittrail-density";
  const PROJECT_LAYOUT_KEY = "gittrail-project-layout";
  const COPY_LABEL = "复制哈希";
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  const state = {
    projectId: "git-client",
    branch: "feat/ui-rewrite",
    query: "",
    view: "commits",
    diffView: "unified",
    wrap: false,
    activeCommitIndex: -1,
    activeFile: 0,
    lastTrigger: null,
    branchAction: null,
    branchFeedback: null,
    operation: null,
    themeMode: "system",
    density: "comfortable",
  };

  const els = {
    app: document.getElementById("app"),
    projectList: document.getElementById("projectList"),
    projectSearch: document.getElementById("projectSearch"),
    railToggle: document.getElementById("railToggle"),
    addProject: document.getElementById("addProject"),
    settingsBtn: document.getElementById("settingsBtn"),
    projectTitle: document.getElementById("projectTitle"),
    themeToggle: document.getElementById("themeToggle"),
    branchBtn: document.getElementById("branchBtn"),
    branchLabel: document.getElementById("branchLabel"),
    branchPopover: document.getElementById("branchPopover"),
    headerBottom: document.getElementById("headerBottom"),
    statusLine: document.getElementById("statusLine"),
    searchInput: document.getElementById("searchInput"),
    searchClear: document.getElementById("searchClear"),
    commitScroll: document.getElementById("commitScroll"),
    contextMenu: document.getElementById("contextMenu"),
    actionMenu: document.getElementById("actionMenu"),
    syncBtn: document.getElementById("syncBtn"),
    stashBtn: document.getElementById("stashBtn"),
    stashPopover: document.getElementById("stashPopover"),
    stashCount: document.getElementById("stashCount"),
    actionBackdrop: document.getElementById("actionBackdrop"),
    actionDialog: document.getElementById("actionDialog"),
    actionTitle: document.getElementById("actionTitle"),
    actionDesc: document.getElementById("actionDesc"),
    actionBody: document.getElementById("actionBody"),
    actionCancel: document.getElementById("actionCancel"),
    actionConfirm: document.getElementById("actionConfirm"),
    conflictBar: document.getElementById("conflictBar"),
    conflictBackdrop: document.getElementById("conflictBackdrop"),
    conflictTitle: document.getElementById("conflictTitle"),
    conflictMeta: document.getElementById("conflictMeta"),
    conflictBody: document.getElementById("conflictBody"),
    conflictCount: document.getElementById("conflictCount"),
    closeConflict: document.getElementById("closeConflict"),
    checkConflictMarkers: document.getElementById("checkConflictMarkers"),
    abortConflict: document.getElementById("abortConflict"),
    continueConflict: document.getElementById("continueConflict"),
    settingsView: document.getElementById("settingsView"),
    reviewBackdrop: document.getElementById("reviewBackdrop"),
    reviewDialog: document.getElementById("reviewDialog"),
    reviewSubject: document.getElementById("reviewSubject"),
    reviewMeta: document.getElementById("reviewMeta"),
    copyHash: document.getElementById("copyHash"),
    closeReview: document.getElementById("closeReview"),
    fileList: document.getElementById("fileList"),
    fileCountHead: document.getElementById("fileCountHead"),
    diffPane: document.getElementById("diffPane"),
    diffToolbar: document.getElementById("diffToolbar"),
    diffContent: document.getElementById("diffContent"),
    prevCommit: document.getElementById("prevCommit"),
    nextCommit: document.getElementById("nextCommit"),
    fileCountFoot: document.getElementById("fileCountFoot"),
    toast: document.getElementById("toast"),
  };

  let searchTimer = null;
  let toastTimer = null;
  let themeTimer = null;
  let copyTimer = null;
  let menuCommit = null;
  let menuCommitIndex = -1;
  let menuTrigger = null;
  let menuCloseTimer = null;
  let actionMenuTrigger = null;
  let actionMenuItems = [];
  let actionMenuOnSelect = null;
  let actionMenuCloseTimer = null;
  let actionDialogTrigger = null;
  let actionDialogOnConfirm = null;
  let projectDragId = null;
  let projectDidDrag = false;
  let railUserSet = false;

  /* ===== 基础工具 ===== */

  function readStored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStored(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 隐私模式或 file:// 限制下静默失败
    }
  }

  function activeProject() {
    return PROJECTS.find((project) => project.id === state.projectId) || PROJECTS[0];
  }

  function filteredCommits() {
    const project = activeProject();
    const query = state.query.trim().toLowerCase();
    return project.commits.filter((item) => {
      const branchMatch = state.branch === "all" || item.refs.includes(state.branch);
      if (!branchMatch) return false;
      if (!query) return true;
      return (
        item.subject.toLowerCase().includes(query) ||
        item.author.toLowerCase().includes(query) ||
        item.short.includes(query) ||
        item.hash.includes(query)
      );
    });
  }

  function currentCommit() {
    return filteredCommits()[state.activeCommitIndex] || null;
  }

  function projectInitials(project) {
    const name = displayProjectName(project);
    const parts = name.split(/[-_\s]/).filter(Boolean);
    const initials = parts.length > 1
      ? parts.map((part) => part.charAt(0)).join("")
      : name.slice(0, 2);
    return initials.slice(0, 2).toUpperCase();
  }

  function projectMeta(project) {
    const bits = [project.branch];
    if (project.ahead) bits.push(`${project.ahead} 未推送`);
    if (project.behind) bits.push(`${project.behind} 待拉取`);
    if (!project.ahead && !project.behind) bits.push("已同步");
    return bits.join(" · ");
  }

  function displayProjectName(project) {
    return (project.alias || "").trim() || project.name;
  }

  function loadProjectLayout() {
    const raw = readStored(PROJECT_LAYOUT_KEY);
    if (!raw) return;

    try {
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return;

      const projectById = new Map(PROJECTS.map((project) => [project.id, project]));
      const ordered = [];
      saved.forEach((entry) => {
        const project = projectById.get(entry.id);
        if (!project) return;
        project.alias = typeof entry.alias === "string" ? entry.alias : "";
        ordered.push(project);
        projectById.delete(entry.id);
      });

      PROJECTS.length = 0;
      PROJECTS.push(...ordered, ...projectById.values());
    } catch {
      // 本地布局损坏时退回默认顺序，避免阻断启动
    }
  }

  function persistProjectLayout() {
    writeStored(PROJECT_LAYOUT_KEY, JSON.stringify(
      PROJECTS.map((project) => ({ id: project.id, alias: project.alias || "" })),
    ));
  }

  // 原型固定本人；真实实现从 git config user.name 读取
  const CURRENT_USER = "Yitao";
  const AVATAR_TONES = 6;

  function authorTone(name) {
    let hash = 0;
    for (const char of String(name)) {
      hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    }
    return hash % AVATAR_TONES;
  }

  function authorMark(name, initials) {
    const trimmed = String(name).trim();
    if (/[\u4e00-\u9fff]/.test(trimmed)) {
      return trimmed.charAt(0);
    }
    return (initials || trimmed.slice(0, 2)).toUpperCase();
  }

  function dateKey(iso) {
    return iso.slice(0, 10);
  }

  function groupLabel(key) {
    if (key === "2026-11-04") return "今天";
    if (key === "2026-11-03") return "昨天";
    const parts = key.split("-");
    return `${Number(parts[1])}月${Number(parts[2])}日`;
  }

  function fmtTime(iso) {
    return iso.slice(11, 16);
  }

  function fmtDateTime(iso) {
    return iso.slice(0, 16).replace("T", " ");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  /* ===== 代码高亮 ===== */

  const CODE_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(<\/?[A-Za-z][^>]*>)|(\b(?:const|let|var|function|return|import|from|export|if|else|for|while|new|class|interface|type|async|await|true|false|null|undefined|typeof|in|of)\b)|(#[0-9a-fA-F]{3,8}\b)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*(?=\())/g;

  function highlightCode(text) {
    let output = "";
    let lastIndex = 0;
    let match;
    CODE_TOKEN.lastIndex = 0;
    while ((match = CODE_TOKEN.exec(text))) {
      output += escapeHtml(text.slice(lastIndex, match.index));
      let className = "tok-fn";
      if (match[1]) className = "tok-comment";
      else if (match[2]) className = "tok-string";
      else if (match[3]) className = "tok-tag";
      else if (match[4]) className = "tok-keyword";
      else if (match[5] || match[6]) className = "tok-number";
      output += `<span class="${className}">${escapeHtml(match[0])}</span>`;
      lastIndex = match.index + match[0].length;
    }
    output += escapeHtml(text.slice(lastIndex));
    return output;
  }

  const ICON_PULL = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7"/><path d="M3 13.5h10"/></svg>`;
  const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;

  /* ===== 主题与密度 ===== */

  function resolvedTheme() {
    if (state.themeMode === "dark") return "dark";
    if (state.themeMode === "light") return "light";
    return themeMedia.matches ? "dark" : "light";
  }

  function applyTheme(animate = false) {
    const next = resolvedTheme();
    const current = document.documentElement.dataset.theme;
    if (animate && current && current !== next) {
      document.documentElement.classList.add("theme-transition");
      els.themeToggle.classList.remove("spin");
      void els.themeToggle.offsetWidth;
      els.themeToggle.classList.add("spin");
      clearTimeout(themeTimer);
      themeTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transition");
        els.themeToggle.classList.remove("spin");
      }, 340);
    }
    document.documentElement.dataset.theme = next;
  }

  function applyDensity() {
    document.documentElement.dataset.density = state.density;
  }

  function setThemeMode(mode) {
    state.themeMode = mode;
    writeStored(THEME_KEY, mode);
    applyTheme(true);
    if (state.view === "settings") renderSettingsPreservingScroll();
  }

  function toggleTheme() {
    setThemeMode(resolvedTheme() === "dark" ? "light" : "dark");
  }

  function setDensity(density) {
    state.density = density;
    writeStored(DENSITY_KEY, density);
    applyDensity();
    if (state.view === "settings") renderSettingsPreservingScroll();
  }

  /* ===== 项目栏 ===== */

  function renderProjects() {
    els.projectList.innerHTML = PROJECTS.map((project) => {
      const active = project.id === state.projectId;
      const displayName = displayProjectName(project);
      return `
        <div class="project ${active ? "active" : ""}" role="button" tabindex="0" draggable="true"
          data-project="${project.id}" data-name="${escapeHtml(`${displayName} ${project.name}`)}"
          data-path="${escapeHtml(project.path)}" title="${escapeHtml(project.path)}"
          aria-current="${active ? "true" : "false"}">
          <span class="project-dot" aria-hidden="true"></span>
          <span class="project-content">
            <span class="project-name">${escapeHtml(displayName)}</span>
            <span class="project-branch">${escapeHtml(projectMeta(project))}</span>
          </span>
          <span class="project-initials" aria-hidden="true">${projectInitials(project)}</span>
        </div>
      `;
    }).join("");
  }

  function filterProjects() {
    const query = els.projectSearch.value.trim().toLowerCase();
    els.projectList.querySelectorAll(".project").forEach((row) => {
      const haystack = `${row.dataset.name} ${row.dataset.path}`.toLowerCase();
      row.hidden = Boolean(query) && !haystack.includes(query);
    });
  }

  function openProjectMenu(event, project, trigger) {
    openActionMenu(event.clientX, event.clientY, {
      header: displayProjectName(project),
      trigger,
      items: [
        { id: "rename", label: "重命名…", hint: "只改显示" },
      ],
      onSelect: (actionId) => {
        if (actionId === "rename") promptProjectRename(project);
      },
    });
  }

  function promptProjectRename(project) {
    openActionDialog({
      title: "重命名项目",
      description: "只改变软件内显示名称，不改仓库目录。",
      fields: [{
        name: "alias",
        label: "显示名称",
        value: project.alias || project.name,
        placeholder: project.name,
      }],
      confirmText: "保存",
      onConfirm(values) {
        const alias = values.alias.trim();
        if (!alias) {
          toast("显示名称不能为空");
          return false;
        }
        project.alias = alias === project.name ? "" : alias;
        persistProjectLayout();
        renderProjects();
        filterProjects();
        renderHeader();
        toast(`项目显示为 ${displayProjectName(project)}`);
      },
    });
  }

  function selectProject(projectId) {
    if (!PROJECTS.some((project) => project.id === projectId)) return;
    closeCommitMenu(true);
    closeActionMenu(true);
    closeStashPopover();
    closeConflictDialog();
    state.projectId = projectId;
    state.branch = activeProject().branch;
    state.query = "";
    state.view = "commits";
    state.activeCommitIndex = -1;
    state.branchAction = null;
    state.branchFeedback = null;
    state.operation = null;
    closeReview();
    closeBranch();
    renderProjects();
    filterProjects();
    renderView();
  }

  /* ===== 主视图 ===== */

  function renderHeader() {
    const project = activeProject();
    const settings = state.view === "settings";
    els.projectTitle.textContent = settings ? "设置" : displayProjectName(project);
    els.projectTitle.title = settings ? "设置" : project.path;
    els.branchLabel.textContent = state.branch === "all" ? "所有分支" : state.branch;

    const bits = [];
    if (project.ahead) bits.push(`${project.ahead} 个未推送`);
    if (project.behind) bits.push(`${project.behind} 个待拉取`);
    if (!bits.length) bits.push("已同步");
    bits.push(project.status);
    els.statusLine.textContent = bits.join(" · ");

    els.searchInput.value = state.query;
    els.searchClear.hidden = !state.query;
    renderStashButton();
  }

  function renderView() {
    const settings = state.view === "settings";
    els.headerBottom.hidden = settings;
    els.commitScroll.hidden = settings;
    els.settingsView.hidden = !settings;
    els.settingsBtn.classList.toggle("active", settings);
    renderHeader();
    renderConflictBar();
    if (settings) {
      renderSettings();
    } else {
      renderCommits();
    }
  }

  /* ===== 提交列表 ===== */

  function renderCommits(animate = "rows") {
    const commits = filteredCommits();
    if (!commits.length) {
      prepareListAnimation(animate);
      const title = state.query ? "没有匹配的提交" : "这个分支还没有提交";
      const hint = state.query ? "换一个关键词，或清除搜索。" : "换一个项目，或切到其他分支。";
      els.commitScroll.innerHTML = `
        <div class="empty">
          <h2>${title}</h2>
          <p>${hint}</p>
          ${state.query ? '<button class="empty-action" type="button" data-action="clear-search">清除搜索</button>' : ""}
        </div>
      `;
      return;
    }

    prepareListAnimation(animate);

    const groups = new Map();
    commits.forEach((item) => {
      const key = dateKey(item.iso);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    let html = "";
    let index = 0;
    groups.forEach((list, key) => {
      html += `<section class="date-group" aria-label="${groupLabel(key)}">`;
      html += `<div class="date-head"><span class="date-label">${groupLabel(key)}</span><span class="date-count">${list.length} 个提交</span></div>`;
      list.forEach((item) => {
        html += commitRow(item, index);
        index += 1;
      });
      html += "</section>";
    });

    if (!state.query) {
      html += `
        <button class="load-more" type="button">
          加载更早的提交
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>
        </button>
      `;
    }

    els.commitScroll.innerHTML = html;
  }

  function prepareListAnimation(animate) {
    els.commitScroll.classList.remove("list-enter", "list-fade");
    void els.commitScroll.offsetWidth;
    els.commitScroll.classList.add(animate === "fade" ? "list-fade" : "list-enter");
    els.commitScroll.scrollTop = 0;
  }

  function commitRow(item, index) {
    const refs = item.refs.map((ref) => {
      const cls = ref.startsWith("origin/") ? "ref remote" : "ref";
      return `<span class="${cls}">${escapeHtml(ref)}</span>`;
    }).join('<span class="meta-dot" aria-hidden="true">·</span>');

    const meta = [
      `<span class="hash">${item.short}</span>`,
      `<span>${escapeHtml(item.author)}</span>`,
      refs,
      item.unpushed ? '<span class="unpushed">未推送</span>' : "",
    ].filter(Boolean).join('<span class="meta-dot" aria-hidden="true">·</span>');

    return `
      <div class="commit-row" role="button" tabindex="0" data-index="${index}"
        style="--i:${Math.min(index, 6)}" aria-label="打开审查：${escapeHtml(item.subject)}">
        <span class="commit-time">${fmtTime(item.iso)}</span>
        <span class="avatar tone-${authorTone(item.author)}${item.author === CURRENT_USER ? " self" : ""}"
          aria-hidden="true" title="${item.author === CURRENT_USER ? "你" : escapeHtml(item.author)}">${escapeHtml(authorMark(item.author, item.initials))}</span>
        <div class="commit-main">
          <div class="commit-subject">${escapeHtml(item.subject)}</div>
          <div class="commit-meta">${meta}</div>
        </div>
        <span class="commit-action">查看改动 <span aria-hidden="true">→</span></span>
      </div>
    `;
  }

  /* ===== Review 弹窗 ===== */

  function openReview(index) {
    const commits = filteredCommits();
    if (!commits[index]) return;
    state.activeCommitIndex = index;
    state.activeFile = 0;
    state.lastTrigger = document.activeElement;
    closeBranch();
    renderReview();
    els.reviewBackdrop.hidden = false;
    document.body.classList.add("modal-open");
    els.reviewDialog.focus();
  }

  function closeReview() {
    if (els.reviewBackdrop.hidden) return;
    els.reviewBackdrop.hidden = true;
    document.body.classList.remove("modal-open");
    const trigger = state.lastTrigger;
    state.lastTrigger = null;
    state.activeCommitIndex = -1;
    if (trigger && trigger.isConnected) trigger.focus();
  }

  function renderReview() {
    const item = currentCommit();
    if (!item) {
      closeReview();
      return;
    }

    els.reviewSubject.textContent = item.subject;
    els.reviewMeta.textContent = `${item.short} · ${item.author} · ${fmtDateTime(item.iso)} · ${item.refs[0] || ""}`;
    els.reviewMeta.title = item.hash;

    const commits = filteredCommits();
    els.prevCommit.disabled = state.activeCommitIndex <= 0;
    els.nextCommit.disabled = state.activeCommitIndex >= commits.length - 1;

    state.activeFile = Math.min(state.activeFile, Math.max(item.files.length - 1, 0));
    renderFiles(item);
    renderDiff(item);
  }

  function renderFiles(item) {
    els.fileCountHead.textContent = item.files.length;
    if (!item.files.length) {
      els.fileList.innerHTML = "";
      els.fileCountFoot.textContent = "文件 0 / 0";
      return;
    }

    els.fileList.innerHTML = item.files.map((file, index) => {
      const active = index === state.activeFile;
      return `
        <button type="button" class="file-row ${active ? "active" : ""}" data-file="${index}"
          title="${escapeHtml(file.path)}" aria-pressed="${active}">
          <span class="file-status ${file.status.toLowerCase()}">${file.status}</span>
          <span class="file-name">${escapeHtml(file.path)}</span>
          <span class="file-stat">+${file.add} −${file.del}</span>
        </button>
      `;
    }).join("");

    els.fileCountFoot.textContent = `文件 ${state.activeFile + 1} / ${item.files.length}`;
  }

  function renderDiffToolbar() {
    els.diffToolbar.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === state.diffView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const wrapButton = els.diffToolbar.querySelector("[data-wrap]");
    wrapButton.classList.toggle("active", state.wrap);
    wrapButton.setAttribute("aria-pressed", String(state.wrap));
  }

  function renderDiff(item) {
    const file = item.files[state.activeFile];
    els.diffPane.classList.toggle("wrap", state.wrap);
    renderDiffToolbar();

    els.diffContent.classList.remove("swap");
    void els.diffContent.offsetWidth;

    const html = !file
      ? '<div class="diff-empty">这个提交没有文件改动</div>'
      : (state.diffView === "split" ? renderSplit(file) : renderUnified(file));

    els.diffContent.innerHTML = html;
    els.diffContent.classList.add("swap");
  }

  function hunkStart(header, index) {
    const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (!match) return 1;
    return Number(match[index]);
  }

  function diffLine(type, oldNo, newNo, text) {
    const sign = type === "add" ? "+" : type === "del" ? "-" : " ";
    return `<div class="diff-line ${type}"><span class="ln">${oldNo}</span><span class="ln">${newNo}</span><span class="sign">${sign}</span><span class="code">${highlightCode(text)}</span></div>`;
  }

  function renderUnified(file) {
    let html = '<div class="diff-scroll">';
    file.hunks.forEach((hunk) => {
      html += `<div class="hunk">${escapeHtml(hunk.header)}</div>`;
      let oldNo = hunkStart(hunk.header, 1);
      let newNo = hunkStart(hunk.header, 2);
      hunk.lines.forEach((raw) => {
        const type = raw.charAt(0);
        const text = raw.slice(1);
        if (type === "+") {
          html += diffLine("add", "", newNo, text);
          newNo += 1;
        } else if (type === "-") {
          html += diffLine("del", oldNo, "", text);
          oldNo += 1;
        } else {
          html += diffLine("ctx", oldNo, newNo, text);
          oldNo += 1;
          newNo += 1;
        }
      });
    });
    html += "</div>";
    return html;
  }

  function splitLine(type, lineNo, text) {
    const sign = type === "add" ? "+" : type === "del" ? "-" : " ";
    return `<div class="split-line ${type}"><span class="ln">${lineNo}</span><span class="sign">${sign}</span><span class="code">${highlightCode(text)}</span></div>`;
  }

  function splitBlank() {
    return '<div class="split-line blank"><span class="ln">0</span><span class="sign"></span><span class="code"></span></div>';
  }

  function renderSplit(file) {
    let oldRows = "";
    let newRows = "";
    file.hunks.forEach((hunk) => {
      oldRows += `<div class="hunk">${escapeHtml(hunk.header)}</div>`;
      newRows += `<div class="hunk">${escapeHtml(hunk.header)}</div>`;
      let oldNo = hunkStart(hunk.header, 1);
      let newNo = hunkStart(hunk.header, 2);
      hunk.lines.forEach((raw) => {
        const type = raw.charAt(0);
        const text = raw.slice(1);
        if (type === "+") {
          oldRows += splitBlank();
          newRows += splitLine("add", newNo, text);
          newNo += 1;
        } else if (type === "-") {
          oldRows += splitLine("del", oldNo, text);
          newRows += splitBlank();
          oldNo += 1;
        } else {
          oldRows += splitLine("ctx", oldNo, text);
          newRows += splitLine("ctx", newNo, text);
          oldNo += 1;
          newNo += 1;
        }
      });
    });
    return `<div class="diff-split"><div class="pane"><div class="pane-head">旧文件</div>${oldRows}</div><div class="pane"><div class="pane-head">新文件</div>${newRows}</div></div>`;
  }

  function stepCommit(delta) {
    const commits = filteredCommits();
    const next = state.activeCommitIndex + delta;
    if (next < 0 || next >= commits.length) return;
    state.activeCommitIndex = next;
    state.activeFile = 0;
    renderReview();
  }

  function stepFile(delta) {
    const item = currentCommit();
    if (!item || !item.files.length) return;
    const next = Math.max(0, Math.min(item.files.length - 1, state.activeFile + delta));
    if (next === state.activeFile) return;
    state.activeFile = next;
    renderFiles(item);
    renderDiff(item);
  }

  function setDiffView(view) {
    const item = currentCommit();
    if (!item) return;
    state.diffView = view;
    renderDiff(item);
  }

  function toggleWrap() {
    const item = currentCommit();
    if (!item) return;
    state.wrap = !state.wrap;
    renderDiff(item);
  }

  /* ===== 分支浮层 ===== */

  function renderBranchPopover() {
    const project = activeProject();
    const upstreamOf = (branch) => project.upstreams && project.upstreams[branch]
      ? `上游 ${project.upstreams[branch]}`
      : "未设置上游";

    const localRows = project.branches.map((branch) => {
      const active = state.branch === branch;
      const check = active ? '<span class="check" aria-hidden="true">✓</span>' : "";
      const activeAction = state.branchAction && state.branchAction.branch === branch
        ? state.branchAction.kind
        : null;
      const feedbackRow = state.branchFeedback && state.branchFeedback.branch === branch;
      const busyRow = Boolean(state.branchAction && state.branchAction.branch === branch);
      const rowClass = [
        active ? "active-row" : "",
        busyRow ? "busy" : "",
        feedbackRow ? "feedback" : "",
      ].filter(Boolean).join(" ");
      const disabled = state.branchAction ? "disabled" : "";

      const actions = feedbackRow
        ? `
          <div class="popover-actions">
            <span class="branch-done" role="status">${ICON_CHECK}已拉取</span>
          </div>
        `
        : busyRow
          ? `
            <div class="popover-actions">
              <span class="branch-loading" role="status">
                <span class="spinner" aria-hidden="true"></span>拉取中
              </span>
            </div>
          `
          : `
            <div class="popover-actions">
              <button type="button" class="branch-action"
                data-branch-action="pull" data-branch="${escapeHtml(branch)}" ${disabled}
                title="拉取 ${escapeHtml(branch)}" aria-label="拉取 ${escapeHtml(branch)}">${ICON_PULL}</button>
              <button type="button" class="branch-action"
                data-branch-more="true" data-branch="${escapeHtml(branch)}" data-remote="false" ${disabled}
                title="分支操作" aria-label="分支操作：${escapeHtml(branch)}"><span class="branch-more" aria-hidden="true">⋯</span></button>
            </div>
          `;

      return `
        <div class="popover-row ${rowClass}">
          <button type="button" class="popover-item ${active ? "active" : ""}"
            data-branch="${escapeHtml(branch)}" role="menuitemradio" aria-checked="${active}"
            title="${escapeHtml(`${branch} · ${upstreamOf(branch)}`)}">
            <span>${escapeHtml(branch)}</span>${check}
          </button>
          ${actions}
        </div>
      `;
    }).join("");

    const remoteRows = (project.remoteBranches || []).map((branch) => {
      return `
        <div class="popover-row">
          <button type="button" class="popover-item remote"
            data-branch-more="true" data-branch="${escapeHtml(branch)}" data-remote="true"
            title="远程分支">
            <span>${escapeHtml(branch)}</span>
          </button>
          <div class="popover-actions">
            <button type="button" class="branch-action"
              data-branch-more="true" data-branch="${escapeHtml(branch)}" data-remote="true"
              title="远程分支操作" aria-label="远程分支操作：${escapeHtml(branch)}">
              <span class="branch-more" aria-hidden="true">⋯</span>
            </button>
          </div>
        </div>
      `;
    }).join("");

    const allActive = state.branch === "all";
    els.branchPopover.innerHTML = `
      <div class="popover-head">本地分支</div>
      ${localRows}
      ${remoteRows ? `<div class="popover-subhead">远程分支</div>${remoteRows}` : ""}
      <div class="popover-subhead">范围</div>
      <div class="popover-row">
        <button type="button" class="popover-item ${allActive ? "active" : ""}"
          data-branch="all" role="menuitemradio" aria-checked="${allActive}">
          <span>所有分支</span>${allActive ? '<span class="check" aria-hidden="true">✓</span>' : ""}
        </button>
      </div>
    `;
  }

  function closeBranch() {
    els.branchPopover.hidden = true;
    els.branchBtn.setAttribute("aria-expanded", "false");
  }

  function toggleBranch() {
    if (!els.branchPopover.hidden) {
      closeBranch();
      return;
    }
    closeActionMenu(true);
    closeCommitMenu(true);
    closeStashPopover();
    renderBranchPopover();
    els.branchPopover.hidden = false;
    els.branchBtn.setAttribute("aria-expanded", "true");
  }

  function handleBranchAction(branch, kind) {
    if (state.branchAction) return;
    state.branchAction = { branch, kind };
    state.branchFeedback = null;
    renderBranchPopover();
    window.setTimeout(() => {
      if (!state.branchAction || state.branchAction.branch !== branch || state.branchAction.kind !== kind) return;
      state.branchAction = null;
      state.branchFeedback = { branch, kind };
      if (!els.branchPopover.hidden) renderBranchPopover();
      window.setTimeout(() => {
        if (!state.branchFeedback || state.branchFeedback.branch !== branch) return;
        state.branchFeedback = null;
        if (!els.branchPopover.hidden) renderBranchPopover();
      }, 500);
    }, 650);
  }

  function refreshBranchViews() {
    renderHeader();
    renderProjects();
    if (!els.branchPopover.hidden) renderBranchPopover();
  }

  async function copyText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      toast(successMessage);
    } catch {
      toast("复制失败");
    }
  }

  function branchUpstream(branch) {
    const project = activeProject();
    return (project.upstreams && project.upstreams[branch]) || "";
  }

  function openBranchMenu(branch, isRemote, trigger) {
    const project = activeProject();
    const current = project.branch === branch;
    const shortRemoteName = branch.split("/").slice(1).join("/");
    const items = isRemote
      ? [
        { id: "create-local", label: "从远程创建本地分支", hint: shortRemoteName },
        { id: "delete-remote", label: "删除远程分支", danger: true },
        { separator: true },
        { id: "copy-remote", label: "复制远程分支名" },
      ]
      : [
        { id: "checkout", label: "检出", hint: current ? "当前" : "", disabled: current },
        { id: "create", label: "从此分支新建…" },
        { id: "rename", label: "重命名…" },
        { id: "delete", label: "删除", danger: true, disabled: current },
        { separator: true },
        { id: "merge", label: "合并到当前分支", disabled: current },
        { id: "upstream", label: "设置上游…", hint: branchUpstream(branch) || "未设置" },
        { separator: true },
        { id: "copy", label: "复制分支名" },
      ];

    const rect = trigger.getBoundingClientRect();
    openActionMenu(rect.left, rect.bottom + 6, {
      header: `${isRemote ? "远程" : "本地"} · ${branch}`,
      items,
      trigger,
      onSelect: (actionId) => handleBranchMenuAction(branch, isRemote, actionId),
    });
  }

  function handleBranchMenuAction(branch, isRemote, actionId) {
    if (actionId === "checkout") return checkoutBranch(branch);
    if (actionId === "create") return promptBranchCreate(branch);
    if (actionId === "rename") return promptBranchRename(branch);
    if (actionId === "delete") return confirmBranchDelete(branch);
    if (actionId === "merge") return confirmBranchMerge(branch);
    if (actionId === "upstream") return chooseBranchUpstream(branch);
    if (actionId === "copy") return copyText(branch, "已复制分支名");
    if (actionId === "create-local") return promptCreateFromRemote(branch);
    if (actionId === "delete-remote") return confirmRemoteDelete(branch);
    if (actionId === "copy-remote") return copyText(branch, "已复制远程分支名");
  }

  function checkoutBranch(branch) {
    const project = activeProject();
    if (!project.branches.includes(branch) || project.branch === branch) return;

    project.branch = branch;
    state.branch = branch;
    state.activeCommitIndex = -1;
    closeBranch();
    closeActionMenu(true);
    refreshBranchViews();
    renderCommits("rows");
    toast(`已检出 ${branch}（原型）`);
  }

  function promptBranchCreate(baseBranch) {
    openActionDialog({
      title: "新建分支",
      description: `从 ${baseBranch} 创建并检出`,
      fields: [{ name: "name", label: "分支名", value: "", placeholder: "例如 feat/next-step" }],
      confirmText: "创建",
      onConfirm(values) {
        const project = activeProject();
        const name = values.name.trim();
        if (!name || /\s/.test(name)) {
          toast("分支名不能为空或含空格");
          return false;
        }
        if (project.branches.includes(name)) {
          toast("分支已存在");
          return false;
        }

        project.branches.push(name);
        project.upstreams = project.upstreams || {};
        project.upstreams[name] = "";
        project.branch = name;
        state.branch = name;
        state.activeCommitIndex = -1;
        closeBranch();
        refreshBranchViews();
        renderCommits("rows");
        toast(`已从 ${baseBranch} 新建并检出 ${name}（原型）`);
      },
    });
  }

  function promptBranchRename(oldName) {
    openActionDialog({
      title: "重命名分支",
      description: `本地分支 ${oldName}`,
      fields: [{ name: "name", label: "新名称", value: oldName }],
      confirmText: "保存",
      onConfirm(values) {
        const project = activeProject();
        const newName = values.name.trim();
        if (!newName || /\s/.test(newName)) {
          toast("分支名不能为空或含空格");
          return false;
        }
        if (newName !== oldName && project.branches.includes(newName)) {
          toast("分支已存在");
          return false;
        }
        if (newName === oldName) return;

        project.branches = project.branches.map((branch) => (branch === oldName ? newName : branch));
        if (project.upstreams && project.upstreams[oldName]) {
          project.upstreams[newName] = project.upstreams[oldName];
          delete project.upstreams[oldName];
        }
        if (project.branch === oldName) project.branch = newName;
        if (state.branch === oldName) state.branch = newName;
        project.commits.forEach((item) => {
          item.refs = item.refs.map((ref) => (ref === oldName ? newName : ref));
        });

        closeBranch();
        refreshBranchViews();
        renderCommits("rows");
        toast(`已重命名 ${oldName} 为 ${newName}（原型）`);
      },
    });
  }

  function confirmBranchDelete(branch) {
    const project = activeProject();
    if (project.branch === branch) {
      toast("不能删除当前分支");
      return;
    }

    openActionDialog({
      title: "删除分支",
      description: `删除本地分支 ${branch}，提交仍会保留。`,
      confirmText: "删除",
      danger: true,
      onConfirm() {
        project.branches = project.branches.filter((item) => item !== branch);
        if (project.upstreams) delete project.upstreams[branch];
        project.commits.forEach((item) => {
          item.refs = item.refs.filter((ref) => ref !== branch);
        });
        if (state.branch === branch) state.branch = project.branch;

        closeBranch();
        refreshBranchViews();
        renderCommits("rows");
        toast(`已删除分支 ${branch}（原型）`);
      },
    });
  }

  function confirmBranchMerge(branch) {
    const project = activeProject();
    if (project.branch === branch) return;

    openActionDialog({
      title: "合并分支",
      description: `将 ${branch} 合并到 ${project.branch}。`,
      confirmText: "合并",
      onConfirm() {
        closeBranch();
        closeActionMenu(true);
        if (branch === "beta") {
          startConflict({
            kind: "merge",
            source: branch,
            target: project.branch,
            files: [
              { path: "src/components/CommitList.vue", resolved: false },
              { path: "src/styles/tokens.css", resolved: false },
            ],
          });
          toast("合并发生冲突，需要处理");
        } else {
          toast(`已合并 ${branch} 到 ${project.branch}（原型）`);
        }
      },
    });
  }

  function chooseBranchUpstream(branch) {
    const project = activeProject();
    const remotes = project.remoteBranches || [];
    if (!remotes.length) {
      toast("没有可用的远程分支");
      return;
    }

    openActionDialog({
      title: "设置上游",
      description: `为 ${branch} 选择跟踪的远程分支。`,
      fields: [{
        name: "upstream",
        label: "远程分支",
        value: branchUpstream(branch) || remotes[0],
        options: remotes.map((remote) => ({ value: remote, label: remote })),
      }],
      confirmText: "保存",
      onConfirm(values) {
        project.upstreams = project.upstreams || {};
        project.upstreams[branch] = values.upstream;
        if (!els.branchPopover.hidden) renderBranchPopover();
        toast(`已将 ${branch} 的上游设为 ${values.upstream}（原型）`);
      },
    });
  }

  function promptCreateFromRemote(remote) {
    const shortName = remote.split("/").slice(1).join("/") || remote;
    openActionDialog({
      title: "从远程创建分支",
      description: `基于 ${remote} 创建本地分支并检出。`,
      fields: [{ name: "name", label: "本地分支名", value: shortName }],
      confirmText: "创建",
      onConfirm(values) {
        const project = activeProject();
        const name = values.name.trim();
        if (!name || /\s/.test(name)) {
          toast("分支名不能为空或含空格");
          return false;
        }
        if (project.branches.includes(name)) {
          toast("本地分支已存在");
          return false;
        }

        project.branches.push(name);
        project.upstreams = project.upstreams || {};
        project.upstreams[name] = remote;
        project.branch = name;
        state.branch = name;
        state.activeCommitIndex = -1;
        closeBranch();
        refreshBranchViews();
        renderCommits("rows");
        toast(`已从 ${remote} 创建并检出 ${name}（原型）`);
      },
    });
  }

  function confirmRemoteDelete(remote) {
    const project = activeProject();
    openActionDialog({
      title: "删除远程分支",
      description: `删除 ${remote}。本地分支不受影响。`,
      confirmText: "删除",
      danger: true,
      onConfirm() {
        project.remoteBranches = (project.remoteBranches || []).filter((branch) => branch !== remote);
        if (project.upstreams) {
          Object.keys(project.upstreams).forEach((branch) => {
            if (project.upstreams[branch] === remote) delete project.upstreams[branch];
          });
        }
        if (!els.branchPopover.hidden) renderBranchPopover();
        toast(`已删除远程分支 ${remote}（原型）`);
      },
    });
  }

  /* ===== 提交右键菜单 ===== */

  function openCommitMenu(event, index, row) {
    const item = filteredCommits()[index];
    if (!item) return;
    if (!els.contextMenu.hidden) closeCommitMenu(true);
    clearTimeout(menuCloseTimer);
    closeActionMenu(true);
    closeStashPopover();
    closeBranch();
    menuCommit = item;
    menuCommitIndex = index;
    menuTrigger = row;

    const menu = els.contextMenu;
    menu.classList.remove("open", "closing");
    menu.style.visibility = "hidden";
    menu.hidden = false;
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.innerHTML = `
      <div class="menu-header">
        <div class="menu-hash">${item.short}</div>
        <div class="menu-subject">${escapeHtml(item.subject)}</div>
      </div>
      <button type="button" class="menu-item" data-menu-action="view" role="menuitem">
        <span>查看改动</span><span class="hint">Enter</span>
      </button>
      <button type="button" class="menu-item" data-menu-action="cherry-pick" role="menuitem">
        <span>Cherry-pick 到当前分支</span><span class="hint"></span>
      </button>
      <button type="button" class="menu-item" data-menu-action="squash" role="menuitem">
        <span>压缩挑拣…</span><span class="hint"></span>
      </button>
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" data-menu-action="copy-short" role="menuitem">
        <span>复制短哈希</span><span class="hint">${item.short}</span>
      </button>
      <button type="button" class="menu-item" data-menu-action="copy-full" role="menuitem">
        <span>复制完整哈希</span><span class="hint"></span>
      </button>
      <button type="button" class="menu-item" data-menu-action="copy-message" role="menuitem">
        <span>复制提交信息</span><span class="hint"></span>
      </button>
      <button type="button" class="menu-item" data-menu-action="copy-author" role="menuitem">
        <span>复制作者</span><span class="hint"></span>
      </button>
    `;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    const x = Math.max(padding, Math.min(event.clientX, window.innerWidth - rect.width - padding));
    const y = Math.max(padding, Math.min(event.clientY, window.innerHeight - rect.height - padding));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "";

    void menu.offsetWidth;
    menu.classList.add("open");
    const first = menu.querySelector(".menu-item");
    if (first) first.focus();
  }

  function closeCommitMenu(immediate = false) {
    const menu = els.contextMenu;
    if (!menu || menu.hidden) return;
    const trigger = menuTrigger;
    menuTrigger = null;
    clearTimeout(menuCloseTimer);

    if (immediate) {
      menu.hidden = true;
      menu.classList.remove("open", "closing");
    } else {
      menu.classList.remove("open");
      menu.classList.add("closing");
      menuCloseTimer = window.setTimeout(() => {
        menu.hidden = true;
        menu.classList.remove("closing");
      }, 110);
    }

    if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function handleMenuKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommitMenu();
      return;
    }
    if (event.key === "Tab") {
      closeCommitMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(els.contextMenu.querySelectorAll(".menu-item"));
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + delta + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = Array.from(els.contextMenu.querySelectorAll(".menu-item"));
      if (!items.length) return;
      (event.key === "Home" ? items[0] : items[items.length - 1]).focus();
    }
  }

  async function copyMenuValue(button, value) {
    try {
      await navigator.clipboard.writeText(value);
      const hint = button.querySelector(".hint");
      if (hint) hint.innerHTML = `${ICON_CHECK}已复制`;
      button.classList.add("done");
      clearTimeout(menuCloseTimer);
      menuCloseTimer = window.setTimeout(() => closeCommitMenu(), 500);
    } catch {
      toast("复制失败");
      closeCommitMenu();
    }
  }

  /* ===== 通用操作菜单 ===== */

  function openActionMenu(x, y, options = {}) {
    if (!els.actionMenu) return;
    if (!els.contextMenu.hidden) closeCommitMenu(true);
    closeActionMenu(true);
    closeStashPopover();
    clearTimeout(actionMenuCloseTimer);

    actionMenuTrigger = options.trigger || document.activeElement;
    actionMenuItems = options.items || [];
    actionMenuOnSelect = options.onSelect || null;

    const menu = els.actionMenu;
    menu.classList.remove("open", "closing");
    menu.style.visibility = "hidden";
    menu.hidden = false;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const header = options.header
      ? `<div class="menu-header"><div class="menu-hash">${escapeHtml(options.header)}</div></div>`
      : "";

    menu.innerHTML = `${header}${actionMenuItems.map((item) => {
      if (item.separator) return '<div class="menu-sep"></div>';
      const hint = item.hint ? `<span class="hint">${escapeHtml(item.hint)}</span>` : "";
      const classes = ["menu-item", item.danger ? "danger" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-action-id="${escapeHtml(item.id)}"
        role="menuitem" ${item.disabled ? "disabled" : ""}>
        <span>${escapeHtml(item.label)}</span>${hint}
      </button>`;
    }).join("")}`;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(padding, Math.min(x, window.innerWidth - rect.width - padding));
    const top = Math.max(padding, Math.min(y, window.innerHeight - rect.height - padding));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";

    void menu.offsetWidth;
    menu.classList.add("open");
    const first = menu.querySelector(".menu-item:not(:disabled)");
    if (first) first.focus();
  }

  function closeActionMenu(immediate = false) {
    const menu = els.actionMenu;
    if (!menu || menu.hidden) return;
    const trigger = actionMenuTrigger;
    actionMenuTrigger = null;
    actionMenuOnSelect = null;
    clearTimeout(actionMenuCloseTimer);

    if (immediate) {
      menu.hidden = true;
      menu.classList.remove("open", "closing");
    } else {
      menu.classList.remove("open");
      menu.classList.add("closing");
      actionMenuCloseTimer = window.setTimeout(() => {
        menu.hidden = true;
        menu.classList.remove("closing");
      }, 110);
    }

    if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function handleActionMenuKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeActionMenu();
      return;
    }
    if (event.key === "Tab") {
      closeActionMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(els.actionMenu.querySelectorAll(".menu-item:not(:disabled)"));
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + delta + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = Array.from(els.actionMenu.querySelectorAll(".menu-item:not(:disabled)"));
      if (!items.length) return;
      (event.key === "Home" ? items[0] : items[items.length - 1]).focus();
    }
  }

  /* ===== 通用操作对话框 ===== */

  function openActionDialog(options = {}) {
    if (!els.actionBackdrop || !els.actionBackdrop.hidden) closeActionDialog();

    actionDialogTrigger = options.trigger || document.activeElement;
    actionDialogOnConfirm = options.onConfirm || null;

    els.actionDialog.classList.toggle("large", Boolean(options.large));
    els.actionTitle.textContent = options.title || "";
    els.actionDesc.textContent = options.description || "";
    els.actionCancel.textContent = options.cancelText || "取消";
    els.actionCancel.hidden = Boolean(options.hideCancel);
    els.actionConfirm.textContent = options.confirmText || "确定";
    els.actionConfirm.className = `action-btn ${options.danger ? "danger" : "primary"}`;
    els.actionConfirm.disabled = false;

    const fields = (options.fields || []).map((field) => {
      const label = `<span>${escapeHtml(field.label || "")}</span>`;
      if (Array.isArray(field.options)) {
        const choices = field.options.map((option) => {
          const selected = String(option.value) === String(field.value ?? "") ? " selected" : "";
          return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
        }).join("");
        return `<label class="action-field">${label}<select data-field="${escapeHtml(field.name)}">${choices}</select></label>`;
      }
      return `<label class="action-field">${label}<input data-field="${escapeHtml(field.name)}"
        type="${escapeHtml(field.type || "text")}" value="${escapeHtml(field.value ?? "")}"
        placeholder="${escapeHtml(field.placeholder || "")}" autocomplete="off" spellcheck="false"></label>`;
    }).join("");

    els.actionBody.innerHTML = `${fields}${options.bodyHtml || ""}`;
    els.actionBackdrop.hidden = false;
    els.actionDialog.scrollTop = 0;

    if (typeof options.onOpen === "function") options.onOpen(els.actionDialog);

    const firstField = els.actionBody.querySelector("input, select, textarea");
    if (firstField) {
      firstField.focus();
      if (firstField.select) firstField.select();
    } else {
      els.actionConfirm.focus();
    }
  }

  function actionDialogValues() {
    const values = {};
    els.actionBody.querySelectorAll("[data-field]").forEach((field) => {
      values[field.dataset.field] = field.value;
    });
    return values;
  }

  function closeActionDialog() {
    if (!els.actionBackdrop || els.actionBackdrop.hidden) return;
    els.actionBackdrop.hidden = true;
    els.actionDialog.classList.remove("large");
    els.actionBody.innerHTML = "";
    els.actionDesc.textContent = "";
    actionDialogOnConfirm = null;

    if (actionDialogTrigger && actionDialogTrigger.isConnected) {
      actionDialogTrigger.focus({ preventScroll: true });
    }
    actionDialogTrigger = null;
  }

  function confirmActionDialog() {
    const callback = actionDialogOnConfirm;
    if (!callback) {
      closeActionDialog();
      return;
    }
    const result = callback(actionDialogValues(), els.actionBody);
    if (result === false) return;
    closeActionDialog();
  }

  /* ===== 冲突处理 ===== */

  function conflictLabel() {
    if (!state.operation) return "冲突";
    return state.operation.kind === "cherry-pick" ? "挑拣冲突" : "合并冲突";
  }

  function conflictProgress() {
    const files = state.operation ? state.operation.files : [];
    return {
      resolved: files.filter((file) => file.resolved).length,
      total: files.length,
    };
  }

  function startConflict(operation) {
    state.operation = {
      ...operation,
      files: (operation.files || []).map((file) => ({ ...file, resolved: false })),
    };
    closeBranch();
    closeActionMenu(true);
    renderConflictBar();
    window.setTimeout(() => openConflictDialog(), 0);
  }

  function renderConflictBar() {
    if (!state.operation) {
      els.conflictBar.hidden = true;
      els.conflictBar.innerHTML = "";
      return;
    }

    const progress = conflictProgress();
    const allResolved = progress.resolved === progress.total;
    els.conflictBar.hidden = state.view === "settings";
    els.conflictBar.innerHTML = `
      <span class="conflict-state">${conflictLabel()}</span>
      <span class="conflict-info">${escapeHtml(state.operation.source)} 到 ${escapeHtml(state.operation.target)} · ${progress.resolved}/${progress.total} 已解决</span>
      <div class="conflict-bar-actions">
        <button type="button" data-conflict-action="view">查看冲突</button>
        <button type="button" class="primary" data-conflict-action="continue" ${allResolved ? "" : "disabled"}>继续</button>
        <button type="button" data-conflict-action="abort">中止</button>
      </div>
    `;
  }

  function openConflictDialog() {
    if (!state.operation) return;
    renderConflictDialog();
    els.conflictBackdrop.hidden = false;
    els.closeConflict.focus();
  }

  function closeConflictDialog() {
    els.conflictBackdrop.hidden = true;
  }

  function renderConflictDialog() {
    if (!state.operation) return;
    const progress = conflictProgress();
    const allResolved = progress.resolved === progress.total;

    els.conflictTitle.textContent = conflictLabel();
    els.conflictMeta.textContent = `${state.operation.source} 到 ${state.operation.target}`;
    els.conflictCount.textContent = `${progress.resolved}/${progress.total} 已解决`;
    els.continueConflict.disabled = !allResolved;
    els.conflictBody.innerHTML = state.operation.files.map((file, index) => `
      <div class="conflict-row ${file.resolved ? "resolved" : ""}">
        <span class="conflict-status">${file.resolved ? "OK" : "UU"}</span>
        <span class="conflict-path">${escapeHtml(file.path)}</span>
        ${file.resolved
          ? '<span class="conflict-resolved">已解决</span>'
          : `<button type="button" class="conflict-resolve" data-conflict-resolve="${index}">标记已解决</button>`}
      </div>
    `).join("");
  }

  function resolveConflictFile(index) {
    if (!state.operation || !state.operation.files[index]) return;
    state.operation.files[index].resolved = true;
    renderConflictBar();
    renderConflictDialog();
    const progress = conflictProgress();
    if (progress.resolved === progress.total) {
      toast("全部冲突已标记解决，可以继续");
    }
  }

  function continueConflict() {
    const progress = conflictProgress();
    if (!state.operation || progress.resolved !== progress.total) {
      toast("还有未解决的冲突");
      return;
    }
    state.operation = null;
    closeConflictDialog();
    renderConflictBar();
    toast("冲突已解决，操作继续（原型）");
  }

  function abortConflict() {
    if (!state.operation) return;
    openActionDialog({
      title: "中止当前操作",
      description: "中止后已解决的冲突标记也会丢弃。",
      confirmText: "中止",
      danger: true,
      onConfirm() {
        state.operation = null;
        closeConflictDialog();
        renderConflictBar();
        toast("已中止当前操作（原型）");
      },
    });
  }

  /* ===== 远程同步 ===== */

  function openSyncMenu(trigger) {
    const project = activeProject();
    closeBranch();
    closeStashPopover();
    const rect = trigger.getBoundingClientRect();
    openActionMenu(rect.left, rect.bottom + 6, {
      header: `远程 · ${project.branch}`,
      trigger,
      items: [
        { id: "fetch", label: "获取所有远程" },
        { id: "pull", label: "拉取当前分支" },
        { id: "push", label: "推送当前分支" },
        { separator: true },
        { id: "upstream", label: "设置当前分支上游…", hint: branchUpstream(project.branch) || "未设置" },
      ],
      onSelect: (actionId) => {
        if (actionId === "fetch") toast("已获取所有远程（原型）");
        if (actionId === "pull") toast(`已拉取 ${project.branch}（原型）`);
        if (actionId === "push") toast(`已推送 ${project.branch}（原型）`);
        if (actionId === "upstream") chooseBranchUpstream(project.branch);
      },
    });
  }

  /* ===== 储藏 ===== */

  function renderStashButton() {
    const project = activeProject();
    const count = (project.stashes || []).length;
    els.stashCount.textContent = String(count);
    els.stashBtn.classList.toggle("has-stashes", count > 0);
  }

  function closeStashPopover() {
    if (!els.stashPopover || els.stashPopover.hidden) return;
    els.stashPopover.hidden = true;
    els.stashBtn.setAttribute("aria-expanded", "false");
  }

  function openStashPopover() {
    closeActionMenu(true);
    closeCommitMenu(true);
    closeBranch();
    renderStashPopover();
    els.stashPopover.hidden = false;
    els.stashBtn.setAttribute("aria-expanded", "true");
  }

  function toggleStashPopover() {
    if (els.stashPopover.hidden) {
      openStashPopover();
    } else {
      closeStashPopover();
    }
  }

  function stashIcon(kind) {
    if (kind === "apply") {
      return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7M5 6.5 8 9.5l3-3"/><path d="M3 13.5h10"/></svg>`;
    }
    if (kind === "drop") {
      return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9"/><path d="M6.5 7v4M9.5 7v4"/></svg>`;
    }
    return `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4Z"/><circle cx="8" cy="8" r="1.8"/></svg>`;
  }

  function renderStashPopover() {
    const project = activeProject();
    const stashes = project.stashes || [];
    els.stashPopover.innerHTML = `
      <div class="stash-head">
        <span class="stash-title">储藏 · ${stashes.length}</span>
        <button type="button" class="stash-create" data-stash-action="create">新建储藏</button>
      </div>
      ${stashes.length
        ? stashes.map((stash, index) => `
          <div class="stash-row">
            <div class="stash-main">
              <div class="stash-message" title="${escapeHtml(stash.message)}">${escapeHtml(stash.message)}</div>
              <div class="stash-meta">${escapeHtml(stash.branch)} · ${escapeHtml(stash.hash)} · ${stash.files} 个文件</div>
            </div>
            <div class="stash-actions">
              <button type="button" class="stash-action" data-stash-action="apply" data-stash-index="${index}" title="应用" aria-label="应用储藏">${stashIcon("apply")}</button>
              <button type="button" class="stash-action" data-stash-action="view" data-stash-index="${index}" title="查看" aria-label="查看储藏">${stashIcon("view")}</button>
              <button type="button" class="stash-action" data-stash-action="drop" data-stash-index="${index}" title="删除" aria-label="删除储藏">${stashIcon("drop")}</button>
            </div>
          </div>
        `).join("")
        : '<div class="stash-empty">这个项目还没有储藏</div>'}
    `;
  }

  function defaultStashName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
    return `${activeProject().branch}-${stamp}`;
  }

  function promptCreateStash() {
    openActionDialog({
      title: "新建储藏",
      description: "把当前改动收起，之后可以再应用。",
      fields: [{ name: "message", label: "储藏名称", value: defaultStashName() }],
      confirmText: "储藏",
      onConfirm(values) {
        const project = activeProject();
        const message = values.message.trim();
        if (!message) {
          toast("储藏名称不能为空");
          return false;
        }
        project.stashes = project.stashes || [];
        project.stashes.unshift({
          message,
          branch: project.branch,
          hash: Math.random().toString(16).slice(2, 9),
          files: 2,
        });
        renderStashButton();
        renderStashPopover();
        toast("已新建储藏（原型）");
      },
    });
  }

  function applyStash(index) {
    const project = activeProject();
    const stash = (project.stashes || [])[index];
    if (!stash) return;
    toast(`已应用 ${stash.message}（原型）`);
  }

  function viewStash(index) {
    const project = activeProject();
    const stash = (project.stashes || [])[index];
    if (!stash) return;
    openActionDialog({
      title: "储藏详情",
      description: `${stash.message} · ${stash.branch}`,
      hideCancel: true,
      confirmText: "关闭",
      bodyHtml: `
        <div class="squash-note">${escapeHtml(stash.hash)} · ${stash.files} 个文件</div>
        <div class="squash-list">
          <div class="squash-row"><span class="squash-copy"><span class="squash-subject">src/components/CommitList.vue</span><span class="squash-meta">M · +12 −4</span></span></div>
          <div class="squash-row"><span class="squash-copy"><span class="squash-subject">src/styles/tokens.css</span><span class="squash-meta">M · +6 −2</span></span></div>
        </div>
      `,
    });
  }

  function dropStash(index) {
    const project = activeProject();
    const stash = (project.stashes || [])[index];
    if (!stash) return;
    openActionDialog({
      title: "删除储藏",
      description: `删除 ${stash.message}，无法恢复。`,
      confirmText: "删除",
      danger: true,
      onConfirm() {
        project.stashes.splice(index, 1);
        renderStashButton();
        renderStashPopover();
        toast("已删除储藏（原型）");
      },
    });
  }

  /* ===== 挑选 ===== */

  function cherryPickCommit(item) {
    if (!item) return;
    const isMerge = item.subject.startsWith("Merge");
    if (isMerge) {
      startConflict({
        kind: "cherry-pick",
        source: item.short,
        target: activeProject().branch,
        files: [{ path: "src/App.vue", resolved: false }],
      });
      toast("Cherry-pick 发生冲突，需要处理");
      return;
    }
    toast(`已 Cherry-pick ${item.short}（原型）`);
  }

  function openSquashDialog() {
    const commits = filteredCommits().slice(0, 12);
    const project = activeProject();
    const rows = commits.map((item, index) => `
      <label class="squash-row">
        <input type="checkbox" data-squash-index="${index}">
        <span class="squash-copy">
          <span class="squash-subject">${escapeHtml(item.subject)}</span>
          <span class="squash-meta">${escapeHtml(item.short)} · ${escapeHtml(item.author)}</span>
        </span>
      </label>
    `).join("");

    openActionDialog({
      title: "压缩挑拣",
      description: `从 ${project.branch} 选择提交，压缩成一个新提交。`,
      large: true,
      confirmText: "开始挑拣",
      bodyHtml: `
        <div class="squash-note">源分支 ${escapeHtml(project.branch)} · 最多 12 条</div>
        <div class="squash-list">${rows || '<div class="squash-empty">当前分支没有可挑拣的提交</div>'}</div>
        <label class="action-field"><span>新提交信息</span><textarea data-field="message" placeholder="压缩后的提交信息"></textarea></label>
      `,
      onOpen() {
        const checkboxes = Array.from(els.actionBody.querySelectorAll("[data-squash-index]"));
        checkboxes.forEach((checkbox) => {
          checkbox.addEventListener("change", () => {
            els.actionConfirm.disabled = !checkboxes.some((item) => item.checked);
          });
        });
        els.actionConfirm.disabled = true;
      },
      onConfirm(values) {
        const selected = Array.from(els.actionBody.querySelectorAll("[data-squash-index]"))
          .filter((checkbox) => checkbox.checked);
        if (!selected.length) {
          toast("至少选择一个提交");
          return false;
        }
        const message = (values.message || "").trim();
        toast(`已压缩挑拣 ${selected.length} 个提交${message ? `：${message}` : ""}（原型）`);
      },
    });
  }

  /* ===== 设置页 ===== */

  function openSettings() {
    closeCommitMenu(true);
    closeActionMenu(true);
    closeStashPopover();
    closeConflictDialog();
    state.view = "settings";
    state.activeCommitIndex = -1;
    closeReview();
    closeBranch();
    renderView();
  }

  function backToCommits() {
    state.view = "commits";
    renderView();
  }

  function renderCodePreview() {
    const lines = [
      { type: "hunk", text: "@@ -12,7 +12,9 @@" },
      { type: "del", no: 12, text: "const rows = computed(() => commits.value)" },
      { type: "add", no: 12, text: "const rows = computed(() => visibleCommits.value)" },
      { type: "add", no: 13, text: "const reviewOpen = ref(false)" },
    ];
    return `
      <div class="code-preview">
        <div class="preview-bar">
          <span>对比视图 · 跟随主题</span>
          <span class="preview-meta">src/components/CommitList.vue</span>
        </div>
        <div class="preview-code">
          ${lines.map((line) => {
            if (line.type === "hunk") {
              return `<div class="preview-line hunk">${escapeHtml(line.text)}</div>`;
            }
            const sign = line.type === "add" ? "+" : "-";
            return `<div class="preview-line ${line.type}"><span class="ln">${line.no}</span><span class="sign">${sign}</span><span class="code">${highlightCode(line.text)}</span></div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderSettingsPreservingScroll() {
    const scrollTop = els.settingsView.scrollTop;
    renderSettings();
    els.settingsView.scrollTop = scrollTop;
  }

  function renderSettings() {
    const themeOptions = [
      ["system", "跟随系统"],
      ["light", "浅色"],
      ["dark", "深色"],
    ];
    const densityOptions = [
      ["comfortable", "舒适 56"],
      ["compact", "紧凑 48"],
    ];

    els.settingsView.innerHTML = `
      <div class="settings-page">
        <div class="settings-sections">
          <section class="settings-section">
            <h2>外观</h2>
            <div class="setting-row">
              <div class="setting-copy">
                <div class="setting-title">主题</div>
                <div class="setting-desc">跟随系统，或固定浅色 / 深色。切换即时生效。</div>
              </div>
              <div class="segmented" role="group" aria-label="主题">
                ${themeOptions.map(([value, label]) => `
                  <button type="button" data-theme-mode="${value}"
                    class="${state.themeMode === value ? "active" : ""}"
                    aria-pressed="${state.themeMode === value}">${label}</button>
                `).join("")}
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-copy">
                <div class="setting-title">代码对比</div>
                <div class="setting-desc">语法高亮和差异底色跟随界面主题，使用暖色代码配色。</div>
              </div>
              <span class="setting-value">跟随主题</span>
            </div>
            ${renderCodePreview()}
          </section>

          <section class="settings-section">
            <h2>布局</h2>
            <div class="setting-row">
              <div class="setting-copy">
                <div class="setting-title">提交行高</div>
                <div class="setting-desc">舒适适合阅读，紧凑适合小窗口。</div>
              </div>
              <div class="segmented" role="group" aria-label="提交行高">
                ${densityOptions.map(([value, label]) => `
                  <button type="button" data-density="${value}"
                    class="${state.density === value ? "active" : ""}"
                    aria-pressed="${state.density === value}">${label}</button>
                `).join("")}
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h2>关于</h2>
            <div class="setting-row">
              <div class="setting-copy">
                <div class="setting-title">版本</div>
                <div class="setting-desc">静态原型，提交与差异为演示数据。</div>
              </div>
              <span class="setting-value">0.3.0</span>
            </div>
            <div class="setting-row">
              <div class="setting-copy">
                <div class="setting-title">GitTrail</div>
                <div class="setting-desc">本地 Git 客户端重写分支 feat/ui-rewrite。</div>
              </div>
              <span class="setting-value">prototype</span>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  /* ===== 通用交互 ===== */

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  function focusSearch() {
    if (state.view !== "commits") return;
    els.searchInput.focus();
    els.searchInput.select();
  }

  function clearSearch() {
    state.query = "";
    els.searchInput.value = "";
    els.searchClear.hidden = true;
    state.activeCommitIndex = -1;
    renderCommits("fade");
    focusSearch();
  }

  function moveFocus(delta) {
    if (state.view !== "commits") return;
    const rows = Array.from(els.commitScroll.querySelectorAll(".commit-row"));
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement);
    let next = current === -1 ? (delta > 0 ? 0 : rows.length - 1) : current + delta;
    next = Math.max(0, Math.min(rows.length - 1, next));
    rows[next].focus();
    rows[next].scrollIntoView({ block: "nearest" });
  }

  function updateRailButton() {
    const rail = els.app.classList.contains("rail");
    els.railToggle.setAttribute("aria-expanded", String(!rail));
    els.railToggle.setAttribute("aria-label", rail ? "展开项目栏" : "折叠项目栏");
    els.railToggle.title = rail ? "展开项目栏" : "折叠项目栏";
  }

  function syncRail() {
    if (railUserSet) return;
    els.app.classList.toggle("rail", window.innerWidth < 1100);
    updateRailButton();
  }

  function trapTab(event) {
    const focusables = Array.from(
      els.reviewDialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((element) => element.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === els.reviewDialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleModalKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeReview();
      return;
    }
    if (event.key === "Tab") {
      trapTab(event);
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      stepCommit(-1);
      return;
    }
    if (event.key === "]") {
      event.preventDefault();
      stepCommit(1);
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      stepFile(1);
    } else if (key === "p") {
      event.preventDefault();
      stepFile(-1);
    } else if (key === "u") {
      event.preventDefault();
      setDiffView("unified");
    } else if (key === "s") {
      event.preventDefault();
      setDiffView("split");
    } else if (key === "w") {
      event.preventDefault();
      toggleWrap();
    }
  }

  /* ===== 事件绑定 ===== */

  els.projectList.addEventListener("click", (event) => {
    if (projectDidDrag) {
      projectDidDrag = false;
      return;
    }
    const row = event.target.closest(".project");
    if (!row) return;
    selectProject(row.dataset.project);
  });

  els.projectList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".project");
    if (!row) return;
    event.preventDefault();
    selectProject(row.dataset.project);
  });

  els.projectList.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".project");
    if (!row) return;
    event.preventDefault();
    closeBranch();
    closeStashPopover();
    closeCommitMenu(true);
    const project = PROJECTS.find((item) => item.id === row.dataset.project);
    if (project) openProjectMenu(event, project, row);
  });

  els.projectList.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".project");
    if (!row) return;
    projectDragId = row.dataset.project;
    projectDidDrag = true;
    row.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", projectDragId);
    }
  });

  els.projectList.addEventListener("dragover", (event) => {
    const row = event.target.closest(".project");
    if (!row || !projectDragId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    els.projectList.querySelectorAll(".project.drag-over").forEach((item) => item.classList.remove("drag-over"));
    if (row.dataset.project !== projectDragId) row.classList.add("drag-over");
  });

  els.projectList.addEventListener("dragleave", (event) => {
    const row = event.target.closest(".project");
    if (row) row.classList.remove("drag-over");
  });

  els.projectList.addEventListener("drop", (event) => {
    const row = event.target.closest(".project");
    if (!row || !projectDragId) return;
    event.preventDefault();

    const targetId = row.dataset.project;
    if (targetId !== projectDragId) {
      const fromIndex = PROJECTS.findIndex((project) => project.id === projectDragId);
      const targetIndex = PROJECTS.findIndex((project) => project.id === targetId);
      if (fromIndex >= 0 && targetIndex >= 0) {
        const [moved] = PROJECTS.splice(fromIndex, 1);
        const insertAt = PROJECTS.findIndex((project) => project.id === targetId);
        PROJECTS.splice(insertAt, 0, moved);
        persistProjectLayout();
        renderProjects();
        filterProjects();
        toast("已调整项目顺序");
      }
    }

    projectDragId = null;
    els.projectList.querySelectorAll(".project.dragging, .project.drag-over").forEach((item) => {
      item.classList.remove("dragging", "drag-over");
    });
  });

  els.projectList.addEventListener("dragend", () => {
    projectDragId = null;
    els.projectList.querySelectorAll(".project.dragging, .project.drag-over").forEach((item) => {
      item.classList.remove("dragging", "drag-over");
    });
    window.setTimeout(() => {
      projectDidDrag = false;
    }, 80);
  });

  els.projectSearch.addEventListener("input", filterProjects);

  els.railToggle.addEventListener("click", () => {
    railUserSet = true;
    els.app.classList.toggle("rail");
    updateRailButton();
  });

  els.addProject.addEventListener("click", () => toast("原型：接入文件夹选择器"));
  els.settingsBtn.addEventListener("click", () => {
    if (state.view === "settings") {
      backToCommits();
    } else {
      openSettings();
    }
  });
  els.themeToggle.addEventListener("click", toggleTheme);

  els.projectTitle.addEventListener("dblclick", () => toast("原型：双击标题可最大化窗口"));

  document.querySelectorAll("[data-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.window;
      const label = action === "minimize" ? "最小化" : action === "maximize" ? "最大化" : "关闭";
      toast(`原型：${label}窗口`);
    });
  });

  els.branchBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleBranch();
  });

  els.branchPopover.addEventListener("click", (event) => {
    const more = event.target.closest("[data-branch-more]");
    if (more) {
      event.stopPropagation();
      openBranchMenu(more.dataset.branch, more.dataset.remote === "true", more);
      return;
    }
    const action = event.target.closest("[data-branch-action]");
    if (action) {
      event.stopPropagation();
      handleBranchAction(action.dataset.branch, action.dataset.branchAction);
      return;
    }
    const item = event.target.closest("[data-branch]");
    if (!item) return;
    closeCommitMenu(true);
    closeActionMenu(true);
    closeStashPopover();
    state.branch = item.dataset.branch;
    state.activeCommitIndex = -1;
    state.branchAction = null;
    state.branchFeedback = null;
    closeBranch();
    renderHeader();
    renderCommits("rows");
  });

  document.addEventListener("click", (event) => {
    if (els.branchPopover.hidden) return;
    if (!event.target.closest(".branch-wrap")) closeBranch();
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    els.searchClear.hidden = !state.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.activeCommitIndex = -1;
      renderCommits("fade");
    }, 160);
  });

  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(searchTimer);
      state.activeCommitIndex = -1;
      renderCommits("fade");
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
    }
  });

  els.searchClear.addEventListener("click", clearSearch);

  els.commitScroll.addEventListener("click", (event) => {
    const loadMore = event.target.closest(".load-more");
    if (loadMore) {
      loadMore.disabled = true;
      loadMore.textContent = "已经是最早的提交";
      return;
    }
    const clearButton = event.target.closest('[data-action="clear-search"]');
    if (clearButton) {
      clearSearch();
      return;
    }
    const row = event.target.closest(".commit-row");
    if (!row) return;
    openReview(Number(row.dataset.index));
  });

  els.commitScroll.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".commit-row");
    if (!row) return;
    event.preventDefault();
    openReview(Number(row.dataset.index));
  });

  els.commitScroll.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".commit-row");
    if (!row) return;
    event.preventDefault();
    openCommitMenu(event, Number(row.dataset.index), row);
  });

  els.contextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-action]");
    if (!button || !menuCommit) return;
    const action = button.dataset.menuAction;

    if (action === "view") {
      const index = menuCommitIndex;
      closeCommitMenu(true);
      if (index >= 0) openReview(index);
      return;
    }

    if (action === "cherry-pick") {
      const item = menuCommit;
      closeCommitMenu(true);
      cherryPickCommit(item);
      return;
    }

    if (action === "squash") {
      closeCommitMenu(true);
      openSquashDialog();
      return;
    }

    const value = action === "copy-short" ? menuCommit.short
      : action === "copy-full" ? menuCommit.hash
        : action === "copy-message" ? menuCommit.subject
          : menuCommit.author;
    copyMenuValue(button, value);
  });

  els.contextMenu.addEventListener("keydown", handleMenuKey);

  els.actionMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action-id]");
    if (!button || button.disabled) return;
    const actionId = button.dataset.actionId;
    const callback = actionMenuOnSelect;
    closeActionMenu(true);
    if (callback) callback(actionId);
  });

  els.actionMenu.addEventListener("keydown", handleActionMenuKey);

  els.actionCancel.addEventListener("click", closeActionDialog);
  els.actionConfirm.addEventListener("click", confirmActionDialog);

  els.actionBackdrop.addEventListener("click", (event) => {
    if (event.target === els.actionBackdrop) closeActionDialog();
  });

  els.actionBackdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeActionDialog();
    }
  });

  els.syncBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openSyncMenu(els.syncBtn);
  });

  els.stashBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleStashPopover();
  });

  els.stashPopover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stash-action]");
    if (!button) return;
    const action = button.dataset.stashAction;
    if (action === "create") promptCreateStash();
    if (action === "apply") applyStash(Number(button.dataset.stashIndex));
    if (action === "view") viewStash(Number(button.dataset.stashIndex));
    if (action === "drop") dropStash(Number(button.dataset.stashIndex));
  });

  document.addEventListener("click", (event) => {
    if (els.stashPopover.hidden) return;
    if (!event.target.closest(".stash-wrap")) closeStashPopover();
  });

  els.conflictBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conflict-action]");
    if (!button) return;
    const action = button.dataset.conflictAction;
    if (action === "view") openConflictDialog();
    if (action === "continue") continueConflict();
    if (action === "abort") abortConflict();
  });

  els.conflictBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conflict-resolve]");
    if (!button) return;
    resolveConflictFile(Number(button.dataset.conflictResolve));
  });

  els.closeConflict.addEventListener("click", closeConflictDialog);
  els.checkConflictMarkers.addEventListener("click", () => toast("检查完成，未发现残留冲突标记（原型）"));
  els.abortConflict.addEventListener("click", abortConflict);
  els.continueConflict.addEventListener("click", continueConflict);

  els.conflictBackdrop.addEventListener("click", (event) => {
    if (event.target === els.conflictBackdrop) closeConflictDialog();
  });

  els.conflictBackdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeConflictDialog();
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (!els.contextMenu.hidden && !event.target.closest(".context-menu")) closeCommitMenu();
    if (!els.actionMenu.hidden && !event.target.closest(".context-menu")) closeActionMenu();
  });

  window.addEventListener("scroll", () => {
    if (!els.contextMenu.hidden) closeCommitMenu(true);
    if (!els.actionMenu.hidden) closeActionMenu(true);
  }, true);

  els.closeReview.addEventListener("click", closeReview);

  els.reviewBackdrop.addEventListener("click", (event) => {
    if (event.target === els.reviewBackdrop) closeReview();
  });

  els.copyHash.addEventListener("click", async () => {
    const item = currentCommit();
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.hash);
      els.copyHash.innerHTML = `${ICON_CHECK}已复制`;
      els.copyHash.classList.add("done");
      clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        els.copyHash.textContent = COPY_LABEL;
        els.copyHash.classList.remove("done");
      }, 500);
    } catch {
      toast("请手动选择哈希");
    }
  });

  els.prevCommit.addEventListener("click", () => stepCommit(-1));
  els.nextCommit.addEventListener("click", () => stepCommit(1));

  els.fileList.addEventListener("click", (event) => {
    const row = event.target.closest(".file-row");
    if (!row) return;
    state.activeFile = Number(row.dataset.file);
    const item = currentCommit();
    if (!item) return;
    renderFiles(item);
    renderDiff(item);
  });

  els.diffToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.view) {
      setDiffView(button.dataset.view);
    } else if (button.dataset.wrap) {
      toggleWrap();
    }
  });

  els.settingsView.addEventListener("click", (event) => {
    const themeButton = event.target.closest("[data-theme-mode]");
    if (themeButton) {
      setThemeMode(themeButton.dataset.themeMode);
      return;
    }
    const densityButton = event.target.closest("[data-density]");
    if (densityButton) {
      setDensity(densityButton.dataset.density);
    }
  });

  themeMedia.addEventListener("change", () => {
    if (state.themeMode !== "system") return;
    applyTheme(true);
    if (state.view === "settings") renderSettingsPreservingScroll();
  });

  document.addEventListener("keydown", (event) => {
    if (!els.actionBackdrop.hidden || !els.conflictBackdrop.hidden) return;
    if (!els.reviewBackdrop.hidden) {
      handleModalKey(event);
      return;
    }

    const target = event.target;
    const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    if (event.key === "Escape") {
      if (!els.stashPopover.hidden) {
        closeStashPopover();
        return;
      }
      if (!els.branchPopover.hidden) {
        closeBranch();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (event.key === "/" && !inField) {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (inField) return;

    if (event.key === "Escape") {
      if (state.view === "settings") {
        backToCommits();
      } else {
        closeBranch();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  });

  window.addEventListener("resize", () => {
    closeCommitMenu(true);
    closeActionMenu(true);
    closeStashPopover();
    syncRail();
  });

  /* ===== 启动 ===== */

  state.themeMode = readStored(THEME_KEY) || "system";
  state.density = readStored(DENSITY_KEY) || "comfortable";
  applyTheme();
  applyDensity();
  loadProjectLayout();

  renderProjects();
  filterProjects();
  renderView();
  syncRail();
})();
