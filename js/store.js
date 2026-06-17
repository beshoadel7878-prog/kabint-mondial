/* =============================================================================
 * store.js — Local data layer for "كابينة مونديال"
 * No backend. Everything persists in localStorage. Exposes window.Store.
 *
 * This file is the SHARED CONTRACT used by every page module.
 * Do not change method names/shapes without updating the pages.
 * ========================================================================== */
(function () {
  'use strict';

  var KEY_NEWS = 'km_news_v1';
  var KEY_POSTERS = 'km_posters_v1';
  var KEY_AUTO_BACKUP = 'km_auto_backup_v1';
  var KEY_SETTINGS = 'km_settings_v1';
  var SCHEMA_VERSION = 2;

  var DEFAULT_SETTINGS = {
    newspaperName: 'كابينة مونديال',
    newspaperSubtitle: 'جريدة كأس العالم اليومية',
    issue: '',
    teamCountry: '',
    accent: ''
  };

  /* ---- Importance levels (ordered: critical first) ---- */
  var IMPORTANCE = [
    { key: 'critical',  label: 'مهم جدًا',  order: 0, badgeClass: 'badge-critical' },
    { key: 'important', label: 'مهم',        order: 1, badgeClass: 'badge-important' },
    { key: 'normal',    label: 'عادي',       order: 2, badgeClass: 'badge-normal' },
    { key: 'low',       label: 'غير مهم',   order: 3, badgeClass: 'badge-low' }
  ];
  var IMPORTANCE_BY_KEY = {};
  IMPORTANCE.forEach(function (i) { IMPORTANCE_BY_KEY[i.key] = i; });

  /* ---- Tournament stages (Arabic) ---- */
  var STAGES = [
    'دور المجموعات', 'دور الـ16', 'ربع النهائي', 'نصف النهائي',
    'تحديد المركز الثالث', 'النهائي', 'ودية', 'تصفيات'
  ];

  /* ---- Content pipeline status ---- */
  var STATUSES = [
    { key: 'draft',     label: 'مسودة',        badgeClass: 'badge-status-draft' },
    { key: 'ready',     label: 'جاهز للإنتاج', badgeClass: 'badge-status-ready' },
    { key: 'published', label: 'تم النشر',     badgeClass: 'badge-status-published' }
  ];
  var STATUS_BY_KEY = {};
  STATUSES.forEach(function (s) { STATUS_BY_KEY[s.key] = s; });

  /* ---- Poster templates ---- */
  var TEMPLATES = [
    { key: 'vintage',  label: 'جريدة كلاسيكية',   desc: 'ورق بيج قديم، طباعة سوداء، الصورة يمينًا والعنوان يسارًا.' },
    { key: 'breaking', label: 'خبر عاجل',          desc: 'شريط عاجل أحمر بنمط الجرائد القديمة.' },
    { key: 'result',   label: 'نتيجة مباراة',      desc: 'تخطيط مخصص لإبراز النتيجة والفريقين.' },
    { key: 'player',   label: 'قصة لاعب',           desc: 'صورة بورتريه كبيرة مع عنوان درامي.' },
    { key: 'final',    label: 'خاص بالنهائي',       desc: 'تصميم احتفالي خاص بمباراة النهائي.' },
    { key: 'double',   label: 'خبرين بصورتين',      desc: 'خبران كاملان فوق بعض، لكلٍّ عنوان ونص وصورة وتعليق.' }
  ];

  /* ============================ utilities ============================ */
  function uid(prefix) {
    var t = Date.now().toString(36);
    var r = Math.floor(Math.random() * 1e9).toString(36);
    return (prefix || 'id') + '_' + t + r;
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Store.read failed for', key, e);
      return [];
    }
  }

  function write(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
      return true;
    } catch (e) {
      console.error('Store.write failed for', key, e);
      // Most common cause: quota exceeded (big base64 images).
      notifyError(e);
      return false;
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Multiline-safe escape that converts newlines into <br> for display.
  function escapeMultiline(str) {
    return escapeHtml(str).replace(/\r?\n/g, '<br>');
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function isSameDay(tsOrISO, refDate) {
    if (!tsOrISO) return false;
    var d = (typeof tsOrISO === 'number') ? new Date(tsOrISO) : new Date(tsOrISO + 'T00:00:00');
    var r = refDate || new Date();
    return d.getFullYear() === r.getFullYear()
      && d.getMonth() === r.getMonth()
      && d.getDate() === r.getDate();
  }

  // Arabic-friendly date formatting.
  function formatDate(value) {
    if (!value) return '';
    var d = (typeof value === 'number') ? new Date(value) : new Date(value + 'T00:00:00');
    if (isNaN(d.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat('ar', {
        year: 'numeric', month: 'long', day: 'numeric'
      }).format(d);
    } catch (e) {
      return d.toLocaleDateString();
    }
  }

  function formatDateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat('ar', {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(d);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(''); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function imageToCompressedDataURL(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var maxW = opts.maxWidth || 1600;
          var maxH = opts.maxHeight || 1200;
          var quality = opts.quality || 0.84;
          var mime = opts.mimeType || 'image/jpeg';
          var scale = Math.min(1, maxW / img.width, maxH / img.height);
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));

          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(objectUrl);
          resolve(canvas.toDataURL(mime, quality));
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('image decode failed'));
      };
      img.src = objectUrl;
    });
  }

  function dataUrlBytes(dataUrl) {
    if (!dataUrl) return 0;
    var comma = String(dataUrl).indexOf(',');
    var payload = comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl);
    return Math.round(payload.length * 0.75);
  }

  function fileToDataURL(file, opts) {
    opts = opts || {};
    if (!file) return Promise.resolve('');
    var isCompressibleImage = /^image\/(png|jpe?g|webp)$/i.test(file.type || '');
    if (!opts.skipCompression && isCompressibleImage && typeof document !== 'undefined') {
      return imageToCompressedDataURL(file, opts).catch(function () {
        return readFileAsDataURL(file);
      });
    }
    return readFileAsDataURL(file);
  }

  /* ============================ pub/sub ============================ */
  var subscribers = [];
  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function unsubscribe() {
      subscribers = subscribers.filter(function (f) { return f !== fn; });
    };
  }
  function emit(evt) {
    subscribers.forEach(function (fn) {
      try { fn(evt); } catch (e) { console.error('subscriber error', e); }
    });
  }

  function notifyError(e) {
    if (window.App && typeof window.App.toast === 'function') {
      window.App.toast('تعذّر الحفظ محليًا — قد تكون مساحة التخزين ممتلئة (الصور كبيرة). صدّر نسخة وامسح القديم.', 'error', 6000);
    }
  }

  /* ============================ NEWS schema ============================ */
  function normalizeNews(input) {
    input = input || {};
    return {
      id: input.id || uid('news'),
      title: (input.title || '').trim(),
      matchName: (input.matchName || '').trim(),
      teamA: (input.teamA || '').trim(),
      teamB: (input.teamB || '').trim(),
      score: (input.score || '').trim(),
      matchDate: (input.matchDate || '').trim(),
      stage: (input.stage || '').trim(),
      country: (input.country || '').trim(),
      rawNews: (input.rawNews || ''),
      summary: (input.summary || ''),
      importance: IMPORTANCE_BY_KEY[input.importance] ? input.importance : 'normal',
      moments: (input.moments || ''),
      videoAngle: (input.videoAngle || ''),
      videoTitle: (input.videoTitle || ''),
      editorNotes: (input.editorNotes || ''),
      image: (input.image || ''),
      group: (input.group || '').trim(),
      status: STATUS_BY_KEY[input.status] ? input.status : '',
      archived: !!input.archived,
      tags: normalizeTags(input.tags),
      createdAt: input.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  // Tags accept either an array or a comma/Arabic-comma separated string.
  function normalizeTags(tags) {
    if (Array.isArray(tags)) {
      return tags.map(function (t) { return String(t || '').trim(); }).filter(Boolean);
    }
    if (typeof tags === 'string') {
      return tags.split(/[,،]/).map(function (t) { return t.trim(); }).filter(Boolean);
    }
    return [];
  }

  function getNews() {
    return read(KEY_NEWS);
  }

  // Sorted: importance (critical first) then newest updated.
  function getNewsSorted() {
    return getNews().slice().sort(function (a, b) {
      var oa = (IMPORTANCE_BY_KEY[a.importance] || {}).order;
      var ob = (IMPORTANCE_BY_KEY[b.importance] || {}).order;
      if (oa == null) oa = 99; if (ob == null) ob = 99;
      if (oa !== ob) return oa - ob;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getNewsById(id) {
    return getNews().filter(function (n) { return n.id === id; })[0] || null;
  }

  // Upsert by id; returns the saved item (or null on failure).
  function saveNews(item) {
    var list = getNews();
    var rec = normalizeNews(item);
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === rec.id) { idx = i; break; } }
    if (idx >= 0) {
      rec.createdAt = list[idx].createdAt || rec.createdAt;
      list[idx] = rec;
    } else {
      list.push(rec);
    }
    if (!write(KEY_NEWS, list)) return null;
    emit({ type: 'news', action: idx >= 0 ? 'update' : 'create', id: rec.id });
    return rec;
  }

  function deleteNews(id) {
    var list = getNews().filter(function (n) { return n.id !== id; });
    if (!write(KEY_NEWS, list)) return false;
    emit({ type: 'news', action: 'delete', id: id });
    return true;
  }

  /* ============================ POSTER schema ============================ */
  function normalizePoster(input) {
    input = input || {};
    var tmpl = TEMPLATES.filter(function (t) { return t.key === input.template; })[0];
    return {
      id: input.id || uid('poster'),
      template: tmpl ? input.template : 'vintage',
      size: (input.size || 'landscape'),
      newspaperName: (input.newspaperName || '').trim(),
      newspaperSubtitle: (input.newspaperSubtitle || '').trim(),
      issue: (input.issue || '').trim(),
      posterDate: input.posterDate || todayISO(),
      headline: (input.headline || ''),
      subheadline: (input.subheadline || ''),
      description: (input.description || ''),
      imageCaption: (input.imageCaption || ''),
      image: (input.image || ''),
      secondHeadline: (input.secondHeadline || ''),
      secondDescription: (input.secondDescription || ''),
      secondImageCaption: (input.secondImageCaption || ''),
      secondImage: (input.secondImage || ''),
      sourceNewsId: input.sourceNewsId || null,
      preview: (input.preview || ''),
      createdAt: input.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  function getPosters() {
    return read(KEY_POSTERS).slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getPosterById(id) {
    return read(KEY_POSTERS).filter(function (p) { return p.id === id; })[0] || null;
  }

  function savePoster(poster) {
    var list = read(KEY_POSTERS);
    var rec = normalizePoster(poster);
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === rec.id) { idx = i; break; } }
    if (idx >= 0) {
      rec.createdAt = list[idx].createdAt || rec.createdAt;
      list[idx] = rec;
    } else {
      list.push(rec);
    }
    if (!write(KEY_POSTERS, list)) return null;
    emit({ type: 'poster', action: idx >= 0 ? 'update' : 'create', id: rec.id });
    return rec;
  }

  function deletePoster(id) {
    var list = read(KEY_POSTERS).filter(function (p) { return p.id !== id; });
    if (!write(KEY_POSTERS, list)) return false;
    emit({ type: 'poster', action: 'delete', id: id });
    return true;
  }

  /* ============================ stats ============================ */
  function stats() {
    var news = getNews();
    var ref = new Date();
    var by = { critical: 0, important: 0, normal: 0, low: 0 };
    var todayCount = 0;
    var lastUpdate = 0;
    var archivedCount = 0;
    news.forEach(function (n) {
      if ((n.updatedAt || 0) > lastUpdate) lastUpdate = n.updatedAt;
      // Archived items are kept for history but excluded from the active counts.
      if (n.archived) { archivedCount++; return; }
      if (by[n.importance] != null) by[n.importance]++;
      // "اليوم" = created today OR match scheduled today
      if (isSameDay(n.createdAt, ref) || isSameDay(n.matchDate, ref)) todayCount++;
    });
    var posters = read(KEY_POSTERS);
    posters.forEach(function (p) { if ((p.updatedAt || 0) > lastUpdate) lastUpdate = p.updatedAt; });

    return {
      total: news.length,
      active: news.length - archivedCount,
      archived: archivedCount,
      today: todayCount,
      important: by.critical + by.important,  // مهم جدًا + مهم
      normal: by.normal + by.low,             // عادي + غير مهم
      byImportance: by,
      posters: posters.length,
      lastUpdate: lastUpdate || 0
    };
  }

  /* ============================ export / import ============================ */
  function buildBackup() {
    return {
      app: 'kabint-mondial',
      version: SCHEMA_VERSION,
      exportedAt: Date.now(),
      news: getNews(),
      posters: read(KEY_POSTERS),
      settings: getSettings()
    };
  }

  function saveAutoBackup(reason) {
    try {
      var backup = buildBackup();
      backup.reason = reason || 'auto';
      localStorage.setItem(KEY_AUTO_BACKUP, JSON.stringify(backup));
      return true;
    } catch (e) {
      console.warn('Auto backup failed', e);
      return false;
    }
  }

  function getAutoBackup() {
    try {
      var raw = localStorage.getItem(KEY_AUTO_BACKUP);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function exportJSON() {
    var data = buildBackup();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'kabint-mondial-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    return data;
  }

  // Accepts a parsed object OR a JSON string. mode: 'replace' | 'merge'
  // Returns { ok, news, posters, error }
  function importData(payload, mode) {
    mode = mode || 'replace';
    var data;
    try {
      data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    } catch (e) {
      return { ok: false, error: 'ملف JSON غير صالح.' };
    }
    if (!data || (typeof data !== 'object') || Array.isArray(data)) {
      return { ok: false, error: 'محتوى الملف غير معروف.' };
    }
    // Must look like a كابينة مونديال backup — otherwise replace mode would wipe
    // everything for any unrelated JSON file.
    if (!Array.isArray(data.news) && !Array.isArray(data.posters)) {
      return { ok: false, error: 'الملف لا يحتوي على بيانات كابينة مونديال (أخبار أو بوسترات).' };
    }
    var incomingNews = Array.isArray(data.news) ? data.news.map(normalizeNews) : [];
    var incomingPosters = Array.isArray(data.posters) ? data.posters.map(normalizePoster) : [];

    // Snapshot for atomic rollback: if the 2nd write fails (quota), the store
    // must not be left half-replaced.
    var prevNews = localStorage.getItem(KEY_NEWS);
    var prevPosters = localStorage.getItem(KEY_POSTERS);

    var okN, okP;
    if (mode === 'merge') {
      var news = getNews();
      var posters = read(KEY_POSTERS);
      incomingNews.forEach(function (n) { upsertInto(news, n); });
      incomingPosters.forEach(function (p) { upsertInto(posters, p); });
      okN = write(KEY_NEWS, news);
      okP = okN ? write(KEY_POSTERS, posters) : false;
    } else {
      if (getNews().length || read(KEY_POSTERS).length) {
        saveAutoBackup('before-import-replace');
      }
      okN = write(KEY_NEWS, incomingNews);
      okP = okN ? write(KEY_POSTERS, incomingPosters) : false;
    }
    // Surface storage-quota failures instead of reporting a false success,
    // and roll back to the pre-import state so nothing is half-applied.
    if (!okN || !okP) {
      restoreRaw(KEY_NEWS, prevNews);
      restoreRaw(KEY_POSTERS, prevPosters);
      return { ok: false, error: 'تعذّر الحفظ — قد تكون مساحة التخزين ممتلئة. صدّر نسخة واحذف محتوى قديمًا.' };
    }
    // Import settings too (schema-versioned backups carry them). Replace mode
    // overwrites; merge mode keeps existing values for keys not in the file.
    if (data.settings && typeof data.settings === 'object') {
      try {
        var merged = (mode === 'merge')
          ? Object.assign({}, getSettings(), data.settings)
          : Object.assign({}, DEFAULT_SETTINGS, data.settings);
        localStorage.setItem(KEY_SETTINGS, JSON.stringify(merged));
      } catch (e) { /* non-fatal */ }
    }
    emit({ type: 'import', action: mode });
    return {
      ok: true, news: incomingNews.length, posters: incomingPosters.length,
      versionNote: (data.version && data.version > SCHEMA_VERSION)
        ? 'الملف من إصدار أحدث (' + data.version + ') — تم الاستيراد مع تجاهل أي حقول غير معروفة.'
        : ''
    };
  }

  function upsertInto(arr, rec) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === rec.id) { arr[i] = rec; return; }
    }
    arr.push(rec);
  }

  // Reads a File (from <input type=file>) and imports it.
  function importFromFile(file, mode) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ ok: false, error: 'لم يتم اختيار ملف.' }); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(importData(reader.result, mode)); };
      reader.onerror = function () { resolve({ ok: false, error: 'تعذّر قراءة الملف.' }); };
      reader.readAsText(file);
    });
  }

  function restoreRaw(key, raw) {
    try {
      if (raw === null || raw === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch (e) { /* ignore */ }
  }

  function clearAll() {
    localStorage.removeItem(KEY_NEWS);
    localStorage.removeItem(KEY_POSTERS);
    emit({ type: 'clear', action: 'all' });
  }

  // Counts EVERY app key (km_*), so the gauge reflects true usage including the
  // auto-backup (which roughly duplicates the data) and seed/flag keys.
  function storageUsage() {
    var total = 0;
    var byKey = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('km_') !== 0) continue;
      var raw = localStorage.getItem(k) || '';
      var bytes = raw.length * 2; // localStorage stores UTF-16 in most browsers.
      byKey[k] = bytes;
      total += bytes;
    }
    return {
      bytes: total,
      mb: total / (1024 * 1024),
      label: (total / (1024 * 1024)).toFixed(total > 1024 * 1024 ? 1 : 2) + ' MB',
      warning: total > 3.8 * 1024 * 1024,
      byKey: byKey,
      news: byKey[KEY_NEWS] || 0,
      posters: byKey[KEY_POSTERS] || 0,
      backup: byKey[KEY_AUTO_BACKUP] || 0
    };
  }

  /* ============================ search / filter / sort ============================ */
  function isoOfTs(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // The "day" an item belongs to: its match date, else the day it was created.
  function newsDayKey(n) {
    return (n && n.matchDate && n.matchDate.trim()) ? n.matchDate.trim() : isoOfTs(n && n.createdAt);
  }

  var SEARCH_FIELDS = ['title', 'matchName', 'teamA', 'teamB', 'score', 'stage',
    'country', 'summary', 'rawNews', 'moments', 'videoTitle', 'videoAngle', 'editorNotes'];

  function sortNews(list, sort) {
    var arr = list.slice();
    if (sort === 'newest') return arr.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    if (sort === 'oldest') return arr.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    if (sort === 'matchDate') return arr.sort(function (a, b) { return String(newsDayKey(b)).localeCompare(String(newsDayKey(a))); });
    if (sort === 'team') return arr.sort(function (a, b) {
      return String(a.teamA || a.matchName || '').localeCompare(String(b.teamA || b.matchName || ''), 'ar');
    });
    // default: importance (critical first) then newest
    return arr.sort(function (a, b) {
      var oa = (IMPORTANCE_BY_KEY[a.importance] || {}).order;
      var ob = (IMPORTANCE_BY_KEY[b.importance] || {}).order;
      if (oa == null) oa = 99; if (ob == null) ob = 99;
      if (oa !== ob) return oa - ob;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  // opts: { query, importance, stage, country, day, sort, tag, archived }
  //   archived: 'all' (default) | 'active' | 'archived'
  function getNewsFiltered(opts) {
    opts = opts || {};
    var q = (opts.query || '').trim().toLowerCase();
    var imp = opts.importance || '';
    var stage = opts.stage || '';
    var country = opts.country || '';
    var day = opts.day || '';
    var tag = opts.tag || '';
    var grp = opts.group || '';
    var status = opts.status || '';
    var arch = opts.archived || 'all';
    var list = getNews().filter(function (n) {
      if (arch === 'active' && n.archived) return false;
      if (arch === 'archived' && !n.archived) return false;
      if (imp && n.importance !== imp) return false;
      if (stage && n.stage !== stage) return false;
      if (country && n.country !== country) return false;
      if (grp && n.group !== grp) return false;
      if (status && n.status !== status) return false;
      if (day && newsDayKey(n) !== day) return false;
      if (tag && !(n.tags || []).some(function (t) { return t === tag; })) return false;
      if (q) {
        var hay = '';
        for (var i = 0; i < SEARCH_FIELDS.length; i++) hay += ' ' + String(n[SEARCH_FIELDS[i]] || '');
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    return sortNews(list, opts.sort || 'importance');
  }

  function getNewsDays() {
    var set = {};
    getNews().forEach(function (n) { var d = newsDayKey(n); if (d) set[d] = (set[d] || 0) + 1; });
    return Object.keys(set).sort().reverse().map(function (d) { return { day: d, count: set[d] }; });
  }
  function getDistinct(field) {
    var set = {};
    getNews().forEach(function (n) { var v = (n[field] || '').trim(); if (v) set[v] = true; });
    return Object.keys(set);
  }

  /* ============================ storage management ============================ */
  function deleteManyNews(ids) {
    if (!ids || !ids.length) return false;
    var set = {};
    ids.forEach(function (i) { set[i] = true; });
    var list = getNews().filter(function (n) { return !set[n.id]; });
    if (!write(KEY_NEWS, list)) return false;
    emit({ type: 'news', action: 'delete-many' });
    return true;
  }
  function deleteAllPosters() {
    if (!write(KEY_POSTERS, [])) return false;
    emit({ type: 'poster', action: 'delete-all' });
    return true;
  }
  // Frees the heaviest payload (base64 images) without losing the text content.
  function stripNewsImages() {
    var list = getNews().map(function (n) { n.image = ''; return n; });
    if (!write(KEY_NEWS, list)) return false;
    emit({ type: 'news', action: 'strip-images' });
    return true;
  }
  function stripPosterImages() {
    var list = read(KEY_POSTERS).map(function (p) { p.image = ''; p.secondImage = ''; p.preview = ''; return p; });
    if (!write(KEY_POSTERS, list)) return false;
    emit({ type: 'poster', action: 'strip-images' });
    return true;
  }
  // Restore the silent auto-backup taken before the last destructive replace.
  // Does NOT overwrite the backup slot (so the user can retry).
  function restoreAutoBackup() {
    var b = getAutoBackup();
    if (!b || (!Array.isArray(b.news) && !Array.isArray(b.posters))) {
      return { ok: false, error: 'لا توجد نسخة احتياطية تلقائية صالحة.' };
    }
    var prevNews = localStorage.getItem(KEY_NEWS);
    var prevPosters = localStorage.getItem(KEY_POSTERS);
    var okN = write(KEY_NEWS, (b.news || []).map(normalizeNews));
    var okP = okN ? write(KEY_POSTERS, (b.posters || []).map(normalizePoster)) : false;
    if (!okN || !okP) {
      restoreRaw(KEY_NEWS, prevNews);
      restoreRaw(KEY_POSTERS, prevPosters);
      return { ok: false, error: 'تعذّر استعادة النسخة الاحتياطية.' };
    }
    emit({ type: 'import', action: 'restore-backup' });
    return { ok: true, news: (b.news || []).length, posters: (b.posters || []).length };
  }

  /* ============================ settings ============================ */
  function getSettings() {
    try {
      var raw = localStorage.getItem(KEY_SETTINGS);
      var s = raw ? JSON.parse(raw) : {};
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings(obj) {
    var next = Object.assign({}, getSettings(), obj || {});
    try {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
      emit({ type: 'settings', action: 'save' });
      return next;
    } catch (e) {
      notifyError(e);
      return null;
    }
  }

  /* ============================ tags / archive / footprint ============================ */
  function getAllTags() {
    var set = {};
    getNews().forEach(function (n) {
      (n.tags || []).forEach(function (t) { if (t) set[t] = (set[t] || 0) + 1; });
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ar'); })
      .map(function (t) { return { tag: t, count: set[t] }; });
  }

  function setArchived(id, val) {
    var list = getNews();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].archived = !!val; list[i].updatedAt = Date.now(); found = true; break; }
    }
    if (!found) return false;
    if (!write(KEY_NEWS, list)) return false;
    emit({ type: 'news', action: 'archive', id: id });
    return true;
  }

  // Rough check used before saving image-heavy records to warn near the ~5MB cap.
  function nearQuota(extraBytes) {
    var u = storageUsage();
    return (u.bytes + (extraBytes || 0)) > 4.5 * 1024 * 1024;
  }

  /* ============================ demo seed (first run only) ============================ */
  function seedIfEmpty() {
    if (localStorage.getItem(KEY_NEWS) !== null) return false;
    var now = Date.now();
    var demo = [
      normalizeNews({
        title: 'مصر تخسر بشق الأنفس أمام بلجيكا',
        matchName: 'مصر × بلجيكا', teamA: 'مصر', teamB: 'بلجيكا', score: '1-2',
        matchDate: todayISO(), stage: 'دور المجموعات', country: 'مصر',
        rawNews: 'مصر لعبت النهاردة ضد بلجيكا وخسرت 2-1، صلاح سجل هدف، الدفاع كان ضعيف، الجمهور زعلان، وفي جدل على تبديل المدرب.',
        summary: 'خسارة مؤثرة لمنتخب مصر أمام بلجيكا بنتيجة 1-2 رغم هدف محمد صلاح المميز. أداء دفاعي مهزوز وجدل تحكيمي وتكتيكي حول قرارات المدرب أشعل غضب الجماهير.',
        importance: 'critical',
        moments: 'هدف صلاح الرائع في الدقيقة 34\nخطأ دفاعي قاتل أدى للهدف الثاني\nجدل حول التبديل المبكر للمدرب',
        videoAngle: 'تحليل الأخطاء الدفاعية التي كلّفت مصر المباراة + إبراز هدف صلاح.',
        videoTitle: 'صلاح يسجل.. والدفاع يخذل مصر أمام بلجيكا 🔥',
        editorNotes: 'استخدم لقطة الهدف بالبطيء، وأضف موسيقى حماسية ثم حزينة.',
        createdAt: now - 1000 * 60 * 60
      }),
      normalizeNews({
        title: 'الأرجنتين تكتسح وتتأهل', matchName: 'الأرجنتين × كرواتيا',
        teamA: 'الأرجنتين', teamB: 'كرواتيا', score: '3-0', matchDate: todayISO(),
        stage: 'نصف النهائي', country: 'الأرجنتين',
        rawNews: 'الأرجنتين فازت 3-0 على كرواتيا وميسي سجل وصنع.',
        summary: 'الأرجنتين تتأهل للنهائي بثلاثية نظيفة على كرواتيا بقيادة ميسي الذي سجل وصنع.',
        importance: 'important',
        moments: 'ثنائية ميسي\nهدف ألفاريز الانفرادي',
        videoAngle: 'تتويج رحلة ميسي نحو النهائي.',
        videoTitle: 'ميسي يقود الأرجنتين للنهائي بثلاثية',
        createdAt: now - 1000 * 60 * 120
      })
    ];
    write(KEY_NEWS, demo);
    return true;
  }

  /* ============================ public API ============================ */
  window.Store = {
    // constants
    IMPORTANCE: IMPORTANCE,
    IMPORTANCE_BY_KEY: IMPORTANCE_BY_KEY,
    STAGES: STAGES,
    STATUSES: STATUSES,
    STATUS_BY_KEY: STATUS_BY_KEY,
    TEMPLATES: TEMPLATES,
    SCHEMA_VERSION: SCHEMA_VERSION,
    // news
    getNews: getNews,
    getNewsSorted: getNewsSorted,
    getNewsFiltered: getNewsFiltered,
    getNewsById: getNewsById,
    getNewsDays: getNewsDays,
    getDistinct: getDistinct,
    getAllTags: getAllTags,
    newsDayKey: newsDayKey,
    saveNews: saveNews,
    deleteNews: deleteNews,
    deleteManyNews: deleteManyNews,
    setArchived: setArchived,
    // posters
    getPosters: getPosters,
    getPosterById: getPosterById,
    savePoster: savePoster,
    deletePoster: deletePoster,
    // stats
    stats: stats,
    // io
    exportJSON: exportJSON,
    importData: importData,
    importFromFile: importFromFile,
    buildBackup: buildBackup,
    saveAutoBackup: saveAutoBackup,
    getAutoBackup: getAutoBackup,
    restoreAutoBackup: restoreAutoBackup,
    clearAll: clearAll,
    deleteAllPosters: deleteAllPosters,
    stripNewsImages: stripNewsImages,
    stripPosterImages: stripPosterImages,
    storageUsage: storageUsage,
    nearQuota: nearQuota,
    getSettings: getSettings,
    saveSettings: saveSettings,
    seedIfEmpty: seedIfEmpty,
    // pubsub
    subscribe: subscribe,
    // helpers
    uid: uid,
    escapeHtml: escapeHtml,
    escapeMultiline: escapeMultiline,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    todayISO: todayISO,
    fileToDataURL: fileToDataURL,
    dataUrlBytes: dataUrlBytes,
    importanceLabel: function (key) { return (IMPORTANCE_BY_KEY[key] || {}).label || 'عادي'; },
    importanceBadge: function (key) { return (IMPORTANCE_BY_KEY[key] || {}).badgeClass || 'badge-normal'; }
  };
})();
