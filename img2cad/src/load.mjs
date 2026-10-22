// 统一图片加载：PNG / BMP 原生解码；JPG 自动借系统工具转 PNG
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodePNG, isPNG } from './png.mjs';
import { decodeBMP, isBMP } from './bmp.mjs';

function tryConvertWith(cmd, args, out, cwd) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 120000 });
    return fs.existsSync(out) && fs.statSync(out).size > 0;
  } catch { return false; }
}

function convertToPNG(file) {
  const out = path.join(os.tmpdir(), 'img2cad-' + process.pid + '-' + Date.now() + '.png');
  const q = file.replace(/'/g, "''");
  const ps =
    "Add-Type -AssemblyName System.Drawing;" +
    `$src=[System.Drawing.Image]::FromFile('${q}');` +
    `$src.Save('${out.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);` +
    '$src.Dispose();';
  const attempts = [
    ['powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]],
    ['pwsh', ['-NoProfile', '-NonInteractive', '-Command', ps]],
    ['sips', ['-s', 'format', 'png', file, '--out', out]],
    ['magick', [file, out]],
    ['convert', [file, out]],
    ['ffmpeg', ['-y', '-loglevel', 'error', '-i', file, out]],
  ];
  for (const [cmd, args] of attempts) {
    if (tryConvertWith(cmd, args, out, os.tmpdir())) return out;
  }
  throw new Error(
    '这张图是 JPG/其他格式，本机没有可用的转换工具。\n' +
    '  办法一：用自带“画图/预览”把它另存为 PNG 再跑。\n' +
    '  办法二：装 ImageMagick 后重试。'
  );
}

export function loadImage(file) {
  if (!fs.existsSync(file)) throw new Error('找不到文件：' + file);
  let buf = fs.readFileSync(file);
  if (isPNG(buf)) return decodePNG(buf);
  if (isBMP(buf)) return decodeBMP(buf);
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  const isGif = buf.subarray(0, 3).toString('latin1') === 'GIF';
  if (isJpeg || isGif || file.match(/\.(jpe?g|gif|webp|tiff?)$/i)) {
    const png = convertToPNG(path.resolve(file));
    try { return decodePNG(fs.readFileSync(png)); }
    finally { try { fs.unlinkSync(png); } catch {} }
  }
  throw new Error('识别不了图片格式（支持 PNG/BMP，JPG 会自动转）');
}
