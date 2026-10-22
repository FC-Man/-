// 栅格预处理、细化、骨架/轮廓追踪、折线简化
const N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

/** 盒式降采样（灰度），返回 {gray, w, h, scale} */
export function downsample(gray, w, h, maxDim) {
  const m = Math.max(w, h);
  if (!maxDim || m <= maxDim) return { gray, w, h, scale: 1 };
  const f = m / maxDim;
  const nw = Math.max(1, Math.round(w / f));
  const nh = Math.max(1, Math.round(h / f));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += gray[yy * w + xx]; n++; }
      out[y * nw + x] = Math.round(sum / n);
    }
  }
  return { gray: out, w: nw, h: nh, scale: w / nw };
}

export function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/** 墨迹 = 1。invert 表示深底浅线 */
export function binarize(gray, threshold, invert) {
  const m = new Uint8Array(gray.length);
  if (invert) { for (let i = 0; i < gray.length; i++) m[i] = gray[i] > threshold ? 1 : 0; }
  else { for (let i = 0; i < gray.length; i++) m[i] = gray[i] <= threshold ? 1 : 0; }
  return m;
}

/** 去除小于 minSize 像素的孤立连通块 */
export function despeckle(mask, w, h, minSize) {
  if (minSize <= 1) return mask;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0, cnt = 0;
    stack[sp++] = i; seen[i] = 1;
    const comp = [];
    while (sp) {
      const p = stack[--sp]; comp.push(p); cnt++;
      const x = p % w, y = (p - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + N8[k][0], ny = y + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    if (cnt < minSize) for (const p of comp) mask[p] = 0;
  }
  return mask;
}

/** Guo-Hall 细化，原地修改并返回 */
export function thin(mask, w, h) {
  const img = mask;
  let changed = true, iter = 0;
  while (changed && iter++ < 400) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      const del = [];
      for (let y = 1; y < h - 1; y++) {
        let i = y * w + 1;
        for (let x = 1; x < w - 1; x++, i++) {
          if (!img[i]) continue;
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
          const a1 = (p2 || p3) + (p4 || p5) + (p6 || p7) + (p8 || p9);
          if (a1 > 3) continue; // N1<=3 的必要条件，先加速
          const a2 = (p3 || p4) + (p5 || p6) + (p7 || p8) + (p9 || p2);
          if (a1 < 2 && a2 < 2) continue;
          const C = (!p2 && (p3 || p4)) + (!p4 && (p5 || p6)) + (!p6 && (p7 || p8)) + (!p8 && (p9 || p2));
          if (C !== 1) continue;
          const N = Math.min(a1, a2);
          if (N < 2 || N > 3) continue;
          const m = pass === 0 ? ((!p2 && !p6) || !p8) : ((!p4 && !p8) || !p2);
          if (!m) continue;
          del.push(i); any = true;
        }
      }
      for (let k = 0; k < del.length; k++) img[del[k]] = 0;
      if (any) changed = true;
    }
  }
  return img;
}

function degreeMap(skel, w, h) {
  const deg = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    let i = y * w + 1;
    for (let x = 1; x < w - 1; x++, i++) {
      if (!skel[i]) continue;
      let d = 0;
      for (let k = 0; k < 8; k++) {
        const q = i + N8[k][1] * w + N8[k][0];
        if (skel[q]) d++;
      }
      deg[i] = d;
    }
  }
  return deg;
}

/** 剪掉长度 <= maxLen 的毛刺（骨架端点走到分叉点） */
export function pruneSpurs(skel, w, h, maxLen) {
  if (!maxLen) return skel;
  for (let round = 0; round < maxLen; round++) {
    const deg = degreeMap(skel, w, h);
    const removals = [];
    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        if (!skel[i] || deg[i] !== 1) continue;
        const path = [i];
        let px = -1, py = -1, cx = x, cy = y, hit = false;
        for (let step = 0; step < maxLen; step++) {
          let nx = -1, ny = -1;
          for (let k = 0; k < 8; k++) {
            const qx = cx + N8[k][0], qy = cy + N8[k][1];
            if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
            if (qx === px && qy === py) continue;
            const qi = qy * w + qx;
            if (!skel[qi]) continue;
            nx = qx; ny = qy; break;
          }
          if (nx < 0) break;
          const ni = ny * w + nx;
          if (deg[ni] >= 3) { hit = true; break; }
          path.push(ni);
          px = cx; py = cy; cx = nx; cy = ny;
        }
        if (hit) removals.push(...path);
      }
    }
    if (!removals.length) break;
    for (const i of removals) skel[i] = 0;
  }
  return skel;
}

