// 生成测试图：一张线稿零件图 + 一张实心图标
import fs from 'node:fs';
import { encodePNG } from '../src/png.mjs';

function canvas(w, h, bg = 255) {
  const g = new Uint8Array(w * h).fill(bg);
  const px = (x, y, v = 0) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    g[y * w + x] = v;
  };
  const line = (x0, y0, x1, y1, t = 2, v = 0) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) px(x + dx, y + dy, v);
    }
  };
  const circle = (cx, cy, r, t = 2, v = 0) => {
    const n = Math.ceil(r * 8);
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2;
      for (let k = 0; k < t; k++) px(cx + Math.cos(a) * (r + k), cy + Math.sin(a) * (r + k), v);
    }
  };
  const rect = (x, y, ww, hh, t = 2) => { line(x, y, x + ww, y, t); line(x + ww, y, x + ww, y + hh, t); line(x + ww, y + hh, x, y + hh, t); line(x, y + hh, x, y, t); };
  return { g, w, h, px, line, circle, rect };
}
function save(file, W, H, g) {
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < g.length; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g[i]; }
  fs.writeFileSync(file, encodePNG(W, H, rgb));
}

// 1) 线稿：带孔的法兰板
{
  const c = canvas(900, 680);
  c.rect(80, 80, 740, 520, 3);
  c.circle(450, 340, 150, 3);
  c.circle(450, 340, 90, 2);
  c.circle(200, 200, 34, 2);
  c.circle(700, 200, 34, 2);
  c.circle(200, 480, 34, 2);
  c.circle(700, 480, 34, 2);
  c.line(450, 40, 450, 130, 1); c.line(450, 550, 450, 640, 1);
  c.line(20, 340, 110, 340, 1); c.line(790, 340, 880, 340, 1);
  c.line(120, 620, 780, 620, 2);
  c.line(120, 620, 120, 590, 1); c.line(780, 620, 780, 590, 1);
  save('/sdcard/dsh/img2cad/test/test-lineart.png', c.w, c.h, c.g);
}
// 2) 实心图案：齿轮状徽标
{
  const c = canvas(600, 600);
  const cx = 300, cy = 300, R = 200, r = 150;
  const teeth = 12;
  const p = (a, rr) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  const poly = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    poly.push(p(a0, R), p(a0 + step * 0.18, R), p(a0 + step * 0.32, r), p(a0 + step * 0.68, r), p(a0 + step * 0.82, R));
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    c.line(a[0], a[1], b[0], b[1], 3, 0);
  }
  // 内部挖空小圆
  c.circle(cx, cy, 45, 40, 255);
  save('/sdcard/dsh/img2cad/test/test-solid.png', c.w, c.h, c.g);
}
console.log('test images written');

// 3) 实心图形：五角星 + 圆孔（测试边界轮廓模式）
{
  const c = canvas(600, 600);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? 240 : 100;
    pts.push([300 + Math.cos(a) * rr, 300 + Math.sin(a) * rr]);
  }
  // 扫描线填充
  for (let y = 0; y < 600; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) c.px(x, y, 0);
    }
  }
  for (let y = 0; y < 600; y++) for (let x = 0; x < 600; x++) {
    const d = Math.hypot(x - 300, y - 300);
    if (d < 45) c.px(x, y, 255);
  }
  save('/sdcard/dsh/img2cad/test/test-filled.png', c.w, c.h, c.g);
}
console.log('filled test written');
