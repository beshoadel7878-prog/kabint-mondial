/* =============================================================================
 * dashboard.js — "لوحة التحكم" section for "كابينة مونديال".
 * A dark, cinematic control-room overview built on top of Store + App.
 * Self-registers via App.registerPage('dashboard').
 *
 * render() is idempotent: it rebuilds container.innerHTML from current Store
 * state, then (re)binds listeners on every call. Keep no DOM references across
 * renders. Module state lives only in this IIFE.
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- helpers ----------------------------- */

  // Human-readable byte size: KB under 1MB, MB otherwise. Always non-negative.
  function fmtBytes(bytes) {
    var b = (typeof bytes === 'number' && bytes > 0) ? bytes : 0;
    var kb = b / 1024;
    if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Storage-management panel: usage gauge + breakdown + guarded actions.
  // Self-contained .panel; re-rendered on every Store change so it always
  // reflects current usage and auto-backup state.
  function storagePanel(usage) {
    var QUOTA = 5 * 1024 * 1024; // localStorage soft budget used for the gauge.
    var pct = Math.min(100, Math.round((usage.bytes / QUOTA) * 100));
    var fillClass = 'dash-store-bar__fill' + (usage.warning ? ' dash-store-bar__fill--warn' : '');

    var gauge =
      '<div class="dash-store-gauge">' +
        '<div class="dash-store-gauge__head">' +
          '<span class="dash-store-gauge__label">' + Store.escapeHtml(usage.label) + '</span>' +
          '<span class="dash-store-gauge__pct">' + pct + '%</span>' +
        '</div>' +
        '<div class="dash-store-bar" role="img" aria-label="نسبة استخدام مساحة التخزين ' + pct + '%">' +
          '<span class="' + fillClass + '" style="width:' + pct + '%"></span>' +
        '</div>' +
        '<div class="dash-store-breakdown">' +
          '<span class="dash-store-breakdown__item">أخبار: <b>' + fmtBytes(usage.news) + '</b></span>' +
          '<span class="dash-store-breakdown__item">بوسترات: <b>' + fmtBytes(usage.posters) + '</b></span>' +
          '<span class="dash-store-breakdown__item">نسخة احتياطية: <b>' + fmtBytes(usage.backup) + '</b></span>' +
        '</div>' +
      '</div>';

    var backup = Store.getAutoBackup ? Store.getAutoBackup() : null;
    var restoreBlock = '';
    if (backup) {
      var when = backup.exportedAt ? Store.escapeHtml(Store.formatDateTime(backup.exportedAt)) : '—';
      var bNews = Array.isArray(backup.news) ? backup.news.length : 0;
      var bPosters = Array.isArray(backup.posters) ? backup.posters.length : 0;
      restoreBlock =
        '<div class="dash-store-backup">' +
          '<div class="dash-store-backup__meta">' +
            '<span>آخر نسخة تلقائية: <b>' + when + '</b></span>' +
            '<span>' + bNews + ' خبر · ' + bPosters + ' بوستر</span>' +
          '</div>' +
          '<button type="button" class="btn btn-outline-gold btn-block dash-store-btn" data-act="store-restore">' +
            '↺ استعادة آخر نسخة احتياطية تلقائية' +
          '</button>' +
        '</div>';
    }

    var actions =
      '<div class="dash-store-actions">' +
        restoreBlock +
        '<button type="button" class="btn btn-ghost btn-block dash-store-btn" data-act="store-export">' +
          '⭱ تصدير نسخة احتياطية' +
        '</button>' +
        '<button type="button" class="btn btn-ghost btn-block dash-store-btn" data-act="store-strip-images">' +
          '🧹 حذف صور الأخبار (تفريغ مساحة)' +
        '</button>' +
        '<button type="button" class="btn btn-danger btn-block dash-store-btn" data-act="store-del-posters">' +
          '🗑 حذف كل البوسترات' +
        '</button>' +
        '<button type="button" class="btn btn-danger btn-block dash-store-btn dash-store-btn--nuke" data-act="store-clear-all">' +
          '⚠ مسح كل البيانات' +
        '</button>' +
      '</div>';

    return (
      '<section class="panel dash-panel dash-store-panel animate-in" style="transition-delay:240ms">' +
        '<h2 class="section-title">إدارة التخزين</h2>' +
        gauge +
        actions +
      '</section>'
    );
  }

  // Build the proportional importance bar segments + legend from byImportance.
  // We render every level that has at least one item as a flex-weighted segment.
  function buildImportanceBreakdown(by) {
    var levels = Store.IMPORTANCE; // ordered critical -> low
    var total = 0;
    levels.forEach(function (lv) { total += (by[lv.key] || 0); });

    var segs = '';
    var legend = '';

    levels.forEach(function (lv) {
      var count = by[lv.key] || 0;
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;
      var label = Store.escapeHtml(lv.label);

      // Only levels with a count occupy the bar (flex-grow by count).
      if (count > 0) {
        segs +=
          '<span class="dash-bar__seg dash-bar__seg--' + lv.key + '"' +
          ' style="flex-grow:' + count + '"' +
          ' title="' + label + ': ' + count + ' (' + pct + '%)"' +
          ' aria-label="' + label + ' ' + count + '">' +
          (pct >= 12 ? '<span class="dash-bar__seg-pct">' + pct + '%</span>' : '') +
          '</span>';
      }

      legend +=
        '<div class="dash-legend__item">' +
          '<span class="dash-legend__dot dash-legend__dot--' + lv.key + '"></span>' +
          '<span class="dash-legend__label">' + label + '</span>' +
          '<span class="dash-legend__count">' + count + '</span>' +
        '</div>';
    });

    var barInner = total > 0
      ? segs
      : '<span class="dash-bar__empty">لا توجد أخبار لعرض التوزيع</span>';

    return (
      '<div class="dash-bar" role="img" aria-label="توزيع الأخبار حسب الأهمية">' + barInner + '</div>' +
      '<div class="dash-legend">' + legend + '</div>'
    );
  }

  // One stat tile. `accent` adds a special border class for the "important" tile.
  function statCard(label, value, ico, accent, delay) {
    return (
      '<div class="stat-card animate-in' + (accent ? ' dash-stat--accent' : '') + '"' +
        ' style="transition-delay:' + delay + 'ms">' +
        '<div class="stat-card__label">' + Store.escapeHtml(label) + '</div>' +
        '<div class="stat-card__value dash-stat__value">' + value + '</div>' +
        '<div class="stat-card__ico" aria-hidden="true">' + ico + '</div>' +
      '</div>'
    );
  }

  // A compact "teams / score / date" meta line for a latest-news row.
  function newsMeta(item) {
    var bits = [];

    var teams = '';
    if (item.teamA || item.teamB) {
      teams = Store.escapeHtml(item.teamA) +
        (item.teamA && item.teamB ? ' × ' : '') +
        Store.escapeHtml(item.teamB);
    } else if (item.matchName) {
      teams = Store.escapeHtml(item.matchName);
    }
    if (teams) {
      var scoreTxt = item.score
        ? ' <span class="dash-row__score">' + Store.escapeHtml(item.score) + '</span>'
        : '';
      bits.push('<span class="dash-row__teams">' + teams + scoreTxt + '</span>');
    }

    if (item.matchDate) {
      bits.push('<span class="dash-row__date">📅 ' + Store.escapeHtml(Store.formatDate(item.matchDate)) + '</span>');
    } else if (item.stage) {
      bits.push('<span class="dash-row__date">' + Store.escapeHtml(item.stage) + '</span>');
    }

    return bits.length
      ? '<div class="dash-row__meta">' + bits.join('') + '</div>'
      : '';
  }

  // One latest-news row (clickable -> edit).
  function newsRow(item) {
    var badgeClass = Store.importanceBadge(item.importance);
    var badgeLabel = Store.escapeHtml(Store.importanceLabel(item.importance));
    var title = Store.escapeHtml(item.title || item.matchName || 'خبر بدون عنوان');

    return (
      '<button type="button" class="dash-row" data-news-id="' + Store.escapeHtml(item.id) + '">' +
        '<span class="badge ' + badgeClass + ' dash-row__badge">' + badgeLabel + '</span>' +
        '<span class="dash-row__body">' +
          '<span class="dash-row__title">' + title + '</span>' +
          newsMeta(item) +
        '</span>' +
        '<span class="dash-row__go" aria-hidden="true">‹</span>' +
      '</button>'
    );
  }

  /* ----------------------------- render ----------------------------- */

  function isOnboarded() {
    try { return localStorage.getItem('km_onboarded') === '1'; } catch (e) { return false; }
  }

  // Dismissible first-run welcome explaining the daily 3-step workflow.
  function onboardingHTML() {
    if (isOnboarded()) return '';
    return '' +
      '<section class="panel dash-onboard animate-in">' +
        '<button type="button" class="dash-onboard__close" data-act="dismiss-onboard" aria-label="إغلاق الترحيب">✕</button>' +
        '<h2 class="dash-onboard__title">أهلًا بك في <span class="accent">كابينة مونديال</span> 👋</h2>' +
        '<p class="dash-onboard__sub">غرفة تحكم محتوى كأس العالم لفريق الإنتاج. سير العمل اليومي في ٣ خطوات:</p>' +
        '<div class="dash-onboard__steps">' +
          '<div class="dash-onboard__step"><span class="dash-onboard__num">1</span><div><strong>أضف المحتوى</strong><span>أدخل خبرًا في المحرر، أو الصق نصًا خامًا في مساعد الصياغة.</span></div></div>' +
          '<div class="dash-onboard__step"><span class="dash-onboard__num">2</span><div><strong>راجع وانسخ</strong><span>من عرض الفريق اقرأ المحتوى المنظّم وانسخ الملخص أو السكريبت.</span></div></div>' +
          '<div class="dash-onboard__step"><span class="dash-onboard__num">3</span><div><strong>ولّد البوستر</strong><span>أنشئ بوستر جريدة كلاسيكي من أي خبر وصدّره لمنصاتك.</span></div></div>' +
        '</div>' +
        '<div class="dash-onboard__actions">' +
          '<button type="button" class="btn btn-gold" data-act="new-news">➕ أضف أول خبر</button>' +
          '<button type="button" class="btn btn-outline-gold" data-act="go-ai">✦ جرّب مساعد الصياغة</button>' +
          '<button type="button" class="btn btn-ghost" data-act="load-worldcup">⚽ حمّل ملخصات المونديال</button>' +
          '<button type="button" class="btn btn-ghost" data-act="dismiss-onboard">تجاهل</button>' +
        '</div>' +
      '</section>';
  }

  function render(container) {
    var stats = Store.stats();
    var usage = Store.storageUsage
      ? Store.storageUsage()
      : { label: '—', warning: false, bytes: 0, news: 0, posters: 0, backup: 0 };
    var latest = Store.getNewsSorted().slice(0, 5);

    var lastUpdateTxt = stats.lastUpdate
      ? Store.escapeHtml(Store.formatDateTime(stats.lastUpdate))
      : 'لا يوجد بعد';

    /* ---- page head ---- */
    var head =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">لوحة <span class="accent">التحكم</span></h1>' +
          '<p class="page-sub">نظرة سريعة على محتوى اليوم</p>' +
        '</div>' +
        '<div class="page-head__actions">' +
          '<span class="chip dash-update-chip" title="آخر تحديث للمحتوى">' +
            '<span class="dash-update-chip__dot" aria-hidden="true"></span>' +
            'آخر تحديث: ' + lastUpdateTxt +
          '</span>' +
        '</div>' +
      '</div>';

    /* ---- stat grid ---- */
    var grid =
      '<div class="stat-grid dash-stat-grid">' +
        statCard('أخبار اليوم', stats.today, '📰', false, 0) +
        statCard('عناصر مهمة', stats.important, '🔥', true, 60) +
        statCard('عناصر عادية', stats.normal, '🗂', false, 120) +
        statCard('البوسترات المولّدة', stats.posters, '🖼', false, 180) +
        statCard('إجمالي الأخبار', stats.total, '📊', false, 240) +
        statCard('مساحة التخزين', Store.escapeHtml(usage.label), '💽', usage.warning, 300) +
      '</div>';

    /* ---- importance breakdown panel ---- */
    var breakdown =
      '<section class="panel dash-panel animate-in" style="transition-delay:120ms">' +
        '<h2 class="section-title">توزيع الأهمية</h2>' +
        buildImportanceBreakdown(stats.byImportance) +
      '</section>';

    /* ---- quick actions panel ---- */
    var quick =
      '<section class="panel dash-panel animate-in" style="transition-delay:160ms">' +
        '<h2 class="section-title">إجراءات سريعة</h2>' +
        (usage.warning
          ? '<div class="dash-storage-warning">مساحة التخزين المحلية مرتفعة. صدّر نسخة احتياطية واحذف الصور أو البوسترات القديمة عند الحاجة.</div>'
          : '') +
        '<div class="dash-quick-grid">' +
          '<button type="button" class="btn btn-gold btn-lg dash-quick" data-act="new-news">' +
            '<span class="dash-quick__ico" aria-hidden="true">➕</span> إضافة خبر' +
          '</button>' +
          '<button type="button" class="btn btn-outline-gold btn-lg dash-quick" data-act="open-poster">' +
            '<span class="dash-quick__ico" aria-hidden="true">🖼</span> فتح مولد الجريدة' +
          '</button>' +
          '<button type="button" class="btn btn-ghost btn-lg dash-quick" data-act="export">' +
            '<span class="dash-quick__ico" aria-hidden="true">⭱</span> تصدير JSON' +
          '</button>' +
          '<button type="button" class="btn btn-ghost btn-lg dash-quick" data-act="import">' +
            '<span class="dash-quick__ico" aria-hidden="true">⭳</span> استيراد JSON' +
          '</button>' +
          '<button type="button" class="btn btn-outline-gold btn-lg dash-quick dash-quick--wide" data-act="load-worldcup">' +
            '<span class="dash-quick__ico" aria-hidden="true">⚽</span> ملخصات كأس العالم' +
          '</button>' +
        '</div>' +
      '</section>';

    /* ---- latest news panel ---- */
    var latestInner;
    if (latest.length === 0) {
      latestInner =
        '<div class="empty-state">' +
          '<div class="empty-state__icon" aria-hidden="true">🗞️</div>' +
          '<h3>لا يوجد محتوى بعد</h3>' +
          '<p>ابدأ بإضافة أول خبر لتنظيم تغطية كأس العالم وتوليد البوسترات.</p>' +
          '<button type="button" class="btn btn-gold" data-act="new-news">➕ إضافة أول خبر</button>' +
        '</div>';
    } else {
      latestInner =
        '<div class="dash-rows">' +
          latest.map(newsRow).join('') +
        '</div>';
    }

    var latestPanel =
      '<section class="panel dash-panel animate-in" style="transition-delay:200ms">' +
        '<div class="row-between dash-panel__head">' +
          '<h2 class="section-title dash-panel__title">آخر الأخبار</h2>' +
          (latest.length
            ? '<button type="button" class="btn btn-ghost btn-sm" data-act="view-all">عرض كل الأخبار ‹</button>'
            : '') +
        '</div>' +
        latestInner +
      '</section>';

    container.innerHTML =
      onboardingHTML() +
      head +
      grid +
      '<div class="dash-cols">' +
        '<div class="dash-col dash-col--main">' + latestPanel + '</div>' +
        '<div class="dash-col dash-col--side">' + breakdown + quick + storagePanel(usage) + '</div>' +
      '</div>';

    bind(container);
  }

  /* ----------------------------- bind ----------------------------- */

  function bind(container) {
    // Quick actions + view-all + empty-state CTA (all via [data-act]).
    var actEls = container.querySelectorAll('[data-act]');
    Array.prototype.forEach.call(actEls, function (el) {
      el.addEventListener('click', function () {
        switch (el.getAttribute('data-act')) {
          case 'new-news':    App.newNews(); break;
          case 'open-poster': App.go('poster'); break;
          case 'export':      App.exportJSON(); break;
          case 'import':      App.openImport(); break;
          case 'load-worldcup':
            if (window.WorldCupSummaries && typeof WorldCupSummaries.load === 'function') {
              var res = WorldCupSummaries.load();
              var msg = res.added > 0
                ? 'تم تحميل ' + res.added + ' ملخص من مباريات كأس العالم'
                : 'ملخصات كأس العالم موجودة بالفعل';
              App.toast(msg, 'success', 2600);
              App.go('team');
            } else {
              App.toast('تعذر العثور على ملخصات كأس العالم', 'error');
            }
            break;
          case 'view-all':    App.go('team'); break;
          case 'go-ai':       App.go('ai'); break;
          case 'dismiss-onboard':
            try { localStorage.setItem('km_onboarded', '1'); } catch (e) {}
            render(container);
            break;

          /* ---- storage management ---- */
          case 'store-export':
            App.exportJSON();
            break;

          case 'store-restore':
            App.confirm({
              title: 'استعادة النسخة الاحتياطية',
              message: 'سيتم استبدال الأخبار والبوسترات الحالية بمحتوى آخر نسخة احتياطية تلقائية. هل تريد المتابعة؟',
              confirmText: 'استعادة',
              cancelText: 'إلغاء',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              var res = Store.restoreAutoBackup();
              if (res && res.ok) {
                App.toast('تمت استعادة ' + res.news + ' خبر و ' + res.posters + ' بوستر', 'success', 2800);
              } else {
                App.toast((res && res.error) || 'تعذّر استعادة النسخة الاحتياطية', 'error');
              }
            });
            break;

          case 'store-strip-images':
            App.confirm({
              title: 'حذف صور الأخبار',
              message: 'سيتم حذف الصور المرفقة بالأخبار لتفريغ مساحة التخزين. سيبقى نص الأخبار كما هو. لا يمكن التراجع عن هذا الإجراء.',
              confirmText: 'حذف الصور',
              cancelText: 'إلغاء',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              if (Store.stripNewsImages()) {
                App.toast('تم حذف صور الأخبار وتفريغ المساحة', 'success', 2600);
              } else {
                App.toast('تعذّر حذف صور الأخبار', 'error');
              }
            });
            break;

          case 'store-del-posters':
            App.confirm({
              title: 'حذف كل البوسترات',
              message: 'سيتم حذف جميع البوسترات المولّدة نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
              confirmText: 'حذف الكل',
              cancelText: 'إلغاء',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              if (Store.deleteAllPosters()) {
                App.toast('تم حذف كل البوسترات', 'success', 2600);
              } else {
                App.toast('تعذّر حذف البوسترات', 'error');
              }
            });
            break;

          case 'store-clear-all':
            App.confirm({
              title: 'مسح كل البيانات',
              message: 'سيتم حذف كل الأخبار والبوسترات نهائيًا. سيتم أخذ نسخة احتياطية تلقائية أولًا يمكنك استعادتها لاحقًا. هل تريد المتابعة؟',
              confirmText: 'مسح كل البيانات',
              cancelText: 'إلغاء',
              danger: true
            }).then(function (ok) {
              if (!ok) return;
              if (Store.saveAutoBackup) Store.saveAutoBackup('before-clear-all');
              Store.clearAll();
              App.toast('تم مسح كل البيانات (مع حفظ نسخة احتياطية)', 'success', 3000);
            });
            break;
        }
      });
    });

    // Latest-news rows -> edit that item.
    var rows = container.querySelectorAll('.dash-row[data-news-id]');
    Array.prototype.forEach.call(rows, function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-news-id');
        if (id) App.editNews(id);
      });
    });
  }

  /* ----------------------------- register ----------------------------- */

  App.registerPage('dashboard', {
    render: render
  });
})();
