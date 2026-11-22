// Draws the app icons (the rail's "HD" mark on the Midnight background) with headless Chrome.
// Run from the repo root: node tools/make-icons.mjs   (needs Google Chrome; installs nothing)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BG = "#05070c"; // Midnight --bg
const TEXT = "#eef2f8"; // Midnight --text
const ACCENT = "#5b9dff"; // Midnight --accent

// scale = how much of the icon the mark fills; the maskable icon keeps it inside the central safe zone.
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 0.5 },
  { file: "icon-512.png", size: 512, scale: 0.5 },
  { file: "maskable-512.png", size: 512, scale: 0.36 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.5 },
];

const page = ({ size, scale }) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${size}px;height:${size}px;background:${BG};overflow:hidden}
body{display:grid;place-items:center}
b{font:700 ${Math.round(size * scale)}px/1 "SF Mono",ui-monospace,Menlo,monospace;letter-spacing:-.04em;color:${TEXT}}
i{display:block;height:${Math.max(3, Math.round(size * 0.02))}px;margin:${Math.round(size * 0.03)}px auto 0;width:${Math.round(size * scale * 0.9)}px;background:${ACCENT};border-radius:99px}
div{text-align:center}
</style><div><b>HD</b><i></i></div>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
fs.mkdirSync("icons", { recursive: true });
for (const icon of ICONS) {
  const html = path.join(tmp, icon.file + ".html");
  fs.writeFileSync(html, page(icon));
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${icon.size},${icon.size}`, `--screenshot=${path.resolve("icons", icon.file)}`, "file://" + html], { stdio: "ignore" });
}
fs.rmSync(tmp, { recursive: true });
console.log("icons written to icons/");