/** 骨架 -> 折线（像素坐标）：按方向连续性行走，避免分叉把线切碎 */
export function traceSkeleton(skel, w, h) {
  const visited = new Uint8Array(w * h);
  const lines = [];
  const at = (x, y) => y * w + x;

  function walk(sx, sy, dirx, diry, out, reverse) {
    let cx = sx, cy = sy;
    let dx0 = dirx, dy0 = diry;
    const pts = reverse ? [] : [[sx, sy]];
    if (reverse) pts.push([sx, sy]);
    for (let guard = 0; guard < w * h; guard++) {
      let bx = -1, by = -1, best = -Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = cx + N8[k][0], ny = cy + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = at(nx, ny);
        if (!skel[ni] || visited[ni]) continue;
        const len = Math.hypot(N8[k][0], N8[k][1]);
        let cos;
        if (dx0 === 0 && dy0 === 0) cos = 0;
        else cos = (dx0 * N8[k][0] + dy0 * N8[k][1]) / len;
        if (cos > best) { best = cos; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      visited[at(bx, by)] = 1;
      pts.push([bx, by]);
      let vx = bx - cx, vy = by - cy;
      const vn = Math.hypot(vx, vy);
      vx /= vn; vy /= vn;
      if (dx0 === 0 && dy0 === 0) { dx0 = vx; dy0 = vy; }
      else { dx0 = dx0 * 0.4 + vx * 0.6; dy0 = dy0 * 0.4 + vy * 0.6; const n2 = Math.hypot(dx0, dy0); dx0 /= n2; dy0 /= n2; }
      cx = bx; cy = by;
    }
    if (reverse) pts.reverse();
    for (const p of pts) out.push(p);
    return { vx: dx0, vy: dy0 };
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (!skel[i] || visited[i]) continue;
      let deg = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + N8[k][0], ny = y + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (skel[at(nx, ny)]) deg++;
      }
      if (deg === 0) { visited[i] = 1; continue; }

      visited[i] = 1;
      const pts = [];
      const fwd = walk(x, y, 0, 0, pts, false);
      const back = [];
      walk(x, y, -fwd.vx, -fwd.vy, back, true);
      const merged = back.concat(pts);
      // 闭环
      const first = merged[0], last = merged[merged.length - 1];
      const closed = merged.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1.5;
      if (closed) merged.push([first[0], first[1]]);
      lines.push(merged);
    }
  }
  return lines;
}

