/* app.js — Shared frontend logic for BOTH index.html (student) and admin.html.
 * Vanilla JS only. Uses fetch(), FileReader, marked.js (CDN), setInterval (5s polling).
 * The page is auto-detected at the bottom of this file.
 */
(function () {
  'use strict';

  /* =========================================================================
   * CONFIG
   * ⬇️ If your frontend (GitHub Pages) and backend (Vercel) are on DIFFERENT
   *    domains, set API_BASE to your Vercel URL, e.g. 'https://polyu-ai-p3.vercel.app'.
   *    If everything is deployed together on Vercel, leave it as '' (same origin).
   * =======================================================================*/
  const CONFIG = {
    API_BASE: 'https://polyu-ai-p3-workshops.vercel.app',
    POLL_INTERVAL_MS: 5000,
    MAX_IMAGE_DIMENSION: 1920, // px — images larger than this are downscaled
    IMAGE_QUALITY: 0.85,       // JPEG quality after resize
    MAX_FILE_BYTES: 10 * 1024 * 1024 // 10 MB hard limit (matches backend)
  };

  /* ---------------- Shared utilities ---------------- */
  const $ = (id) => document.getElementById(id);
  const apiUrl = (p) => (CONFIG.API_BASE ? CONFIG.API_BASE.replace(/\/$/, '') : '') + p;

  function toast(message, type) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast hidden'; }, 3800);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderMarkdown(md) {
    if (window.marked) return (marked.parse ? marked.parse(md) : marked(md));
    return escapeHtml(md).replace(/\n/g, '<br>');
  }

  async function postJSON(path, body, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } finally { clearTimeout(t); }
  }

  /* Downscale an image File using <canvas>. Returns { dataUrl, mime, size }. */
  function processImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('讀取檔案失敗 File read error'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('圖片格式不支援 Unsupported image'));
        img.onload = () => {
          let { width, height } = img;
          const max = CONFIG.MAX_IMAGE_DIMENSION;
          if (width > max || height > max) {
            const scale = Math.min(max / width, max / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          // Keep PNG (transparency) if it stays small, else JPEG to save space.
          let mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          let dataUrl = canvas.toDataURL(mime, CONFIG.IMAGE_QUALITY);
          if (mime === 'image/png' && dataUrl.length > 3.2 * 1024 * 1024) {
            mime = 'image/jpeg';
            dataUrl = canvas.toDataURL(mime, CONFIG.IMAGE_QUALITY);
          }
          const size = Math.round((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 3 / 4);
          resolve({ dataUrl, mime, size });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* localStorage fallback queue (used when the API is unreachable) */
  const QUEUE_KEY = 'polyu_pending_submissions';
  function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
  function writeQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* sandbox may block */ } }

  /* =========================================================================
   * STUDENT PAGE
   * =======================================================================*/
  function initStudentPage() {
    const INSTRUCTIONS_MD = [
      '### 👋 歡迎來到 AI 創作坊！',
      '1. **選擇你的名字**，再輸入老師給你的**學生編號**。',
      '2. 上載你用 AI 製作的**圖片** 🖼️，或貼上你的 **HTML 程式碼** 💻。',
      '3. 按 **提交** 🚀 — 完成啦！'
    ].join('\n');
    $('instructions').innerHTML = renderMarkdown(INSTRUCTIONS_MD);

    let verified = null;          // { name, id }
    let mode = 'image';           // 'image' | 'html'
    let selectedImage = null;     // { dataUrl, mime, size }
    let localStudents = null;     // full list (fallback verify)

    /* --- Populate name dropdown (API → fallback to students.json) --- */
    (async function loadNames() {
      const select = $('nameSelect');
      let names = [];
      try {
        const res = await fetch(apiUrl('/api/students'));
        if (res.ok) names = (await res.json()).map((s) => s.name);
      } catch { /* fall through */ }
      if (!names.length) {
        try {
          const res = await fetch('students.json');
          localStudents = await res.json();
          names = localStudents.map((s) => s.name);
        } catch { toast('無法載入名單 Could not load name list', 'err'); }
      }
      names.forEach((n) => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n; select.appendChild(o);
      });
    })();

    async function ensureLocalStudents() {
      if (localStudents) return localStudents;
      try { localStudents = await (await fetch('students.json')).json(); } catch { localStudents = []; }
      return localStudents;
    }

    /* --- Verify --- */
    $('verifyBtn').addEventListener('click', async () => {
      const name = $('nameSelect').value.trim();
      const id = $('studentId').value.trim();
      const msg = $('verifyMsg');
      if (!name) { msg.className = 'msg err'; msg.textContent = '⚠️ 請先選擇名字 Please choose your name.'; return; }
      if (!id) { msg.className = 'msg err'; msg.textContent = '⚠️ 請輸入學生編號 Please enter your ID.'; return; }

      $('verifyBtn').disabled = true;
      msg.className = 'msg'; msg.textContent = '檢查中… Checking…';

      let valid = false;
      try {
        const r = await postJSON('/api/verify', { name, studentId: id });
        valid = !!(r.data && r.data.valid);
      } catch {
        // Fallback: verify against local students.json
        const list = await ensureLocalStudents();
        valid = list.some((s) => String(s.id) === id && s.name === name);
      }
      $('verifyBtn').disabled = false;

      if (valid) {
        verified = { name, id };
        msg.className = 'msg ok'; msg.textContent = '✅ 確認成功 Verified!';
        $('welcomeMsg').textContent = `你好，${name}！🎉 準備好上載你的作品了嗎？`;
        $('uploadCard').classList.remove('hidden');
        $('uploadCard').scrollIntoView({ behavior: 'smooth' });
        refreshSyncButton();
      } else {
        msg.className = 'msg err';
        msg.textContent = '❌ 名字或編號不正確 Name or ID is incorrect. 請再試一次 Try again.';
      }
    });

    /* --- Tab switching --- */
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        mode = tab.dataset.mode;
        $('imageMode').classList.toggle('hidden', mode !== 'image');
        $('htmlMode').classList.toggle('hidden', mode !== 'html');
      });
    });

    /* --- Image: drag & drop + picker --- */
    const dz = $('dropZone');
    $('pickFileBtn').addEventListener('click', () => $('fileInput').click());
    dz.addEventListener('click', (e) => { if (e.target === dz || e.target.closest('.dz-title, .dz-icon')) $('fileInput').click(); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
    $('fileInput').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) handleFile(f); });

    async function handleFile(file) {
      if (!file.type.startsWith('image/')) { toast('請選擇圖片檔案 Please choose an image', 'err'); return; }
      if (file.size > CONFIG.MAX_FILE_BYTES) { toast('檔案太大（最大 10MB）File too large', 'err'); return; }
      try {
        selectedImage = await processImage(file);
        selectedImage.fileName = file.name;
        $('previewImg').src = selectedImage.dataUrl;
        $('fileInfo').textContent = `${file.name} · ${(selectedImage.size / 1024).toFixed(0)} KB`;
        $('imagePreview').classList.remove('hidden');
      } catch (err) { toast(err.message, 'err'); }
    }
    $('clearImageBtn').addEventListener('click', () => {
      selectedImage = null; $('fileInput').value = '';
      $('imagePreview').classList.add('hidden'); $('previewImg').src = '';
    });

    /* --- HTML preview (sandboxed iframe) --- */
    $('previewHtmlBtn').addEventListener('click', () => {
      const code = $('htmlInput').value;
      const frame = $('htmlPreviewFrame');
      frame.srcdoc = code;            // sandbox="" => isolated, scripts won't run
      frame.classList.remove('hidden');
    });

    /* --- Submit --- */
    $('submitBtn').addEventListener('click', submit);

    async function submit() {
      if (!verified) { toast('請先確認身份 Please verify first', 'err'); return; }

      let payload;
      if (mode === 'image') {
        if (!selectedImage) { toast('請先選擇圖片 Please choose an image', 'err'); return; }
        payload = { name: verified.name, studentId: verified.id, type: 'image',
                    fileName: selectedImage.fileName, base64Data: selectedImage.dataUrl };
      } else {
        const content = $('htmlInput').value.trim();
        if (!content) { toast('請先貼上程式碼 Please paste your code', 'err'); return; }
        payload = { name: verified.name, studentId: verified.id, type: 'html', content };
      }

      const btn = $('submitBtn');
      btn.disabled = true; const label = btn.textContent; btn.textContent = '上載中… Uploading…';

      try {
        const r = await postJSON('/api/upload', payload);
        if (r.ok && r.data && r.data.success) {
          toast(`🎉 成功提交！Submission ID: ${r.data.id ? String(r.data.id).slice(-6) : 'OK'}`, 'ok');
          resetAfterSubmit();
        } else {
          throw new Error((r.data && r.data.error) || ('HTTP ' + r.status));
        }
      } catch (err) {
        // Graceful fallback → store locally, offer "Sync Later"
        const q = readQueue(); q.push({ ...payload, savedAt: Date.now() }); writeQueue(q);
        toast('⚠️ 暫時無法連線，已儲存在本機。Saved locally — use “Sync Later”.', 'warn');
        refreshSyncButton();
      } finally {
        btn.disabled = false; btn.textContent = label;
      }
    }

    function resetAfterSubmit() {
      selectedImage = null; $('fileInput').value = '';
      $('imagePreview').classList.add('hidden'); $('previewImg').src = '';
      $('htmlInput').value = ''; $('htmlPreviewFrame').classList.add('hidden');
    }

    /* --- "Sync Later" for queued submissions --- */
    function refreshSyncButton() {
      const q = readQueue();
      const btn = $('syncBtn');
      if (q.length) { btn.classList.remove('hidden'); btn.textContent = `🔁 同步 ${q.length} 個待上載作品 Sync ${q.length} pending`; }
      else btn.classList.add('hidden');
    }
    $('syncBtn').addEventListener('click', async () => {
      let q = readQueue(); if (!q.length) return;
      $('syncBtn').disabled = true;
      const remaining = [];
      for (const item of q) {
        try {
          const r = await postJSON('/api/upload', item);
          if (!(r.ok && r.data && r.data.success)) remaining.push(item);
        } catch { remaining.push(item); }
      }
      writeQueue(remaining);
      $('syncBtn').disabled = false;
      refreshSyncButton();
      toast(remaining.length ? `仍有 ${remaining.length} 個未能上載` : '✅ 全部已同步！All synced!', remaining.length ? 'warn' : 'ok');
    });

    refreshSyncButton();
  }

  /* =========================================================================
   * ADMIN PAGE
   * =======================================================================*/
  function initAdminPage() {
    let timer = null;
    let current = [];

    async function fetchSubmissions() {
      try {
        const res = await fetch(apiUrl('/api/submissions'));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        current = await res.json();
        render(current);
        $('lastUpdated').textContent = '更新於 ' + new Date().toLocaleTimeString('zh-HK');
      } catch (err) {
        $('lastUpdated').textContent = '⚠️ 連線失敗 — 將重試';
      }
    }

    function render(rows) {
      const body = $('subsBody');
      body.innerHTML = '';
      $('emptyMsg').style.display = rows.length ? 'none' : 'block';

      let imgN = 0, htmlN = 0;
      rows.forEach((r) => {
        if (r.type === 'image') imgN++; else htmlN++;
        const tr = document.createElement('tr');

        // Preview cell
        const previewTd = document.createElement('td');
        if (r.type === 'image') {
          const img = document.createElement('img');
          img.className = 'thumb'; img.loading = 'lazy';
          img.src = r.thumbnailUrl || r.downloadUrl || '';
          img.alt = r.studentName;
          img.addEventListener('click', () => openImageModal(r));
          previewTd.appendChild(img);
        } else {
          const box = document.createElement('div');
          box.className = 'html-icon'; box.textContent = '💻'; box.title = '預覽 HTML';
          box.addEventListener('click', () => openHtmlModal(r));
          previewTd.appendChild(box);
        }
        tr.appendChild(previewTd);

        tr.appendChild(cell(escapeHtml(r.studentName)));
        tr.appendChild(cell(escapeHtml(r.studentId)));
        tr.appendChild(cell(`<span class="badge ${r.type}">${r.type === 'image' ? '🖼️ 圖片' : '💻 HTML'}</span>`, true));
        tr.appendChild(cell(escapeHtml(new Date(r.createdDateTime).toLocaleString('zh-HK'))));

        const actions = document.createElement('td');
        actions.innerHTML = `<div class="row-actions">
            <button class="btn btn-secondary" data-act="view">👀 View</button>
            <a class="btn btn-primary" href="${escapeHtml(r.downloadUrl || '#')}" download="${escapeHtml(r.fileName)}">⬇️ Download</a>
          </div>`;
        actions.querySelector('[data-act="view"]').addEventListener('click', () =>
          r.type === 'image' ? openImageModal(r) : openHtmlModal(r));
        tr.appendChild(actions);

        body.appendChild(tr);
      });

      $('statCount').textContent = rows.length;
      $('statImages').textContent = imgN;
      $('statHtml').textContent = htmlN;
    }

    function cell(html, isHtml) {
      const td = document.createElement('td');
      if (isHtml) td.innerHTML = html; else td.textContent = html.replace(/&[a-z#0-9]+;/g, (m) => m); // already escaped
      if (!isHtml) td.innerHTML = html;
      return td;
    }

    /* --- Modals --- */
    function openImageModal(r) {
      $('modalTitle').textContent = `${r.studentName} (${r.studentId})`;
      $('modalContent').innerHTML = `<img src="${escapeHtml(r.downloadUrl || r.thumbnailUrl)}" alt="${escapeHtml(r.studentName)}">`;
      $('modal').classList.remove('hidden');
    }
    async function openHtmlModal(r) {
      $('modalTitle').textContent = `${r.studentName} (${r.studentId})`;
      $('modalContent').innerHTML = '載入中… Loading…';
      $('modal').classList.remove('hidden');
      let html = '<p class="muted">無法載入內容</p>';
      try {
        // Proxy through our API to avoid cross-origin issues
        const res = await fetch(apiUrl('/api/file?id=' + encodeURIComponent(r.id)));
        if (res.ok) html = await res.text();
      } catch { /* keep fallback */ }
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', ''); // isolated render
      frame.srcdoc = html;
      $('modalContent').innerHTML = '';
      $('modalContent').appendChild(frame);
    }
    $('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

    /* --- CSV export --- */
    $('exportBtn').addEventListener('click', () => {
      const headers = ['Name', 'StudentID', 'Type', 'FileName', 'Time', 'DownloadURL'];
      const csvEscape = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = [headers.join(',')];
      current.forEach((r) => lines.push([r.studentName, r.studentId, r.type, r.fileName, r.createdDateTime, r.downloadUrl || ''].map(csvEscape).join(',')));
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `polyu_submissions_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    });

    /* --- Polling control --- */
    function startTimer() { stopTimer(); timer = setInterval(fetchSubmissions, CONFIG.POLL_INTERVAL_MS); }
    function stopTimer() { if (timer) clearInterval(timer); timer = null; }
    $('autoRefresh').addEventListener('change', (e) => { e.target.checked ? startTimer() : stopTimer(); });
    $('refreshBtn').addEventListener('click', fetchSubmissions);

    fetchSubmissions();
    startTimer();
  }

  /* =========================================================================
   * BOOT — detect which page we are on
   * =======================================================================*/
  document.addEventListener('DOMContentLoaded', () => {
    if ($('verifyCard')) initStudentPage();
    if ($('subsBody')) initAdminPage();
  });
})();
