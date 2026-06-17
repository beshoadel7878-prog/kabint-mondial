/* =============================================================================
 * poster.js — "مولد الجريدة" (Vintage Newspaper Poster Generator)
 * The flagship section. Two columns: controls (left) + live poster preview (right).
 * Self-registers via App.registerPage('poster'). Plain browser globals only.
 *
 * Crisp PNG export strategy:
 *   .poster-scaler (CSS transform: scale) fits #posterStage into the column,
 *   but #posterStage keeps its TRUE pixel size (1920x1080 landscape). html2canvas
 *   captures #posterStage so the scaler transform never distorts the export.
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- module state ----------------------------- */
  // The in-progress poster. PRESERVED across re-renders so unrelated Store
  // changes (e.g. saving news elsewhere) never wipe the user's work.
  var state = null;
  var currentId = null;        // id of poster being edited (null => new)
  var scalerRO = null;         // ResizeObserver for the live scale-to-fit
  var onWinResize = null;      // window resize handler (cleaned up each render)
  var booted = false;          // first-visit flag

  /* ----------------------------- export sizes ----------------------------- */
  // Size registry: every entry is a true-pixel canvas geometry for the stage +
  // export. The stage keeps these REAL dimensions; only the on-screen scaler
  // transform shrinks it to fit the column. Default 'landscape' === the legacy
  // fixed 1920x1080 geometry so existing posters look identical.
  var SIZES = {
    landscape: { w: 1920, h: 1080, label: 'عريض 16:9' },
    square:    { w: 1080, h: 1080, label: 'مربع 1:1' },
    story:     { w: 1080, h: 1920, label: 'ستوري 9:16' },
    ythumb:    { w: 1280, h: 720,  label: 'مصغّرة يوتيوب' },
    portrait:  { w: 1080, h: 1350, label: 'بورتريه 4:5' }
  };
  var SIZE_ORDER = ['landscape', 'square', 'story', 'ythumb', 'portrait'];

  function sizeKey() {
    var k = state && state.size;
    return SIZES[k] ? k : 'landscape';
  }
  function activeSize() {
    return SIZES[sizeKey()];
  }
  function sizeLabel(key) {
    return SIZES[key] ? SIZES[key].label : key;
  }

  /* ----------------------------- defaults ----------------------------- */
  function templateDefaults(tmplKey) {
    // Studio identity comes from Settings (so the masthead isn't retyped each time).
    var s = (Store.getSettings ? Store.getSettings() : {}) || {};
    var base = {
      template: tmplKey || 'vintage',
      size: 'landscape',
      newspaperName: s.newspaperName || 'كابينة مونديال',
      newspaperSubtitle: s.newspaperSubtitle || 'جريدة كأس العالم اليومية',
      issue: s.issue || 'العدد ١ — السنة الأولى',
      posterDate: Store.todayISO(),
      headline: '',
      subheadline: '',
      description: '',
      imageCaption: '',
      image: '',
      secondHeadline: '',
      secondDescription: '',
      secondImageCaption: '',
      secondImage: '',
      sourceNewsId: null
    };
    // Light per-template flavour for the default masthead/subtitle wording.
    switch (tmplKey) {
      case 'breaking':
        base.newspaperSubtitle = 'نشرة عاجلة — كأس العالم';
        base.issue = 'إصدار خاص — عاجل';
        break;
      case 'result':
        base.newspaperSubtitle = 'صفحة النتائج اليومية';
        break;
      case 'player':
        base.newspaperSubtitle = 'بورتريه نجوم البطولة';
        break;
      case 'final':
        base.newspaperSubtitle = 'إصدار خاص بالنهائي الكبير';
        base.issue = 'العدد الختامي — ليلة النهائي';
        break;
      case 'double':
        base.newspaperSubtitle = 'خبران في صفحة واحدة';
        break;
      default:
        base.newspaperSubtitle = s.newspaperSubtitle || 'جريدة كأس العالم اليومية';
    }
    return base;
  }

  function freshState() {
    return templateDefaults('vintage');
  }

  function ensureState() {
    if (!state) state = freshState();
  }

  /* ----------------------------- autofill from news ----------------------------- */
  function fillFromNews(news) {
    if (!news) return;
    ensureState();
    var firstMoment = '';
    if (news.moments) {
      firstMoment = String(news.moments).split(/\r?\n/)[0] || '';
    }
    var sub = '';
    if (news.teamA || news.teamB || news.score) {
      sub = [news.teamA, news.score, news.teamB]
        .filter(function (x) { return x && String(x).trim(); })
        .join(' ').trim();
    }
    if (!sub) sub = news.matchName || '';

    var caption = '';
    if (news.matchName && news.matchDate) {
      caption = news.matchName + ' — ' + Store.formatDate(news.matchDate);
    } else {
      caption = news.matchName || (news.matchDate ? Store.formatDate(news.matchDate) : '');
    }

    state.headline = news.title || '';
    state.posterDate = news.matchDate || state.posterDate || Store.todayISO();
    state.subheadline = sub;
    state.description = news.summary || '';
    state.imageCaption = caption;
    state.image = news.image || '';
    state.secondHeadline = firstMoment;
    state.secondDescription = news.videoAngle || '';
    state.sourceNewsId = news.id || null;
  }

  function loadPoster(p) {
    if (!p) return;
    state = {
      template: p.template || 'vintage',
      size: SIZES[p.size] ? p.size : 'landscape',
      newspaperName: p.newspaperName || '',
      newspaperSubtitle: p.newspaperSubtitle || '',
      issue: p.issue || '',
      posterDate: p.posterDate || Store.todayISO(),
      headline: p.headline || '',
      subheadline: p.subheadline || '',
      description: p.description || '',
      imageCaption: p.imageCaption || '',
      image: p.image || '',
      secondHeadline: p.secondHeadline || '',
      secondDescription: p.secondDescription || '',
      secondImageCaption: p.secondImageCaption || '',
      secondImage: p.secondImage || '',
      sourceNewsId: p.sourceNewsId || null
    };
    currentId = p.id || null;
  }

  /* ----------------------------- pending handoff ----------------------------- */
  function consumePending() {
    var P = App.pending || {};
    if (P.posterEditId) {
      var p = Store.getPosterById(P.posterEditId);
      P.posterEditId = null;
      if (p) {
        loadPoster(p);
        return 'edit';
      }
    }
    if (P.posterSourceNewsId) {
      var news = Store.getNewsById(P.posterSourceNewsId);
      P.posterSourceNewsId = null;
      // new poster derived from a news item
      state = templateDefaults('vintage');
      currentId = null;
      fillFromNews(news);
      if (state.image) {
        toGrayscale(state.image).then(function (g) { state.image = g; App.refresh(); });
      }
      return 'fromNews';
    }
    return null;
  }

  /* ----------------------------- template meta ----------------------------- */
  function templateLabel(key) {
    var t = (Store.TEMPLATES || []).filter(function (x) { return x.key === key; })[0];
    return t ? t.label : key;
  }
  function templateDesc(key) {
    var t = (Store.TEMPLATES || []).filter(function (x) { return x.key === key; })[0];
    return t ? t.desc : '';
  }

  /* ----------------------------- render ----------------------------- */
  function render(container) {
    ensureState();

    // Consume any handoff exactly once. On normal re-renders (no pending),
    // we keep the in-progress state untouched.
    consumePending();

    if (!booted) booted = true;

    var editing = !!currentId;
    var newsList = Store.getNews();

    container.innerHTML = buildShell(editing, newsList);

    bindControls(container);
    rebuildStage(container);
    setupScaler(container);
  }

  /* ----------------------------- shell markup ----------------------------- */
  function buildShell(editing, newsList) {
    var tmplBtns = (Store.TEMPLATES || []).map(function (t) {
      var active = state.template === t.key ? ' is-active' : '';
      return '<button type="button" class="tmpl-btn' + active + '" data-tmpl="' +
        Store.escapeHtml(t.key) + '" title="' + Store.escapeHtml(t.desc) + '">' +
        '<span class="tmpl-btn__label">' + Store.escapeHtml(t.label) + '</span>' +
        '</button>';
    }).join('');

    var curSize = sizeKey();
    var sizeBtns = SIZE_ORDER.map(function (key) {
      var s = SIZES[key];
      var active = curSize === key ? ' is-active' : '';
      return '<button type="button" class="size-btn' + active + '" data-size="' +
        Store.escapeHtml(key) + '" title="' + Store.escapeHtml(s.w + '×' + s.h) + '">' +
        '<span class="size-btn__label">' + Store.escapeHtml(s.label) + '</span>' +
        '<span class="size-btn__dim">' + Store.escapeHtml(s.w + '×' + s.h) + '</span>' +
        '</button>';
    }).join('');

    var newsOptions = ['<option value="">— اختر خبرًا محفوظًا —</option>'].concat(
      newsList.map(function (n) {
        var teams = (n.teamA || n.teamB)
          ? (Store.escapeHtml(n.teamA) + ' × ' + Store.escapeHtml(n.teamB))
          : Store.escapeHtml(n.matchName || '');
        var label = Store.escapeHtml(n.title || 'خبر بدون عنوان');
        if (teams) label += ' — ' + teams;
        var sel = (state.sourceNewsId && state.sourceNewsId === n.id) ? ' selected' : '';
        return '<option value="' + Store.escapeHtml(n.id) + '"' + sel + '>' + label + '</option>';
      })
    ).join('');

    var head =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">مولد <span class="accent">الجريدة</span></h1>' +
          '<p class="page-sub">صمّم بوستر جريدة عربية كلاسيكية من أخبارك، ثم صدّره صورة عالية الدقة.' +
            (editing ? ' <span class="gold">(وضع التعديل)</span>' : '') + '</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn-ghost btn-sm" id="psDuplicate" title="إنشاء نسخة جديدة">⧉ تكرار</button>' +
          '<button class="btn btn-ghost btn-sm" id="psReset" title="إعادة الحقول لقيم القالب الافتراضية">↺ إعادة ضبط القالب</button>' +
          '<button class="btn btn-gold btn-sm" id="psSave">💾 حفظ البوستر</button>' +
        '</div>' +
      '</div>';

    var controls =
      '<div class="ps-controls panel">' +

        // templates
        '<div class="field">' +
          '<span class="field-label">القالب</span>' +
          '<div class="tmpl-row" id="psTemplates">' + tmplBtns + '</div>' +
          '<span class="field-hint" id="psTmplDesc">' + Store.escapeHtml(templateDesc(state.template)) + '</span>' +
        '</div>' +

        '<hr class="divider" />' +

        // export size
        '<div class="field">' +
          '<span class="field-label">مقاس التصدير</span>' +
          '<div class="size-row" id="psSizes">' + sizeBtns + '</div>' +
          '<span class="field-hint">يحدّد أبعاد البوستر عند المعاينة والتصدير (لكل منصّة مقاسها المناسب).</span>' +
        '</div>' +

        '<hr class="divider" />' +

        // fill from news
        '<div class="field">' +
          '<label for="psNewsSelect">تعبئة من خبر محفوظ</label>' +
          '<select class="select" id="psNewsSelect">' + newsOptions + '</select>' +
          '<span class="field-hint">تعبئة تلقائية: يملأ العنوان والنتيجة والوصف والصورة من الخبر المختار.</span>' +
        '</div>' +

        '<hr class="divider" />' +

        // masthead group
        '<div class="form-grid">' +
          field('psNewspaperName', 'اسم الجريدة', 'input', state.newspaperName, 'كابينة مونديال') +
          field('psNewspaperSubtitle', 'العنوان الفرعي للجريدة', 'input', state.newspaperSubtitle, 'جريدة كأس العالم اليومية') +
          field('psPosterDate', 'تاريخ البوستر', 'date', state.posterDate, '') +
          fieldSpan('psIssue', 'السنة / رقم العدد', 'input', state.issue, 'العدد ١ — السنة الأولى') +
        '</div>' +

        '<hr class="divider" />' +
        '<div class="section-title">الكتلة الأولى</div>' +

        '<div class="form-grid">' +
          fieldSpan('psHeadline', 'العنوان الرئيسي', 'input', state.headline, 'العنوان الرئيسي هنا') +
          fieldSpan('psSubheadline', 'العنوان الثانوي', 'input', state.subheadline, 'العنوان الثانوي / النتيجة') +
          fieldSpan('psDescription', 'الوصف المختصر', 'textarea', state.description, 'نص الخبر المختصر…') +
          fieldSpan('psImageCaption', 'تعليق الصورة', 'input', state.imageCaption, 'اسم المباراة والتاريخ') +
        '</div>' +

        // primary image dropzone
        dropzoneBlock('psImage', 'تحميل الصورة', state.image) +

        '<hr class="divider" />' +
        '<div class="section-title">الكتلة الثانية</div>' +

        '<div class="form-grid">' +
          fieldSpan('psSecondHeadline', 'العنوان الثاني', 'input', state.secondHeadline, 'عنوان فرعي ثانٍ') +
          fieldSpan('psSecondDescription', 'الوصف الثاني', 'textarea', state.secondDescription, 'تفاصيل إضافية…') +
          fieldSpan('psSecondImageCaption', 'تعليق الصورة الثانية', 'input', state.secondImageCaption, 'تعليق الصورة الثانية') +
        '</div>' +

        dropzoneBlock('psSecondImage', 'الصورة الثانية', state.secondImage) +

      '</div>';

    var previewCol =
      '<div class="ps-preview-col">' +
        '<div class="ps-preview-bar">' +
          '<div class="ps-preview-title">المعاينة الحية</div>' +
          '<div class="row">' +
            '<button class="btn btn-ghost btn-sm" id="psGenerate">👁 معاينة</button>' +
            '<button class="btn btn-ghost btn-sm" id="psCopy" title="نسخ الصورة للحافظة">⧉ نسخ الصورة</button>' +
            '<button class="btn btn-ghost btn-sm" id="psShare" title="مشاركة الصورة">↗ مشاركة</button>' +
            '<button class="btn btn-ghost btn-sm" id="psPrint" title="طباعة البوستر">🖨 طباعة</button>' +
            '<button class="btn btn-gold btn-sm" id="psDownload">⬇ تحميل PNG</button>' +
            '<label class="ps-hires" title="تصدير بدقة مضاعفة"><input type="checkbox" id="psHiRes"> دقة ×2</label>' +
          '</div>' +
        '</div>' +
        '<div class="poster-scaler" id="psScaler">' +
          '<div id="posterStage" class="poster-stage tmpl-' + Store.escapeHtml(state.template) +
            '" data-size="' + Store.escapeHtml(curSize) + '"></div>' +
        '</div>' +
        '<p class="ps-export-hint muted text-xs">' +
          '<span id="psExportDim">يُصدَّر البوستر بدقة ' + Store.escapeHtml(activeSize().w + '×' + activeSize().h) + ' بكسل.</span>' +
          ' كل الخطوط وأداة التصدير محلية — يعمل بدون إنترنت.</p>' +
      '</div>';

    return head +
      '<div class="ps-layout">' +
        '<div class="ps-col-controls">' + controls + '</div>' +
        previewCol +
      '</div>';
  }

  // single-cell field
  function field(id, label, kind, value, placeholder) {
    return fieldImpl(id, label, kind, value, placeholder, false);
  }
  // full-width field (col-span-2)
  function fieldSpan(id, label, kind, value, placeholder) {
    return fieldImpl(id, label, kind, value, placeholder, true);
  }
  function fieldImpl(id, label, kind, value, placeholder, span) {
    var v = Store.escapeHtml(value || '');
    var ph = Store.escapeHtml(placeholder || '');
    var control;
    if (kind === 'textarea') {
      control = '<textarea class="textarea" id="' + id + '" placeholder="' + ph + '">' + v + '</textarea>';
    } else if (kind === 'date') {
      control = '<input type="date" class="input" id="' + id + '" value="' + v + '" />';
    } else {
      control = '<input type="text" class="input" id="' + id + '" value="' + v + '" placeholder="' + ph + '" />';
    }
    return '<div class="field' + (span ? ' col-span-2' : '') + '">' +
      '<label for="' + id + '">' + Store.escapeHtml(label) + '</label>' + control + '</div>';
  }

  // dropzone + thumb-preview block (no inline JS; bound later)
  function dropzoneBlock(id, label, dataUrl) {
    var hasImg = !!dataUrl;
    var preview = hasImg
      ? '<div class="thumb-preview" data-thumb="' + id + '">' +
          '<img src="' + Store.escapeHtml(dataUrl) + '" alt="معاينة" />' +
          '<button type="button" class="btn btn-ghost btn-sm" data-remove="' + id + '">إزالة الصورة</button>' +
        '</div>'
      : '';
    return '<div class="field col-span-2 ps-dz-field">' +
      '<span class="field-label">' + Store.escapeHtml(label) + '</span>' +
      '<div class="dropzone" data-dz="' + id + '" role="button" tabindex="0">' +
        '<div class="dz-inner">⬆ اسحب صورة هنا أو اضغط للاختيار</div>' +
        '<input type="file" accept="image/*" data-dzinput="' + id + '" hidden />' +
      '</div>' +
      preview +
    '</div>';
  }

  /* ----------------------------- bind controls ----------------------------- */
  function bindControls(container) {
    // template buttons
    var tmplRow = container.querySelector('#psTemplates');
    if (tmplRow) {
      tmplRow.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.tmpl-btn') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-tmpl');
        if (!key || key === state.template) return;
        state.template = key;
        // reflect active state without full re-render
        Array.prototype.forEach.call(tmplRow.querySelectorAll('.tmpl-btn'), function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-tmpl') === key);
        });
        var desc = container.querySelector('#psTmplDesc');
        if (desc) desc.textContent = templateDesc(key);
        var stage = container.querySelector('#posterStage');
        if (stage) {
          stage.className = 'poster-stage tmpl-' + key;
        }
        rebuildStage(container);
      });
    }

    // export-size pills
    var sizeRow = container.querySelector('#psSizes');
    if (sizeRow) {
      sizeRow.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.size-btn') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-size');
        if (!key || !SIZES[key] || key === sizeKey()) return;
        state.size = key;
        // reflect active state without a full re-render
        Array.prototype.forEach.call(sizeRow.querySelectorAll('.size-btn'), function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-size') === key);
        });
        applyStageSize(container);     // sets stage w/h + data-size, then re-runs fit/scale
        rebuildStage(container);
        fitScale(container);
        var dim = container.querySelector('#psExportDim');
        if (dim) dim.textContent = 'يُصدَّر البوستر بدقة ' + activeSize().w + '×' + activeSize().h + ' بكسل.';
      });
    }

    // fill-from-news select
    var sel = container.querySelector('#psNewsSelect');
    if (sel) {
      sel.addEventListener('change', function () {
        var id = sel.value;
        if (!id) return;
        var news = Store.getNewsById(id);
        if (!news) { App.toast('تعذّر العثور على الخبر', 'error'); return; }
        fillFromNews(news);
        // re-render controls to reflect new field values, keep template
        App.refresh();
        App.toast('تم ملء الحقول من الخبر المحفوظ', 'success');
      });
    }

    // text/textarea live bindings -> state + stage
    bindText(container, 'psNewspaperName', 'newspaperName');
    bindText(container, 'psNewspaperSubtitle', 'newspaperSubtitle');
    bindText(container, 'psPosterDate', 'posterDate');
    bindText(container, 'psIssue', 'issue');
    bindText(container, 'psHeadline', 'headline');
    bindText(container, 'psSubheadline', 'subheadline');
    bindText(container, 'psDescription', 'description');
    bindText(container, 'psImageCaption', 'imageCaption');
    bindText(container, 'psSecondHeadline', 'secondHeadline');
    bindText(container, 'psSecondDescription', 'secondDescription');
    bindText(container, 'psSecondImageCaption', 'secondImageCaption');

    // dropzones
    bindDropzone(container, 'psImage', 'image');
    bindDropzone(container, 'psSecondImage', 'secondImage');

    // action buttons
    var gen = container.querySelector('#psGenerate');
    if (gen) gen.addEventListener('click', function () {
      rebuildStage(container);
      fitScale(container);
      // on mobile, scroll the preview into view
      var col = container.querySelector('.ps-preview-col');
      if (col && window.matchMedia('(max-width: 1000px)').matches) {
        col.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      App.toast('تم تحديث المعاينة', 'info', 1500);
    });

    var dl = container.querySelector('#psDownload');
    if (dl) dl.addEventListener('click', function () { downloadPNG(container); });

    var copyBtn = container.querySelector('#psCopy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      if (typeof html2canvas === 'undefined') { App.toast('أداة التصدير غير متاحة', 'error'); return; }
      copyBtn.disabled = true;
      captureContainerCanvas(container)
        .then(function (c) { return copyCanvas(c); })
        .catch(function () { App.toast('تعذّر تجهيز الصورة', 'error'); })
        .finally(function () { copyBtn.disabled = false; });
    });

    var shareBtn = container.querySelector('#psShare');
    if (shareBtn) shareBtn.addEventListener('click', function () {
      if (typeof html2canvas === 'undefined') { App.toast('أداة التصدير غير متاحة', 'error'); return; }
      shareBtn.disabled = true;
      captureContainerCanvas(container)
        .then(function (c) { return shareCanvas(c, sanitizeFilename(state.headline || state.newspaperName)); })
        .catch(function () { App.toast('تعذّرت المشاركة', 'error'); })
        .finally(function () { shareBtn.disabled = false; });
    });

    var printBtn = container.querySelector('#psPrint');
    if (printBtn) printBtn.addEventListener('click', function () {
      rebuildStage(container);
      setTimeout(function () { try { window.print(); } catch (e) {} }, 60);
    });

    var save = container.querySelector('#psSave');
    if (save) save.addEventListener('click', function () { savePoster(container); });

    var dup = container.querySelector('#psDuplicate');
    if (dup) dup.addEventListener('click', function () { duplicatePoster(); });

    var reset = container.querySelector('#psReset');
    if (reset) reset.addEventListener('click', function () { resetTemplate(); });
  }

  function bindText(container, id, key) {
    var el = container.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('input', function () {
      state[key] = el.value;
      rebuildStage(container);
    });
  }

  function bindDropzone(container, id, key) {
    var dz = container.querySelector('[data-dz="' + id + '"]');
    var input = container.querySelector('[data-dzinput="' + id + '"]');
    var removeBtn = container.querySelector('[data-remove="' + id + '"]');

    if (dz && input) {
      dz.addEventListener('click', function () { input.click(); });
      dz.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-drag'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('is-drag'); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.classList.remove('is-drag');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        handleImageFile(file, key, container);
      });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        handleImageFile(file, key, container);
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        state[key] = '';
        App.refresh();
      });
    }
  }

  // Bake a black & white (newsprint) version so the poster looks/exports as B&W
  // even if html2canvas drops the CSS grayscale filter. Falls back to the
  // original on any error (e.g. a tainted/oversized image).
  function toGrayscale(dataUrl) {
    return new Promise(function (resolve) {
      if (!dataUrl) { resolve(dataUrl); return; }
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var maxW = 1400;
            var scale = img.width > maxW ? maxW / img.width : 1;
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var d = ctx.getImageData(0, 0, w, h);
            var px = d.data;
            // Bake the FULL newsprint look into the pixels. html2canvas 1.4.1 does
            // not apply CSS `filter`, so the tone that .poster-img used to receive
            // from `contrast()/sepia()/brightness()` would be dropped in the export
            // (the PNG came out flatter/cooler than the preview). We reproduce the
            // exact chain here — grayscale → contrast(1.12×1.15) → sepia(.1) →
            // brightness(1.02) — and remove the CSS filter (see poster.css), so the
            // preview and the exported PNG are pixel-identical.
            for (var i = 0; i < px.length; i += 4) {
              var lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
              var v = (lum - 128) * 1.288 + 128;     // combined contrast 1.12 × 1.15
              if (v < 0) v = 0; else if (v > 255) v = 255;
              var r = v * 1.0558;                    // sepia(.1) warm tint + brightness(1.02)
              var gg = v * 1.0407;
              var b = v * 1.0136;
              px[i]     = r > 255 ? 255 : r;
              px[i + 1] = gg > 255 ? 255 : gg;
              px[i + 2] = b > 255 ? 255 : b;
            }
            ctx.putImageData(d, 0, 0);
            resolve(c.toDataURL('image/jpeg', 0.85));
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }

  function handleImageFile(file, key, container) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      App.toast('الرجاء اختيار ملف صورة صالح', 'error');
      return;
    }
    Store.fileToDataURL(file, { maxWidth: 1800, maxHeight: 1800, quality: 0.88 }).then(function (url) {
      if (file.size && Store.dataUrlBytes && Store.dataUrlBytes(url) < file.size * 0.88) {
        App.toast('تم تجهيز الصورة وضغطها للتخزين المحلي', 'success', 2200);
      }
      return toGrayscale(url);
    }).then(function (gurl) {
      state[key] = gurl || '';
      App.refresh();
    }).catch(function () {
      App.toast('تعذّر قراءة الصورة', 'error');
    });
  }

  /* ----------------------------- poster stage rendering ----------------------------- */
  function placeholderText(value, ph) {
    // returns {html, isPlaceholder}
    var v = (value == null) ? '' : String(value).trim();
    if (v) return { html: Store.escapeMultiline(value), placeholder: false };
    return { html: Store.escapeHtml(ph), placeholder: true };
  }

  function fitClass(value, midAt, longAt) {
    var len = String(value || '').trim().length;
    if (len >= (longAt || 90)) return ' is-fit-2';
    if (len >= (midAt || 55)) return ' is-fit-1';
    return '';
  }

  function frame(dataUrl, captionHtml, captionIsPh, extraClass, suppressCaption) {
    var cls = 'poster-figure' + (extraClass ? ' ' + extraClass : '');
    var imgHtml;
    if (dataUrl) {
      imgHtml = '<div class="poster-img-wrap">' +
        '<img class="poster-img" src="' + Store.escapeHtml(dataUrl) + '" alt="" crossorigin="anonymous" />' +
        '<div class="poster-halftone" aria-hidden="true"></div>' +
      '</div>';
    } else {
      imgHtml = '<div class="poster-img-wrap is-empty">' +
        '<div class="poster-img-placeholder">الصورة هنا</div>' +
        '<div class="poster-halftone" aria-hidden="true"></div>' +
      '</div>';
    }
    var cap = suppressCaption ? '' : '<figcaption class="poster-caption' + (captionIsPh ? ' is-ph' : '') + '">' + captionHtml + '</figcaption>';
    return '<figure class="' + cls + '">' + imgHtml + cap + '</figure>';
  }

  // Apply the active size's TRUE pixel geometry + data-size attribute to the
  // stage. CSS reflow rules key off [data-size]; export/fit read activeSize().
  function applyStageSize(container) {
    var stage = container.querySelector('#posterStage');
    if (!stage) return;
    var s = activeSize();
    stage.setAttribute('data-size', sizeKey());
    stage.style.width = s.w + 'px';
    stage.style.height = s.h + 'px';
  }

  function rebuildStage(container) {
    var stage = container.querySelector('#posterStage');
    if (!stage) return;
    stage.className = 'poster-stage tmpl-' + state.template;
    // className reset above drops nothing structural, but re-assert geometry/size
    applyStageSize(container);

    var name = placeholderText(state.newspaperName, 'اسم الجريدة');
    var subtitle = placeholderText(state.newspaperSubtitle, 'العنوان الفرعي للجريدة');
    var issue = placeholderText(state.issue, 'العدد / السنة');
    var headline = placeholderText(state.headline, 'العنوان الرئيسي هنا');
    var subheadline = placeholderText(state.subheadline, 'العنوان الثانوي هنا');
    var description = placeholderText(state.description, 'اكتب نص الخبر المختصر هنا ليظهر في الجريدة بصياغة كلاسيكية أنيقة.');
    var caption = placeholderText(state.imageCaption, 'تعليق الصورة');
    var secondHeadline = placeholderText(state.secondHeadline, 'العنوان الثاني هنا');
    var secondDescription = placeholderText(state.secondDescription, 'نص الكتلة الثانية يظهر هنا.');
    var secondCaption = placeholderText(state.secondImageCaption, 'تعليق الصورة الثانية');

    var dateStr = Store.formatDate(state.posterDate || Store.todayISO());

    // ---- masthead (shared, varies by CSS per template) ----
    var bannerExtra = '';
    if (state.template === 'breaking') {
      bannerExtra = '<div class="poster-breaking-bar"><span>خبر عاجل</span></div>';
    } else if (state.template === 'final') {
      bannerExtra = '<div class="poster-final-banner"><span>✦ النهائي الكبير ✦</span></div>';
    }

    var masthead =
      '<header class="poster-masthead">' +
        bannerExtra +
        '<div class="poster-masthead__name' + (name.placeholder ? ' is-ph' : '') + fitClass(state.newspaperName, 18, 28) + '">' + name.html + '</div>' +
        '<div class="poster-rule poster-rule--double"></div>' +
        '<div class="poster-masthead__sub' + (subtitle.placeholder ? ' is-ph' : '') + '">' + subtitle.html + '</div>' +
        '<div class="poster-issueline">' +
          '<span class="poster-issueline__side">' + Store.escapeHtml(dateStr) + '</span>' +
          '<span class="poster-issueline__rule"></span>' +
          '<span class="poster-issueline__mid' + (issue.placeholder ? ' is-ph' : '') + '">' + issue.html + '</span>' +
          '<span class="poster-issueline__rule"></span>' +
          '<span class="poster-issueline__side">طبعة اليوم</span>' +
        '</div>' +
      '</header>';

    // ---- body, per template ----
    var body;
    if (state.template === 'result') {
      body = buildResultBody(headline, subheadline, description, caption, secondHeadline, secondDescription, secondCaption);
    } else if (state.template === 'player') {
      body = buildPlayerBody(headline, subheadline, description, caption, secondHeadline, secondDescription);
    } else if (state.template === 'double') {
      body = buildDoubleBody(headline, description, caption, secondHeadline, secondDescription, secondCaption);
    } else {
      // vintage, breaking, final share the classic two-block newspaper body
      body = buildClassicBody(headline, subheadline, description, caption, secondHeadline, secondDescription, secondCaption);
    }

    stage.innerHTML =
      '<div class="poster-paper" aria-hidden="false">' +
        '<div class="poster-ink poster-ink--1" aria-hidden="true"></div>' +
        '<div class="poster-ink poster-ink--2" aria-hidden="true"></div>' +
        masthead +
        body +
        '<footer class="poster-footer">' +
          '<span class="poster-footer__rule"></span>' +
          '<span class="poster-footer__txt">' + Store.escapeHtml(state.newspaperName.trim() || 'كابينة مونديال') + ' — كل الحقوق محفوظة لفريق الإنتاج</span>' +
          '<span class="poster-footer__rule"></span>' +
        '</footer>' +
      '</div>';
  }

  // classic two-block: headline + subheadline + description on the right of a
  // framed image, then a divider and the second block.
  function buildClassicBody(headline, subheadline, description, caption, secondHeadline, secondDescription, secondCaption) {
    var img = frame(state.image, caption.html, caption.placeholder);
    var block1 =
      '<div class="poster-block poster-block--lead">' +
        '<div class="poster-text-col">' +
          '<h1 class="poster-headline' + (headline.placeholder ? ' is-ph' : '') + fitClass(state.headline, 54, 82) + '">' + headline.html + '</h1>' +
          '<h2 class="poster-subhead' + (subheadline.placeholder ? ' is-ph' : '') + fitClass(state.subheadline, 42, 66) + '">' + subheadline.html + '</h2>' +
          '<div class="poster-rule poster-rule--thin"></div>' +
          '<p class="poster-desc' + (description.placeholder ? ' is-ph' : '') + '">' + description.html + '</p>' +
        '</div>' +
        '<div class="poster-fig-col">' + img + '</div>' +
      '</div>';

    var hasSecondImg = !!state.secondImage;
    var secondImgHtml = hasSecondImg ? frame(state.secondImage, '', false, 'poster-figure--sm', true) : '';

    var block2 =
      '<div class="poster-divider-h"></div>' +
      '<div class="poster-block poster-block--second">' +
        (hasSecondImg ? '<div class="poster-fig-col poster-fig-col--sm">' + secondImgHtml + '</div>' : '') +
        '<div class="poster-text-col">' +
          '<h3 class="poster-second-head' + (secondHeadline.placeholder ? ' is-ph' : '') + fitClass(state.secondHeadline, 44, 72) + '">' + secondHeadline.html + '</h3>' +
          '<p class="poster-second-desc' + (secondDescription.placeholder ? ' is-ph' : '') + '">' + secondDescription.html + '</p>' +
        '</div>' +
      '</div>';

    return '<div class="poster-body">' + block1 + block2 + '</div>';
  }

  // double: two EQUAL stories stacked vertically with a divider. Each story is
  // headline + body + a framed halftone image (with its own caption) beside it.
  function buildDoubleBody(headline, description, caption, secondHeadline, secondDescription, secondCaption) {
    function story(hObj, dObj, dataUrl, capObj, hVal, dVal) {
      var img = frame(dataUrl, capObj.html, capObj.placeholder);
      return '<div class="poster-block poster-block--story">' +
        '<div class="poster-text-col">' +
          '<h1 class="poster-headline' + (hObj.placeholder ? ' is-ph' : '') + fitClass(hVal, 40, 64) + '">' + hObj.html + '</h1>' +
          '<div class="poster-rule poster-rule--thin"></div>' +
          '<p class="poster-desc' + (dObj.placeholder ? ' is-ph' : '') + '">' + dObj.html + '</p>' +
        '</div>' +
        '<div class="poster-fig-col">' + img + '</div>' +
      '</div>';
    }
    return '<div class="poster-body poster-body--double">' +
      story(headline, description, state.image, caption, state.headline, state.description) +
      '<div class="poster-divider-h"></div>' +
      story(secondHeadline, secondDescription, state.secondImage, secondCaption, state.secondHeadline, state.secondDescription) +
    '</div>';
  }

  // result: big scoreboard pulled from subheadline (teamA score teamB)
  function buildResultBody(headline, subheadline, description, caption, secondHeadline, secondDescription, secondCaption) {
    var img = frame(state.image, caption.html, caption.placeholder);
    var scoreboard =
      '<div class="poster-scoreboard">' +
        '<div class="poster-scoreboard__line' + (subheadline.placeholder ? ' is-ph' : '') + '">' + subheadline.html + '</div>' +
      '</div>';

    var block1 =
      '<div class="poster-block poster-block--result">' +
        '<div class="poster-text-col">' +
          '<h1 class="poster-headline' + (headline.placeholder ? ' is-ph' : '') + fitClass(state.headline, 54, 82) + '">' + headline.html + '</h1>' +
          scoreboard +
          '<div class="poster-rule poster-rule--thin"></div>' +
          '<p class="poster-desc' + (description.placeholder ? ' is-ph' : '') + '">' + description.html + '</p>' +
        '</div>' +
        '<div class="poster-fig-col">' + img + '</div>' +
      '</div>';

    var hasSecondImg = !!state.secondImage;
    var secondImgHtml = hasSecondImg ? frame(state.secondImage, '', false, 'poster-figure--sm', true) : '';
    var block2 =
      '<div class="poster-divider-h"></div>' +
      '<div class="poster-block poster-block--second">' +
        (hasSecondImg ? '<div class="poster-fig-col poster-fig-col--sm">' + secondImgHtml + '</div>' : '') +
        '<div class="poster-text-col">' +
          '<h3 class="poster-second-head' + (secondHeadline.placeholder ? ' is-ph' : '') + fitClass(state.secondHeadline, 44, 72) + '">' + secondHeadline.html + '</h3>' +
          '<p class="poster-second-desc' + (secondDescription.placeholder ? ' is-ph' : '') + '">' + secondDescription.html + '</p>' +
        '</div>' +
      '</div>';

    return '<div class="poster-body">' + block1 + block2 + '</div>';
  }

  // player: large dominant portrait, text wraps beside/below
  function buildPlayerBody(headline, subheadline, description, caption, secondHeadline, secondDescription) {
    var img = frame(state.image, caption.html, caption.placeholder, 'poster-figure--portrait');
    var block =
      '<div class="poster-block poster-block--player">' +
        '<div class="poster-fig-col poster-fig-col--portrait">' + img + '</div>' +
        '<div class="poster-text-col">' +
          '<h1 class="poster-headline poster-headline--player' + (headline.placeholder ? ' is-ph' : '') + fitClass(state.headline, 48, 76) + '">' + headline.html + '</h1>' +
          '<h2 class="poster-subhead' + (subheadline.placeholder ? ' is-ph' : '') + fitClass(state.subheadline, 42, 66) + '">' + subheadline.html + '</h2>' +
          '<div class="poster-rule poster-rule--thin"></div>' +
          '<p class="poster-desc' + (description.placeholder ? ' is-ph' : '') + '">' + description.html + '</p>' +
          '<div class="poster-divider-h"></div>' +
          '<h3 class="poster-second-head' + (secondHeadline.placeholder ? ' is-ph' : '') + fitClass(state.secondHeadline, 44, 72) + '">' + secondHeadline.html + '</h3>' +
          '<p class="poster-second-desc' + (secondDescription.placeholder ? ' is-ph' : '') + '">' + secondDescription.html + '</p>' +
        '</div>' +
      '</div>';
    return '<div class="poster-body poster-body--player">' + block + '</div>';
  }

  /* ----------------------------- scale-to-fit ----------------------------- */
  function setupScaler(container) {
    // clean up previous observers/handlers
    if (scalerRO && scalerRO.disconnect) { scalerRO.disconnect(); scalerRO = null; }
    if (onWinResize) { window.removeEventListener('resize', onWinResize); onWinResize = null; }

    fitScale(container);

    var scaler = container.querySelector('#psScaler');
    if (scaler && typeof ResizeObserver !== 'undefined') {
      scalerRO = new ResizeObserver(function () { fitScale(container); });
      scalerRO.observe(scaler);
    }
    onWinResize = function () { fitScale(container); };
    window.addEventListener('resize', onWinResize);
  }

  function fitScale(container) {
    var scaler = container.querySelector('#psScaler');
    var stage = container.querySelector('#posterStage');
    if (!scaler || !stage) return;
    var avail = scaler.clientWidth;
    if (!avail) return;
    var sz = activeSize();
    var scale = avail / sz.w;
    if (scale > 1) scale = 1;          // never upscale beyond true size
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.transformOrigin = 'top right'; // RTL: anchor to the right
    // reserve correct height so layout doesn't overlap (scaled height)
    var realH = stage.offsetHeight || sz.h;
    scaler.style.height = (realH * scale) + 'px';
  }

  /* ----------------------------- PNG download ----------------------------- */
  function sanitizeFilename(s) {
    s = (s || '').toString().trim();
    if (!s) return 'poster';
    // keep Arabic letters/digits/space/dash/underscore; collapse the rest
    s = s.replace(/[\\/:*?"<>|]+/g, ' ')
         .replace(/\s+/g, '-')
         .replace(/^-+|-+$/g, '');
    if (s.length > 60) s = s.slice(0, 60);
    return s || 'poster';
  }

  function waitForFonts() {
    if (document.fonts && document.fonts.ready) {
      return document.fonts.ready.catch(function () {});
    }
    return Promise.resolve();
  }

  function waitForImages(root) {
    var imgs = root ? root.querySelectorAll('img') : [];
    var waits = [];
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.complete && img.naturalWidth) return;
      waits.push(new Promise(function (resolve) {
        img.onload = function () { resolve(); };
        img.onerror = function () { resolve(); };
      }));
    });
    return Promise.all(waits);
  }

  function withCapture(container, fn) {
    // Capture a clean off-screen clone instead of the scaled preview. This avoids
    // html2canvas clipping/transform artifacts from the preview wrapper.
    var stage = container.querySelector('#posterStage');
    if (!stage) return Promise.reject(new Error('no stage'));

    var sz = activeSize();
    var host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = sz.w + 'px';
    host.style.height = sz.h + 'px';
    host.style.overflow = 'visible';
    host.style.pointerEvents = 'none';
    host.style.background = 'transparent';

    var clone = stage.cloneNode(true);
    clone.classList.add('poster-export-stage');
    clone.setAttribute('data-size', sizeKey());
    clone.style.transform = 'none';
    clone.style.transformOrigin = 'top right';
    clone.style.width = sz.w + 'px';
    clone.style.height = sz.h + 'px';
    host.appendChild(clone);
    container.appendChild(host);

    function cleanup() {
      if (host.parentNode) host.parentNode.removeChild(host);
    }

    return waitForFonts().then(function () {
      return waitForImages(clone);
    }).then(function () {
      return fn(clone);
    }).then(function (res) {
      cleanup();
      return res;
    }, function (err) {
      cleanup();
      throw err;
    });
  }

  // Cached procedural paper-grain tile. html2canvas 1.4.1 cannot rasterize the SVG
  // feTurbulence noise used for the aged-paper background, so the exported PNG lost
  // its newsprint texture. We re-add an equivalent grain onto the final canvas.
  var _grainTile = null;
  function grainTile() {
    if (_grainTile) return _grainTile;
    var size = 128;
    var t = document.createElement('canvas');
    t.width = size; t.height = size;
    var tctx = t.getContext('2d');
    var img = tctx.createImageData(size, size);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = 107; d[i + 1] = 84; d[i + 2] = 46;       // warm ink fleck ~rgb(107,84,46)
      d[i + 3] = Math.floor(Math.random() * 34);       // sparse low-alpha grain
    }
    tctx.putImageData(img, 0, 0);
    _grainTile = t;
    return t;
  }

  function normalizeCanvas(canvas, width, height) {
    if (!canvas) return canvas;

    var out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#efe7d3';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);

    // Re-create the aged-paper grain html2canvas drops (see grainTile above).
    try {
      var pat = ctx.createPattern(grainTile(), 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    } catch (e) { /* grain is cosmetic — never fail the export over it */ }
    return out;
  }

  function downloadPNG(container) {
    if (typeof html2canvas === 'undefined') {
      App.toast('تعذّر تحميل أداة التصدير — تحقق من الاتصال بالإنترنت', 'error');
      return;
    }
    var btn = container.querySelector('#psDownload');
    if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = '… جارٍ التصدير'; }

    rebuildStage(container);

    var sz = activeSize();
    var hi = container.querySelector('#psHiRes');
    var mult = (hi && hi.checked) ? 2 : 1;
    withCapture(container, function (stage) {
      return html2canvas(stage, {
        scale: mult,
        backgroundColor: '#efe7d3',
        useCORS: true,
        logging: false,
        width: sz.w,
        height: sz.h,
        windowWidth: sz.w,
        windowHeight: sz.h
      });
    }).then(function (canvas) {
      canvas = normalizeCanvas(canvas, sz.w * mult, sz.h * mult);
      var name = 'poster-' + sanitizeFilename(state.headline || state.newspaperName) + (mult > 1 ? '@2x' : '') + '.png';
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { fallbackDataUrl(canvas, name); return; }
          var url = URL.createObjectURL(blob);
          triggerDownload(url, name, true);
        }, 'image/png');
      } else {
        fallbackDataUrl(canvas, name);
      }
      App.toast('تم تصدير صورة البوستر ✓', 'success');
    }).catch(function (e) {
      console.error('export failed', e);
      App.toast('تعذّر تصدير الصورة. حاول مرة أخرى.', 'error');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl || '⬇ تحميل PNG'; }
    });
  }

  function fallbackDataUrl(canvas, name) {
    triggerDownload(canvas.toDataURL('image/png'), name, false);
  }

  function triggerDownload(href, name, revoke) {
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 1500);
  }

  /* ----------------------------- reusable capture / copy / share ----------------------------- */
  // Capture the live preview's stage to a full-size canvas (sz.w × sz.h).
  function captureContainerCanvas(container) {
    var sz = activeSize();
    rebuildStage(container);
    return withCapture(container, function (stage) {
      return html2canvas(stage, {
        scale: 1, backgroundColor: '#efe7d3', useCORS: true, logging: false,
        width: sz.w, height: sz.h, windowWidth: sz.w, windowHeight: sz.h
      });
    }).then(function (canvas) { return normalizeCanvas(canvas, sz.w, sz.h); });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas && canvas.toBlob) { canvas.toBlob(function (b) { resolve(b); }, 'image/png'); }
      else resolve(null);
    });
  }

  function copyCanvas(canvas) {
    if (!(navigator.clipboard && window.ClipboardItem)) {
      App.toast('نسخ الصور غير مدعوم في هذا المتصفح — استخدم التحميل', 'error', 3500);
      return Promise.resolve();
    }
    return canvasToBlob(canvas).then(function (blob) {
      if (!blob) { App.toast('تعذّر تجهيز الصورة', 'error'); return; }
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
        .then(function () { App.toast('تم نسخ صورة البوستر للحافظة ✓', 'success'); })
        .catch(function () { App.toast('تعذّر نسخ الصورة', 'error'); });
    });
  }

  function shareCanvas(canvas, baseName) {
    return canvasToBlob(canvas).then(function (blob) {
      if (!blob) { App.toast('تعذّر تجهيز الصورة', 'error'); return; }
      var fname = (baseName || 'poster') + '.png';
      var file = null;
      try { file = new File([blob], fname, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        return navigator.share({ files: [file], title: 'بوستر كابينة مونديال' }).catch(function (err) {
          // User-cancelled share (AbortError) is expected — stay silent. Surface
          // only genuine failures.
          if (err && err.name === 'AbortError') return;
          App.toast('تعذّرت المشاركة', 'error');
        });
      }
      // Fallback: download.
      var url = URL.createObjectURL(blob);
      triggerDownload(url, fname, true);
      App.toast('المشاركة غير مدعومة — تم تنزيل الصورة', 'info', 3000);
    });
  }

  // Render a SAVED poster object off-screen to a full-size canvas (used by the
  // gallery for true full-resolution export). Swaps module state, then restores.
  function exportObjectToCanvas(posterObj) {
    if (typeof html2canvas === 'undefined') return Promise.reject(new Error('no html2canvas'));
    var savedState = state, savedId = currentId;
    loadPoster(posterObj);
    var temp = document.createElement('div');
    temp.style.position = 'absolute';
    temp.style.left = '-10000px';
    temp.style.top = '0';
    temp.innerHTML = '<div id="posterStage" class="poster-stage tmpl-' + Store.escapeHtml(state.template) +
      '" data-size="' + Store.escapeHtml(sizeKey()) + '"></div>';
    document.body.appendChild(temp);
    function restore() {
      state = savedState; currentId = savedId;
      if (temp.parentNode) temp.parentNode.removeChild(temp);
    }
    return captureContainerCanvas(temp).then(function (c) { restore(); return c; },
      function (err) { restore(); throw err; });
  }

  // Public export API consumed by the gallery (full-res, since the gallery only
  // stores a low-res thumbnail preview).
  window.PosterExport = {
    available: function () { return typeof html2canvas !== 'undefined'; },
    toCanvas: exportObjectToCanvas,
    download: function (posterObj) {
      return exportObjectToCanvas(posterObj).then(function (canvas) {
        var name = 'poster-' + sanitizeFilename(posterObj.headline || posterObj.newspaperName) + '.png';
        return canvasToBlob(canvas).then(function (blob) {
          if (blob) { triggerDownload(URL.createObjectURL(blob), name, true); }
          else triggerDownload(canvas.toDataURL('image/png'), name, false);
          App.toast('تم تصدير صورة عالية الدقة ✓', 'success');
        });
      }).catch(function () { App.toast('تعذّر التصدير', 'error'); });
    },
    copy: function (posterObj) {
      return exportObjectToCanvas(posterObj).then(function (c) { return copyCanvas(c); })
        .catch(function () { App.toast('تعذّر النسخ', 'error'); });
    },
    share: function (posterObj) {
      return exportObjectToCanvas(posterObj)
        .then(function (c) { return shareCanvas(c, sanitizeFilename(posterObj.headline || posterObj.newspaperName)); })
        .catch(function () { App.toast('تعذّرت المشاركة', 'error'); });
    }
  };

  /* ----------------------------- save / duplicate / reset ----------------------------- */
  function buildPosterObject(preview) {
    return {
      id: currentId || undefined,
      template: state.template,
      size: sizeKey(),
      newspaperName: state.newspaperName,
      newspaperSubtitle: state.newspaperSubtitle,
      issue: state.issue,
      posterDate: state.posterDate || Store.todayISO(),
      headline: state.headline,
      subheadline: state.subheadline,
      description: state.description,
      imageCaption: state.imageCaption,
      image: state.image,
      secondHeadline: state.secondHeadline,
      secondDescription: state.secondDescription,
      secondImageCaption: state.secondImageCaption,
      secondImage: state.secondImage,
      sourceNewsId: state.sourceNewsId || null,
      preview: preview || ''
    };
  }

  function persist(preview) {
    var saved = Store.savePoster(buildPosterObject(preview));
    if (saved) {
      currentId = saved.id;   // keep id so subsequent saves update, not duplicate
      App.toast('تم حفظ البوستر ✓', 'success');
    } else {
      App.toast('تعذّر حفظ البوستر', 'error');
    }
  }

  function savePoster(container) {
    // Footprint guard — warn before a save that could push localStorage near its cap.
    var estimate = 0;
    try { estimate = JSON.stringify(buildPosterObject('')).length * 2; } catch (e) {}
    if (Store.nearQuota && Store.nearQuota(estimate)) {
      App.confirm({
        danger: true, title: 'مساحة التخزين منخفضة',
        message: 'حفظ هذا البوستر قد يقترب من ملء مساحة التخزين المحلية. ننصح بحذف بوسترات قديمة أو تصدير نسخة احتياطية أولًا. هل تريد المتابعة؟',
        confirmText: 'متابعة الحفظ', cancelText: 'إلغاء'
      }).then(function (ok) { if (ok) savePosterProceed(container); });
      return;
    }
    savePosterProceed(container);
  }

  function savePosterProceed(container) {
    var btn = container.querySelector('#psSave');
    if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = '… جارٍ الحفظ'; }

    rebuildStage(container);

    function restoreBtn() {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl || '💾 حفظ البوستر'; }
    }

    if (typeof html2canvas === 'undefined') {
      persist('');
      App.toast('تم الحفظ بدون صورة مصغّرة (أداة التصدير غير متاحة).', 'info', 3500);
      restoreBtn();
      return;
    }

    var sz = activeSize();
    withCapture(container, function (stage) {
      // smaller scale for a lightweight thumbnail stored in the gallery
      return html2canvas(stage, {
        scale: 0.5,
        backgroundColor: '#efe7d3',
        useCORS: true,
        logging: false,
        width: sz.w,
        height: sz.h,
        windowWidth: sz.w,
        windowHeight: sz.h
      });
    }).then(function (canvas) {
      canvas = normalizeCanvas(canvas, Math.round(sz.w * 0.5), Math.round(sz.h * 0.5));
      var preview = '';
      try { preview = canvas.toDataURL('image/jpeg', 0.82); } catch (e) { preview = ''; }
      persist(preview);
    }).catch(function (e) {
      console.error('preview gen failed', e);
      persist('');
      App.toast('تم الحفظ بدون صورة مصغّرة.', 'info', 3000);
    }).finally(restoreBtn);
  }

  function duplicatePoster() {
    currentId = null;            // next save creates a new record
    state.sourceNewsId = state.sourceNewsId || null;
    App.toast('تم إنشاء نسخة جديدة — احفظها', 'info', 3000);
    App.refresh();
  }

  function resetTemplate() {
    var key = state.template;
    App.confirm({
      title: 'إعادة ضبط القالب',
      message: 'سيتم إرجاع كل الحقول إلى القيم الافتراضية لقالب «' + templateLabel(key) + '». لا يمكن التراجع.',
      confirmText: 'إعادة الضبط',
      cancelText: 'إلغاء',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var keepSize = sizeKey();   // size is independent of the template; keep it
      state = templateDefaults(key);
      state.size = keepSize;
      currentId = null;
      App.refresh();
      App.toast('تمت إعادة ضبط القالب', 'success');
    });
  }

  /* ----------------------------- onShow ----------------------------- */
  function onShow(container) {
    // ensure scale is correct after the view becomes visible (layout settled)
    fitScale(container);
    // a second pass after fonts/images settle
    setTimeout(function () { fitScale(container); }, 120);
  }

  /* ----------------------------- register ----------------------------- */
  App.registerPage('poster', {
    render: render,
    onShow: onShow
  });
})();
