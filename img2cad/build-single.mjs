// 生成单文件网页版（CSS/JS 全部内联，方便直接发一个文件给电脑）
import fs from 'node:fs';
const root = new URL('./web/', import.meta.url);
let html = fs.readFileSync(new URL('index.html', root), 'utf8');
const core = fs.readFileSync(new URL('src/core.js', root), 'utf8');
const app = fs.readFileSync(new URL('app.js', root), 'utf8');
for (const [src, code] of [['src/core.js', core], ['app.js', app]]) {
  if (/<\/script/i.test(code)) throw new Error(src + ' 里含有 </script>，不能内联');
  html = html.replace(`<script src="${src}"></script>`, () => '<script>\n' + code + '\n</script>');
}
if (html.includes('<script src=')) throw new Error('还有没内联的脚本');
html = html.replace('<title>图片 → CAD 线稿 (DXF)</title>', '<title>图片 → CAD 线稿 (DXF) · 单文件版</title>');
const out = process.argv[2] || new URL('../index.html', root).pathname;
fs.writeFileSync(out, html);
console.log('已生成 ' + out + ' (' + (html.length / 1024).toFixed(1) + ' KB)');
