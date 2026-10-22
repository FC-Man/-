// BMP 解码（24/32 位真彩、8 位调色板，未压缩）
export function isBMP(buf) { return buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d; }

export function decodeBMP(buf) {
  const dataOff = buf.readUInt32LE(10);
  const hdrSize = buf.readUInt32LE(14);
  const w = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const topDown = rawH < 0;
  const h = Math.abs(rawH);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error('只支持未压缩 BMP（当前压缩方式 ' + compression + '），请另存为 PNG');
  if (![8, 24, 32].includes(bpp)) throw new Error('只支持 8/24/32 位 BMP（当前 ' + bpp + '）');

  const gray = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);
  let palette = null;
  if (bpp === 8) {
    const count = buf.readUInt32LE(46) || 256;
    palette = [];
    let p = 14 + hdrSize;
    for (let i = 0; i < count; i++, p += 4) palette.push([buf[p + 2], buf[p + 1], buf[p]]);
  }
  const stride = Math.floor((bpp * w + 31) / 32) * 4;
  for (let row = 0; row < h; row++) {
    const srcY = topDown ? row : h - 1 - row;
    const line = dataOff + srcY * stride;
    for (let x = 0; x < w; x++) {
      let r, g, b;
      if (bpp === 8) { const c = palette[buf[line + x]] || [255, 255, 255]; [r, g, b] = c; }
      else if (bpp === 24) { b = buf[line + x * 3]; g = buf[line + x * 3 + 1]; r = buf[line + x * 3 + 2]; }
      else { b = buf[line + x * 4]; g = buf[line + x * 4 + 1]; r = buf[line + x * 4 + 2]; alpha[row * w + x] = buf[line + x * 4 + 3]; }
      gray[row * w + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return { width: w, height: h, gray, alpha };
}
