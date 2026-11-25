// Render the Planner's icons and share image from code (no stock or AI images).
//
//   node sites/giving-planner/scripts/render-assets.mjs
//
// Writes icons/icon-32.png, apple-touch-icon.png (180), icon-192.png, icon-512.png,
// icon-maskable-512.png, favicon.ico and og-image.png (1200x630).
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(root, "favicon.svg"), "utf8");
await mkdir(path.join(root, "icons"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function icon(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // A maskable icon keeps the art inside the middle 80% safe zone, on a full-bleed ground.
  const inner = maskable ? Math.round(size * 0.7) : size;
  await page.setContent(`<html><body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${maskable ? "#f3f8fc" : "transparent"}">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  return page.screenshot({ path: path.join(root, file), omitBackground: !maskable });
}

const png32 = await icon(32, "icons/icon-32.png");
await icon(180, "icons/apple-touch-icon.png", { maskable: true });
await icon(192, "icons/icon-192.png");
await icon(512, "icons/icon-512.png");
await icon(512, "icons/icon-maskable-512.png", { maskable: true });

// favicon.ico: one 32x32 PNG inside an ICO container.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0); entry.writeUInt8(32, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png32.length, 8); entry.writeUInt32LE(22, 12);
await writeFile(path.join(root, "favicon.ico"), Buffer.concat([header, entry, png32]));

// Share image: the headline and the twelve jars, in the site's own look.
const jars = Array.from({ length: 12 }, (_, i) => {
  const level = [0.35, 0.5, 0.62, 0.45, 0.7, 0.55, 0.4, 0.66, 0.5, 0.58, 0.72, 0.48][i];
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i];
  return `<div class="jar"><span class="lid"></span><span class="fill" style="height:${level * 100}%"></span><span class="m">${m}</span></div>`;
}).join("");
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600&family=Caveat:wght@600&family=Nunito:wght@700&display=swap">
<style>
  body{margin:0;width:1200px;height:630px;overflow:hidden;background:#f3f8fc;font-family:Nunito,sans-serif;color:#1f2f3d;position:relative}
  .blob{position:absolute;border-radius:46% 54% 42% 58%/55% 45% 55% 45%}
  .a{width:520px;height:440px;right:-120px;top:-140px;background:#d9f1e8}.b{width:360px;height:300px;left:-120px;bottom:-160px;background:#e2f0f8}
  .brand{position:absolute;left:72px;top:56px;display:flex;align-items:center;gap:14px;font:600 30px 'Baloo 2'}
  .dot{width:40px;height:40px;border-radius:50% 50% 46% 54%/60% 60% 40% 40%;background:radial-gradient(circle at 35% 30%,#ffd58a,#f2a93b 60%,#c97b0a)}
  h1{position:absolute;left:72px;top:118px;margin:0;width:1000px;font:600 60px/1.08 'Baloo 2';letter-spacing:-.01em}
  h1 span{background:linear-gradient(transparent 68%,rgba(242,169,59,.55) 68%)}
  .hand{position:absolute;left:76px;top:266px;font:600 34px Caveat;color:#0b5c56;transform:rotate(-2deg)}
  .jars{position:absolute;left:72px;right:72px;bottom:56px;display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
  .jar{position:relative;height:170px;border-radius:22px 22px 26px 26px;border:3px solid #f2a93b;background:#fff;overflow:hidden}
  .lid{position:absolute;top:0;left:20%;right:20%;height:10px;border-radius:0 0 10px 10px;background:#0f766e;z-index:2}
  .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,#ffd58a,#f2a93b)}
  .m{position:absolute;bottom:10px;left:0;right:0;text-align:center;font-weight:700;font-size:18px;z-index:2}
</style></head><body>
<div class="blob a"></div><div class="blob b"></div>
<div class="brand"><span class="dot"></span>Pune Giving Planner</div>
<h1>Plan a year of giving, then <span>ask the charity</span> what it does.</h1>
<div class="hand">your plan stays on your device</div>
<div class="jars">${jars}</div>
</body></html>`, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(root, "og-image.png") });
await browser.close();
console.log("Rendered icons, favicon.ico and og-image.png");
