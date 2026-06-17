/* =============================================================================
 * gallery.js — "معرض البوسترات" (Saved Posters Gallery) section.
 * Responsive grid of saved posters (newest first). Per-card actions:
 *   edit / duplicate / download PNG / delete.
 * Self-registers via App.registerPage('gallery'). Plain browser global, no modules.
 * ========================================================================== */
(function () {
  'use strict';

  var searchTerm = '';
  var templateFilter = 'all';
  var refocusSearch = false;

  /* ------------------------------ helpers ------------------------------ */

  // Map a template key to its Arabic label (falls back gracefully).
  function templateLabel(key) {
    var list = (window.Store && Store.TEMPLATES) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i].label;
    }
    return 'تصميم';
  }

  // Trigger a browser download of a dataURL (PNG) via a temporary <a download>.
  function downloadDataURL(dataURL, filename) {
    try {
      var a = document.createElement('a');
      a.href = dataURL;
      a.download = filename || 'poster.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Build a safe filename slug from the headline (Arabic-friendly: keep letters/digits).
  function fileSlug(headline) {
    var base = (headline || 'بوستر').toString().trim();
    base = base.replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 40);
    if (!base) base = 'بوستر';
    return 'kabint-mondial-' + base + '.png';
  }

  /* ------------------------------ rendering ------------------------------ */

  function cardHTML(p) {
    var esc = Store.escapeHtml;
    var id = esc(p.id);
    var headline = (p.headline || '').toString().trim();
    var headlineDisplay = headline || 'بدون عنوان';
    var tmplLabel = templateLabel(p.template);
    var created = Store.formatDateTime(p.createdAt);

    // Preview area: real preview image, or a tasteful newsprint placeholder.
    var previewInner;
    if (p.preview) {
      previewInner =
        '<img class="gal-card__img" src="' + esc(p.preview) + '" ' +
        'alt="' + esc(headlineDisplay) + '" loading="lazy" />';
    } else {
      previewInner =
        '<div class="gal-placeholder" aria-hidden="false">' +
          '<div class="gal-placeholder__rule"></div>' +
          '<div class="gal-placeholder__masthead">' + esc(tmplLabel) + '</div>' +
          '<div class="gal-placeholder__rule"></div>' +
          '<div class="gal-placeholder__headline">' + esc(headlineDisplay) + '</div>' +
          '<div class="gal-placeholder__lines">' +
            '<span></span><span></span><span></span>' +
          '</div>' +
          '<div class="gal-placeholder__tag">لا توجد معاينة بعد</div>' +
        '</div>';
    }

    return '' +
      '<article class="gal-card card animate-in" data-id="' + id + '">' +
        '<div class="gal-card__preview' + (p.preview ? '' : ' gal-card__preview--empty') + '">' +
          previewInner +
          '<span class="gal-card__chip chip">' + esc(tmplLabel) + '</span>' +
        '</div>' +
        '<div class="gal-card__body">' +
          '<h3 class="gal-card__headline" title="' + esc(headlineDisplay) + '">' +
            esc(headlineDisplay) +
          '</h3>' +
          '<div class="gal-card__meta text-xs muted">' +
            '<span class="gal-card__date">أُنشئ: ' + esc(created) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="gal-card__actions">' +
          '<button class="btn btn-sm btn-ghost" data-act="edit" data-id="' + id + '" type="button">✎ تعديل</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="duplicate" data-id="' + id + '" type="button">⧉ تكرار</button>' +
          '<button class="btn btn-sm btn-outline-gold" data-act="download" data-id="' + id + '" type="button">⬇ تحميل بدقة كاملة</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="copy" data-id="' + id + '" type="button">⧉ نسخ</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="share" data-id="' + id + '" type="button">↗ مشاركة</button>' +
          '<button class="btn btn-sm btn-danger" data-act="delete" data-id="' + id + '" type="button">🗑 حذف</button>' +
        '</div>' +
      '</article>';
  }

  function emptyStateHTML() {
    return '' +
      '<div class="empty-state animate-in">' +
        '<div class="empty-state__icon">🖼</div>' +
        '<h3>لا توجد بوسترات محفوظة بعد</h3>' +
        '<p class="muted">ابدأ من مولد الجريدة لإنشاء أول بوستر، وسيظهر هنا تلقائيًا للتعديل والتحميل لاحقًا.</p>' +
        '<button class="btn btn-gold btn-lg" data-act="open-poster" type="button">🖼 افتح مولد الجريدة</button>' +
      '</div>';
  }

  function toolbarHTML() {
    var options = '<option value="all">كل القوالب</option>';
    (Store.TEMPLATES || []).forEach(function (t) {
      options += '<option value="' + Store.escapeHtml(t.key) + '"' +
        (templateFilter === t.key ? ' selected' : '') + '>' + Store.escapeHtml(t.label) + '</option>';
    });
    return '' +
      '<div class="panel gal-toolbar">' +
        '<div class="gal-search">' +
          '<span class="gal-search__ico" aria-hidden="true">🔍</span>' +
          '<input type="search" class="input" id="galSearch" value="' + Store.escapeHtml(searchTerm) + '" placeholder="ابحث بعنوان البوستر..." autocomplete="off">' +
        '</div>' +
        '<select class="select gal-template-filter" id="galTemplateFilter">' + options + '</select>' +
      '</div>';
  }

  function matchesPoster(p) {
    var q = searchTerm.trim().toLowerCase();
    var hay = [p.headline, p.subheadline, p.description, templateLabel(p.template)].join(' ').toLowerCase();
    var matchText = !q || hay.indexOf(q) >= 0;
    var matchTemplate = templateFilter === 'all' || p.template === templateFilter;
    return matchText && matchTemplate;
  }

  function noResultsHTML() {
    return '' +
      '<div class="empty-state animate-in">' +
        '<div class="empty-state__icon">🔎</div>' +
        '<h3>لا توجد بوسترات مطابقة</h3>' +
        '<p class="muted">جرّب تعديل البحث أو اختيار كل القوالب.</p>' +
        '<button class="btn btn-ghost" data-act="clear-filters" type="button">مسح الفلاتر</button>' +
      '</div>';
  }

  function render(container) {
    var posters = Store.getPosters(); // already sorted newest-first by the store
    var visible = posters.filter(matchesPoster);
    var count = posters.length;

    var headActions =
      '<div class="page-head__actions">' +
        '<button class="btn btn-gold" data-act="open-poster" type="button">🖼 مولد جديد</button>' +
      '</div>';

    var head =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">معرض <span class="accent">البوسترات</span></h1>' +
          '<p class="page-sub">' +
            (count
              ? ('كل البوسترات المحفوظة محليًا — ' + count + ' بوستر، الأحدث أولًا.')
              : 'هنا تُحفظ كل البوسترات التي تنشئها من مولد الجريدة.') +
          '</p>' +
        '</div>' +
        headActions +
      '</div>';

    var body;
    if (!count) {
      body = emptyStateHTML();
    } else if (!visible.length) {
      body = toolbarHTML() + noResultsHTML();
    } else {
      var cards = '';
      for (var i = 0; i < visible.length; i++) {
        cards += cardHTML(visible[i]);
      }
      body = toolbarHTML() + '<div class="gal-grid">' + cards + '</div>';
    }

    container.innerHTML = head + body;

    bindEvents(container);
    restoreToolbarFocus(container);
  }

  /* ------------------------------ events ------------------------------ */

  function bindEvents(container) {
    // Single delegated click handler for the whole view.
    if (container.__galleryClickBound) return;
    container.__galleryClickBound = true;
    container.addEventListener('click', onClick);
    container.addEventListener('input', onInput);
    container.addEventListener('change', onChange);
  }

  function restoreToolbarFocus(container) {
    var input = container.querySelector('#galSearch');
    if (input && refocusSearch) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      refocusSearch = false;
    }
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');

    if (act === 'open-poster') {
      App.go('poster');
      return;
    }
    if (act === 'clear-filters') {
      searchTerm = '';
      templateFilter = 'all';
      App.refresh();
      return;
    }
    if (act === 'edit') {
      App.editPoster(id);
      return;
    }
    if (act === 'duplicate') {
      duplicatePoster(id);
      return;
    }
    if (act === 'download') {
      downloadPoster(id);
      return;
    }
    if (act === 'copy') {
      copyPoster(id);
      return;
    }
    if (act === 'share') {
      sharePoster(id);
      return;
    }
    if (act === 'delete') {
      deletePoster(id);
      return;
    }
  }

  var searchDebounce = null;
  function onInput(e) {
    if (e.target && e.target.id === 'galSearch') {
      searchTerm = e.target.value || '';
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        searchDebounce = null;
        refocusSearch = true;
        App.refresh();
      }, 180);
    }
  }

  function onChange(e) {
    if (e.target && e.target.id === 'galTemplateFilter') {
      templateFilter = e.target.value || 'all';
      App.refresh();
    }
  }

  function duplicatePoster(id) {
    var src = Store.getPosterById(id);
    if (!src) {
      App.toast('تعذّر العثور على البوستر', 'error');
      return;
    }
    // Clone, strip identity/timestamps so the store assigns a fresh record.
    var clone = JSON.parse(JSON.stringify(src));
    delete clone.id;
    delete clone.createdAt;
    delete clone.updatedAt;
    var saved = Store.savePoster(clone);
    if (saved) {
      App.toast('تم تكرار البوستر', 'success');
      // Store emits a change event -> App.refresh() re-renders this view.
    } else {
      App.toast('تعذّر تكرار البوستر', 'error');
    }
  }

  function exporterReady() {
    return window.PosterExport && window.PosterExport.available && window.PosterExport.available();
  }

  function downloadPoster(id) {
    var p = Store.getPosterById(id);
    if (!p) {
      App.toast('تعذّر العثور على البوستر', 'error');
      return;
    }
    // Re-render the saved poster at TRUE full resolution (the stored preview is a
    // low-res thumbnail). Falls back to the thumbnail if the exporter is missing.
    if (exporterReady()) {
      App.toast('يتم تجهيز صورة عالية الدقة…', 'info', 1800);
      window.PosterExport.download(p);
      return;
    }
    if (p.preview) {
      var ok = downloadDataURL(p.preview, fileSlug(p.headline));
      App.toast(ok ? 'تم تحميل المعاينة' : 'تعذّر تحميل الصورة', ok ? 'success' : 'error');
    } else {
      App.toast('افتح البوستر وأنشئ معاينة أولًا', 'info');
    }
  }

  function copyPoster(id) {
    var p = Store.getPosterById(id);
    if (!p) { App.toast('تعذّر العثور على البوستر', 'error'); return; }
    if (!exporterReady()) { App.toast('النسخ غير متاح حاليًا', 'error'); return; }
    App.toast('يتم تجهيز الصورة…', 'info', 1500);
    window.PosterExport.copy(p);
  }

  function sharePoster(id) {
    var p = Store.getPosterById(id);
    if (!p) { App.toast('تعذّر العثور على البوستر', 'error'); return; }
    if (!exporterReady()) { App.toast('المشاركة غير متاحة حاليًا', 'error'); return; }
    window.PosterExport.share(p);
  }

  function deletePoster(id) {
    var p = Store.getPosterById(id);
    var name = (p && (p.headline || '').toString().trim()) || 'بدون عنوان';
    App.confirm({
      title: 'حذف البوستر',
      message: 'سيتم حذف البوستر «' + name + '» نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      if (Store.deletePoster(id)) {
        App.toast('تم حذف البوستر', 'success');
        // Store emits -> App.refresh() re-renders.
      } else {
        App.toast('تعذّر حذف البوستر', 'error');
      }
    });
  }

  /* ------------------------------ register ------------------------------ */
  App.registerPage('gallery', {
    render: render
  });
})();
