/* img2cad 网页版：拖图 -> 自动描线 -> 下载 DXF（全部在本机浏览器内完成） */
(function () {
  const $ = (s) => document.querySelector(s);
  const state = { file: null, image: null, imgW: 0, imgH: 0, res: null, busy: false };

  const el = {
    drop: $('#drop'), file: $('#file'), canvas: $('#preview'),
    stats: $('#stats'), status: $('#status'), mode: $('#mode'),
    invert: $('#invert'), autoTh: $('#autoTh'), th: $('#th'), thVal: $('#thVal'),
    simplify: $('#simplify'), simplifyVal: $('#simplifyVal'),
    minlen: $('#minlen'), minlenVal: $('#minlenVal'),
    widthMm: $('#widthMm'), origin: $('#origin'), layer: $('#layer'),
    dl: $('#download'), dlSvg: $('#downloadSvg'), reset: $('#reset'),
  };

  function setStatus(t, kind) {
    el.status.textContent = t || '';
    el.status.dataset.kind = kind || '';
  }

  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus('这不是图片文件', 'err'); return; }
    state.file = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      state.image = img;
      state.imgW = img.naturalWidth;
      state.imgH = img.naturalHeight;
      $('#filename').textContent = file.name + ' · ' + state.imgW + '×' + state.imgH;
      el.drop.classList.add('has-image');
      run();
    };
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('图片解码失败，换一张试试', 'err'); };
    img.src = url;
  }

  function grabPixels() {
    const MAX = 3200;
    const k = Math.min(1, MAX / Math.max(state.imgW, state.imgH));
    const w = Math.max(1, Math.round(state.imgW * k));
    const h = Math.max(1, Math.round(state.imgH * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(state.image, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    const alpha = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      alpha[j] = d[i + 3];
      gray[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    return { gray, alpha, width: w, height: h };
  }

  function opts() {
    return {
      mode: el.mode.value,
      invert: el.invert.checked,
      threshold: el.autoTh.checked ? null : Number(el.th.value),
      simplify: Number(el.simplify.value),
      minLen: Number(el.minlen.value),
      maxDim: 2000,
      widthUnits: el.widthMm.value ? Number(el.widthMm.value) : null,
      origin: el.origin.value,
    };
  }

  function run() {
    if (!state.image || state.busy) return;
    state.busy = true;
    setStatus('正在识别…');
    setTimeout(() => {
      try {
        const px = grabPixels();
        const res = IMG2CAD.vectorize(px, opts());
        state.res = res;
        drawPreview(px, res);
        showStats(res);
        el.dl.disabled = false;
        el.dlSvg.disabled = false;
        setStatus('完成', 'ok');
      } catch (e) {
        console.error(e);
        setStatus('出错：' + e.message, 'err');
      } finally {
        state.busy = false;
      }
    }, 20);
  }

  function drawPreview(px, res) {
    const canvas = el.canvas;
    const maxW = Math.min(canvas.parentElement.clientWidth || 900, 1100);
    const k = maxW / res.W;
    const cw = Math.round(res.W * k);
    const chh = Math.round(res.H * k);
    canvas.width = cw;
    canvas.height = chh;
    canvas.style.width = cw + 'px';
    canvas.style.height = chh + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, chh);

    // 原图垫底（浅灰）
    if (state.image) {
      try { ctx.filter = 'grayscale(1)'; } catch {}
      ctx.globalAlpha = 0.28;
      ctx.drawImage(state.image, 0, 0, cw, chh);
      ctx.globalAlpha = 1;
      try { ctx.filter = 'none'; } catch {}
    }

    const tx = (x) => (x - res.offX) * k;
    const ty = (y) => (res.H + res.offY - y) * k;
    ctx.strokeStyle = '#0b57e0';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of res.polys) {
      if (p.circle) {
        const [x, y, r] = p.circle;
        ctx.beginPath();
        ctx.arc(tx(x), ty(y), r * k, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (!p.pts || p.pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(tx(p.pts[0][0]), ty(p.pts[0][1]));
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(tx(p.pts[i][0]), ty(p.pts[i][1]));
      if (p.closed) ctx.closePath();
      ctx.stroke();
    }
  }

  function showStats(res) {
    const s = res.stats;
    const dims = el.widthMm.value ? `${s.bounds.width.toFixed(1)} × ${s.bounds.height.toFixed(1)} mm` : `${s.bounds.width.toFixed(0)} × ${s.bounds.height.toFixed(0)} 单位`;
    el.stats.innerHTML = `
      <span><b>${s.polylines}</b> 条折线</span>
      <span><b>${s.circles}</b> 个圆</span>
      <span><b>${s.vertices}</b> 个点</span>
      <span>图幅 <b>${dims}</b></span>
      <span>${s.mode === 'centerline' ? '中心线' : '外轮廓'}模式${s.mode === 'centerline' ? '（线宽 ' + s.strokeWidth + 'px）' : ''}</span>
      <span>阈值 ${s.threshold}</span>`;
    if (el.autoTh.checked) el.th.value = s.threshold;
    el.thVal.textContent = el.autoTh.checked ? '自动' : el.th.value;
  }

  function download(text, filename, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function baseName() {
    const n = state.file ? state.file.name : 'drawing.png';
    return n.replace(/\.[^.]+$/, '');
  }

  // ---- 事件绑定 ----
  el.drop.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', (e) => { loadImageFile(e.target.files[0]); el.file.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => el.drop.addEventListener(ev, (e) => {
    e.preventDefault(); el.drop.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => el.drop.addEventListener(ev, (e) => {
    e.preventDefault(); el.drop.classList.remove('drag');
  }));
  el.drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImageFile(f);
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) if (it.type.startsWith('image/')) { loadImageFile(it.getAsFile()); break; }
  });

  el.mode.addEventListener('change', run);
  el.invert.addEventListener('change', run);
  el.origin.addEventListener('change', run);
  el.autoTh.addEventListener('change', () => {
    el.th.disabled = el.autoTh.checked;
    el.thVal.textContent = el.autoTh.checked ? '自动' : el.th.value;
    run();
  });
  let timer = null;
  const debounce = () => { clearTimeout(timer); timer = setTimeout(run, 220); };
  [el.simplify, el.minlen, el.th].forEach((r) => r.addEventListener('input', () => {
    el.simplifyVal.textContent = Number(el.simplify.value).toFixed(1);
    el.minlenVal.textContent = el.minlen.value;
    el.thVal.textContent = el.autoTh.checked ? '自动' : el.th.value;
    debounce();
  }));
  el.widthMm.addEventListener('input', debounce);

  el.dl.addEventListener('click', () => {
    if (!state.res) return;
    download(IMG2CAD.writeDXF(state.res.polys, { layer: el.layer.value || 'IMG' }), baseName() + '.dxf', 'application/dxf');
  });
  el.dlSvg.addEventListener('click', () => {
    if (!state.res) return;
    const r = state.res;
    const conv = r.polys.map((p) => p.circle
      ? { circle: [p.circle[0] - r.offX, r.H + r.offY - p.circle[1], p.circle[2]] }
      : { pts: p.pts.map(([x, y]) => [x - r.offX, r.H + r.offY - y]), closed: p.closed });
    download(IMG2CAD.writeSVG(conv, { width: r.W, height: r.H, strokeWidth: Math.max(0.6, r.W / 1400) }), baseName() + '.svg', 'image/svg+xml');
  });
  el.reset.addEventListener('click', () => {
    state.file = null; state.image = null; state.res = null;
    el.dl.disabled = true; el.dlSvg.disabled = true;
    el.drop.classList.remove('has-image');
    $('#filename').textContent = '拖入图片，或点击选择';
    el.stats.innerHTML = '';
    const c = el.canvas; c.width = 0; c.height = 0;
    setStatus('');
  });
})();