/** 轮廓模式：沿像素边界追踪所有闭合轮廓（分叉点处取最右转，保证闭合不交叉） */
export function traceOutline(mask, w, h) {
  const key = (x, y) => x + ',' + y;
  const out = new Map();
  const push = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    let arr = out.get(k);
    if (!arr) { arr = []; out.set(k, arr); }
    arr.push([x2, y2]);
  };
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!get(x, y - 1)) push(x, y, x + 1, y);
      if (!get(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!get(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!get(x - 1, y)) push(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [startKey, list] of out) {
    while (list.length) {
      const [sx, sy] = startKey.split(',').map(Number);
      const pts = [[sx, sy]];
      let cur = list.pop();
      let px = sx, py = sy;
      let guard = 0;
      while (guard++ < w * h * 4) {
        pts.push([cur[0], cur[1]]);
        if (cur[0] === sx && cur[1] === sy) break;
        const nexts = out.get(key(cur[0], cur[1]));
        if (!nexts || !nexts.length) break;
        const dx = cur[0] - px, dy = cur[1] - py;
        let bi = 0, bestAng = Infinity;
        for (let i = 0; i < nexts.length; i++) {
          const ox = nexts[i][0] - cur[0], oy = nexts[i][1] - cur[1];
          const ang = Math.atan2(dx * oy - dy * ox, dx * ox + dy * oy);
          if (ang < bestAng) { bestAng = ang; bi = i; }
        }
        const nx = nexts[bi];
        nexts.splice(bi, 1);
        px = cur[0]; py = cur[1];
        cur = nx;
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}

/** Douglas-Peucker */
export function simplify(points, tol) {
  if (points.length <= 2 || tol <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + t * dx, qy = ay + t * dy;
        d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const res = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) res.push(points[i]);
  return res;
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** 闭合折线圆拟合（Kasa 代数最小二乘），通过则返回 {cx,cy,r} */
export function fitCircle(pts) {
  const n = pts.length;
  if (n < 8) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [px, py] of pts) {
    const x = px - mx, y = py - my;
    const z = x * x + y * y;
    Sxx += x * x; Sxy += x * y; Syy += y * y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  const den = Sxx * Syy - Sxy * Sxy;
  if (Math.abs(den) < 1e-9) return null;
  const a = (Sxz * Syy - Syz * Sxy) / den;
  const b = (Syz * Sxx - Sxz * Sxy) / den;
  const c = Sz / n;
  const r2 = c + (a * a + b * b) / 4;
  if (r2 <= 0) return null;
  const cx = mx + a / 2, cy = my + b / 2, r = Math.sqrt(r2);
  let maxDev = 0;
  for (const [px, py] of pts) {
    const d = Math.abs(Math.hypot(px - cx, py - cy) - r);
    if (d > maxDev) maxDev = d;
  }
  if (maxDev > Math.max(1.2, r * 0.03)) return null;
  return { cx, cy, r };
}

/** 把断开的端点吸附到附近线段的最近点上（补 T 形交叉处的 1-2 像素缺口） */
export function bridgeGaps(polys, tol) {
  if (!(tol > 0)) return polys;
  const segs = [];
  const grid = new Map();
  const cell = Math.max(tol, 1e-6);
  const key = (ix, iy) => ix + ',' + iy;
  const addSeg = (poly, i) => {
    const p1 = poly.pts[i];
    const p2 = i + 1 < poly.pts.length ? poly.pts[i + 1] : poly.pts[0];
    const s = { p1, p2, poly, i };
    segs.push(s);
    const minx = Math.min(p1[0], p2[0]) - tol, maxx = Math.max(p1[0], p2[0]) + tol;
    const miny = Math.min(p1[1], p2[1]) - tol, maxy = Math.max(p1[1], p2[1]) + tol;
    for (let ix = Math.floor(minx / cell); ix <= Math.floor(maxx / cell); ix++) {
      for (let iy = Math.floor(miny / cell); iy <= Math.floor(maxy / cell); iy++) {
        const k = key(ix, iy);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(s);
      }
    }
  };
  for (const p of polys) {
    if (!p.pts || p.pts.length < 2) continue;
    const n = p.closed ? p.pts.length : p.pts.length - 1;
    for (let i = 0; i < n; i++) addSeg(p, i);
  }
  const tol2 = tol * tol;
  const ends = [];
  for (const p of polys) {
    if (!p.pts || p.closed || p.pts.length < 2) continue;
    ends.push({ poly: p, idx: 0 });
    ends.push({ poly: p, idx: p.pts.length - 1 });
  }
  let moved = 0;
  for (const e of ends) {
    const pt = e.poly.pts[e.idx];
    const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
    let best = null, bestD = tol2;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const arr = grid.get(key(ix, iy));
        if (!arr) continue;
        for (const s of arr) {
          if (s.poly === e.poly) continue;
          const [x1, y1] = s.p1, [x2, y2] = s.p2;
          const dx = x2 - x1, dy = y2 - y1;
          const L2 = dx * dx + dy * dy;
          let t = L2 === 0 ? 0 : ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / L2;
          if (t <= 0 || t >= 1) continue; // 端点对端点不处理
          const qx = x1 + t * dx, qy = y1 + t * dy;
          const d = (pt[0] - qx) ** 2 + (pt[1] - qy) ** 2;
          // 已经贴在线上，跳过
          if (d < 1e-12) { best = null; bestD = -1; break; }
          if (d < bestD) { bestD = d; best = [qx, qy]; }
        }
        if (bestD < 0) break;
      }
      if (bestD < 0) break;
    }
    if (best && bestD > 0 && bestD <= tol2) {
      e.poly.pts[e.idx] = [best[0], best[1]];
      moved++;
    }
  }
  return polys;
}
