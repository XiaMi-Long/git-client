import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");

// 应用就绪后淡出启动画面（最短停留 400ms，避免极速启动闪断）
setTimeout(() => {
  const splash = document.getElementById("boot-splash");
  if (!splash || (window as unknown as { __bootHidden?: boolean }).__bootHidden) return;
  (window as unknown as { __bootHidden?: boolean }).__bootHidden = true;
  splash.classList.add("boot-hide");
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  // 过渡未触发时的兜底移除
  setTimeout(() => splash.remove(), 600);
}, 400);
