<!--
  @component ThinkingOrb
  @description
    点阵思维球加载指示器（working/orbits 态）-- 12 条倾斜轨道 x 40 幽灵点 + 每轨 3 粒子。
    算法移植自 thinking-orbs（MIT, Jakub Antalik），纯 2D canvas、z 排序单色墨色，
    与 index.html 启动画面共用同一套参数。
  @props
    size  - 画布边长（px），默认 64
    theme - "auto"（跟随 documentElement 的 data-theme）| "dark" | "light"
    speed - 速度倍率，默认 1.885（官方 64px working 预设）
  @changeLog
    - 2026-08-07: Created. 启动画面 orb 的组件化沉淀。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    size?: number;
    theme?: "auto" | "dark" | "light";
    speed?: number;
  }>(),
  { size: 64, theme: "auto", speed: 1.885 }
);

const canvasEl = ref<HTMLCanvasElement | null>(null);

// orbits 模式基础参数（64px 基准 profile）
const orbitN = 12, ghostN = 40, ghostR = 0.9, ghostA = 0.5;
const particles = 3, partR = 1.2, partRDepth = 1.6, rsPow = 0.6, rMin = 0.3;

function hashD(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** 自转 + 倾斜 + 正交投影 */
function makeProj(yaw: number, tilt: number, cx: number, cy: number, scale: number) {
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  const sy = Math.sin(yaw), cyw = Math.cos(yaw);
  return (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a: number;
}

function isDark(): boolean {
  if (props.theme === "dark") return true;
  if (props.theme === "light") return false;
  return document.documentElement.getAttribute("data-theme") !== "light";
}

let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let start = 0;

function draw(t: number) {
  if (!ctx) return;
  const size = props.size;
  ctx.clearRect(0, 0, size, size);
  const dark = isDark();
  const cx = size / 2, cy = size / 2;
  const R = (size / 2) * 0.82;
  const pt = makeProj(t * 0.12, 0.3, cx, cy, 1);
  const rs = Math.pow(size / 300, rsPow);
  const dots: Dot[] = [];

  for (let orb = 0; orb < orbitN; orb++) {
    const h1 = hashD(orb, 1.7);
    const h2 = hashD(orb, 5.2);
    const h3 = hashD(orb, 8.9);
    const ro = R * (0.45 + 0.52 * h1);
    const th = h1 * 2 * Math.PI;
    const phi = Math.acos(2 * h2 - 1);
    const nx = Math.sin(phi) * Math.cos(th);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(th);
    let ux = -ny, uy = nx;
    const uz = 0;
    const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
    ux /= ul; uy /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);

    for (let k = 0; k < ghostN; k++) {
      const a = (k / ghostN) * 2 * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const p = pt(
        (ux * ca + vx * sa) * ro,
        (uy * ca + vy * sa) * ro,
        (uz * ca + vz * sa) * ro
      );
      const depth = (p[2] / ro + 1) / 2;
      dots.push({ x: p[0], y: p[1], z: p[2], r: ghostR * rs, white: 0.72, a: ghostA * (0.4 + 0.6 * depth) });
    }
    for (let m = 0; m < particles; m++) {
      const a2 = t * speed + (m / particles) * 2 * Math.PI + h2 * 6;
      const ca2 = Math.cos(a2), sa2 = Math.sin(a2);
      const p2 = pt(
        (ux * ca2 + vx * sa2) * ro,
        (uy * ca2 + vy * sa2) * ro,
        (uz * ca2 + vz * sa2) * ro
      );
      const depth2 = (p2[2] / ro + 1) / 2;
      dots.push({ x: p2[0], y: p2[1], z: p2[2], r: (partR + partRDepth * depth2) * rs, white: 0.3 - 0.22 * depth2, a: 1 });
    }
  }

  dots.sort((a, b) => a.z - b.z);
  for (const d of dots) {
    if (d.a < 0.02) continue;
    const w = Math.min(1, Math.max(0, d.white));
    const g = Math.round((dark ? 1 - w : w) * 255);
    ctx.fillStyle = `rgba(${g},${g},${g},${d.a})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, Math.max(rMin, d.r), 0, Math.PI * 2);
    ctx.fill();
  }
}

function setupCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = props.size * dpr;
  canvas.height = props.size * dpr;
  ctx = canvas.getContext("2d");
  ctx?.scale(dpr, dpr);
}

function startLoop() {
  stopLoop();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    draw(2.4); // 静态代表帧
    return;
  }
  start = performance.now();
  const loop = (now: number) => {
    draw(((now - start) / 1000) * props.speed);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// 标签页隐藏时暂停，恢复时续播
function onVisibility() {
  if (document.hidden) stopLoop();
  else startLoop();
}

onMounted(() => {
  setupCanvas();
  startLoop();
  document.addEventListener("visibilitychange", onVisibility);
});
onUnmounted(() => {
  stopLoop();
  document.removeEventListener("visibilitychange", onVisibility);
});

watch(() => props.size, () => {
  setupCanvas();
  draw(2.4);
});
</script>

<template>
  <canvas
    ref="canvasEl"
    class="thinking-orb"
    :style="{ width: size + 'px', height: size + 'px' }"
    role="img"
    aria-label="正在处理…"
  />
</template>

<style scoped>
.thinking-orb {
  display: block;
}
</style>
