/* =============================================================================
 * app.js — Router + shell controller for "كابينة مونديال". Exposes window.App.
 *
 * PAGE MODULE CONTRACT (every section uses this):
 *   App.registerPage('dashboard', {
 *     render: function (container) { ... },   // called every time the view shows / data changes
 *     onShow: function (container) { ... }    // optional, called once per navigation (after render)
 *   });
 *   Container ids in index.html: #view-dashboard #view-editor #view-team
 *                                #view-ai #view-poster #view-gallery
 *
 * CROSS-PAGE HANDOFFS (state stashed on App.pending, consumed by the target page):
 *   App.editNews(id)             -> go to editor, prefill that item   (App.pending.editorItemId)
 *   App.newNews()                -> go to editor, blank form
 *   App.sendToEditor(prefillObj) -> go to editor, prefill from object (App.pending.editorPrefill)
 *   App.createPosterFromNews(id) -> go to poster, autofill from news  (App.pending.posterSourceNewsId)
 *   App.editPoster(id)           -> go to poster, load saved poster   (App.pending.posterEditId)
 *
 * SHARED UI HELPERS:
 *   App.toast(msg, type, ms)         type: 'success' | 'error' | 'info'
 *   App.confirm({title, message, confirmText, danger}) -> Promise<boolean>
 *   App.chooseImportMode(fileName)    -> Promise<'merge'|'replace'|null>
 *   App.copy(text)                   -> Promise<boolean>   (writes to clipboard + toast)
 *   App.exportJSON()                 trigger backup download
 *   App.openImport()                 open the file picker + merge/replace prompt
 *   App.go(route)                    e.g. App.go('poster')
 * ========================================================================== */
