// DXF R12 (AC1009) 写出：POLYLINE 折线，全版本 CAD 都能打开
function num(v) {
  if (!isFinite(v)) v = 0;
  let s = v.toFixed(6);
  s = s.replace(/\.?0+$/, '');
  if (s === '' || s === '-' || s === '-0') s = '0';
  return s;
}

/**
 * polys: [{ pts: [[x,y],...], closed:boolean }]
 */
export function writeDXF(polys, { layer = 'IMG', precision = 6 } = {}) {
  const out = [];
  const w = (...lines) => { for (const l of lines) out.push(String(l)); };

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of polys) {
    if (p.circle) {
      const [cx, cy, r] = p.circle;
      minx = Math.min(minx, cx - r); maxx = Math.max(maxx, cx + r);
      miny = Math.min(miny, cy - r); maxy = Math.max(maxy, cy + r);
      continue;
    }
    for (const [x, y] of p.pts) {
      if (x < minx) minx = x; if (y < miny) miny = y;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    }
  }
  if (!isFinite(minx)) { minx = miny = 0; maxx = maxy = 1; }

  w('0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMIN', '10', num(minx), '20', num(miny), '30', '0.0',
    '9', '$EXTMAX', '10', num(maxx), '20', num(maxy), '30', '0.0',
    '9', '$LIMMIN', '10', num(minx), '20', num(miny),
    '9', '$LIMMAX', '10', num(maxx), '20', num(maxy),
    '0', 'ENDSEC');

  w('0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '1',
    '0', 'LAYER', '2', layer, '70', '0', '62', '7', '6', 'CONTINUOUS',
    '0', 'ENDTAB',
    '0', 'ENDSEC');

  w('0', 'SECTION', '2', 'ENTITIES');
  for (const p of polys) {
    if (p.circle) {
      w('0', 'CIRCLE', '8', layer, '10', num(p.circle[0]), '20', num(p.circle[1]), '30', '0.0', '40', num(p.circle[2]));
      continue;
    }
    const flag = p.closed ? 1 : 0;
    w('0', 'POLYLINE', '8', layer, '66', '1', '70', String(flag),
      '10', '0.0', '20', '0.0', '30', '0.0');
    for (const [x, y] of p.pts) {
      w('0', 'VERTEX', '8', layer, '10', num(x), '20', num(y), '30', '0.0');
    }
    w('0', 'SEQEND', '8', layer);
  }
  w('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

export function writeSVG(polys, { width, height, stroke = '#111', strokeWidth = 1 } = {}) {
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<rect width="100%" height="100%" fill="#fff"/>`);
  parts.push(`<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`);
  for (const p of polys) {
    if (p.circle) {
      parts.push(`<circle cx="${p.circle[0].toFixed(2)}" cy="${p.circle[1].toFixed(2)}" r="${p.circle[2].toFixed(2)}"/>`);
      continue;
    }
    const d = p.pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ') + (p.closed ? ' Z' : '');
    parts.push(`<path d="${d}"/>`);
  }
  parts.push('</g></svg>');
  return parts.join('\n');
}
