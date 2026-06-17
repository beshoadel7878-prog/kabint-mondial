/* =============================================================================
 * editor.js — "المحرر" (Admin Editor) section for "كابينة مونديال".
 * Manual daily content entry. Two-column layout: form (main) + saved list (side).
 * Registers via App.registerPage('editor'). No backend; all state in Store.
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- module state ----------------------------- */
  var editingId = null;       // id of the news item currently being edited (null = new)
  var imageData = '';         // dataURL of the currently attached image
  var savedFlash = null;      // id of the just-saved item (to highlight in side list)
  var sideSearch = '';        // quick filter for the saved-items side list
  var sticky = null;          // {matchDate,stage,country} carried over by "save & new"

  /* The form fields we read/write, with their default values. */
  var TEXT_FIELDS = [
    'title', 'matchName', 'score', 'teamA', 'teamB', 'matchDate',
    'stage', 'country', 'group', 'rawNews', 'summary', 'moments',
    'videoAngle', 'videoTitle', 'editorNotes', 'tags'
  ];

  /* ----------------------------- markup ----------------------------- */
  function stageOptions(selected) {
    var html = '<option value="">— اختر —</option>';
    Store.STAGES.forEach(function (s) {
      var sel = (s === selected) ? ' selected' : '';
      html += '<option value="' + Store.escapeHtml(s) + '"' + sel + '>' + Store.escapeHtml(s) + '</option>';
    });
    return html;
  }

  function statusOptions(selected) {
    var html = '<option value="">— بدون —</option>';
    Store.STATUSES.forEach(function (s) {
      var sel = (s.key === selected) ? ' selected' : '';
      html += '<option value="' + Store.escapeHtml(s.key) + '"' + sel + '>' + Store.escapeHtml(s.label) + '</option>';
    });
    return html;
  }

  function segControl(importance) {
    var imp = Store.IMPORTANCE_BY_KEY[importance] ? importance : 'normal';
    var html = '<div class="seg" id="ed-importance">';
    Store.IMPORTANCE.forEach(function (lvl) {
      var id = 'ed-imp-' + lvl.key;
      var checked = (lvl.key === imp) ? ' checked' : '';
      html += '<input type="radio" name="ed-importance" id="' + id + '" value="' + lvl.key + '"' + checked + '>'
        + '<label for="' + id + '" class="is-' + lvl.key + '">' + Store.escapeHtml(lvl.label) + '</label>';
    });
    html += '</div>';
    return html;
  }

  function imageBlockHtml(dataURL) {
    if (dataURL) {
      return '<div class="thumb-preview animate-in">'
        + '<img src="' + Store.escapeHtml(dataURL) + '" alt="معاينة الصورة">'
        + '<button type="button" class="btn btn-ghost btn-sm" id="ed-img-remove">إزالة الصورة</button>'
        + '</div>';
    }
    return '<div class="dropzone" id="ed-dropzone">'
      + '<div class="ed-dz-ico">🖼️</div>'
      + '<div class="ed-dz-text">اسحب صورة هنا أو اضغط للاختيار</div>'
      + '<div class="field-hint">PNG أو JPG — تُحفظ محليًا مع الخبر</div>'
      + '</div>';
  }

  function sideRowHtml(n) {
    var badge = Store.importanceBadge(n.importance);
    var label = Store.importanceLabel(n.importance);
    var titleText = (n.title || n.matchName || 'بدون عنوان');
    var score = n.score ? '<span class="ed-row__score">' + Store.escapeHtml(n.score) + '</span>' : '';
    var active = (n.id === editingId) ? ' is-active' : '';
    var flash = (n.id === savedFlash) ? ' animate-in' : '';
    var searchText = [
      n.title, n.matchName, n.teamA, n.teamB, n.score, n.country, Store.importanceLabel(n.importance)
    ].join(' ').toLowerCase();
    return '<button type="button" class="ed-row' + active + flash + '" data-id="' + Store.escapeHtml(n.id) + '" data-search="' + Store.escapeHtml(searchText) + '">'
      + '<span class="badge ' + badge + '">' + Store.escapeHtml(label) + '</span>'
      + '<span class="ed-row__title">' + Store.escapeHtml(titleText) + '</span>'
      + score
      + '</button>';
  }

  function sideListHtml() {
    var list = Store.getNewsSorted();
    var head = '<div class="row-between ed-side__head">'
      + '<div class="section-title" style="margin-bottom:0">العناصر المحفوظة</div>'
      + '<span class="chip">' + list.length + '</span>'
      + '</div>';

    if (!list.length) {
      return head + '<div class="empty-state ed-side__empty">'
        + '<div class="empty-state__icon">🗂️</div>'
        + '<h3>لا توجد عناصر محفوظة</h3>'
        + '<p class="muted">ابدأ بإدخال أول خبر في النموذج، وسيظهر هنا فور الحفظ.</p>'
        + '<button type="button" class="btn btn-outline-gold btn-sm" id="ed-empty-focus">إدخال خبر جديد</button>'
        + '</div>';
    }

    var rows = list.map(sideRowHtml).join('');
    return head
      + '<div class="field ed-side-search">'
      +   '<label for="ed-side-search" class="field-label">بحث سريع</label>'
      +   '<input type="search" class="input" id="ed-side-search" value="' + Store.escapeHtml(sideSearch) + '" placeholder="ابحث بالعنوان، الفريق، النتيجة..." autocomplete="off">'
      + '</div>'
      + '<div class="ed-rows">' + rows + '</div>'
      + '<div class="empty-state ed-side__empty ed-side__no-results hidden" id="ed-side-no-results">'
      +   '<div class="empty-state__icon">🔎</div>'
      +   '<h3>لا توجد نتائج</h3>'
      +   '<p class="muted">عدّل البحث أو امسحه لعرض كل العناصر.</p>'
      + '</div>';
  }

  function viewHtml(data) {
    var editMode = !!editingId;
    return ''
      + '<div class="page-head">'
      +   '<div>'
      +     '<h1 class="page-title">المحرر <span class="accent">اليومي</span></h1>'
      +     '<p class="page-sub">' + (editMode ? 'تعديل عنصر محفوظ' : 'إدخال محتوى يدوي جديد') + ' — كل البيانات تُحفظ محليًا.</p>'
      +   '</div>'
      +   '<div class="page-head__actions">'
      +     '<span class="chip ed-mode' + (editMode ? ' is-edit' : '') + '" id="ed-mode-chip">'
      +       (editMode ? '✎ وضع التعديل' : '＋ عنصر جديد')
      +     '</span>'
      +   '</div>'
      + '</div>'

      + '<div class="ed-layout">'

      // -------- main form --------
      +   '<div class="panel ed-main animate-in">'
      +     '<form id="ed-form" class="form-grid" autocomplete="off">'

      +       field2('عنوان المحتوى', input('title', data.title, 'مثال: مصر تخسر بشق الأنفس أمام بلجيكا'))
      +       field('اسم المباراة', input('matchName', data.matchName, 'مثال: مصر × بلجيكا'))
      +       field('النتيجة', input('score', data.score, 'مثال: 2-1'))
      +       field('الفريق الأول', input('teamA', data.teamA, 'مثال: مصر'))
      +       field('الفريق الثاني', input('teamB', data.teamB, 'مثال: بلجيكا'))
      +       field('تاريخ المباراة', '<input type="date" class="input" id="ed-matchDate" value="' + Store.escapeHtml(data.matchDate) + '">')
      +       field('مرحلة البطولة', '<select class="select" id="ed-stage">' + stageOptions(data.stage) + '</select>')
      +       field('الدولة / المنتخب', input('country', data.country, 'مثال: مصر'))
      +       field('المجموعة', input('group', data.group, 'مثال: المجموعة A'))
      +       field('حالة المحتوى', '<select class="select" id="ed-status">' + statusOptions(data.status) + '</select>')

      +       field2('درجة الأهمية', segControl(data.importance))

      +       field2('النص الخام لآخر الأخبار', textarea('rawNews', data.rawNews, 'الصق هنا النص الخام كما ورد...'))
      +       field2('الملخص العربي', textarea('summary', data.summary, 'ملخص عربي مُحرَّر للنشر...'))
      +       field2('أهم اللقطات', textarea('moments', data.moments, 'لقطة في كل سطر...'), 'كل لقطة في سطر')

      +       field('فكرة الفيديو', textarea('videoAngle', data.videoAngle, 'زاوية المعالجة المقترحة للفيديو...'))
      +       field('عنوان الفيديو المقترح', input('videoTitle', data.videoTitle, 'عنوان جذّاب للفيديو'))

      +       field2('ملاحظات للمحرر', textarea('editorNotes', data.editorNotes, 'تعليمات المونتاج، الموسيقى، اللقطات المطلوبة...'))

      +       field2('الوسوم', input('tags', data.tags, 'مثال: ريمونتادا، جدل تحكيمي، نجم المباراة'), 'افصل بين الوسوم بفاصلة — تُستخدم للفلترة في عرض الفريق')

      +       field2('الصورة', '<div id="ed-image-wrap">' + imageBlockHtml(data.image) + '</div>'
      +         '<input type="file" id="ed-image-input" accept="image/*" hidden>')

      +     '</form>'

      +     '<div class="divider"></div>'

      +     '<div class="ed-actions">'
      +       '<button type="button" class="btn btn-gold" id="ed-save">💾 حفظ التحديث</button>'
      +       '<button type="button" class="btn btn-outline-gold" id="ed-save-new">＋ حفظ وإضافة جديد</button>'
      +       '<button type="button" class="btn btn-ghost" id="ed-clear">🧹 مسح النموذج</button>'
      +       '<button type="button" class="btn btn-danger" id="ed-delete"' + (editMode ? '' : ' disabled') + '>🗑 حذف العنصر</button>'
      +       '<button type="button" class="btn btn-outline-gold" id="ed-duplicate"' + (editMode ? '' : ' disabled') + '>⧉ تكرار الخبر</button>'
      +       '<span class="ed-actions__spacer"></span>'
      +       '<button type="button" class="btn btn-outline-gold btn-sm" id="ed-export">⭱ تصدير JSON</button>'
      +       '<button type="button" class="btn btn-ghost btn-sm" id="ed-import">⭳ استيراد JSON</button>'
      +     '</div>'
      +     '<div class="ed-postsave' + (editMode ? '' : ' hidden') + '" id="ed-postsave">'
      +       '<button type="button" class="btn btn-outline-gold btn-sm" id="ed-view-team">▣ عرض في صفحة الفريق</button>'
      +       '<button type="button" class="btn btn-ghost btn-sm" id="ed-poster">▤ توليد بوستر من هذا الخبر</button>'
      +     '</div>'
      +   '</div>'

      // -------- side list --------
      +   '<aside class="panel ed-side animate-in">'
      +     sideListHtml()
      +   '</aside>'

      + '</div>';
  }

  /* small markup helpers ------------------------------------------------- */
  function input(name, value, ph) {
    return '<input type="text" class="input" id="ed-' + name + '" value="' + Store.escapeHtml(value) + '" placeholder="' + Store.escapeHtml(ph || '') + '">';
  }
  function textarea(name, value, ph) {
    return '<textarea class="textarea" id="ed-' + name + '" placeholder="' + Store.escapeHtml(ph || '') + '">' + Store.escapeHtml(value) + '</textarea>';
  }
  function field(label, control, hint) {
    var h = hint ? '<span class="field-hint">' + Store.escapeHtml(hint) + '</span>' : '';
    return '<div class="field"><label>' + Store.escapeHtml(label) + '</label>' + control + h + '</div>';
  }
  function field2(label, control, hint) {
    var h = hint ? '<span class="field-hint">' + Store.escapeHtml(hint) + '</span>' : '';
    return '<div class="field col-span-2"><label>' + Store.escapeHtml(label) + '</label>' + control + h + '</div>';
  }

  /* ----------------------------- data helpers ----------------------------- */
  function blankData() {
    var s = (Store.getSettings ? Store.getSettings() : {}) || {};
    return {
      title: '', matchName: '', score: '', teamA: '', teamB: '',
      matchDate: (sticky && sticky.matchDate) || Store.todayISO(),
      stage: (sticky && sticky.stage) || '',
      country: (sticky && sticky.country) || (s.teamCountry || ''),
      group: (sticky && sticky.group) || '',
      status: '',
      rawNews: '', summary: '', importance: 'normal', moments: '',
      videoAngle: '', videoTitle: '', editorNotes: '', image: '', tags: ''
    };
  }

  // Decide what data to render from, consuming any pending handoff.
  function resolveData() {
    // 1) explicit edit request
    if (App.pending && App.pending.editorItemId) {
      var id = App.pending.editorItemId;
      App.pending.editorItemId = null;
      var item = Store.getNewsById(id);
      if (item) {
        editingId = item.id;
        imageData = item.image || '';
        return itemToData(item);
      }
      // item vanished — fall through to blank
      editingId = null;
      imageData = '';
      return blankData();
    }

    // 2) prefill from AI assistant (new item)
    if (App.pending && App.pending.editorPrefill) {
      var pre = App.pending.editorPrefill;
      App.pending.editorPrefill = null;
      editingId = null;
      var d = blankData();
      Object.keys(d).forEach(function (k) {
        if (pre[k] != null && pre[k] !== '') d[k] = pre[k];
      });
      if (!Store.IMPORTANCE_BY_KEY[d.importance]) d.importance = 'normal';
      imageData = d.image || '';
      return d;
    }

    // 3) currently editing an existing item -> reload fresh copy from store
    if (editingId) {
      var cur = Store.getNewsById(editingId);
      if (cur) {
        imageData = cur.image || '';
        return itemToData(cur);
      }
      editingId = null; // it was deleted elsewhere
    }

    // 4) blank new form
    imageData = imageData || '';
    var blank = blankData();
    blank.image = imageData;
    return blank;
  }

  function itemToData(item) {
    return {
      title: item.title || '', matchName: item.matchName || '', score: item.score || '',
      teamA: item.teamA || '', teamB: item.teamB || '',
      matchDate: item.matchDate || '', stage: item.stage || '',
      country: item.country || '', group: item.group || '',
      status: item.status || '',
      rawNews: item.rawNews || '',
      summary: item.summary || '', importance: item.importance || 'normal',
      moments: item.moments || '', videoAngle: item.videoAngle || '',
      videoTitle: item.videoTitle || '', editorNotes: item.editorNotes || '',
      image: item.image || '',
      tags: (item.tags || []).join('، ')
    };
  }

  // Read the live form into a plain object (uses module imageData for the image).
  function readForm(container) {
    var data = {};
    TEXT_FIELDS.forEach(function (name) {
      var el = container.querySelector('#ed-' + name);
      data[name] = el ? el.value : '';
    });
    var checked = container.querySelector('input[name="ed-importance"]:checked');
    data.importance = checked ? checked.value : 'normal';
    var st = container.querySelector('#ed-status');
    data.status = st ? st.value : '';
    data.image = imageData;
    return data;
  }

  /* ----------------------------- render ----------------------------- */
  function render(container) {
    var data = resolveData();
    container.innerHTML = viewHtml(data);
    bind(container);
    // clear the one-shot flash after it has been rendered once
    savedFlash = null;
  }

  /* ----------------------------- binding ----------------------------- */
  function bind(container) {
    bindImage(container);
    bindSideList(container);
    bindSideSearch(container);
    bindActions(container);
  }

  function bindImage(container) {
    // The hidden file input persists across image-block refreshes; replace it
    // with a clone so we never stack duplicate 'change' listeners on it.
    var oldInput = container.querySelector('#ed-image-input');
    if (oldInput && oldInput.parentNode) {
      var fresh = oldInput.cloneNode(false);
      fresh.value = '';
      oldInput.parentNode.replaceChild(fresh, oldInput);
    }
    var input = container.querySelector('#ed-image-input');

    var dz = container.querySelector('#ed-dropzone');
    if (dz && input) {
      dz.addEventListener('click', function () { input.click(); });
      dz.addEventListener('dragover', function (e) {
        e.preventDefault();
        dz.classList.add('is-drag');
      });
      dz.addEventListener('dragleave', function () { dz.classList.remove('is-drag'); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.classList.remove('is-drag');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadImageFile(file, container);
      });
    }

    if (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (file) loadImageFile(file, container);
      });
    }

    var remove = container.querySelector('#ed-img-remove');
    if (remove) {
      remove.addEventListener('click', function () {
        imageData = '';
        refreshImageBlock(container);
      });
    }
  }

  function loadImageFile(file, container) {
    if (!/^image\//.test(file.type)) {
      App.toast('الرجاء اختيار ملف صورة صالح', 'error');
      return;
    }
    Store.fileToDataURL(file, { maxWidth: 1500, maxHeight: 1100, quality: 0.82 }).then(function (url) {
      imageData = url || '';
      if (file.size && Store.dataUrlBytes && Store.dataUrlBytes(url) < file.size * 0.88) {
        App.toast('تم ضغط الصورة قبل الحفظ لتقليل مساحة التخزين', 'success', 2200);
      }
      refreshImageBlock(container);
    }).catch(function () {
      App.toast('تعذّر قراءة الصورة', 'error');
    });
  }

  // Re-render only the image sub-block so typed-but-unsaved fields are preserved.
  function refreshImageBlock(container) {
    var wrap = container.querySelector('#ed-image-wrap');
    if (!wrap) return;
    wrap.innerHTML = imageBlockHtml(imageData);
    bindImage(container); // re-wire dropzone / remove button
  }

  function bindSideList(container) {
    var rows = container.querySelectorAll('.ed-row');
    Array.prototype.forEach.call(rows, function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id');
        if (!id) return;
        var item = Store.getNewsById(id);
        if (!item) { App.toast('تعذّر العثور على العنصر', 'error'); return; }
        editingId = id;
        imageData = item.image || '';
        render(container);
        App.toast('تم تحميل العنصر للتعديل', 'info', 1600);
      });
    });

    var emptyFocus = container.querySelector('#ed-empty-focus');
    if (emptyFocus) {
      emptyFocus.addEventListener('click', function () {
        var t = container.querySelector('#ed-title');
        if (t) t.focus();
      });
    }
  }

  function bindSideSearch(container) {
    var input = container.querySelector('#ed-side-search');
    if (!input) return;
    var apply = function () {
      sideSearch = input.value || '';
      var q = sideSearch.trim().toLowerCase();
      var shown = 0;
      Array.prototype.forEach.call(container.querySelectorAll('.ed-row'), function (row) {
        var ok = !q || (row.getAttribute('data-search') || '').indexOf(q) >= 0;
        row.classList.toggle('hidden', !ok);
        if (ok) shown++;
      });
      var empty = container.querySelector('#ed-side-no-results');
      if (empty) empty.classList.toggle('hidden', shown !== 0);
    };
    input.addEventListener('input', apply);
    apply();
  }

  function bindActions(container) {
    var saveBtn = container.querySelector('#ed-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { doSave(container); });

    var saveNewBtn = container.querySelector('#ed-save-new');
    if (saveNewBtn) saveNewBtn.addEventListener('click', function () { doSaveNew(container); });

    var clearBtn = container.querySelector('#ed-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { doClear(container); });

    var delBtn = container.querySelector('#ed-delete');
    if (delBtn) delBtn.addEventListener('click', function () { doDelete(container); });

    var dupBtn = container.querySelector('#ed-duplicate');
    if (dupBtn) dupBtn.addEventListener('click', function () { doDuplicate(container); });

    var exportBtn = container.querySelector('#ed-export');
    if (exportBtn) exportBtn.addEventListener('click', function () { App.exportJSON(); });

    var importBtn = container.querySelector('#ed-import');
    if (importBtn) importBtn.addEventListener('click', function () { App.openImport(); });

    var teamBtn = container.querySelector('#ed-view-team');
    if (teamBtn) teamBtn.addEventListener('click', function () { App.go('team'); });

    var posterBtn = container.querySelector('#ed-poster');
    if (posterBtn) posterBtn.addEventListener('click', function () {
      if (editingId) App.createPosterFromNews(editingId);
    });
  }

  /* ----------------------------- behaviors ----------------------------- */
  function doSave(container) {
    var data = readForm(container);

    var hasTitle = (data.title || '').trim() !== '';
    var hasMatch = (data.matchName || '').trim() !== '';
    if (!hasTitle && !hasMatch) {
      App.toast('أدخل عنوانًا أو اسم مباراة على الأقل', 'error');
      var t = container.querySelector('#ed-title');
      if (t) t.focus();
      return;
    }

    if (editingId) data.id = editingId;

    var saved = Store.saveNews(data);
    if (!saved) {
      // Store.write already surfaces a toast on quota failure.
      return;
    }

    editingId = saved.id;
    imageData = saved.image || '';
    savedFlash = saved.id;
    App.toast('تم حفظ التحديث', 'success');
    App.refresh();
    // NOTE: Store.saveNews emits a change event -> App.refresh() re-renders this
    // view via render(), switching the form into edit mode for the saved id.
  }

  // Save the current form, then reset to a fresh blank form keeping the shared
  // context (date/stage/country) sticky for fast back-to-back daily entry.
  function doSaveNew(container) {
    var data = readForm(container);
    var hasTitle = (data.title || '').trim() !== '';
    var hasMatch = (data.matchName || '').trim() !== '';
    if (!hasTitle && !hasMatch) {
      App.toast('أدخل عنوانًا أو اسم مباراة على الأقل', 'error');
      var t = container.querySelector('#ed-title');
      if (t) t.focus();
      return;
    }
    if (editingId) data.id = editingId;
    var saved = Store.saveNews(data);
    if (!saved) return; // quota toast already shown
    sticky = { matchDate: data.matchDate, stage: data.stage, country: data.country, group: data.group };
    editingId = null;
    imageData = '';
    savedFlash = saved.id;
    if (App.pending) { App.pending.editorItemId = null; App.pending.editorPrefill = null; }
    App.toast('تم الحفظ — جاهز لإدخال خبر جديد', 'success');
    render(container);
    var focusEl = container.querySelector('#ed-title');
    if (focusEl) focusEl.focus();
  }

  function doDuplicate(container) {
    if (!editingId) return;
    var data = readForm(container);
    var hasTitle = (data.title || '').trim() !== '';
    var hasMatch = (data.matchName || '').trim() !== '';
    if (!hasTitle && !hasMatch) {
      App.toast('لا يمكن تكرار عنصر بلا عنوان أو مباراة', 'error');
      return;
    }
    if (hasTitle && data.title.indexOf('نسخة - ') !== 0) data.title = 'نسخة - ' + data.title;
    delete data.id;
    var saved = Store.saveNews(data);
    if (!saved) return;
    editingId = saved.id;
    imageData = saved.image || '';
    savedFlash = saved.id;
    App.toast('تم إنشاء نسخة من الخبر', 'success');
    App.refresh();
  }

  function doClear(container) {
    var proceed = function () {
      editingId = null;
      imageData = '';
      savedFlash = null;
      sticky = null;
      // ensure no stale pending handoff revives an item
      if (App.pending) { App.pending.editorItemId = null; App.pending.editorPrefill = null; }
      render(container);
      App.toast('تم مسح النموذج', 'info', 1600);
    };

    if (isDirty(container)) {
      App.confirm({
        title: 'مسح النموذج',
        message: 'سيتم مسح المدخلات الحالية وإعادة النموذج لوضع الإدخال الجديد. متابعة؟',
        confirmText: 'مسح',
        cancelText: 'تراجع',
        danger: false
      }).then(function (ok) { if (ok) proceed(); });
    } else {
      proceed();
    }
  }

  function doDelete(container) {
    if (!editingId) return;
    var id = editingId;
    App.confirm({
      danger: true,
      title: 'حذف العنصر',
      message: 'سيتم حذف هذا الخبر نهائيًا. متابعة؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء'
    }).then(function (ok) {
      if (!ok) return;
      var done = Store.deleteNews(id);
      if (done) {
        editingId = null;
        imageData = '';
        savedFlash = null;
        App.toast('تم حذف العنصر', 'success');
        // Store emits change -> App.refresh() re-renders blank form + updated list.
      } else {
        App.toast('تعذّر حذف العنصر', 'error');
      }
    });
  }

  // Dirty = current form differs from the baseline (edited item or blank new).
  function isDirty(container) {
    var current = readForm(container);
    var baseline;
    if (editingId) {
      var item = Store.getNewsById(editingId);
      baseline = item ? itemToData(item) : blankData();
    } else {
      baseline = blankData();
    }
    var keys = TEXT_FIELDS.concat(['importance', 'status', 'image']);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = (current[k] == null) ? '' : String(current[k]);
      var b = (baseline[k] == null) ? '' : String(baseline[k]);
      // matchDate baseline for a fresh form is today's date; treat unchanged today as not dirty
      if (a !== b) return true;
    }
    return false;
  }

  /* ----------------------------- register ----------------------------- */
  App.registerPage('editor', {
    render: render
  });
})();
