#!/usr/bin/env node
// img2cad — 把图片自动描成 CAD 可编辑的矢量线稿（输出 DXF）
import fs from 'node:fs';
import path from 'node:path';
import { loadImage } from './src/load.mjs';
import { vectorize } from './src/pipeline.mjs';
import { writeDXF, writeSVG } from './src/dxf.mjs';

const HELP = `img2cad — 图片自动转 CAD 线稿 (DXF)

用法:
  node img2cad.mjs <图片> [选项]

输出:
  -o, --out <文件>      DXF 路径（默认与图片同名 .dxf）
  --svg <文件>          同时输出 SVG 预览（浏览器可直接看）
  --json                只打印统计 JSON

识别:
  --mode <auto|centerline|outline>
                        auto=自动（默认）；centerline=线条中心线（工程图/线稿）；
                        outline=外轮廓（实心图案/照片/图标）
  --invert              深底浅线时加这个
  --threshold <0-255>   二值化阈值（默认 Otsu 自动）
  --simplify <像素>     简化容差，越大点越少（默认 1.5）
  --prune <像素>        毛刺剪除长度，0=关闭（默认 3）
  --min-len <像素>      丢弃短于此长度的碎线（默认 6）
  --max-dim <像素>      处理分辨率上限，大图先缩小（默认 2000）

图纸:
  --width <数值>        图纸总宽（毫米），自动算比例
  --scale <数值>        每个像素 = 多少图形单位（默认 1）
  --origin <corner|center>  原点位置（默认 corner，左下角）
  --layer <名称>        目标图层（默认 IMG）
  -h, --help            显示帮助
`;

function parseArgs(argv) {
  const o = {
    mode: 'auto', scale: 1, width: null, threshold: null, invert: false,
    simplify: 1.5, prune: 3, minLen: 6, maxDim: 2000, layer: 'IMG',
    origin: 'corner', out: null, svg: null, json: false, input: null,
  };
  const nums = { '--scale': 'scale', '--width': 'width', '--threshold': 'threshold', '--simplify': 'simplify', '--prune': 'prune', '--min-len': 'minLen', '--max-dim': 'maxDim' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(a + ' 缺少参数'); return v; };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-o' || a === '--out') o.out = next();
    else if (a === '--svg') o.svg = next();
    else if (a === '--mode') o.mode = next();
    else if (a === '--layer') o.layer = next();
    else if (a === '--origin') o.origin = next();
    else if (a === '--invert') o.invert = true;
    else if (a === '--json') o.json = true;
    else if (nums[a]) {
      const v = Number(next());
      if (!isFinite(v)) throw new Error(a + ' 需要一个数字');
      o[nums[a]] = v;
    }
    else if (a.startsWith('-')) throw new Error('未知选项 ' + a);
    else if (o.input) throw new Error('只能处理一张图：' + a);
    else o.input = a;
  }
  return o;
}

function fmt(n) { return Number(n.toFixed(3)).toString(); }

const opt = parseArgs(process.argv.slice(2));
if (!opt.input) { console.log(HELP); process.exit(1); }

try {
  const t0 = Date.now();
  const img = loadImage(opt.input);
  const res = vectorize(img, {
    mode: opt.mode, threshold: opt.threshold, invert: opt.invert,
    simplify: opt.simplify, prune: opt.prune, minLen: opt.minLen, maxDim: opt.maxDim,
    unit: opt.scale, widthUnits: opt.width, origin: opt.origin,
  });

  const outPath = opt.out || path.join(path.dirname(path.resolve(opt.input)), path.basename(opt.input, path.extname(opt.input)) + '.dxf');
  fs.writeFileSync(outPath, writeDXF(res.polys, { layer: opt.layer }));

  let svgPath = null;
  if (opt.svg) {
    const conv = res.polys.map(p => p.circle
      ? { circle: [p.circle[0] - res.offX, res.H + res.offY - p.circle[1], p.circle[2]] }
      : { pts: p.pts.map(([x, y]) => [x - res.offX, res.H + res.offY - y]), closed: p.closed });
    fs.writeFileSync(opt.svg, writeSVG(conv, { width: res.W, height: res.H, strokeWidth: Math.max(0.6, res.W / 1400) }));
    svgPath = opt.svg;
  }

  const stats = { ...res.stats, input: path.resolve(opt.input), dxf: path.resolve(outPath), svg: svgPath ? path.resolve(svgPath) : null, ms: Date.now() - t0 };
  if (opt.json) { console.log(JSON.stringify(stats, null, 2)); process.exit(0); }

  const s = stats;
  console.log(`[OK] ${path.basename(outPath)}  ${s.polylines} 条折线 / ${s.circles} 个圆 / ${s.vertices} 个点`);
  console.log(`  ${s.mode === 'centerline' ? '中心线模式' : '外轮廓模式'} · ${fmt(s.bounds.width)} x ${fmt(s.bounds.height)} · 原图 ${s.image.width}x${s.image.height}px · ${s.ms}ms`);
  if (stats.svg) console.log(`  预览 ${stats.svg}`);
  console.log('  CAD 里用 OPEN 打开这个 DXF，或直接拖进图纸。');
} catch (e) {
  console.error('[X] ' + e.message);
  process.exit(1);
}
