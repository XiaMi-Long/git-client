import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // Tauri 2 前端开发服务器配置
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 不监听 Rust 后端目录
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri 使用固定端口，构建时注入环境变量
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri 在桌面端使用 Chromium，支持现代 CSS
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
