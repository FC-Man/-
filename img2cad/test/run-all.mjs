// 全量自测：跑各种图/参数，断言输出正确
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { encodePNG } from '../src/png.mjs';
import { loadImage } from '../src/load.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'img2cad.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'img2cad-test-'));

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); }
}
function run(args) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}
function json(args) {
  const r = run([...args, '--json']);
  if (r.code !== 0) throw new Error(r.out);
  return JSON.parse(r.out.slice(r.out.indexOf('{')));
}

// 造一张黑白反相图（白线黑底）
function makeInverted(src, dst) {
  const img = loadImage(src);
  const g = new Uint8Array(img.gray.length);
  for (let i = 0; i < g.length; i++) g[i] = 255 - img.gray[i];
  const rgb = new Uint8Array(g.length * 3);
  for (let i = 0; i < g.length; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g[i]; }
  fs.writeFileSync(dst, encodePNG(img.width, img.height, rgb));
  return { width: img.width, height: img.height };
}

const flange = path.join(HERE, 'test-lineart.png');
const filled = path.join(HERE, 'test-filled.png');
const gear = path.join(HERE, 'test-solid.png');

// 1. 中心线模式：法兰板
{
  const s = json([flange, '--mode', 'centerline', '-o', path.join(TMP, 'a.dxf')]);
  ok(s.mode === 'centerline', 'centerline 模式生效');
  ok(s.polylines === 12, '法兰折线数=12', s.polylines);
  ok(s.circles === 6, '六个圆全部识别', s.circles);
  const dxf = fs.readFileSync(path.join(TMP, 'a.dxf'), 'utf8');
  ok(dxf.startsWith('0\nSECTION'), 'DXF 以 SECTION 开头');
  ok(dxf.trimEnd().endsWith('EOF'), 'DXF 以 EOF 结尾');
  ok((dxf.match(/^VERTEX$/gm) || []).length === s.vertices, 'VERTEX 数与统计一致');
  ok((dxf.match(/^CIRCLE$/gm) || []).length === 6, 'CIRCLE 实体数=6');
  ok(dxf.includes('AC1009'), '版本 R12');
}
// 2. 真实尺寸
{
  const s = json([flange, '--width', '420', '-o', path.join(TMP, 'b.dxf')]);
  ok(Math.abs(s.bounds.width - 420) < 0.01, '--width 420 生效', s.bounds.width);
  ok(Math.abs(s.bounds.width / s.bounds.height - 900 / 680) < 0.01, '比例保持');
}
// 3. 强制轮廓模式
{
  const s = json([flange, '--mode', 'outline', '-o', path.join(TMP, 'c.dxf')]);
  ok(s.mode === 'outline', 'outline 模式生效');
  ok(s.polylines + s.circles >= 4, '轮廓模式有线条', s.polylines + s.circles);
}
// 4. 实心图案 auto → 轮廓 + 圆孔
{
  const s = json([filled, '-o', path.join(TMP, 'd.dxf')]);
  ok(s.mode === 'outline', '实心图自动判为轮廓', s.mode);
  ok(s.circles === 1, '内孔拟合为圆', s.circles);
  ok(s.polylines === 1, '外轮廓 1 条', s.polylines);
}
// 5. 线稿 auto → 中心线（3px 线也要判对）
{
  const s = json([gear, '-o', path.join(TMP, 'e.dxf')]);
  ok(s.mode === 'centerline', '3px 线稿自动判为中心线', s.mode);
  ok(s.polylines === 1, '闭合齿轮 1 条折线', s.polylines);
}
// 6. 反相图
{
  const inv = path.join(TMP, 'inv.png');
  makeInverted(flange, inv);
  const s = json([inv, '--invert', '-o', path.join(TMP, 'f.dxf')]);
  ok(s.circles === 6, '反相图识别 6 个圆', s.circles);
}
// 7. 大图性能
{
  const big = '/tmp/big.png';
  if (fs.existsSync(big)) {
    const s = json([big, '-o', path.join(TMP, 'g.dxf')]);
    ok(s.polylines > 50, '大图有大量线条', s.polylines);
    ok(s.ms < 8000, '大图 < 8s', s.ms);
  } else ok(true, '大图跳过');
}
// 8. SVG 预览
{
  const svg = path.join(TMP, 'p.svg');
  run([flange, '-o', path.join(TMP, 'h.dxf'), '--svg', svg]);
  const t = fs.readFileSync(svg, 'utf8');
  ok(t.startsWith('<svg'), 'SVG 输出');
  ok((t.match(/<circle/g) || []).length === 6, 'SVG 里有 6 个圆');
}
// 9. 错误处理
{
  const r = run(['--nonsense']);
  ok(r.code !== 0, '未知参数应报错');
  const r2 = run(['/tmp/definitely-missing.png']);
  ok(r2.code !== 0, '缺文件应报错');
}
// 10. 缩放与原点
{
  const s = json([filled, '--scale', '2', '--origin', 'center', '-o', path.join(TMP, 'i.dxf')]);
  ok(Math.abs(s.bounds.width - 1200) < 0.01, '--scale 2 生效', s.bounds.width);
  const s2 = json([filled, '--origin', 'center', '-o', path.join(TMP, 'j.dxf')]);
  ok(s2.bounds.width === s.bounds.width / 2, '原点中心不影响图幅');
}

console.log(`\n${pass} 项通过, ${fail} 项失败`);
if (fail) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
console.log('全部通过');
