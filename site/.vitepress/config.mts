import { defineConfig } from "vitepress";

// GitHub Pages 子路径部署（仓库 git-client）→ 站点地址 /git-client/
// 若以后用自定义域名，改为 "/"
const base = "/git-client/";

export default defineConfig({
  lang: "zh-CN",
  title: "GitTrail",
  description: "扁平化 · 暗色优先 · 纯中文的桌面 Git 客户端（Tauri 2 + Vue 3）",
  // 默认暗色优先（可切换）
  appearance: "dark",
  base,
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "首页", link: "/" },
      { text: "功能", link: "/features" },
      { text: "使用文档", link: "/guide/getting-started" },
      { text: "更新日志", link: "/changelog" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "使用文档",
          items: [{ text: "快速开始", link: "/guide/getting-started" }],
        },
      ],
    },
    docFooter: { prev: "上一篇", next: "下一篇" },
    outlineTitle: "本页目录",
    footer: {
      message: "GitTrail · 自用桌面 Git 客户端",
      copyright: "MIT License",
    },
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
          modal: { noResultsText: "未找到相关结果", footer: {} },
        },
      },
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/XiaMi-Long/git-client" },
    ],
  },
});
