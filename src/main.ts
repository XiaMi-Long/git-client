import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/main.css";

/**
 * 阻止正式环境显示 WebView 的原生浏览器右键菜单。
 * @param {MouseEvent} event - 用户触发的原生右键菜单事件
 * @returns {void} 无返回值
 */
function preventNativeContextMenu(event: MouseEvent): void {
  event.preventDefault();
}

if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", preventNativeContextMenu);
}

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
