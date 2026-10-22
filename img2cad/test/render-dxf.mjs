// 回读 DXF 并渲染成 PNG，用于目检
import fs from 'node:fs';
import { encodePNG } from '../src/png.mjs';

export function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
  const polys = [];
  let cur = null, inEnt = false, circle = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, val] = pairs[i];
    if (code === '0') {
      if (val === 'SECTION') { inEnt = pairs[i + 1] && pairs[i + 1][1] === 'ENTITIES'; continue; }
      if (val === 'POLYLINE') { cur = { pts: [], closed: false, layer: '' }; continue; }
      if (val === 'CIRCLE') { circle = { _c: {} }; continue; }
      if (val === 'VERTEX' && cur) { cur._v = {}; continue; }
      if (val === 'SEQEND') { if (cur) polys.push(cur); cur = null; continue; }
    }
    if (circle) {
      if (code === '10') circle._c.cx = Number(val);
      else if (code === '20') { circle._c.cy = Number(val); }
      else if (code === '40') { circle._c.r = Number(val); polys.push({ pts: [], circle: [circle._c.cx, circle._c.cy, circle._c.r], closed: true }); circle = null; }
      continue;
    }
    if (cur && code === '70' && !cur._v) cur.closed = (Number(val) & 1) === 1;
    if (cur && cur._v && code === '10') cur._v.x = Number(val);
    if (cur && cur._v && code === '20') { cur._v.y = Number(val); cur.pts.push([cur._v.x, cur._v.y]); cur._v = null; }
  }
  return polys;
}

export function render(file, out, scale = 1) {
  const polys = parseDXF(fs.readFileSync(file, 'utf8'));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of polys) {
    if (p.circle) {
      const [cx, cy, rr] = p.circle;
      minx = Math.min(minx, cx - rr); maxx = Math.max(maxx, cx + rr);
      miny = Math.min(miny, cy - rr); maxy = Math.max(maxy, cy + rr);
      continue;
    }
    for (const [x, y] of p.pts) {
      if (x < minx) minx = x; if (y < miny) miny = y;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    }
  }
  if (!isFinite(minx)) { minx = miny = 0; maxx = maxy = 1; }
  const pad = 10;
  const W = Math.round((maxx - minx) * scale) + pad * 2;
  const H = Math.round((maxy - miny) * scale) + pad * 2;
  const g = new Uint8Array(W * H).fill(255);
  const put = (x, y) => {
    const ix = Math.round((x - minx) * scale) + pad;
    const iy = Math.round((maxy - y) * scale) + pad;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = ix + dx, yy = iy + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) g[yy * W + xx] = 0;
    }
  };
  for (const p of polys) {
    if (p.circle) {
      const [cx, cy, rr] = p.circle;
      const n = Math.ceil(rr * 8);
      for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2; put(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      continue;
    }
    for (let i = 1; i < p.pts.length; i++) {
      const [x0, y0] = p.pts[i - 1], [x1, y1] = p.pts[i];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * scale * 2 + 1;
      for (let k = 0; k <= n; k++) put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
    }
    if (p.closed && p.pts.length > 2) {
      const [x0, y0] = p.pts[p.pts.length - 1], [x1, y1] = p.pts[0];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * scale * 2 + 1;
      for (let k = 0; k <= n; k++) put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
    }
  }
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < g.length; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g[i]; }
  fs.writeFileSync(out, encodePNG(W, H, rgb));
  return { W, H, count: polys.length };
}

if (process.argv[1].endsWith('render-dxf.mjs')) {
  const [file, out, s] = process.argv.slice(2);
  const r = render(file, out, Number(s || 1));
  console.log(JSON.stringify(r));
}