(function () {
  'use strict';

  var ROUTES = ['dashboard', 'editor', 'team', 'ai', 'poster', 'gallery'];
  var DEFAULT_ROUTE = 'dashboard';

  var pages = {};            // name -> { render, onShow }
  var current = null;        // current route name
  var App = {};

  App.pending = {
    editorItemId: null,
    editorPrefill: null,
    posterSourceNewsId: null,
    posterEditId: null
  };

  /* ----------------------------- registration ----------------------------- */
  App.registerPage = function (name, def) {
    pages[name] = def || {};
  };

  function containerFor(name) {
    return document.getElementById('view-' + name);
  }

  /* ----------------------------- routing ----------------------------- */
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('/')[0].trim();
    return ROUTES.indexOf(h) >= 0 ? h : DEFAULT_ROUTE;
  }

  App.go = function (name) {
    if (ROUTES.indexOf(name) < 0) name = DEFAULT_ROUTE;
    if (location.hash !== '#/' + name) {
      location.hash = '#/' + name;   // triggers hashchange -> renderRoute
    } else {
      renderRoute(name);
    }
  };

  function renderRoute(name) {
    current = name;

    // toggle views
    ROUTES.forEach(function (r) {
      var el = containerFor(r);
      if (el) el.classList.toggle('view--active', r === name);
    });

    // nav active state
    var links = document.querySelectorAll('.nav-link');
    Array.prototype.forEach.call(links, function (a) {
      var on = a.getAttribute('data-route') === name;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    closeMobileNav();

    var page = pages[name];
    var container = containerFor(name);
    if (page && typeof page.render === 'function' && container) {
      try {
        page.render(container);
        if (typeof page.onShow === 'function') page.onShow(container);
      } catch (e) {
        console.error('render error for', name, e);
        container.innerHTML = '<div class="empty-state"><div class="empty-state__icon">⚠️</div>'
          + '<h3>حدث خطأ أثناء عرض هذا القسم</h3><p class="muted">'
          + (Store.escapeHtml(e && e.message) || '') + '</p></div>';
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Re-render the currently active page (used on data changes).
  App.refresh = function () {
    if (!current) return;
    var page = pages[current];
    var container = containerFor(current);
    if (page && typeof page.render === 'function' && container) {
      try { page.render(container); } catch (e) { console.error(e); }
    }
  };

  /* ----------------------------- cross-page handoffs ----------------------------- */
  App.newNews = function () {
    App.pending.editorItemId = null;
    App.pending.editorPrefill = null;
    App.go('editor');
  };
  App.editNews = function (id) {
    App.pending.editorItemId = id;
    App.pending.editorPrefill = null;
    App.go('editor');
  };
  App.sendToEditor = function (prefill) {
    App.pending.editorItemId = null;
    App.pending.editorPrefill = prefill || null;
    App.go('editor');
  };
  App.createPosterFromNews = function (id) {
    App.pending.posterSourceNewsId = id;
    App.pending.posterEditId = null;
    App.go('poster');
  };
  App.editPoster = function (id) {
    App.pending.posterEditId = id;
    App.pending.posterSourceNewsId = null;
    App.go('poster');
  };

  /* ----------------------------- toast ----------------------------- */
  App.toast = function (msg, type, ms) {
    type = type || 'info';
    ms = ms || 3200;
    var stack = document.getElementById('toastStack');
    if (!stack) { console.log('[toast]', msg); return; }
    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    var icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    el.innerHTML = '<span class="toast__icon">' + icon + '</span><span class="toast__msg"></span>';
    el.querySelector('.toast__msg').textContent = msg;
    stack.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('toast--in'); });
    setTimeout(function () {
      el.classList.remove('toast--in');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, ms);
  };

  /* ----------------------------- copy to clipboard ----------------------------- */
  App.copy = function (text) {
    text = text == null ? '' : String(text);
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          App.toast('تم النسخ ✓', 'success', 1800); resolve(true);
        }).catch(function () {
          var ok = fallback();
          App.toast(ok ? 'تم النسخ ✓' : 'تعذّر النسخ', ok ? 'success' : 'error', 1800);
          resolve(ok);
        });
      } else {
        var ok = fallback();
        App.toast(ok ? 'تم النسخ ✓' : 'تعذّر النسخ', ok ? 'success' : 'error', 1800);
        resolve(ok);
      }
    });
  };

  /* ----------------------------- modal a11y helper ----------------------------- */
  // Adds aria-labelledby/describedby, traps Tab inside the dialog, and restores
  // focus to the trigger on close. Returns a teardown to call when closing.
  var modalSeq = 0;
  function modalA11y(overlay) {
    var dialog = overlay.querySelector('[role="dialog"]');
    var titleEl = overlay.querySelector('.modal__title');
    var msgEl = overlay.querySelector('.modal__message, .import-modal__msg');
    var sid = ++modalSeq;
    if (dialog && titleEl) { titleEl.id = titleEl.id || ('mdlT' + sid); dialog.setAttribute('aria-labelledby', titleEl.id); }
    if (dialog && msgEl) { msgEl.id = msgEl.id || ('mdlM' + sid); dialog.setAttribute('aria-describedby', msgEl.id); }
    var prevFocus = document.activeElement;
    function focusables() {
      return Array.prototype.slice.call(
        overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(function (el) { return !el.disabled; });
    }
    function onTab(e) {
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    overlay.addEventListener('keydown', onTab);
    return function teardown() {
      overlay.removeEventListener('keydown', onTab);
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
    };
  }

  /* ----------------------------- confirm modal ----------------------------- */
  App.confirm = function (opts) {
    opts = opts || {};
    var title = opts.title || 'تأكيد';
    var message = opts.message || 'هل أنت متأكد؟';
    var confirmText = opts.confirmText || 'تأكيد';
    var cancelText = opts.cancelText || 'إلغاء';
    var danger = opts.danger !== false; // default danger styling

    return new Promise(function (resolve) {
      var root = document.getElementById('modalRoot');
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<h3 class="modal__title"></h3>' +
          '<p class="modal__message"></p>' +
          '<div class="modal__actions">' +
            '<button class="btn btn-ghost" data-act="cancel"></button>' +
            '<button class="btn ' + (danger ? 'btn-danger' : 'btn-gold') + '" data-act="ok"></button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.modal__title').textContent = title;
      overlay.querySelector('.modal__message').textContent = message;
      overlay.querySelector('[data-act="cancel"]').textContent = cancelText;
      overlay.querySelector('[data-act="ok"]').textContent = confirmText;
      root.appendChild(overlay);
      var untrap = modalA11y(overlay);
      requestAnimationFrame(function () { overlay.classList.add('modal-overlay--in'); });

      function close(result) {
        overlay.classList.remove('modal-overlay--in');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
        document.removeEventListener('keydown', onKey);
        untrap();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        if (act === 'cancel') close(false);
      });
      document.addEventListener('keydown', onKey);
      var okBtn = overlay.querySelector('[data-act="ok"]');
      if (okBtn) okBtn.focus();
    });
  };

  App.chooseImportMode = function (fileName) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modalRoot');
      if (!root) { resolve(null); return; }

      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal import-modal" role="dialog" aria-modal="true">' +
          '<h3 class="modal__title">استيراد بيانات</h3>' +
          '<p class="modal__message import-modal__msg"></p>' +
          '<div class="import-modal__choices">' +
            '<button class="btn btn-gold" data-mode="merge" type="button">دمج مع الحالي</button>' +
            '<button class="btn btn-danger" data-mode="replace" type="button">استبدال الحالي</button>' +
            '<button class="btn btn-ghost" data-mode="cancel" type="button">إلغاء</button>' +
          '</div>' +
          '<p class="field-hint import-modal__hint">عند الاستبدال سيتم تنزيل نسخة احتياطية من البيانات الحالية قبل تنفيذ الاستيراد.</p>' +
        '</div>';

      var msg = overlay.querySelector('.import-modal__msg');
      if (msg) {
        msg.textContent = 'اختر طريقة التعامل مع ملف ' + (fileName || 'JSON') + '. الدمج يضيف البيانات، والاستبدال يمسح الحالي ثم يستخدم الملف الجديد.';
      }

      root.appendChild(overlay);
      var untrap = modalA11y(overlay);
      requestAnimationFrame(function () { overlay.classList.add('modal-overlay--in'); });

      function close(result) {
        overlay.classList.remove('modal-overlay--in');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
        document.removeEventListener('keydown', onKey);
        untrap();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { close(null); return; }
        var mode = e.target.getAttribute && e.target.getAttribute('data-mode');
        if (!mode) return;
        close(mode === 'cancel' ? null : mode);
      });
      document.addEventListener('keydown', onKey);
      var merge = overlay.querySelector('[data-mode="merge"]');
      if (merge) merge.focus();
    });
  };

  /* ----------------------------- settings ----------------------------- */
  App.openSettings = function () {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var s = Store.getSettings();
    function row(id, label, val, ph) {
      return '<div class="field"><label for="' + id + '">' + label + '</label>' +
        '<input type="text" class="input" id="' + id + '" value="' + Store.escapeHtml(val || '') +
        '" placeholder="' + Store.escapeHtml(ph || '') + '"></div>';
    }
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal modal--form" role="dialog" aria-modal="true">' +
        '<h3 class="modal__title">الإعدادات</h3>' +
        '<p class="modal__message">هوية الاستوديو الافتراضية — تُستخدم تلقائيًا في مولد البوستر والمحرر، وتُحفظ ضمن النسخة الاحتياطية.</p>' +
        '<div class="settings-form">' +
          row('setName', 'اسم الجريدة', s.newspaperName, 'كابينة مونديال') +
          row('setSub', 'العنوان الفرعي', s.newspaperSubtitle, 'جريدة كأس العالم اليومية') +
          row('setIssue', 'العدد / السنة الافتراضي', s.issue, 'العدد ١ — السنة الأولى') +
          row('setTeam', 'الدولة / المنتخب الافتراضي', s.teamCountry, 'مثال: مصر') +
        '</div>' +
        '<div class="modal__actions">' +
          '<button class="btn btn-ghost" data-act="cancel" type="button">إلغاء</button>' +
          '<button class="btn btn-gold" data-act="save" type="button">حفظ الإعدادات</button>' +
        '</div>' +
      '</div>';
    root.appendChild(overlay);
    var untrap = modalA11y(overlay);
    requestAnimationFrame(function () { overlay.classList.add('modal-overlay--in'); });

    function close() {
      overlay.classList.remove('modal-overlay--in');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
      document.removeEventListener('keydown', onKey);
      untrap();
    }
    function val(id) { var el = overlay.querySelector('#' + id); return el ? el.value : ''; }
    function save() {
      Store.saveSettings({
        newspaperName: val('setName'),
        newspaperSubtitle: val('setSub'),
        issue: val('setIssue'),
        teamCountry: val('setTeam')
      });
      App.toast('تم حفظ الإعدادات', 'success');
      close();
    }
    function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'Enter') save(); }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); return; }
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'save') save();
      if (act === 'cancel') close();
    });
    document.addEventListener('keydown', onKey);
    var first = overlay.querySelector('#setName');
    if (first) first.focus();
  };

  /* ----------------------------- help / about ----------------------------- */
  App.openHelp = function () {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var backup = Store.getAutoBackup && Store.getAutoBackup();
    var backupLine = backup
      ? 'آخر نسخة احتياطية تلقائية: ' + Store.escapeHtml(Store.formatDateTime(backup.exportedAt)) +
        ' (' + ((backup.news || []).length) + ' خبر، ' + ((backup.posters || []).length) + ' بوستر).'
      : 'لا توجد نسخة احتياطية تلقائية بعد.';
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal modal--form modal--help" role="dialog" aria-modal="true">' +
        '<h3 class="modal__title">مساعدة وحول التطبيق</h3>' +
        '<div class="help-body">' +
          '<p><strong>كابينة مونديال</strong> — غرفة تحكم محتوى كأس العالم. كل البيانات محفوظة محليًا في هذا المتصفح؛ صدّر نسخة احتياطية بانتظام.</p>' +
          '<h4>سير العمل اليومي</h4>' +
          '<ol><li>أضف خبرًا في المحرر أو الصق نصًا في مساعد الصياغة.</li><li>راجع وانسخ المحتوى من عرض الفريق.</li><li>ولّد بوستر الجريدة وصدّره أو شاركه.</li></ol>' +
          '<h4>اختصارات لوحة المفاتيح</h4>' +
          '<ul class="help-keys">' +
            '<li><kbd>Alt</kbd>+<kbd>1…6</kbd> — التنقل بين الأقسام</li>' +
            '<li><kbd>N</kbd> — خبر جديد</li>' +
            '<li><kbd>/</kbd> — تركيز مربع البحث</li>' +
            '<li><kbd>Ctrl</kbd>+<kbd>S</kbd> — حفظ (المحرر / البوستر)</li>' +
            '<li><kbd>?</kbd> — هذه النافذة • <kbd>Esc</kbd> — إغلاق</li>' +
          '</ul>' +
          '<h4>النسخ الاحتياطي</h4>' +
          '<p class="muted">' + backupLine + '</p>' +
        '</div>' +
        '<div class="modal__actions">' +
          (backup ? '<button class="btn btn-outline-gold" data-act="restore" type="button">استعادة آخر نسخة احتياطية</button>' : '') +
          '<button class="btn btn-gold" data-act="close" type="button">إغلاق</button>' +
        '</div>' +
      '</div>';
    root.appendChild(overlay);
    var untrap = modalA11y(overlay);
    requestAnimationFrame(function () { overlay.classList.add('modal-overlay--in'); });
    function close() {
      overlay.classList.remove('modal-overlay--in');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
      document.removeEventListener('keydown', onKey);
      untrap();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); return; }
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'close') close();
      if (act === 'restore') {
        App.confirm({
          danger: true, title: 'استعادة نسخة احتياطية',
          message: 'سيتم استبدال كل البيانات الحالية بآخر نسخة احتياطية تلقائية. متابعة؟',
          confirmText: 'استعادة', cancelText: 'إلغاء'
        }).then(function (okk) {
          if (!okk) return;
          var res = Store.restoreAutoBackup();
          App.toast(res.ok ? 'تمت استعادة النسخة الاحتياطية' : (res.error || 'تعذّرت الاستعادة'), res.ok ? 'success' : 'error');
          if (res.ok) close();
        });
      }
    });
    document.addEventListener('keydown', onKey);
    var c = overlay.querySelector('[data-act="close"]');
    if (c) c.focus();
  };

  /* ----------------------------- keyboard shortcuts ----------------------------- */
  function isTyping(e) {
    var t = e.target;
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
  }
  function installShortcuts() {
    document.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+S → save the active editor/poster (works even while typing).
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        var sel = current === 'editor' ? '#ed-save' : (current === 'poster' ? '#psSave' : null);
        if (sel) { var sb = document.querySelector(sel); if (sb) { e.preventDefault(); sb.click(); } }
        return;
      }
      // Alt+1..6 → navigate.
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        var map = { '1': 'dashboard', '2': 'editor', '3': 'team', '4': 'ai', '5': 'poster', '6': 'gallery' };
        if (map[e.key]) { e.preventDefault(); App.go(map[e.key]); return; }
      }
      if (isTyping(e)) return;
      if (e.key === '/') {
        var s = document.querySelector('#view-' + current + ' input[type="search"]');
        if (s) { e.preventDefault(); s.focus(); }
        return;
      }
      if (e.key === 'n' || e.key === 'N') { App.newNews(); return; }
      if (e.key === '?') { App.openHelp(); return; }
    });
  }

  /* ----------------------------- export / import ----------------------------- */
  App.exportJSON = function () {
    var data = Store.exportJSON();
    App.toast('تم تصدير نسخة احتياطية (' + data.news.length + ' خبر، ' + data.posters.length + ' بوستر)', 'success');
  };

  App.openImport = function () {
    var input = document.getElementById('jsonImportInput');
    if (!input) return;
    input.value = '';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      App.chooseImportMode(file.name).then(function (mode) {
        if (!mode) return;
        if (mode === 'replace' && (Store.stats().total || Store.stats().posters)) {
          Store.exportJSON();
          App.toast('تم تنزيل نسخة احتياطية قبل الاستبدال', 'info', 3000);
        }
        doImport(file, mode);
      });
    };
    input.click();
  };

  function doImport(file, mode) {
    Store.importFromFile(file, mode).then(function (res) {
      if (res.ok) {
        App.toast('تم الاستيراد: ' + res.news + ' خبر، ' + res.posters + ' بوستر (' + (mode === 'merge' ? 'دمج' : 'استبدال') + ')', 'success', 4000);
        App.refresh();
      } else {
        App.toast(res.error || 'فشل الاستيراد', 'error', 4000);
      }
    });
  }

  /* ----------------------------- mobile nav ----------------------------- */
  function closeMobileNav() {
    var nav = document.getElementById('mainNav');
    var toggle = document.getElementById('navToggle');
    if (nav) nav.classList.remove('nav--open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  function wireNav() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('mainNav');
    if (toggle && nav) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'mainNav');
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = nav.classList.toggle('nav--open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      // Close the mobile dropdown on outside-click or Escape.
      document.addEventListener('click', function (e) {
        if (!nav.classList.contains('nav--open')) return;
        if (nav.contains(e.target) || toggle.contains(e.target)) return;
        closeMobileNav();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('nav--open')) closeMobileNav();
      });
    }
    var exp = document.getElementById('globalExportBtn');
    var imp = document.getElementById('globalImportBtn');
    if (exp) exp.addEventListener('click', App.exportJSON);
    if (imp) imp.addEventListener('click', App.openImport);
    var setBtn = document.getElementById('globalSettingsBtn');
    if (setBtn) setBtn.addEventListener('click', App.openSettings);
  }

  /* ----------------------------- boot ----------------------------- */
  App.start = function () {
    wireNav();
    installShortcuts();
    var helpBtn = document.getElementById('globalHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', App.openHelp);
    if (location.search.indexOf('demo=1') >= 0 || localStorage.getItem('km_demo_seed') === '1') {
      Store.seedIfEmpty();
    }
    if (window.WorldCupSummaries && typeof WorldCupSummaries.autoSeed === 'function') {
      WorldCupSummaries.autoSeed();
    }

    // Re-render active view whenever the data changes — coalesced so a burst of
    // writes (e.g. the 12-item World Cup seed) collapses into a single render.
    var refreshQueued = false;
    Store.subscribe(function () {
      if (refreshQueued) return;
      refreshQueued = true;
      var run = function () { refreshQueued = false; App.refresh(); };
      if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16);
    });

    window.addEventListener('hashchange', function () { renderRoute(parseHash()); });

    if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
    renderRoute(parseHash());
  };

  window.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.start);
  } else {
    App.start();
  }

  // PWA: register the service worker (http/https only — file:// is skipped gracefully).
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW registration failed', e); });
    });
  }
})();
