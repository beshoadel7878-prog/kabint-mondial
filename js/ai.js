/* =============================================================================
 * ai.js — "مساعد الصياغة بالذكاء الاصطناعي" (AI Formatting Assistant)
 * Section module for "كابينة مونديال". Self-registers via App.registerPage('ai').
 *
 * Turns pasted raw Arabic news into clean, production-ready structured fields.
 * NOTE: this is a MOCK / heuristic ("نموذج مبدئي") — a fully client-side Arabic
 * heuristic parser. No network. The simulated "AI" delay is purely cosmetic.
 * ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- module state ----------------------------- */
  var EXAMPLE =
    'مصر لعبت النهاردة ضد بلجيكا وخسرت 2-1، صلاح سجل هدف، الدفاع كان ضعيف، الجمهور زعلان، وفي جدل على تبديل المدرب.';

  // The text currently in the textarea (kept across re-renders so subscriber
  // refreshes / navigation don't wipe the user's input).
  var rawText = EXAMPLE;
  // Last formatted result object (null = nothing parsed yet -> show placeholder).
  var result = null;
  // 'idle' | 'processing'
  var phase = 'idle';
  var processingTimer = null;

  /* ============================ Arabic heuristic parser ============================ */

  // Normalize: collapse whitespace, unify common dash/colon score separators.
  function collapse(s) {
    return String(s == null ? '' : s).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  // Strip leading connective words / filler from a clause for cleaner output.
  function trimClause(s) {
    return String(s || '')
      .replace(/^[\s،,.؛:\-–]+/, '')
      .replace(/[\s،,.؛:]+$/, '')
      .replace(/^(?:و|ثم|كما|حيث|لكن|بينما|وفي|في)\s+/, '')
      .trim();
  }

  // Split text into sentence-ish fragments on Arabic + Latin separators.
  function splitFragments(s) {
    return String(s || '')
      .split(/[،,؛;.!؟?\n]+/)
      .map(trimClause)
      .filter(function (x) { return x.length > 1; });
  }

  var SEP_WORDS = ['ضد', 'مع', 'أمام', 'امام', 'vs', 'VS', 'Vs', 'x', 'X', '×'];

  // Try to extract teamA / teamB around a separator word.
  function parseTeams(text) {
    // Build a regex with an Arabic/Latin word group around each separator.
    // word group: 1–3 tokens of Arabic letters (handles "كوت ديفوار", "كوريا الجنوبية").
    var WORD = '[\\u0600-\\u06FFA-Za-z]+(?:\\s+[\\u0600-\\u06FFA-Za-z]+){0,2}';

    // Pattern 1: "<teamA> <separator> <teamB>"  (ضد / مع / أمام / vs / × / x)
    var seps = '(?:ضد|مع|أمام|امام|vs|VS|Vs|×|x|X)';
    var m = text.match(new RegExp('(' + WORD + ')\\s*' + seps + '\\s*(' + WORD + ')'));
    if (m) return { teamA: cleanTeam(m[1]), teamB: cleanTeam(m[2]) };

    // Pattern 2: "<teamA> فاز/خسر/تعادل ... على/من/أمام <teamB>"
    // Common Arabic phrasing where the result verb sits between the two teams.
    var verb = '(?:فاز(?:ت)?|خسر(?:ت)?|تغلّب(?:ت)?|تغلب(?:ت)?|اكتسح(?:ت)?|تعادل(?:ت)?|انتصر(?:ت)?|كسب(?:ت)?)';
    var link = '(?:على|من|أمام|امام|ضد|مع)';
    m = text.match(new RegExp('(' + WORD + ')\\s+' + verb + '[^\\u0600-\\u06FF]*' + link + '\\s+(' + WORD + ')'));
    if (m) return { teamA: cleanTeam(m[1]), teamB: cleanTeam(m[2]) };

    return { teamA: '', teamB: '' };
  }

  // Remove verbs / filler that commonly cling to a captured team name.
  function cleanTeam(name) {
    // A leading conjunction "و" frequently glues onto the captured name
    // ("وميسي" / "والأرجنتين"); drop it so the output reads naturally.
    var s = trimClause(name).replace(/^و(?=[؀-ۿ])/, '');
    // Drop trailing/leading common verbs & adverbs that sneaked into the capture.
    var noise = ['لعبت', 'لعب', 'فازت', 'فاز', 'خسرت', 'خسر', 'تعادلت', 'تعادل',
      'واجهت', 'واجه', 'النهاردة', 'اليوم', 'امبارح', 'أمس', 'تغلبت', 'تغلب',
      'انهزمت', 'انهزم', 'كسبت', 'كسب', 'تأهلت', 'تأهل',
      'انتهت', 'انتهى', 'انتهوا', 'المباراة', 'مباراة', 'اللقاء', 'المباري'];
    // Prepositions / time words that signal the end of a team name — truncate
    // the capture here ("كرواتيا في نصف النهائي" -> "كرواتيا").
    var stop = ['في', 'فى', 'من', 'إلى', 'الى', 'على', 'عن', 'بـ', 'يوم',
      'النهاردة', 'اليوم', 'امبارح', 'أمس', 'بعد', 'قبل', 'خلال', 'حتى'];
    var tokens = [];
    var raw = s.split(/\s+/);
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (/\d/.test(t)) break; // a score/date fragment marks the end of the name
      // A leading "و" often glues onto a verb ("وخسرت") swallowed by the capture.
      var bare = t.replace(/^و/, '');
      if (stop.indexOf(t) >= 0 || stop.indexOf(bare) >= 0) break; // boundary reached
      if (noise.indexOf(t) >= 0 || noise.indexOf(bare) >= 0) continue; // drop verbs/adverbs
      tokens.push(t);
    }
    // A team name rarely exceeds 3 tokens; trim defensively.
    if (tokens.length > 3) tokens = tokens.slice(0, 3);
    return tokens.join(' ').trim();
  }

  // First "N - M" style score; normalized to "N-M".
  function parseScore(text) {
    // Avoid capturing dates ("2026-06-15") or times ("9:30") as a score:
    // require the pair to be bounded by non-digit / non-separator chars and use
    // only a dash separator.
    var m = text.match(/(?:^|[^\d:\/–-])(\d{1,2})\s*[-–]\s*(\d{1,2})(?![\d:\/–-])/);
    if (!m) return '';
    return m[1] + '-' + m[2];
  }

  function scoreMargin(score) {
    if (!score) return 0;
    var p = score.split('-');
    if (p.length !== 2) return 0;
    return Math.abs((parseInt(p[0], 10) || 0) - (parseInt(p[1], 10) || 0));
  }

  // Result keyword detection -> {key:'win'|'loss'|'draw'|'', label}
  function parseResult(text) {
    if (/(?:تعادل|تعادلت|تعادلا|تعادلوا|التعادل)/.test(text)) return { key: 'draw', label: 'تعادل' };
    if (/(?:فاز|فازت|كسب|كسبت|تغلّب|تغلب|تتغلب|اكتسح|اكتسحت|تأهل|تأهلت|انتصر|انتصرت)/.test(text))
      return { key: 'win', label: 'فوز' };
    if (/(?:خسر|خسرت|انهزم|انهزمت|الخسارة|سقط|سقطت|أُقصي|اقصي|أقصيت)/.test(text))
      return { key: 'loss', label: 'خسارة' };
    return { key: '', label: '' };
  }

  var CRITICAL_WORDS = ['جدل', 'إقالة', 'اقالة', 'طرد', 'إصابة خطيرة', 'اصابة خطيرة',
    'نهائي', 'خروج', 'مفاجأة', 'مفاجاة', 'إقصاء', 'اقصاء', 'فضيحة', 'أزمة', 'ازمة'];
  var KNOCKOUT_WORDS = ['نهائي', 'ربع النهائي', 'نصف النهائي', 'ثمن النهائي', 'دور الـ16',
    'إقصاء', 'اقصاء', 'خروج', 'حسم التأهل'];

  function pickImportance(text, score, resultObj) {
    var hasCritical = CRITICAL_WORDS.some(function (w) { return text.indexOf(w) >= 0; });
    var isKnockout = KNOCKOUT_WORDS.some(function (w) { return text.indexOf(w) >= 0; });
    var bigMargin = scoreMargin(score) >= 3;
    var lossInKnockout = resultObj.key === 'loss' && isKnockout;
    if (hasCritical || bigMargin || lossInKnockout) return 'critical';
    if (resultObj.key || score || /(?:هدف|أهداف|سجل|سجّل|تسجيل)/.test(text)) return 'important';
    return 'normal';
  }

  // Notable-moment fragments (keep only ones with a salient keyword).
  var MOMENT_WORDS = ['هدف', 'أهداف', 'سجل', 'سجّل', 'طرد', 'إصابة', 'اصابة', 'جدل',
    'تبديل', 'ركلة', 'دفاع', 'تألق', 'تالق', 'إنذار', 'انذار', 'هجمة', 'تسديدة',
    'حارس', 'تصدى', 'تصدي', 'بنالتي', 'بنلتي', 'صنع', 'تمريرة', 'انفراد'];

  function parseMoments(text) {
    var frags = splitFragments(text);
    var out = [];
    frags.forEach(function (f) {
      var hit = MOMENT_WORDS.some(function (w) { return f.indexOf(w) >= 0; });
      if (hit) out.push(polishMoment(f));
    });
    // De-duplicate while preserving order.
    var seen = {};
    out = out.filter(function (x) {
      var k = x.replace(/\s+/g, '');
      if (seen[k]) return false; seen[k] = true; return true;
    });
    return out;
  }

  // Light cleanup of colloquial fragments into a tidier moment line.
  function polishMoment(f) {
    var s = trimClause(f)
      .replace(/\bالنهاردة\b/g, 'اليوم')
      .replace(/\bكان\s+/g, '')
      .replace(/\bفي\s+جدل\b/g, 'جدل')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!s) return s;
    return s.charAt(0) + s.slice(1);
  }

  // Try to find who scored ("صلاح سجل" / "سجل صلاح").
  function findScorer(text) {
    var WORD = '[\\u0600-\\u06FF]+';
    var m = text.match(new RegExp('(' + WORD + ')\\s+(?:سجّل|سجل)'));
    if (m) return cleanTeam(m[1]);
    m = text.match(new RegExp('(?:سجّل|سجل)\\s+(' + WORD + ')'));
    if (m) return cleanTeam(m[1]);
    return '';
  }

  // Compose a polished Arabic summary from the extracted pieces.
  function buildSummary(text, teams, score, resultObj, moments) {
    var parts = [];
    var hasPair = teams.teamA && teams.teamB;

    if (hasPair && resultObj.label && score) {
      if (resultObj.key === 'draw') {
        parts.push(teams.teamA + ' و' + teams.teamB + ' تعادلا بنتيجة ' + score + '.');
      } else if (resultObj.key === 'loss') {
        parts.push(teams.teamA + ' يخسر أمام ' + teams.teamB + ' بنتيجة ' + score + '.');
      } else {
        parts.push(teams.teamA + ' يتغلّب على ' + teams.teamB + ' بنتيجة ' + score + '.');
      }
    } else if (hasPair && score) {
      parts.push('مباراة ' + teams.teamA + ' و' + teams.teamB + ' انتهت بنتيجة ' + score + '.');
    } else if (hasPair) {
      parts.push('مواجهة بين ' + teams.teamA + ' و' + teams.teamB + '.');
    } else if (resultObj.label && score) {
      parts.push('انتهت المباراة بـ' + resultObj.label + ' بنتيجة ' + score + '.');
    }

    // Add one notable detail sentence if available.
    if (moments && moments.length) {
      parts.push('أبرز ما جرى: ' + moments[0] + '.');
    }

    var summary = parts.join(' ').trim();
    // Fallback: weak parse -> clean first ~160 chars of the original.
    if (summary.length < 12) {
      var clean = collapse(text).replace(/\n/g, ' ');
      summary = clean.length > 160 ? clean.slice(0, 160).trim() + '…' : clean;
    }
    return summary;
  }

  function buildTitle(text, teams, score, resultObj) {
    if (teams.teamA && teams.teamB) {
      var t = teams.teamA + ' × ' + teams.teamB;
      if (resultObj.label) t += ' .. ' + resultObj.label;
      if (score) t += ' ' + score;
      return t;
    }
    // Otherwise: first salient clause.
    var frags = splitFragments(text);
    if (frags.length) {
      var first = frags[0];
      return first.length > 70 ? first.slice(0, 70).trim() + '…' : first;
    }
    return 'خبر مونديال';
  }

  function buildVideoTitle(teams, score, resultObj, scorer) {
    // Lead with the scorer if known, else the winning/losing team, else the result.
    var lead = '';
    if (scorer) lead = scorer;
    else if (resultObj.label && teams.teamA) lead = teams.teamA;
    else if (resultObj.label) lead = resultObj.label;
    else if (teams.teamA) lead = teams.teamA;

    var tail = '';
    if (teams.teamA && teams.teamB) {
      tail = teams.teamA + ' ضد ' + teams.teamB + (score ? ' ' + score : '');
    } else if (score) {
      tail = score;
    }

    // Avoid repeating the result word when the lead already IS the result label.
    var resWord = (resultObj.label && lead !== resultObj.label) ? ('.. ' + resultObj.label + ' ') : '.. ';
    var head = lead ? (lead + ' ' + resWord) : 'كواليس المباراة ';
    var title = (head + (tail ? '| ' + tail + ' ' : '')).trim() + ' 🔥';
    return title.replace(/\s{2,}/g, ' ').trim();
  }

  function buildVideoAngle(teams, resultObj, moments, scorer) {
    if (moments && moments.length) {
      var key = moments[0];
      if (scorer) return 'التركيز على لحظة ' + scorer + ' الحاسمة وتسلسل ' + key + '.';
      return 'تسليط الضوء على اللحظة المفصلية: ' + key + '.';
    }
    if (scorer) return 'إبراز دور ' + scorer + ' في صناعة الفارق داخل المباراة.';
    if (resultObj.label && teams.teamA && teams.teamB) {
      return 'تحليل أسباب ' + resultObj.label + ' ' + teams.teamA + ' أمام ' + teams.teamB + '.';
    }
    return 'استعراض أبرز ما جاء في الخبر بأسلوب سريع وجذّاب.';
  }

  // Master parse: returns an editable result object.
  function parse(rawInput) {
    var text = collapse(rawInput);
    var teams = parseTeams(text);
    var score = parseScore(text);
    var resultObj = parseResult(text);
    var moments = parseMoments(text);
    var scorer = findScorer(text);
    var importance = pickImportance(text, score, resultObj);
    var summary = buildSummary(text, teams, score, resultObj, moments);
    var title = buildTitle(text, teams, score, resultObj);
    var videoTitle = buildVideoTitle(teams, score, resultObj, scorer);
    var videoAngle = buildVideoAngle(teams, resultObj, moments, scorer);

    return {
      title: title,
      summary: summary,
      importance: importance,
      moments: moments.join('\n'),
      videoAngle: videoAngle,
      videoTitle: videoTitle,
      teamA: teams.teamA,
      teamB: teams.teamB,
      score: score,
      raw: rawInput
    };
  }

  /* ============================ rendering ============================ */

  function segImportance(current) {
    var html = '<div class="seg" id="aiImpSeg">';
    Store.IMPORTANCE.forEach(function (lvl) {
      var id = 'ai-imp-' + lvl.key;
      var cls = 'is-' + lvl.key;
      var checked = (current === lvl.key) ? ' checked' : '';
      html += '<input type="radio" name="aiImportance" id="' + id + '" value="' + lvl.key + '"' + checked + '>';
      html += '<label for="' + id + '" class="' + cls + '">' + Store.escapeHtml(lvl.label) + '</label>';
    });
    html += '</div>';
    return html;
  }

  // A single editable field row with a "نسخ" button.
  function fieldBlock(opts) {
    // opts: {key, label, hint, type:'input'|'textarea', value}
    var control;
    var safeVal = Store.escapeHtml(opts.value || '');
    if (opts.type === 'textarea') {
      control = '<textarea class="textarea ai-field" data-field="' + opts.key + '"' +
        (opts.rows ? ' rows="' + opts.rows + '"' : '') + '>' + safeVal + '</textarea>';
    } else {
      control = '<input class="input ai-field" data-field="' + opts.key + '" value="' + safeVal + '">';
    }
    return '' +
      '<div class="field ai-result-field">' +
        '<div class="ai-field-head">' +
          '<label class="field-label">' + Store.escapeHtml(opts.label) + '</label>' +
          '<button type="button" class="btn btn-ghost btn-sm ai-copy-one" data-copy="' + opts.key + '">نسخ</button>' +
        '</div>' +
        (opts.hint ? '<span class="field-hint">' + Store.escapeHtml(opts.hint) + '</span>' : '') +
        control +
      '</div>';
  }

  function resultPanelHtml() {
    if (phase === 'processing') {
      return '' +
        '<div class="ai-processing animate-in">' +
          '<div class="ai-spinner spin" aria-hidden="true">✦</div>' +
          '<p class="ai-processing__txt">جارٍ التحليل...</p>' +
          '<p class="muted text-sm">يقوم النموذج المبدئي باستخراج الفرق والنتيجة وأهم اللقطات.</p>' +
        '</div>';
    }
    if (!result) {
      return '' +
        '<div class="empty-state ai-empty">' +
          '<div class="empty-state__icon">✦</div>' +
          '<h3>النتيجة المنسّقة ستظهر هنا</h3>' +
          '<p>الصق الخبر الخام على اليمين ثم اضغط «التنسيق بالذكاء الاصطناعي». ' +
          'سنستخرج لك العنوان، الملخص، الأهمية، أهم اللقطات، وفكرة الفيديو وعنوانه — جاهزة للتعديل والإرسال إلى المحرر.</p>' +
          '<button class="btn btn-outline-gold" id="aiEmptyHint" type="button">✦ ابدأ التنسيق</button>' +
        '</div>';
    }

    // Parsed metadata chips (teams / score).
    var chips = '';
    if (result.teamA || result.teamB) {
      chips += '<span class="chip">⚽ ' + Store.escapeHtml((result.teamA || '؟') + ' × ' + (result.teamB || '؟')) + '</span>';
    }
    if (result.score) chips += '<span class="chip">النتيجة: ' + Store.escapeHtml(result.score) + '</span>';
    chips += '<span class="badge ' + Store.importanceBadge(result.importance) + '">' +
      Store.escapeHtml(Store.importanceLabel(result.importance)) + '</span>';

    return '' +
      '<div class="ai-result animate-in">' +
        '<div class="ai-result__meta row">' + chips + '</div>' +
        fieldBlock({ key: 'title', label: 'العنوان', type: 'input', value: result.title }) +
        fieldBlock({ key: 'summary', label: 'الملخص', type: 'textarea', rows: 3, value: result.summary }) +
        '<div class="field ai-result-field">' +
          '<label class="field-label">الأهمية</label>' +
          segImportance(result.importance) +
        '</div>' +
        fieldBlock({ key: 'moments', label: 'أهم اللقطات', hint: 'كل لقطة في سطر مستقل', type: 'textarea', rows: 4, value: result.moments }) +
        fieldBlock({ key: 'videoAngle', label: 'فكرة الفيديو', type: 'textarea', rows: 2, value: result.videoAngle }) +
        fieldBlock({ key: 'videoTitle', label: 'عنوان مقترح للفيديو', type: 'input', value: result.videoTitle }) +
        '<div class="ai-actions row">' +
          '<button class="btn btn-gold" id="aiSendEditor" type="button">📤 إرسال إلى المحرر</button>' +
          '<button class="btn btn-outline-gold" id="aiPoster" type="button">🖼 توليد بوستر</button>' +
          '<button class="btn btn-ghost" id="aiCopyAll" type="button">📋 نسخ الكل</button>' +
        '</div>' +
      '</div>';
  }

  function render(container) {
    container.innerHTML = '' +
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">مساعد <span class="accent">الصياغة</span></h1>' +
          '<p class="page-sub">حوّل الخبر الخام إلى حقول إنتاج منسّقة وجاهزة للنشر في ثوانٍ.</p>' +
        '</div>' +
      '</div>' +

      '<div class="ai-grid">' +
        // LEFT: raw input
        '<section class="panel ai-pane ai-pane--input">' +
          '<div class="row-between ai-pane__head">' +
            '<h2 class="section-title">النص الخام</h2>' +
            '<span class="chip ai-mock-chip">✦ نموذج مبدئي — يمكن ربطه بذكاء اصطناعي حقيقي لاحقًا</span>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field-label" for="aiRaw">الصق الخبر كما وصلك (لهجة عامية مقبولة)</label>' +
            '<textarea class="textarea ai-raw" id="aiRaw" rows="9" placeholder="مثال: مصر لعبت ضد بلجيكا وخسرت 2-1..."></textarea>' +
          '</div>' +
          '<div class="row ai-input-actions">' +
            '<button class="btn btn-gold btn-lg" id="aiFormatBtn" type="button">✦ التنسيق بالذكاء الاصطناعي</button>' +
            '<button class="btn btn-ghost" id="aiResetBtn" type="button">إعادة المثال</button>' +
            '<button class="btn btn-ghost" id="aiClearBtn" type="button">تفريغ</button>' +
          '</div>' +
          '<p class="ai-tip muted text-xs">يتعرّف المحلّل تلقائيًا على الفريقين، النتيجة، نوع النتيجة، الأهمية، وأهم اللقطات من النص العربي.</p>' +
        '</section>' +

        // RIGHT: formatted output
        '<section class="panel ai-pane ai-pane--output">' +
          '<h2 class="section-title">النتيجة المنسّقة</h2>' +
          '<div id="aiResultMount">' + resultPanelHtml() + '</div>' +
        '</section>' +
      '</div>';

    // Restore textarea value from module state.
    var ta = container.querySelector('#aiRaw');
    if (ta) ta.value = rawText;

    bind(container);
  }

  /* ============================ event binding ============================ */

  // Full bind: left pane (built once per render) + result mount.
  function bind(container) {
    bindLeft(container);
    bindResult(container);
  }

  // Left input pane — these elements exist for the whole page and are only
  // recreated by a full render(), so they are bound here (NOT from paintResult,
  // which would stack a new listener on every format cycle).
  function bindLeft(container) {
    var ta = container.querySelector('#aiRaw');
    if (ta) {
      ta.addEventListener('input', function () { rawText = ta.value; });
    }

    var formatBtn = container.querySelector('#aiFormatBtn');
    if (formatBtn) formatBtn.addEventListener('click', function () { runFormat(container); });

    var resetBtn = container.querySelector('#aiResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      rawText = EXAMPLE;
      if (ta) { ta.value = EXAMPLE; ta.focus(); }
    });

    var clearBtn = container.querySelector('#aiClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      rawText = '';
      if (ta) { ta.value = ''; ta.focus(); }
    });
  }

  // Result-mount controls — recreated by paintResult(), so re-bound there.
  function bindResult(container) {
    var emptyHint = container.querySelector('#aiEmptyHint');
    if (emptyHint) emptyHint.addEventListener('click', function () { runFormat(container); });

    // Editable-field syncing: typing into result fields updates module state.
    Array.prototype.forEach.call(container.querySelectorAll('.ai-field'), function (el) {
      el.addEventListener('input', function () {
        if (!result) return;
        var key = el.getAttribute('data-field');
        if (key) result[key] = el.value;
      });
    });

    // Importance segmented control.
    Array.prototype.forEach.call(container.querySelectorAll('input[name="aiImportance"]'), function (radio) {
      radio.addEventListener('change', function () {
        if (result && radio.checked) result.importance = radio.value;
        // Update the meta badge live without a full re-render.
        var badge = container.querySelector('.ai-result__meta .badge');
        if (badge && result) {
          badge.className = 'badge ' + Store.importanceBadge(result.importance);
          badge.textContent = Store.importanceLabel(result.importance);
        }
      });
    });

    // Per-field copy buttons.
    Array.prototype.forEach.call(container.querySelectorAll('.ai-copy-one'), function (btn) {
      btn.addEventListener('click', function () {
        if (!result) return;
        var key = btn.getAttribute('data-copy');
        App.copy(result[key] || '');
      });
    });

    var copyAll = container.querySelector('#aiCopyAll');
    if (copyAll) copyAll.addEventListener('click', function () {
      if (!result) return;
      App.copy(buildCopyAllText(result));
    });

    var sendBtn = container.querySelector('#aiSendEditor');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      if (!result) return;
      App.sendToEditor(resultToNews());
    });

    // One-click: save the formatted result as a news item, then jump straight
    // into the poster generator pre-filled from it — closing the raw-text → poster loop.
    var posterBtn = container.querySelector('#aiPoster');
    if (posterBtn) posterBtn.addEventListener('click', function () {
      if (!result) return;
      var saved = Store.saveNews(resultToNews());
      if (!saved) return; // quota toast already shown
      App.toast('تم حفظ الخبر — جارٍ فتح مولد البوستر', 'success', 2200);
      App.createPosterFromNews(saved.id);
    });
  }

  // Map the editable AI result into a news-schema object.
  function resultToNews() {
    return {
      title: result.title,
      summary: result.summary,
      importance: result.importance,
      moments: result.moments,
      videoAngle: result.videoAngle,
      videoTitle: result.videoTitle,
      teamA: result.teamA,
      teamB: result.teamB,
      score: result.score,
      rawNews: result.raw
    };
  }

  function buildCopyAllText(r) {
    var lines = [];
    lines.push('العنوان: ' + (r.title || ''));
    lines.push('الأهمية: ' + Store.importanceLabel(r.importance));
    if (r.teamA || r.teamB) lines.push('المباراة: ' + (r.teamA || '؟') + ' × ' + (r.teamB || '؟') + (r.score ? ' (' + r.score + ')' : ''));
    lines.push('');
    lines.push('الملخص:');
    lines.push(r.summary || '');
    lines.push('');
    lines.push('أهم اللقطات:');
    (r.moments || '').split('\n').forEach(function (m) {
      m = m.trim();
      if (m) lines.push('• ' + m);
    });
    lines.push('');
    lines.push('فكرة الفيديو: ' + (r.videoAngle || ''));
    lines.push('عنوان الفيديو: ' + (r.videoTitle || ''));
    return lines.join('\n');
  }

  /* ============================ format action (simulated AI) ============================ */

  function runFormat(container) {
    var input = (rawText || '').trim();
    if (!input) {
      App.toast('الصق نصًا أولًا', 'info');
      var ta = container.querySelector('#aiRaw');
      if (ta) ta.focus();
      return;
    }

    // Enter the simulated processing state.
    phase = 'processing';
    result = null;
    paintResult(container);
    setBusy(container, true);

    if (processingTimer) clearTimeout(processingTimer);
    var delay = 700 + Math.floor(Math.random() * 400); // 700–1100ms
    processingTimer = setTimeout(function () {
      processingTimer = null;
      try {
        result = parse(input);
      } catch (e) {
        console.error('AI parse error', e);
        result = null;
        phase = 'idle';
        App.toast('تعذّر تحليل النص — جرّب نصًا أوضح.', 'error');
        paintResult(container);
        setBusy(container, false);
        return;
      }
      phase = 'idle';
      paintResult(container);
      setBusy(container, false);
      App.toast('تم تنسيق الخبر ✓', 'success');
    }, delay);
  }

  function setBusy(container, busy) {
    var btn = container.querySelector('#aiFormatBtn');
    if (!btn) return;
    btn.disabled = busy;
    btn.innerHTML = busy
      ? '<span class="spin" aria-hidden="true">✦</span> جارٍ التحليل...'
      : '✦ التنسيق بالذكاء الاصطناعي';
  }

  // Repaint only the result mount (cheaper than full render, keeps raw textarea intact).
  function paintResult(container) {
    var mount = container.querySelector('#aiResultMount');
    if (!mount) return;
    mount.innerHTML = resultPanelHtml();
    bindResult(container);
  }

  /* ============================ register ============================ */
  App.registerPage('ai', {
    render: render,
    onShow: function (container) {
      // Focus the raw textarea on first navigation for a fast workflow.
      var ta = container.querySelector('#aiRaw');
      if (ta && !result && phase === 'idle') {
        // Defer to avoid fighting the route scroll animation.
        setTimeout(function () { try { ta.focus(); } catch (e) {} }, 60);
      }
    }
  });
})();
