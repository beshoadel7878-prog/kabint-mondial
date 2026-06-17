/* =============================================================================
 * teamview.js — "عرض الفريق" (Team View) page module for "كابينة مونديال".
 * The daily production-team reading & copying surface. Self-registers via
 * App.registerPage('team', ...). Plain browser globals only — no modules.
 *
 * Reads window.Store (data) and window.App (shell helpers). Renders the
 * importance-sorted, ready-for-production news as premium, copy-friendly cards.
 * render() is idempotent: it rebuilds innerHTML and rebinds listeners every call.
 * ========================================================================== */
(function () {
  'use strict';

  /* --------------------------- module-scope state --------------------------- */
  var searchTerm = '';        // live search text (deep search via Store)
  var activeFilter = 'all';   // 'all' | importance key
  var stageFilter = '';       // '' (all) | stage string from Store.STAGES
  var dayFilter = '';         // '' (all) | 'YYYY-MM-DD'
  var sortKey = 'importance'; // 'importance'|'newest'|'oldest'|'matchDate'|'team'
  var groupByDay = false;     // collapsible dated sections when ON
  var tagFilter = '';         // '' (all) | a single tag string
  var showArchived = false;   // include archived items when ON
  var selectMode = false;     // bulk multi-select mode
  var selected = {};          // id -> true (bulk selection set)

  var collapsedDays = {};     // day -> true when section is collapsed
  var debounceTimer = null;   // input debounce handle (~180ms)

  /* available sort options (label + Store sort key) */
  var SORT_OPTIONS = [
    { key: 'importance', label: 'الأهمية' },
    { key: 'newest', label: 'الأحدث' },
    { key: 'oldest', label: 'الأقدم' },
    { key: 'matchDate', label: 'تاريخ المباراة' },
    { key: 'team', label: 'حسب الفريق' }
  ];

  /* ------------------------------- helpers --------------------------------- */
  var esc = function (s) { return Store.escapeHtml(s); };
  var escM = function (s) { return Store.escapeMultiline(s); };

  function hasText(v) {
    return v != null && String(v).trim() !== '';
  }

  // Split a multiline field into trimmed, non-empty lines.
  function toLines(v) {
    if (!hasText(v)) return [];
    return String(v).split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
  }

  // Build the options object passed to Store.getNewsFiltered().
  function currentFilterOpts() {
    return {
      query: searchTerm,
      importance: activeFilter === 'all' ? '' : activeFilter,
      stage: stageFilter,
      day: dayFilter,
      tag: tagFilter,
      archived: showArchived ? 'all' : 'active',
      sort: sortKey
    };
  }

  // True when any filter/search narrows the default (all) view.
  function isFiltering() {
    return hasText(searchTerm) || activeFilter !== 'all' || !!stageFilter || !!dayFilter || !!tagFilter;
  }

  /* ---------------------- plain-text full-content block --------------------- */
  // Build a clean, readable Arabic plain-text block (NOT HTML) for copying.
  function buildFullText(n) {
    var lines = [];
    var push = function (s) { lines.push(s); };

    if (hasText(n.title)) push('📰 ' + n.title.trim());

    // teams + score, or fall back to matchName
    if (hasText(n.teamA) && hasText(n.teamB)) {
      var match = n.teamA.trim() + ' × ' + n.teamB.trim();
      if (hasText(n.score)) match += '  (' + n.score.trim() + ')';
      push('⚽ المباراة: ' + match);
    } else if (hasText(n.matchName)) {
      push('⚽ المباراة: ' + n.matchName.trim());
    }

    if (hasText(n.matchDate)) push('📅 التاريخ: ' + Store.formatDate(n.matchDate));
    if (hasText(n.stage)) push('🏟 المرحلة: ' + n.stage.trim());
    if (hasText(n.country)) push('🌍 الدولة: ' + n.country.trim());
    push('⭐ الأهمية: ' + Store.importanceLabel(n.importance));

    if (hasText(n.summary)) {
      push('');
      push('— الملخص —');
      push(n.summary.trim());
    }

    if (hasText(n.rawNews)) {
      push('');
      push('— آخر الأخبار —');
      push(n.rawNews.trim());
    }

    var moments = toLines(n.moments);
    if (moments.length) {
      push('');
      push('— أهم اللقطات —');
      moments.forEach(function (m) { push('• ' + m); });
    }

    if (hasText(n.videoTitle)) {
      push('');
      push('🎬 عنوان الفيديو المقترح: ' + n.videoTitle.trim());
    }

    if (hasText(n.videoAngle)) {
      push('');
      push('— فكرة الفيديو —');
      push(n.videoAngle.trim());
    }

    return lines.join('\n');
  }

  function buildVideoScript(n) {
    var lines = [];
    var title = hasText(n.videoTitle) ? n.videoTitle.trim() : (n.title || n.matchName || 'خبر مونديال');
    lines.push('🎬 العنوان: ' + title);
    lines.push('');
    lines.push('الافتتاحية:');
    lines.push('في خبر مهم من كأس العالم، ' + ((n.summary || n.rawNews || title).trim()));
    if (hasText(n.score) || (hasText(n.teamA) && hasText(n.teamB))) {
      lines.push('');
      lines.push('تفاصيل المباراة:');
      var match = hasText(n.teamA) && hasText(n.teamB) ? (n.teamA.trim() + ' ضد ' + n.teamB.trim()) : (n.matchName || '').trim();
      lines.push(match + (hasText(n.score) ? ' بنتيجة ' + n.score.trim() : ''));
    }
    var moments = toLines(n.moments);
    if (moments.length) {
      lines.push('');
      lines.push('أهم اللقطات التي تظهر في الفيديو:');
      moments.forEach(function (m, i) { lines.push((i + 1) + '. ' + m); });
    }
    if (hasText(n.videoAngle)) {
      lines.push('');
      lines.push('زاوية المعالجة:');
      lines.push(n.videoAngle.trim());
    }
    lines.push('');
    lines.push('الخاتمة:');
    lines.push('تابعونا لتغطية أسرع وأوضح لكل تفاصيل كأس العالم.');
    return lines.join('\n');
  }

  /* ------------------------------ card markup ------------------------------ */
  function scoreboardHTML(n) {
    if (hasText(n.teamA) && hasText(n.teamB)) {
      var score = hasText(n.score) ? esc(n.score) : 'VS';
      return '' +
        '<div class="tv-scoreboard">' +
          '<span class="tv-team">' + esc(n.teamA) + '</span>' +
          '<span class="tv-score">' + score + '</span>' +
          '<span class="tv-team">' + esc(n.teamB) + '</span>' +
        '</div>';
    }
    if (hasText(n.matchName)) {
      return '<div class="tv-scoreboard tv-scoreboard--name"><span class="tv-matchname">' +
        esc(n.matchName) + '</span></div>';
    }
    return '';
  }

  function metaChipsHTML(n) {
    var chips = [];
    if (hasText(n.matchDate)) chips.push('<span class="chip">📅 ' + esc(Store.formatDate(n.matchDate)) + '</span>');
    if (hasText(n.stage)) chips.push('<span class="chip">🏟 ' + esc(n.stage) + '</span>');
    if (hasText(n.country)) chips.push('<span class="chip">🌍 ' + esc(n.country) + '</span>');
    if (!chips.length) return '';
    return '<div class="tv-meta">' + chips.join('') + '</div>';
  }

  function imageHTML(n) {
    if (!hasText(n.image)) return '';
    var alt = hasText(n.title) ? esc(n.title) : 'صورة الخبر';
    return '<div class="tv-image"><img src="' + esc(n.image) + '" alt="' + alt + '" loading="lazy" /></div>';
  }

  // A labelled content section; returns '' if the field is empty.
  function sectionHTML(label, value, opts) {
    if (!hasText(value)) return '';
    opts = opts || {};
    var bodyClass = 'tv-section__body';
    if (opts.muted) bodyClass += ' muted';
    if (opts.prominent) bodyClass += ' tv-section__body--prominent';
    return '' +
      '<div class="tv-section">' +
        '<div class="tv-section-label">' + esc(label) + '</div>' +
        '<div class="' + bodyClass + '">' + escM(value) + '</div>' +
      '</div>';
  }

  function momentsSectionHTML(n) {
    var moments = toLines(n.moments);
    if (!moments.length) return '';
    var items = moments.map(function (m) {
      return '<li>' + esc(m) + '</li>';
    }).join('');
    return '' +
      '<div class="tv-section">' +
        '<div class="tv-section-label">أهم اللقطات</div>' +
        '<ul class="tv-moments">' + items + '</ul>' +
      '</div>';
  }

  function footerHTML(n) {
    var btns = [];

    if (hasText(n.summary)) {
      btns.push('<button class="btn btn-ghost btn-sm" data-act="copy-summary" data-id="' + esc(n.id) + '">📋 نسخ الملخص</button>');
    }
    if (hasText(n.videoTitle)) {
      btns.push('<button class="btn btn-ghost btn-sm" data-act="copy-title" data-id="' + esc(n.id) + '">🎬 نسخ عنوان الفيديو</button>');
    }
    if (hasText(n.summary) || hasText(n.videoAngle) || hasText(n.rawNews)) {
      btns.push('<button class="btn btn-ghost btn-sm" data-act="copy-script" data-id="' + esc(n.id) + '">🎙 نسخ سكريبت سريع</button>');
    }
    // Full content is always meaningful (always has at least a title/importance).
    btns.push('<button class="btn btn-outline-gold btn-sm" data-act="copy-full" data-id="' + esc(n.id) + '">📄 نسخ المحتوى الكامل</button>');
    btns.push('<button class="btn btn-gold btn-sm" data-act="poster" data-id="' + esc(n.id) + '">🖼 إنشاء بوستر الجريدة</button>');
    if (n.archived) {
      btns.push('<button class="btn btn-ghost btn-sm" data-act="unarchive" data-id="' + esc(n.id) + '">↩ إلغاء الأرشفة</button>');
    } else {
      btns.push('<button class="btn btn-ghost btn-sm" data-act="archive" data-id="' + esc(n.id) + '">🗄 أرشفة</button>');
    }
    btns.push('<button class="btn btn-ghost btn-sm tv-btn-danger" data-act="delete" data-id="' + esc(n.id) + '">🗑 حذف</button>');

    return '<div class="tv-footer">' + btns.join('') + '</div>';
  }

  function cardHTML(n) {
    var badgeClass = Store.importanceBadge(n.importance);
    var badgeLabel = Store.importanceLabel(n.importance);
    var title = hasText(n.title) ? esc(n.title) : 'خبر بدون عنوان';
    var archived = !!n.archived;
    var isSel = !!selected[n.id];

    var tags = Array.isArray(n.tags) ? n.tags : [];
    var tagsHTML = tags.length
      ? '<div class="tv-tags">' + tags.map(function (t) {
          return '<button class="tv-tag" type="button" data-act="tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
        }).join('') + '</div>'
      : '';
    var checkbox = selectMode
      ? '<label class="tv-selbox"><input type="checkbox" data-act="select" data-id="' + esc(n.id) + '"' + (isSel ? ' checked' : '') + ' aria-label="تحديد الخبر"></label>'
      : '';
    var archBadge = archived ? '<span class="badge tv-archived-badge">مؤرشف</span>' : '';
    var statusBadge = '';
    var st = n.status && Store.STATUS_BY_KEY ? Store.STATUS_BY_KEY[n.status] : null;
    if (st) statusBadge = '<span class="badge ' + esc(st.badgeClass) + '">' + esc(st.label) + '</span>';

    return '' +
      '<article class="card tv-card animate-in' + (archived ? ' is-archived' : '') + (isSel ? ' is-selected' : '') + '" data-id="' + esc(n.id) + '">' +
        '<header class="tv-card-head">' +
          '<div class="tv-card-head__main">' +
            '<div class="tv-badges">' + checkbox +
              '<span class="badge ' + badgeClass + '">' + esc(badgeLabel) + '</span>' + statusBadge + archBadge +
            '</div>' +
            '<h3 class="tv-title">' + title + '</h3>' +
            tagsHTML +
          '</div>' +
          '<div class="tv-card-head__actions">' +
            '<button class="btn-icon tv-icon-btn" data-act="edit" data-id="' + esc(n.id) + '" title="تعديل" aria-label="تعديل">✎</button>' +
          '</div>' +
        '</header>' +
        scoreboardHTML(n) +
        metaChipsHTML(n) +
        imageHTML(n) +
        '<div class="tv-body">' +
          sectionHTML('الملخص', n.summary) +
          sectionHTML('آخر الأخبار', n.rawNews) +
          momentsSectionHTML(n) +
          sectionHTML('عنوان الفيديو المقترح', n.videoTitle, { prominent: true }) +
          sectionHTML('فكرة الفيديو', n.videoAngle) +
          sectionHTML('ملاحظات للمحرر', n.editorNotes, { muted: true }) +
        '</div>' +
        footerHTML(n) +
      '</article>';
  }

  /* -------------------------------- toolbar -------------------------------- */
  function chipsHTML() {
    var chips = [];
    chips.push('<button class="tv-fchip' + (activeFilter === 'all' ? ' is-active' : '') +
      '" data-filter="all" type="button">الكل</button>');
    Store.IMPORTANCE.forEach(function (lvl) {
      chips.push('<button class="tv-fchip tv-fchip--' + esc(lvl.key) +
        (activeFilter === lvl.key ? ' is-active' : '') +
        '" data-filter="' + esc(lvl.key) + '" type="button">' + esc(lvl.label) + '</button>');
    });
    return chips.join('');
  }

  function stageSelectHTML() {
    var opts = ['<option value="">كل الأدوار</option>'];
    Store.STAGES.forEach(function (s) {
      opts.push('<option value="' + esc(s) + '"' + (stageFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>');
    });
    return opts.join('');
  }

  function daySelectHTML() {
    var days = Store.getNewsDays();
    var opts = ['<option value="">كل الأيام</option>'];
    days.forEach(function (d) {
      opts.push('<option value="' + esc(d.day) + '"' + (dayFilter === d.day ? ' selected' : '') + '>' +
        esc(Store.formatDate(d.day)) + ' (' + d.count + ')</option>');
    });
    return opts.join('');
  }

  function sortSelectHTML() {
    return SORT_OPTIONS.map(function (o) {
      return '<option value="' + esc(o.key) + '"' + (sortKey === o.key ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  // Tag filter control — omitted entirely when no tags exist anywhere.
  function tagControlHTML() {
    var tags = Store.getAllTags();
    if (!tags.length) return '';
    var opts = ['<option value="">كل الوسوم</option>'];
    tags.forEach(function (t) {
      opts.push('<option value="' + esc(t.tag) + '"' + (tagFilter === t.tag ? ' selected' : '') +
        '>#' + esc(t.tag) + ' (' + t.count + ')</option>');
    });
    return '<div class="tv-ctrl">' +
      '<label class="tv-ctrl__label" for="tvTag">الوسم</label>' +
      '<select class="select tv-select" id="tvTag">' + opts.join('') + '</select></div>';
  }

  function selectedIds() {
    return Object.keys(selected).filter(function (k) { return selected[k]; });
  }
  function bulkBarInner() {
    var n = selectedIds().length;
    return '<span class="tv-bulk-count">المحدد: ' + n + '</span>' +
      '<button class="btn btn-ghost btn-sm" data-bulk="all" type="button">تحديد المعروض</button>' +
      '<button class="btn btn-ghost btn-sm" data-bulk="none" type="button"' + (n ? '' : ' disabled') + '>إلغاء التحديد</button>' +
      '<button class="btn btn-outline-gold btn-sm" data-bulk="archive" type="button"' + (n ? '' : ' disabled') + '>🗄 أرشفة المحدد</button>' +
      '<button class="btn btn-ghost btn-sm tv-btn-danger" data-bulk="delete" type="button"' + (n ? '' : ' disabled') + '>🗑 حذف المحدد</button>';
  }

  function toolbarHTML() {
    return '' +
      '<div class="tv-toolbar panel">' +
        '<div class="tv-search">' +
          '<label class="sr-only" for="tvSearch">بحث في الأخبار</label>' +
          '<span class="tv-search__ico" aria-hidden="true">🔍</span>' +
          '<input type="search" class="input tv-search__input" id="tvSearch" ' +
            'placeholder="بحث عميق في كل الحقول…" ' +
            'value="' + esc(searchTerm) + '" autocomplete="off" />' +
        '</div>' +
        '<div class="tv-filters" id="tvFilters" role="group" aria-label="تصفية حسب الأهمية">' + chipsHTML() + '</div>' +
        '<div class="tv-controls">' +
          '<div class="tv-ctrl">' +
            '<label class="tv-ctrl__label" for="tvStage">الدور</label>' +
            '<select class="select tv-select" id="tvStage">' + stageSelectHTML() + '</select>' +
          '</div>' +
          '<div class="tv-ctrl">' +
            '<label class="tv-ctrl__label" for="tvDay">اليوم</label>' +
            '<select class="select tv-select" id="tvDay">' + daySelectHTML() + '</select>' +
          '</div>' +
          '<div class="tv-ctrl">' +
            '<label class="tv-ctrl__label" for="tvSort">الترتيب</label>' +
            '<select class="select tv-select" id="tvSort">' + sortSelectHTML() + '</select>' +
          '</div>' +
          tagControlHTML() +
          '<label class="tv-ctrl tv-group-toggle" for="tvGroupDay">' +
            '<span class="tv-ctrl__label">تجميع حسب اليوم</span>' +
            '<input type="checkbox" id="tvGroupDay"' + (groupByDay ? ' checked' : '') + ' />' +
            '<span class="tv-switch" aria-hidden="true"></span>' +
          '</label>' +
          '<label class="tv-ctrl tv-group-toggle" for="tvArchived">' +
            '<span class="tv-ctrl__label">إظهار المؤرشف</span>' +
            '<input type="checkbox" id="tvArchived"' + (showArchived ? ' checked' : '') + ' />' +
            '<span class="tv-switch" aria-hidden="true"></span>' +
          '</label>' +
          '<label class="tv-ctrl tv-group-toggle" for="tvSelectMode">' +
            '<span class="tv-ctrl__label">تحديد متعدد</span>' +
            '<input type="checkbox" id="tvSelectMode"' + (selectMode ? ' checked' : '') + ' />' +
            '<span class="tv-switch" aria-hidden="true"></span>' +
          '</label>' +
        '</div>' +
        (selectMode ? '<div class="tv-bulkbar" id="tvBulkbar">' + bulkBarInner() + '</div>' : '') +
        '<div class="tv-results" id="tvResults" role="status" aria-live="polite"></div>' +
      '</div>';
  }

  /* -------------------------------- list ----------------------------------- */
  // Group an already-filtered list by day key, newest day first.
  function groupByDayList(visible) {
    var order = [];
    var byDay = {};
    visible.forEach(function (n) {
      var d = Store.newsDayKey(n) || '';
      if (!byDay[d]) { byDay[d] = []; order.push(d); }
      byDay[d].push(n);
    });
    // newest day first ('' day, if any, sinks to the end)
    order.sort(function (a, b) {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return String(b).localeCompare(String(a));
    });
    return order.map(function (d) { return { day: d, items: byDay[d] }; });
  }

  function groupSectionHTML(group) {
    var d = group.day;
    var isCollapsed = !!collapsedDays[d];
    var label = d ? Store.formatDate(d) : 'بدون تاريخ';
    return '' +
      '<section class="tv-day-group' + (isCollapsed ? ' is-collapsed' : '') + '" data-day="' + esc(d) + '">' +
        '<button class="tv-day-head" type="button" data-act="toggle-day" data-day="' + esc(d) + '" ' +
          'aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' +
          '<span class="tv-day-caret" aria-hidden="true">▾</span>' +
          '<span class="tv-day-title">' + esc(label) + '</span>' +
          '<span class="tv-day-count">' + group.items.length + '</span>' +
        '</button>' +
        '<div class="tv-grid tv-day-grid">' + group.items.map(cardHTML).join('') + '</div>' +
      '</section>';
  }

  // Build the inner HTML for the list region from the current filters.
  function listRegionHTML(visible) {
    if (!visible.length) return emptyNoResultsHTML();
    if (groupByDay) {
      return '<div class="tv-groups">' +
        groupByDayList(visible).map(groupSectionHTML).join('') +
        '</div>';
    }
    return '<div class="tv-grid">' + visible.map(cardHTML).join('') + '</div>';
  }

  /* -------------------------------- empty ---------------------------------- */
  function emptyNoDataHTML() {
    return '' +
      '<div class="empty-state">' +
        '<div class="empty-state__icon">📭</div>' +
        '<h3>لا يوجد محتوى بعد</h3>' +
        '<p>ابدأ بإضافة أول خبر ليظهر هنا جاهزًا للإنتاج والنسخ من قِبل الفريق.</p>' +
        '<button class="btn btn-gold" id="tvAddFirst">➕ إضافة خبر</button>' +
      '</div>';
  }

  function emptyNoResultsHTML() {
    return '' +
      '<div class="empty-state tv-empty-results">' +
        '<div class="empty-state__icon">🔎</div>' +
        '<h3>لا نتائج مطابقة للبحث/الفلتر</h3>' +
        '<p>جرّب تعديل كلمات البحث أو امسح الفلاتر لعرض جميع الأخبار.</p>' +
        '<button class="btn btn-ghost" id="tvClearFilters">مسح البحث والفلاتر</button>' +
      '</div>';
  }

  /* -------------------------------- render --------------------------------- */
  function render(container) {
    var all = Store.getNews();

    // No data at all -> full empty state (no toolbar).
    if (!all.length) {
      container.innerHTML = '' +
        '<div id="view-team-inner" class="tv-root">' +
          headHTML() +
          emptyNoDataHTML() +
        '</div>';
      bindAddFirst(container);
      return;
    }

    var visible = Store.getNewsFiltered(currentFilterOpts());

    container.innerHTML = '' +
      '<div id="view-team-inner" class="tv-root">' +
        headHTML() +
        toolbarHTML() +
        '<div class="tv-list" id="tvList">' + listRegionHTML(visible) + '</div>' +
      '</div>';

    updateResultsCount(container, visible.length, all.length);
    bindToolbar(container);
    bindList(container);
  }

  function headHTML() {
    return '' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">عرض <span class="accent">الفريق</span></h1>' +
          '<p class="page-sub">المحتوى الجاهز للإنتاج، مرتّب حسب الأهمية</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<button class="btn btn-gold" id="tvNewBtn">➕ إضافة خبر</button>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------- bindings -------------------------------- */
  function bindAddFirst(container) {
    var b = container.querySelector('#tvAddFirst');
    if (b) b.addEventListener('click', function () { App.newNews(); });
    var nb = container.querySelector('#tvNewBtn');
    if (nb) nb.addEventListener('click', function () { App.newNews(); });
  }

  function bindToolbar(container) {
    var newBtn = container.querySelector('#tvNewBtn');
    if (newBtn) newBtn.addEventListener('click', function () { App.newNews(); });

    var search = container.querySelector('#tvSearch');
    if (search) {
      // Debounce keystrokes (~180ms) — don't full re-render on every key.
      search.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          debounceTimer = null;
          searchTerm = search.value;
          rerenderList(container);
        }, 180);
      });
    }

    var filters = container.querySelector('#tvFilters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-filter]');
        if (!btn) return;
        var key = btn.getAttribute('data-filter');
        if (key === activeFilter) return;
        activeFilter = key;
        // Update active chip styling without full re-render of toolbar.
        Array.prototype.forEach.call(filters.querySelectorAll('[data-filter]'), function (c) {
          c.classList.toggle('is-active', c.getAttribute('data-filter') === activeFilter);
        });
        rerenderList(container);
      });
    }

    var stage = container.querySelector('#tvStage');
    if (stage) {
      stage.addEventListener('change', function () {
        stageFilter = stage.value;
        rerenderList(container);
      });
    }

    var day = container.querySelector('#tvDay');
    if (day) {
      day.addEventListener('change', function () {
        dayFilter = day.value;
        rerenderList(container);
      });
    }

    var sort = container.querySelector('#tvSort');
    if (sort) {
      sort.addEventListener('change', function () {
        sortKey = sort.value;
        rerenderList(container);
      });
    }

    var groupToggle = container.querySelector('#tvGroupDay');
    if (groupToggle) {
      groupToggle.addEventListener('change', function () {
        groupByDay = groupToggle.checked;
        rerenderList(container);
      });
    }

    var tagSel = container.querySelector('#tvTag');
    if (tagSel) {
      tagSel.addEventListener('change', function () {
        tagFilter = tagSel.value;
        rerenderList(container);
      });
    }

    var archToggle = container.querySelector('#tvArchived');
    if (archToggle) {
      archToggle.addEventListener('change', function () {
        showArchived = archToggle.checked;
        rerenderList(container);
      });
    }

    var selToggle = container.querySelector('#tvSelectMode');
    if (selToggle) {
      selToggle.addEventListener('change', function () {
        selectMode = selToggle.checked;
        if (!selectMode) selected = {};
        render(container); // toolbar (bulk bar) + cards (checkboxes) both change
      });
    }

    var bulkbar = container.querySelector('#tvBulkbar');
    if (bulkbar) {
      bulkbar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-bulk]');
        if (!b) return;
        var act = b.getAttribute('data-bulk');
        if (act === 'all') {
          Store.getNewsFiltered(currentFilterOpts()).forEach(function (n) { selected[n.id] = true; });
          rerenderList(container); updateBulkBar(container);
        } else if (act === 'none') {
          selected = {}; rerenderList(container); updateBulkBar(container);
        } else if (act === 'archive') {
          var ids = selectedIds();
          if (!ids.length) return;
          ids.forEach(function (id) { Store.setArchived(id, true); });
          selected = {};
          App.toast('تمت أرشفة ' + ids.length + ' عنصرًا', 'success');
          // Store emits change -> coalesced App.refresh re-renders.
        } else if (act === 'delete') {
          var dids = selectedIds();
          if (!dids.length) return;
          App.confirm({
            danger: true, title: 'حذف المحدد',
            message: 'سيتم حذف ' + dids.length + ' عنصرًا نهائيًا. لا يمكن التراجع. متابعة؟',
            confirmText: 'حذف', cancelText: 'إلغاء'
          }).then(function (ok) {
            if (!ok) return;
            if (Store.deleteManyNews(dids)) { selected = {}; App.toast('تم حذف ' + dids.length + ' عنصرًا', 'success'); }
            else App.toast('تعذّر الحذف', 'error');
          });
        }
      });
    }
  }

  // Re-render just the list region, preserving the toolbar (and search focus).
  function rerenderList(container) {
    var root = container.querySelector('#view-team-inner');
    if (!root) { render(container); return; }

    var all = Store.getNews();
    if (!all.length) { render(container); return; }

    var listEl = root.querySelector('#tvList');
    if (!listEl) { render(container); return; }

    var visible = Store.getNewsFiltered(currentFilterOpts());
    listEl.innerHTML = listRegionHTML(visible);

    updateResultsCount(container, visible.length, all.length);
    bindList(container);
  }

  // aria-live "عرض N من M" results counter.
  function updateResultsCount(container, shown, total) {
    var el = container.querySelector('#tvResults');
    if (!el) return;
    el.textContent = 'عرض ' + shown + ' من ' + total;
  }

  function clearAllFilters() {
    searchTerm = '';
    activeFilter = 'all';
    stageFilter = '';
    dayFilter = '';
    tagFilter = '';
    // Keep sort + grouping preference; user explicitly asked to clear filters.
  }

  function updateBulkBar(container) {
    var bar = container.querySelector('#tvBulkbar');
    if (bar) bar.innerHTML = bulkBarInner();
  }

  // Single delegated handler on the list region: cards + group toggles + empty-state.
  function bindList(container) {
    var listEl = container.querySelector('#tvList');
    if (!listEl) return;

    // Empty-results "clear filters" button (lives inside the list region).
    var clear = listEl.querySelector('#tvClearFilters');
    if (clear) {
      clear.addEventListener('click', function () {
        clearAllFilters();
        render(container);
      });
    }

    if (listEl.__tvBound) return; // delegated handler bound once per render
    listEl.__tvBound = true;

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || !listEl.contains(btn)) return;
      var act = btn.getAttribute('data-act');

      if (act === 'toggle-day') {
        var day = btn.getAttribute('data-day') || '';
        collapsedDays[day] = !collapsedDays[day];
        var section = btn.closest('.tv-day-group');
        if (section) section.classList.toggle('is-collapsed', !!collapsedDays[day]);
        btn.setAttribute('aria-expanded', collapsedDays[day] ? 'false' : 'true');
        return;
      }

      if (act === 'tag') {
        tagFilter = btn.getAttribute('data-tag') || '';
        render(container); // sync the toolbar tag <select> too
        return;
      }

      var id = btn.getAttribute('data-id');
      if (!id) return;

      switch (act) {
        case 'edit':
          App.editNews(id);
          break;
        case 'select': {
          selected[id] = btn.checked;
          var card = btn.closest('.tv-card');
          if (card) card.classList.toggle('is-selected', !!btn.checked);
          updateBulkBar(container);
          break;
        }
        case 'archive':
          if (Store.setArchived(id, true)) App.toast('تمت الأرشفة', 'success', 1600);
          break;
        case 'unarchive':
          if (Store.setArchived(id, false)) App.toast('تم إلغاء الأرشفة', 'success', 1600);
          break;
        case 'poster':
          App.createPosterFromNews(id);
          break;
        case 'copy-summary': {
          var ns = Store.getNewsById(id);
          if (ns && hasText(ns.summary)) App.copy(ns.summary.trim());
          break;
        }
        case 'copy-title': {
          var nt = Store.getNewsById(id);
          if (nt && hasText(nt.videoTitle)) App.copy(nt.videoTitle.trim());
          break;
        }
        case 'copy-full': {
          var nf = Store.getNewsById(id);
          if (nf) App.copy(buildFullText(nf));
          break;
        }
        case 'copy-script': {
          var nv = Store.getNewsById(id);
          if (nv) App.copy(buildVideoScript(nv));
          break;
        }
        case 'delete': {
          var nd = Store.getNewsById(id);
          var name = nd && hasText(nd.title) ? nd.title.trim() : 'هذا الخبر';
          App.confirm({
            title: 'حذف الخبر',
            message: 'سيتم حذف «' + name + '» نهائيًا. لا يمكن التراجع. هل تريد المتابعة؟',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            if (Store.deleteNews(id)) {
              App.toast('تم حذف الخبر', 'success');
              // Store.subscribe -> App.refresh re-renders the page automatically.
            } else {
              App.toast('تعذّر حذف الخبر', 'error');
            }
          });
          break;
        }
      }
    });
  }

  /* ------------------------------- register -------------------------------- */
  App.registerPage('team', {
    render: render
  });
})();
