// 把 src 里的纯函数打包成浏览器可直接 <script> 引用的 src/core.js（同一份源码）
import fs from 'node:fs';
const parts = [];
for (const f of ['src/vector.mjs', 'src/dxf.mjs', 'src/pipeline.mjs']) {
  let s = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  s = s.replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  s = s.replace(/^export /gm, '');
  parts.push('// ---- ' + f + ' ----\n' + s);
}
parts.push(`
const IMG2CAD = {
  downsample, otsu, binarize, despeckle, thin, pruneSpurs,
  traceSkeleton, traceOutline, simplify, polyLength, fitCircle, bridgeGaps,
  writeDXF, writeSVG, vectorize, flattenAlpha,
};
if (typeof module !== 'undefined' && module.exports) module.exports = IMG2CAD;
if (typeof window !== 'undefined') window.IMG2CAD = IMG2CAD;
`);
fs.mkdirSync(new URL('web/src/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('web/src/core.js', import.meta.url), parts.join('\n'));
console.log('web/src/core.js built (' + parts.join('\n').split('\n').length + ' lines)');
