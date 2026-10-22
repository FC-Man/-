// 一条流水线：灰度图 -> 矢量折线/圆（CLI 与网页共用同一份代码）
import {
  downsample, otsu, binarize, despeckle, thin, pruneSpurs,
  traceSkeleton, traceOutline, simplify, polyLength, fitCircle, bridgeGaps,
} from './vector.mjs';

export function flattenAlpha(gray, alpha, w, h) {
  const out = new Uint8Array(w * h);
  if (!alpha) { out.set(gray); return out; }
  for (let i = 0; i < out.length; i++) {
    const a = alpha[i] / 255;
    out[i] = Math.round(255 - (255 - gray[i]) * a);
  }
  return out;
}

/**
 * @param {{gray:Uint8Array, alpha?:Uint8Array, width:number, height:number}} img
 * @param {object} opt
 */
export function vectorize(img, opt = {}) {
  const o = {
    mode: 'auto', threshold: null, invert: false, simplify: 1.5, prune: 3,
    minLen: 6, maxDim: 2000, unit: 1, widthUnits: null, origin: 'corner',
    ...opt,
  };
  const origW = img.width, origH = img.height;
  const flat = flattenAlpha(img.gray, img.alpha, origW, origH);
  const ds = downsample(flat, origW, origH, o.maxDim);
  const w = ds.w, h = ds.h, px = ds.scale;

  const threshold = o.threshold == null ? otsu(ds.gray) : o.threshold;
  const mask = binarize(ds.gray, threshold, o.invert);
  despeckle(mask, w, h, Math.max(2, Math.round(4 * px * px)));

  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];

  let mode = o.mode;
  let skel = null;
  let strokeWidth = 0;
  if (mode === 'auto') {
    // 便宜的判别特征：一次腐蚀后剩下的比例（线越粗剩得越多）+ 中间调占比（照片/彩色图高）
    let eroded = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        if ((x > 0 && mask[i - 1]) && (x < w - 1 && mask[i + 1]) &&
            (y > 0 && mask[i - w]) && (y < h - 1 && mask[i + w])) eroded++;
      }
    }
    const erodeRatio = ink / Math.max(1, eroded);
    let ambiguous = 0;
    for (let i = 0; i < ds.gray.length; i++) {
      const v = ds.gray[i];
      if (v > 40 && v < 215 && Math.abs(v - threshold) <= 45) ambiguous++;
    }
    const ambFrac = ambiguous / ds.gray.length;
    mode = ambFrac > 0.22 ? 'outline' : (erodeRatio >= 1.45 ? 'centerline' : 'outline');
    if (mode === 'centerline') {
      skel = thin(Uint8Array.from(mask), w, h);
      let sk = 0;
      for (let i = 0; i < skel.length; i++) sk += skel[i];
      strokeWidth = sk ? ink / sk : 0;
    }
  } else if (mode === 'centerline') {
    skel = thin(Uint8Array.from(mask), w, h);
    let sk = 0;
    for (let i = 0; i < skel.length; i++) sk += skel[i];
    strokeWidth = sk ? ink / sk : 0;
  }

  let raw;
  if (mode === 'centerline') {
    pruneSpurs(skel, w, h, Math.round(o.prune * px));
    raw = traceSkeleton(skel, w, h);
  } else {
    raw = traceOutline(mask, w, h);
  }

  const unit = o.widthUnits && o.widthUnits > 0 ? o.widthUnits / origW : o.unit;
  const s = px * unit;
  const W = origW * unit, H = origH * unit;
  const offX = o.origin === 'center' ? -W / 2 : 0;
  const offY = o.origin === 'center' ? -H / 2 : 0;

  const polys = [];
  for (const pts of raw) {
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const simp = simplify(pts, o.simplify);
    const fin = closed ? simp.slice(0, -1) : simp;
    if (fin.length < 2) continue;
    if (polyLength(fin) * px < o.minLen) continue;
    if (closed && fin.length >= 8) {
      const c = fitCircle(fin);
      if (c) { polys.push({ circle: [c.cx * s + offX, H - c.cy * s + offY, c.r * s] }); continue; }
    }
    polys.push({ pts: fin.map(([x, y]) => [x * s + offX, H - y * s + offY]), closed: closed && fin.length > 2 });
  }

  if (mode === 'centerline') bridgeGaps(polys, 2.5 * s);

  let vertices = 0;
  for (const p of polys) if (p.pts) vertices += p.pts.length;

  return {
    polys,
    W, H, offX, offY,
    stats: {
      image: { width: origW, height: origH },
      work: { width: w, height: h, downscale: +px.toFixed(3) },
      mode,
      strokeWidth: +strokeWidth.toFixed(2),
      threshold,
      polylines: polys.filter(p => p.pts).length,
      circles: polys.filter(p => p.circle).length,
      vertices,
      closedLoops: polys.filter(p => p.closed).length,
      bounds: { width: +W.toFixed(3), height: +H.toFixed(3) },
    },
  };
}
