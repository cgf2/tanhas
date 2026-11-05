/* ==========================================================================
   FANUC 系统参数说明 — 页面逻辑（双模块版）
   依赖：params.js / params-extra.js（参数），sysvars.js（系统变量）
   功能：参数与系统变量两个主模块、即时搜索、分类筛选、收藏、最近浏览、
         复制、深浅色、数据校验、号段覆盖概览
   ========================================================================== */

(function () {
  'use strict';

  var RECENT_LIMIT = 8;

  var RISK_INFO = {
    readonly: { label: '只读', cls: 'tag-risk-readonly', hint: '系统自动维护或仅供查看，不应手动修改' },
    careful: { label: '谨慎修改', cls: 'tag-risk-careful', hint: '影响功能或显示，修改前请备份并确认' },
    danger: { label: '危险', cls: 'tag-risk-danger', hint: '改错可能导致撞机、丢原点或设备损坏' }
  };

  /* 号段定义统一放在 params.js 的 FANUC_PARAM_META.bands 中，便于维护 */
  var PARAM_BANDS = (window.FANUC_PARAM_META && window.FANUC_PARAM_META.bands) || [];

  var STORAGE_KEYS = {
    theme: 'fanuc.site.theme.v1'
  };

  var moduleDefs = {
    params: {
      id: 'params',
      label: '参数',
      meta: window.FANUC_PARAM_META,
      raw: window.FANUC_PARAMS,
      favKey: 'fanuc.site.favs.v1',
      recentKey: 'fanuc.site.recent.v1',
      showSeries: true,
      countWord: '条参数',
      itemWord: '参数',
      totalLabel: '收录参数',
      searchPlaceholder: '搜索参数号或名称，例如 1006、1815#5、主轴、刀库、通讯',
      searchHint: '支持：1006、1815#5、No.1401、13730、主轴、刀库、通讯；纯数字查询只匹配参数号本身。',
      copyLabel: '复制参数号 + 名称',
      emptyTitle: '没有找到匹配的参数',
      suggestions: ['1006', '1401', '1825', '主轴', '刀库', '通讯'],
      bands: PARAM_BANDS
    },
    sysvars: {
      id: 'sysvars',
      label: '系统变量',
      meta: window.FANUC_SYSVAR_META,
      raw: window.FANUC_SYSVARS,
      favKey: 'fanuc.site.sysvar.favs.v1',
      recentKey: 'fanuc.site.sysvar.recent.v1',
      showSeries: false,
      countWord: '个变量',
      itemWord: '系统变量',
      totalLabel: '收录变量',
      searchPlaceholder: '搜索变量号或名称，例如 #3000、#1000.0、#5021、坐标、刀补',
      searchHint: '支持：#3000、3000、#1000.0（按位）、#1000–#1015（区间）、坐标、刀补、报警。',
      copyLabel: '复制变量号 + 名称',
      emptyTitle: '没有找到匹配的系统变量',
      suggestions: ['#3000', '#1000.0', '#5021', '坐标', '刀补', '报警'],
      bands: window.FANUC_SYSVAR_META ? window.FANUC_SYSVAR_META.bands : []
    }
  };

  var memoryStore = {};
  var state = {
    module: 'params',
    q: '',
    category: 'all',
    series: 'all',
    favOnly: false,
    favs: new Set(),
    recent: []
  };

  function active() {
    return moduleDefs[state.module];
  }

  function activeData() {
    return active().data || [];
  }

  function activeIssues() {
    return active().issues || [];
  }

  function meta() {
    return active().meta;
  }

  var el = {
    header: document.getElementById('appHeader'),
    totalCount: document.getElementById('totalCount'),
    themeToggle: document.getElementById('themeToggle'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebarClose: document.getElementById('sidebarClose'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchHint: document.getElementById('searchHint'),
    seriesPanel: document.getElementById('seriesPanel'),
    seriesFilter: document.getElementById('seriesFilter'),
    categoryList: document.getElementById('categoryList'),
    mobileCategoryList: document.getElementById('mobileCategoryList'),
    categoryNote: document.getElementById('categoryNote'),
    favOnlyBtn: document.getElementById('favOnlyBtn'),
    recentList: document.getElementById('recentList'),
    statsBox: document.getElementById('statsBox'),
    dataWarning: document.getElementById('dataWarning'),
    resultSummary: document.getElementById('resultSummary'),
    resetFilters: document.getElementById('resetFilters'),
    paramGrid: document.getElementById('paramGrid'),
    emptyState: document.getElementById('emptyState'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyText: document.getElementById('emptyText'),
    emptySuggestions: document.getElementById('emptySuggestions'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    resetAllBtn: document.getElementById('resetAllBtn'),
    moduleTabs: document.getElementById('moduleTabs'),
    overview: document.getElementById('overview'),
    overviewCounts: document.getElementById('overviewCounts'),
    coverageParams: document.getElementById('coverageParams'),
    coverageSysvars: document.getElementById('coverageSysvars'),
    pendingList: document.getElementById('pendingList')
  };

  /* ---------------- 存储 ---------------- */

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : fallback;
    }
  }

  function writeStore(key, value) {
    memoryStore[key] = value;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* file:// 或隐私模式下仅内存保存 */
    }
  }

  /* ---------------- 工具 ---------------- */

  function normalize(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[\s\u3000]+/g, '');
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function catMapOf(mod) {
    return mod._catMap || (mod._catMap = (function () {
      var map = {};
      if (mod.meta && mod.meta.categories) mod.meta.categories.forEach(function (c) { map[c.id] = c; });
      return map;
    })());
  }

  function seriesMapOf(mod) {
    return mod._seriesMap || (mod._seriesMap = (function () {
      var map = {};
      if (mod.meta && mod.meta.series) mod.meta.series.forEach(function (s) { map[s.id] = s; });
      return map;
    })());
  }

  function categoryName(mod, id) {
    var map = catMapOf(mod);
    return map[id] ? map[id].name : id;
  }

  function seriesName(mod, id) {
    var map = seriesMapOf(mod);
    return map[id] ? map[id].name : id;
  }

  function riskInfo(risk) {
    return RISK_INFO[risk] || RISK_INFO.careful;
  }

  function keyOf(mod, p) {
    if (mod.id === 'sysvars') {
      return String(p.no) + (p.noEnd ? '-' + p.noEnd : '') + (p.bit === null || p.bit === undefined ? '' : '.' + p.bit);
    }
    return String(p.no) + (p.bit === null || p.bit === undefined ? '' : '#' + p.bit);
  }

  function displayNo(mod, p) {
    if (mod.id === 'sysvars') {
      var text = '#' + p.no;
      if (p.noEnd) text += '–#' + p.noEnd;
      if (p.bit !== null && p.bit !== undefined) text += '.' + p.bit;
      return text;
    }
    return 'No.' + p.no + (p.bit === null || p.bit === undefined ? '' : ' #' + p.bit);
  }

  function scopeOf(mod, p) {
    if (mod.id === 'sysvars') {
      if (p.bitAccess) return '字节（可按位访问）';
      if (p.noEnd) return '变量区间';
      return '系统变量';
    }
    return p.scope || '参数';
  }

  function copyTextOf(mod, p) {
    if (mod.id === 'sysvars') return displayNo(mod, p) + ' ' + p.nameZh;
    return displayNo(mod, p).replace(' #', '#') + ' ' + p.nameZh;
  }

  /* ---------------- 数据校验 ---------------- */

  function validateParams(mod) {
    var issues = [];
    var seen = {};
    var required = ['nameZh', 'nameEn', 'desc', 'range', 'defaultValue', 'example', 'apply', 'source', 'scope', 'unit'];
    var catMap = catMapOf(mod);
    var seriesMap = seriesMapOf(mod);

    mod.data.forEach(function (p, index) {
      var messages = [];
      var label = (p && p.no ? 'No.' + p.no : '第 ' + (index + 1) + ' 条');
      if (!p || typeof p !== 'object') {
        issues.push({ index: index, label: label, messages: ['条目不是有效对象'] });
        return;
      }
      var noText = String(p.no == null ? '' : p.no);
      if (!/^\d{1,5}$/.test(noText)) messages.push('参数号格式应为 1~5 位数字');
      if (p.bit !== null && p.bit !== undefined) {
        if (!(typeof p.bit === 'number' && isFinite(p.bit) && p.bit >= 0 && p.bit <= 7 && Math.floor(p.bit) === p.bit)) {
          messages.push('位号应为 0~7 的整数');
        }
      }
      required.forEach(function (field) {
        if (typeof p[field] !== 'string' || !p[field].trim()) messages.push('缺少必填字段 ' + field);
      });
      if (!catMap[p.category]) messages.push('未知分类 ' + p.category);
      if (!RISK_INFO[p.risk]) messages.push('风险等级无效：' + p.risk);
      if (typeof p.verified !== 'string' || !mod.meta.verification[p.verified]) messages.push('资料核实等级无效：' + p.verified);
      if (!Array.isArray(p.series) || p.series.length === 0) {
        messages.push('缺少适用系统系列');
      } else {
        p.series.forEach(function (s) { if (!seriesMap[s]) messages.push('未知系统系列 ' + s); });
      }
      if (!Array.isArray(p.related)) messages.push('related 应为字符串数组');

      var key = keyOf(mod, p);
      if (Object.prototype.hasOwnProperty.call(seen, key)) messages.push('参数号重复（与第 ' + (seen[key] + 1) + ' 条重复）');
      else seen[key] = index;

      if (messages.length) {
        p.__issues = messages;
        issues.push({ index: index, label: label, messages: messages });
      }
    });
    return issues;
  }

  function validateSysvars(mod) {
    var issues = [];
    var seen = {};
    var required = ['nameZh', 'nameEn', 'desc', 'dataType', 'range', 'access', 'reset', 'source'];
    var catMap = catMapOf(mod);

    mod.data.forEach(function (p, index) {
      var messages = [];
      var label = (p && p.no ? '#' + p.no : '第 ' + (index + 1) + ' 条');
      if (!p || typeof p !== 'object') {
        issues.push({ index: index, label: label, messages: ['条目不是有效对象'] });
        return;
      }
      var noText = String(p.no == null ? '' : p.no);
      if (!/^\d{1,5}$/.test(noText)) messages.push('变量号格式应为 1~5 位数字');
      if (p.noEnd !== undefined) {
        if (!/^\d{1,5}$/.test(String(p.noEnd))) messages.push('区间结束号格式应为 1~5 位数字');
        else if (Number(p.noEnd) < Number(noText)) messages.push('区间结束号不能小于起始号');
      }
      if (p.bit !== null && p.bit !== undefined) {
        if (!(typeof p.bit === 'number' && isFinite(p.bit) && p.bit >= 0 && p.bit <= 7 && Math.floor(p.bit) === p.bit)) {
          messages.push('位号应为 0~7 的整数');
        }
      }
      if (p.bitAccess !== undefined && typeof p.bitAccess !== 'boolean') messages.push('bitAccess 应为 true/false');
      required.forEach(function (field) {
        if (typeof p[field] !== 'string' || !p[field].trim()) messages.push('缺少必填字段 ' + field);
      });
      if (!catMap[p.category]) messages.push('未知分类 ' + p.category);
      if (!RISK_INFO[p.risk]) messages.push('风险等级无效：' + p.risk);
      if (!p.access || ['只读', '可读可写', '可写'].indexOf(p.access) === -1) messages.push('读写属性应为 只读/可读可写/可写');
      if (typeof p.verified !== 'string' || !mod.meta.verification[p.verified]) messages.push('资料核实等级无效：' + p.verified);
      if (!Array.isArray(p.related)) messages.push('related 应为字符串数组');

      var key = keyOf(mod, p);
      if (Object.prototype.hasOwnProperty.call(seen, key)) messages.push('变量号重复（与第 ' + (seen[key] + 1) + ' 条重复）');
      else seen[key] = index;

      if (messages.length) {
        p.__issues = messages;
        issues.push({ index: index, label: label, messages: messages });
      }
    });
    return issues;
  }

  function sortData(mod, list) {
    return list.slice().sort(function (a, b) {
      var na = Number(a.no);
      var nb = Number(b.no);
      if (na !== nb) return na - nb;
      if (mod.id === 'sysvars') {
        var ra = a.noEnd ? Number(a.noEnd) : Number(a.no);
        var rb = b.noEnd ? Number(b.noEnd) : Number(b.no);
        if (ra !== rb) return ra - rb;
        return (a.bit === null || a.bit === undefined ? -1 : a.bit) - (b.bit === null || b.bit === undefined ? -1 : b.bit);
      }
      return (a.bit === null || a.bit === undefined ? -1 : a.bit) - (b.bit === null || b.bit === undefined ? -1 : b.bit);
    });
  }

  /* ---------------- 状态初始化 ---------------- */

  function initStoredState() {
    Object.keys(moduleDefs).forEach(function (id) {
      var mod = moduleDefs[id];
      var storedFavs = readStore(mod.favKey, []);
      mod.favs = new Set(Array.isArray(storedFavs) ? storedFavs.map(String) : []);
      mod.recent = [];
      var storedRecent = readStore(mod.recentKey, []);
      if (Array.isArray(storedRecent)) {
        mod.recent = storedRecent.map(String).filter(function (k) {
          return (mod.data || []).some(function (p) { return keyOf(mod, p) === k; });
        }).slice(0, RECENT_LIMIT);
      }
    });

    var storedTheme = readStore(STORAGE_KEYS.theme, null);
    var prefersDark = false;
    try {
      prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) { prefersDark = false; }
    applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : (prefersDark ? 'dark' : 'light'));
    syncStateFromModule();
  }

  function syncStateFromModule() {
    var mod = active();
    state.favs = mod.favs || new Set();
    state.recent = mod.recent || [];
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (el.themeToggle) {
      var dark = theme === 'dark';
      el.themeToggle.textContent = dark ? '浅色' : '深色';
      el.themeToggle.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
    }
    writeStore(STORAGE_KEYS.theme, theme);
  }

  /* ---------------- 查询解析 ---------------- */

  function parseTerms(rawValue) {
    var raw = String(rawValue || '').trim().replace(/^no\.?\s*/i, '');
    return raw.replace(/[\s\u3000]+/g, '').split(/[，,;；]+/).filter(Boolean).map(normalize);
  }

  function numericQuery(mod, terms) {
    if (terms.length !== 1) return null;
    /* 把常见的破折号/波浪号写法统一成 ASCII 连字符，便于识别区间查询 */
    var t = terms[0].replace(/[–—－~～]/g, '-');
    if (mod.id === 'sysvars') {
      var bitMatch = t.match(/^#?(\d{1,5})\.([0-7])$/);
      if (bitMatch) return { kind: 'bit', no: bitMatch[1], bit: bitMatch[2] };
      var rangeMatch = t.match(/^#?(\d{1,5})-+#?(\d{1,5})$/);
      if (rangeMatch) return { kind: 'range', from: rangeMatch[1], to: rangeMatch[2] };
      var noMatch = t.match(/^#?(\d{1,5})$/);
      if (noMatch) return { kind: 'number', no: noMatch[1] };
      return null;
    }
    var match = t.match(/^(\d{1,5})(?:#([0-7]))?$/);
    if (!match) return null;
    return { kind: match[2] === undefined ? 'number' : 'bit', no: match[1], bit: match[2] };
  }

  function rangeCovers(p, no) {
    if (!p.noEnd) return false;
    return Number(p.no) <= no && no <= Number(p.noEnd);
  }

  function matchesNumeric(mod, p, nq) {
    var no = Number(p.no);
    if (nq.kind === 'bit') {
      if (String(p.no) !== nq.no) return false;
      if (p.bit !== null && p.bit !== undefined) return String(p.bit) === nq.bit;
      return !!p.bitAccess;
    }
    if (nq.kind === 'range') {
      var from = Number(nq.from);
      var to = Number(nq.to);
      if (String(p.no) === nq.from || (p.noEnd && String(p.noEnd) === nq.to)) return true;
      if (no >= from && no <= to) return true;
      return !!(p.noEnd && Number(p.noEnd) >= from && no <= to);
    }
    if (String(p.no) === nq.no) return true;
    return rangeCovers(p, no) && no === Number(nq.no);
  }

  function matchesQuery(mod, p, terms) {
    if (!terms.length) return true;
    var hay = p.__hay;
    if (!hay) {
      hay = normalize([
        p.no,
        keyOf(mod, p),
        p.nameZh,
        p.nameEn,
        p.desc,
        p.example,
        p.range,
        p.defaultValue || '',
        p.dataType || '',
        p.access || '',
        p.reset || '',
        p.note || '',
        p.source,
        scopeOf(mod, p),
        categoryName(mod, p.category),
        (p.series || []).map(function (s) { return seriesName(mod, s); }).join(' '),
        (p.related || []).join(' '),
        RISK_INFO[p.risk] ? RISK_INFO[p.risk].label : ''
      ].join(' '));
      p.__hay = hay;
    }
    return terms.every(function (term) { return hay.indexOf(term) !== -1; });
  }

  function filteredData() {
    var mod = active();
    var terms = parseTerms(state.q);
    var nq = numericQuery(mod, terms);

    return activeData().filter(function (p) {
      if (state.category !== 'all' && p.category !== state.category) return false;
      if (mod.showSeries && state.series !== 'all' && (p.series || []).indexOf(state.series) === -1) return false;
      if (state.favOnly && !state.favs.has(keyOf(mod, p))) return false;
      if (nq) return matchesNumeric(mod, p, nq);
      return matchesQuery(mod, p, terms);
    });
  }

  function baseData() {
    var mod = active();
    if (!mod.showSeries || state.series === 'all') return activeData();
    return activeData().filter(function (p) { return (p.series || []).indexOf(state.series) !== -1; });
  }

  /* ---------------- 侧栏渲染 ---------------- */

  function renderSeriesFilter() {
    var mod = active();
    if (!el.seriesPanel) return;
    el.seriesPanel.hidden = !mod.showSeries;
    if (!mod.showSeries) return;
    clear(el.seriesFilter);
    var allBtn = make('button', 'chip', '全部系列');
    allBtn.type = 'button';
    allBtn.dataset.series = 'all';
    allBtn.setAttribute('aria-pressed', state.series === 'all' ? 'true' : 'false');
    el.seriesFilter.appendChild(allBtn);

    (mod.meta.series || []).forEach(function (s) {
      var btn = make('button', 'chip', s.name);
      btn.type = 'button';
      btn.dataset.series = s.id;
      btn.setAttribute('aria-pressed', state.series === s.id ? 'true' : 'false');
      el.seriesFilter.appendChild(btn);
    });
  }

  function fillCategoryList(target, mod, base, counts, compact) {
    if (!target) return;
    clear(target);
    var allBtn = make('button', 'cat-btn' + (compact ? ' mobile-cat-btn' : ''));
    allBtn.type = 'button';
    allBtn.dataset.category = 'all';
    allBtn.setAttribute('aria-pressed', state.category === 'all' ? 'true' : 'false');
    allBtn.appendChild(make('span', '', '全部' + mod.itemWord));
    allBtn.appendChild(make('span', 'cat-count', base.length));
    target.appendChild(allBtn);

    (mod.meta.categories || []).forEach(function (c) {
      var btn = make('button', 'cat-btn' + (compact ? ' mobile-cat-btn' : ''));
      btn.type = 'button';
      btn.dataset.category = c.id;
      btn.title = c.desc;
      btn.setAttribute('aria-pressed', state.category === c.id ? 'true' : 'false');
      btn.appendChild(make('span', '', c.name));
      btn.appendChild(make('span', 'cat-count', counts[c.id] || 0));
      target.appendChild(btn);
    });
  }

  function renderCategoryList() {
    var mod = active();
    var base = baseData();
    var counts = {};
    base.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });

    fillCategoryList(el.categoryList, mod, base, counts, false);
    fillCategoryList(el.mobileCategoryList, mod, base, counts, true);

    if (el.categoryNote) {
      el.categoryNote.textContent = mod.showSeries
        ? (state.series === 'all' ? '（全部系列）' : '（当前系列）')
        : '（全部系统变量）';
    }
  }

  function renderMyPanel() {
    var mod = active();
    el.favOnlyBtn.textContent = '仅显示收藏（' + state.favs.size + '）';
    el.favOnlyBtn.setAttribute('aria-pressed', state.favOnly ? 'true' : 'false');

    clear(el.recentList);
    if (state.recent.length === 0) {
      el.recentList.appendChild(make('p', 'recent-empty', '暂无浏览记录。点击' + mod.itemWord + '卡片即可记录。'));
      return;
    }
    state.recent.forEach(function (key) {
      var p = activeData().find(function (item) { return keyOf(mod, item) === key; });
      if (!p) return;
      var btn = make('button', 'recent-item');
      btn.type = 'button';
      btn.dataset.key = key;
      btn.title = '搜索 ' + displayNo(mod, p);
      btn.appendChild(make('span', 'recent-no', displayNo(mod, p)));
      btn.appendChild(make('span', 'recent-name', p.nameZh));
      el.recentList.appendChild(btn);
    });
  }

  function renderStats() {
    var mod = active();
    var visible = filteredData().length;
    var pending = activeData().filter(function (p) { return p.verified === 'low'; }).length;
    clear(el.statsBox);
    [
      [mod.totalLabel, activeData().length + ' ' + mod.countWord.replace('条', '').replace('个', '')],
      ['当前显示', visible + ' 条'],
      ['分类数量', (mod.meta.categories || []).length + ' 类'],
      ['收藏', state.favs.size + ' 条'],
      ['资料待核实', pending + ' 条']
    ].forEach(function (row) {
      var div = document.createElement('div');
      div.appendChild(make('span', '', row[0]));
      div.appendChild(make('strong', '', row[1]));
      el.statsBox.appendChild(div);
    });
  }

  /* ---------------- 卡片 ---------------- */

  function buildCard(p) {
    var mod = active();
    var card = make('article', 'param-card');
    card.dataset.key = keyOf(mod, p);
    if (p.__issues) card.classList.add('is-invalid');

    var head = make('div', 'card-head');
    var noBox = make('div', 'param-no', displayNo(mod, p));
    if (mod.id === 'sysvars' && p.bitAccess) {
      noBox.appendChild(make('span', 'bit', ' .0–.7'));
    }
    head.appendChild(noBox);

    var isFav = state.favs.has(keyOf(mod, p));
    var star = make('button', 'star-btn', isFav ? '★' : '☆');
    star.type = 'button';
    star.dataset.action = 'fav';
    star.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    star.setAttribute('aria-label', isFav ? '取消收藏 ' + displayNo(mod, p) : '收藏 ' + displayNo(mod, p));
    star.title = isFav ? '取消收藏' : '收藏';
    head.appendChild(star);

    var closeDetail = make('button', 'detail-close', '关闭');
    closeDetail.type = 'button';
    closeDetail.dataset.action = 'close-detail';
    closeDetail.setAttribute('aria-label', '关闭详情');
    head.appendChild(closeDetail);

    card.appendChild(head);

    var title = make('h3', 'param-title', p.nameZh);
    title.appendChild(make('span', 'param-en', p.nameEn));
    card.appendChild(title);

    var tags = make('div', 'tag-row');
    tags.appendChild(make('span', 'tag', categoryName(mod, p.category)));
    tags.appendChild(make('span', 'tag', scopeOf(mod, p)));
    if (mod.id === 'sysvars') {
      tags.appendChild(make('span', 'tag', '读写：' + p.access));
      if (p.bitAccess) tags.appendChild(make('span', 'tag tag-bit', '可按位 .0–.7'));
    } else {
      tags.appendChild(make('span', 'tag', '系列：' + (p.series || []).map(function (s) { return seriesName(mod, s); }).join(' / ')));
    }
    var risk = riskInfo(p.risk);
    var riskTag = make('span', 'tag ' + risk.cls, '风险：' + risk.label);
    riskTag.title = risk.hint;
    tags.appendChild(riskTag);
    if (mod.id === 'params') tags.appendChild(make('span', 'tag', p.apply));
    tags.appendChild(make('span', 'tag', '资料核实：' + (mod.meta.verification[p.verified] || p.verified)));
    if (p.__issues) {
      var issueTag = make('span', 'tag tag-invalid', '数据异常（' + p.__issues.length + '）');
      issueTag.title = p.__issues.join('；');
      tags.appendChild(issueTag);
    }
    card.appendChild(tags);

    var detail = make('div', 'card-detail');
    detail.appendChild(make('p', 'desc', p.desc));

    var facts = make('dl', 'facts');
    var factRows = mod.id === 'sysvars'
      ? [['数据类型', p.dataType], ['取值范围', p.range], ['读写属性', p.access], ['生效/复位', p.reset]]
      : [['数据范围', p.range], ['默认值', p.defaultValue], ['单位', p.unit], ['生效方式', p.apply]];
    factRows.forEach(function (row) {
      var item = make('div', 'fact-row');
      item.appendChild(make('dt', '', row[0]));
      var dd = make('dd', '', row[1]);
      if (String(row[1]).indexOf('请以随机官方手册为准') !== -1) dd.classList.add('warn-value');
      item.appendChild(dd);
      facts.appendChild(item);
    });
    detail.appendChild(facts);

    var example = make('div', 'example');
    example.appendChild(make('strong', '', mod.id === 'sysvars' ? '典型用法 / 程序示例：' : '常用设定示例：'));
    example.appendChild(document.createTextNode(p.example));
    detail.appendChild(example);

    if (p.note) detail.appendChild(make('div', 'card-note', '注意：' + p.note));

    var metaBox = make('div', 'card-meta');
    metaBox.appendChild(make('div', 'source', '来源类型：' + p.source));
    metaBox.appendChild(make('div', '', (mod.id === 'sysvars' ? '关联变量：' : '关联参数：') +
      ((p.related && p.related.length) ? p.related.join('、') : '无')));
    detail.appendChild(metaBox);
    card.appendChild(detail);

    var actions = make('div', 'card-actions');
    var detailBtn = make('button', 'detail-btn', '查看详情');
    detailBtn.type = 'button';
    detailBtn.dataset.action = 'detail';
    detailBtn.setAttribute('aria-label', '查看详情：' + displayNo(mod, p) + ' ' + p.nameZh);
    actions.appendChild(detailBtn);

    var copy = make('button', 'copy-btn', mod.copyLabel);
    copy.type = 'button';
    copy.dataset.action = 'copy';
    copy.setAttribute('aria-label', mod.copyLabel + '：' + displayNo(mod, p) + ' ' + p.nameZh);
    actions.appendChild(copy);
    card.appendChild(actions);

    return card;
  }

  function renderGrid() {
    var list = filteredData();
    clear(el.paramGrid);
    document.body.classList.remove('detail-open');

    if (list.length === 0) {
      el.emptyState.hidden = false;
      renderEmptyState();
    } else {
      el.emptyState.hidden = true;
      var frag = document.createDocumentFragment();
      list.forEach(function (p) { frag.appendChild(buildCard(p)); });
      el.paramGrid.appendChild(frag);
    }

    renderSummary(list.length);
    renderStats();
  }

  function renderSummary(count) {
    var mod = active();
    clear(el.resultSummary);
    var total = activeData().length;
    if (state.q.trim()) el.resultSummary.appendChild(document.createTextNode('搜索“' + state.q.trim() + '”：'));
    el.resultSummary.appendChild(make('strong', '', '显示 ' + count + ' / ' + total + ' ' + mod.countWord));

    var parts = [];
    parts.push('分类：' + (state.category === 'all' ? '全部' : categoryName(mod, state.category)));
    if (mod.showSeries) parts.push('系列：' + (state.series === 'all' ? '全部' : seriesName(mod, state.series)));
    if (state.favOnly) parts.push('仅收藏');
    el.resultSummary.appendChild(document.createTextNode(' · ' + parts.join(' · ')));
  }

  function renderEmptyState() {
    var mod = active();
    var hasQuery = !!state.q.trim();
    var filtersActive = state.category !== 'all' || state.series !== 'all' || state.favOnly;

    clear(el.emptyText);
    clear(el.emptySuggestions);
    el.emptyTitle.textContent = mod.emptyTitle;

    var details = [];
    if (hasQuery) details.push('搜索词：' + state.q.trim());
    if (state.category !== 'all') details.push('分类：' + categoryName(mod, state.category));
    if (mod.showSeries && state.series !== 'all') details.push('系列：' + seriesName(mod, state.series));
    if (state.favOnly) details.push('仅显示收藏');

    if (state.favOnly && state.favs.size === 0) {
      el.emptyTitle.textContent = '收藏夹为空';
      el.emptyText.textContent = '点击' + mod.itemWord + '卡片右上角的星标即可收藏。收藏按模块分别保存在本机浏览器中，下次打开仍然保留。';
    } else if (!activeData().length) {
      el.emptyTitle.textContent = mod.itemWord + '数据未加载';
      el.emptyText.textContent = '请确认 ' + (mod.id === 'params' ? 'params.js、params-extra.js' : 'sysvars.js') +
        ' 与 index.html 在同一目录，并且浏览器允许本地脚本运行。打开控制台可查看具体错误。';
    } else {
      el.emptyText.textContent = (details.length ? details.join('；') + '\n' : '') +
        '可以检查' + (mod.id === 'sysvars' ? '变量号写法（如 #3000、#1000.0）' : '参数号写法') +
        '、缩短关键词，或清除筛选条件后重试。';
    }

    if (activeData().length) {
      var list = make('ul', '');
      if (mod.id === 'sysvars') {
        list.appendChild(make('li', '', '变量号可写 #3000、3000；按位写 #1000.0；区间写 #1000–#1015。'));
        list.appendChild(make('li', '', '中文关键字可尝试：宏程序、接口、报警、坐标、刀补、模态、计数。'));
        list.appendChild(make('li', '', '英文关键字可尝试：macro、signal、offset、position、alarm。'));
      } else {
        list.appendChild(make('li', '', '参数号为纯数字，位参数请写成 1815#5 这样的格式（不带空格）。'));
        list.appendChild(make('li', '', '中文关键字可尝试：伺服、快移、主轴、刀库、通讯、报警。'));
        list.appendChild(make('li', '', '英文关键字可尝试：servo、rapid、spindle、tool、offset。'));
      }
      list.appendChild(make('li', '', '若同时启用了分类、系列和“仅收藏”，可先重置筛选再搜索。'));
      el.emptySuggestions.appendChild(list);

      var tryWrap = make('div', 'tag-row');
      tryWrap.style.marginTop = '4px';
      tryWrap.appendChild(make('span', '', '快速尝试：'));
      mod.suggestions.forEach(function (word) {
        var b = make('button', 'chip', word);
        b.type = 'button';
        b.dataset.suggest = word;
        tryWrap.appendChild(b);
      });
      el.emptySuggestions.appendChild(tryWrap);
    }
  }

  /* ---------------- 号段覆盖概览 ---------------- */

  function countInBand(list, from, to, mod) {
    return list.filter(function (p) {
      var start = Number(p.no);
      var end = p.noEnd ? Number(p.noEnd) : start;
      return end >= from && start <= to;
    }).length;
  }

  function renderCoverage(target, list, bands, mod) {
    clear(target);
    if (!bands || !bands.length) {
      target.appendChild(make('p', 'coverage-empty', '未定义号段。'));
      return;
    }
    bands.forEach(function (band) {
      var count = countInBand(list, band.from, band.to, mod);
      var row = make('div', 'coverage-row' + (count === 0 ? ' is-gap' : ''));
      row.appendChild(make('span', 'coverage-name', band.name));
      row.appendChild(make('span', 'coverage-count', count + ' 条'));
      row.appendChild(make('span', 'coverage-state', count === 0 ? '空缺' : '已收录'));
      target.appendChild(row);
    });
  }

  function renderOverview() {
    if (!el.overview) return;
    var show = !state.q.trim() && state.category === 'all' && state.series === 'all' && !state.favOnly;
    el.overview.hidden = !show;
    if (!show) return;

    var pMod = moduleDefs.params;
    var sMod = moduleDefs.sysvars;
    var pData = pMod.data || [];
    var sData = sMod.data || [];
    var pPending = pData.filter(function (p) { return p.verified === 'low'; }).length;
    var sPending = sData.filter(function (p) { return p.verified === 'low'; }).length;

    clear(el.overviewCounts);
    [
      { label: '参数', total: pData.length, pending: pPending, unit: '条', note: '按 Plus 加工中心（M 系列）口径筛选；覆盖轴控制、伺服、进给、主轴、刀库、程序、I/O、显示等常用参数。' },
      { label: '系统变量', total: sData.length, pending: sPending, unit: '个', note: '覆盖宏变量、接口信号、报警计时、坐标、刀补、工件坐标系、模态、计数与伺服状态。' }
    ].forEach(function (item) {
      var card = make('div', 'overview-card');
      card.appendChild(make('div', 'overview-card-title', item.label));
      card.appendChild(make('div', 'overview-card-count', item.total + ' ' + item.unit));
      card.appendChild(make('div', 'overview-card-sub', '资料待核实 ' + item.pending + ' ' + item.unit));
      card.appendChild(make('p', 'overview-card-note', item.note));
      el.overviewCounts.appendChild(card);
    });

    renderCoverage(el.coverageParams, pData, PARAM_BANDS, pMod);
    renderCoverage(el.coverageSysvars, sData, (sMod.meta && sMod.meta.bands) || [], sMod);

    var gaps = [];
    PARAM_BANDS.forEach(function (b) {
      if (countInBand(pData, b.from, b.to, pMod) === 0) gaps.push(b.name);
    });
    var sgaps = [];
    ((sMod.meta && sMod.meta.bands) || []).forEach(function (b) {
      if (countInBand(sData, b.from, b.to, sMod) === 0) sgaps.push(b.name);
    });

    clear(el.pendingList);
    var intro = make('p', '', '官方参数手册有数千条，系统变量也远不止本库收录范围。本库是“常用项整理”，不是完整手册；未列出的号段/变量并不代表不存在。');
    el.pendingList.appendChild(intro);
    var pGapText = gaps.length ? '参数明显空缺号段：' + gaps.join('、') + '。' : '参数主要号段均有收录。';
    var sGapText = sgaps.length ? '系统变量明显空缺区间：' + sgaps.join('、') + '。' : '系统变量主要区间均有收录。';
    el.pendingList.appendChild(make('p', 'pending-gap', pGapText));
    el.pendingList.appendChild(make('p', 'pending-gap', sGapText));

    var pRem = (pMod.meta && pMod.meta.removal) || { total: 0, criteria: '', items: [] };
    var sRem = (sMod.meta && sMod.meta.removal) || { total: 0, criteria: '', items: [] };
    var reason = make('p', 'pending-gap', '筛选口径：' + (pRem.criteria || ''));
    el.pendingList.appendChild(reason);
    el.pendingList.appendChild(make('p', 'pending-gap', '已移除：参数 ' + (pRem.total || 0) + ' 条，系统变量 ' + (sRem.total || 0) + ' 个。'));
    if (pRem.items && pRem.items.length) {
      el.pendingList.appendChild(make('p', '', '参数移除清单：' + pRem.items.map(function (it) {
        return it.no + ' ' + it.name;
      }).join('；') + '。'));
    }
    if (sRem.items && sRem.items.length) {
      el.pendingList.appendChild(make('p', '', '系统变量移除清单：' + sRem.items.map(function (it) {
        return it.no + ' ' + it.name;
      }).join('；') + '。'));
    }
    if (pRem.keptUncertain && pRem.keptUncertain.length) {
      el.pendingList.appendChild(make('p', 'pending-gap', '保留但适用性待核实：' + pRem.keptUncertain.join('、') + '（见卡片备注，以随机官方手册为准）。'));
    }
    el.pendingList.appendChild(make('p', '', '继续补充方法：在 params-extra.js 的 push 数组或 sysvars.js 的数组中按字段格式追加条目；不确定的含义写“请以随机官方手册为准”并将 verified 设为 low。'));
  }

  /* ---------------- 整体渲染 ---------------- */

  function renderAll() {
    renderSeriesFilter();
    renderCategoryList();
    renderMyPanel();
    renderOverview();
    renderGrid();
  }

  function renderAfterFilterChange() {
    renderSeriesFilter();
    renderCategoryList();
    renderOverview();
    renderGrid();
  }

  /* ---------------- 收藏 / 最近 ---------------- */

  function toggleFav(key) {
    if (state.favs.has(key)) state.favs.delete(key); else state.favs.add(key);
    writeStore(active().favKey, Array.from(state.favs));
    renderMyPanel();

    var card = el.paramGrid.querySelector('[data-key="' + cssEscape(key) + '"]');
    var star = card ? card.querySelector('[data-action="fav"]') : null;
    if (star) {
      var on = state.favs.has(key);
      star.textContent = on ? '★' : '☆';
      star.setAttribute('aria-pressed', on ? 'true' : 'false');
      star.title = on ? '取消收藏' : '收藏';
    }
    if (state.favOnly) renderGrid(); else renderStats();
  }

  function addRecent(key) {
    var mod = active();
    state.recent = state.recent.filter(function (k) { return k !== key; });
    state.recent.unshift(key);
    if (state.recent.length > RECENT_LIMIT) state.recent = state.recent.slice(0, RECENT_LIMIT);
    mod.recent = state.recent;
    writeStore(mod.recentKey, state.recent);
    renderMyPanel();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\\]]/g, '\\$&');
  }

  /* ---------------- 复制 ---------------- */

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-2000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function handleCopy(button, p) {
    var mod = active();
    var text = copyTextOf(mod, p);
    copyText(text).then(function (ok) {
      var original = mod.copyLabel;
      button.textContent = ok ? '已复制' : '复制失败，请手动选择';
      button.classList.toggle('copied', ok);
      window.setTimeout(function () {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1600);
    });
  }

  /* ---------------- 模块切换 ---------------- */

  function renderTabs() {
    if (!el.moduleTabs) return;
    var buttons = el.moduleTabs.querySelectorAll('button[data-module]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var on = btn.dataset.module === state.module;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
      var count = moduleDefs[btn.dataset.module] ? (moduleDefs[btn.dataset.module].data || []).length : 0;
      var countEl = btn.querySelector('.tab-count');
      if (countEl) countEl.textContent = count;
    });
    document.body.setAttribute('data-module', state.module);
  }

  function switchModule(id) {
    if (!moduleDefs[id] || id === state.module) return;
    state.module = id;
    state.q = '';
    state.category = 'all';
    state.series = 'all';
    state.favOnly = false;
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    var mod = active();
    el.searchInput.placeholder = mod.searchPlaceholder;
    if (el.searchHint) el.searchHint.textContent = mod.searchHint;
    el.totalCount.textContent = (mod.data || []).length + ' ' + mod.countWord;
    syncStateFromModule();
    renderTabs();
    renderAll();
    closeSidebar();
    window.scrollTo(0, 0);
    el.searchInput.focus();
  }

  /* ---------------- 事件 ---------------- */

  function bindEvents() {
    el.searchInput.addEventListener('input', function () {
      state.q = el.searchInput.value;
      el.searchClear.hidden = !state.q;
      renderGrid();
      renderOverview();
    });

    el.searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') clearSearch();
    });
    if (el.searchClear) el.searchClear.addEventListener('click', clearSearch);
    if (el.themeToggle) el.themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    if (el.sidebarToggle) el.sidebarToggle.addEventListener('click', openSidebar);
    if (el.sidebarClose) el.sidebarClose.addEventListener('click', closeSidebar);
    if (el.sidebarOverlay) el.sidebarOverlay.addEventListener('click', closeSidebar);

    if (el.moduleTabs) {
      el.moduleTabs.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-module]');
        if (btn) switchModule(btn.dataset.module);
      });
    }

    if (el.seriesFilter) {
      el.seriesFilter.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-series]');
        if (!btn) return;
        state.series = btn.dataset.series;
        renderAfterFilterChange();
      });
    }

    if (el.categoryList) {
      el.categoryList.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-category]');
        if (!btn) return;
        state.category = btn.dataset.category;
        renderAfterFilterChange();
      });
    }
    if (el.mobileCategoryList) {
      el.mobileCategoryList.addEventListener('click', function (event) {
        var btn = event.target.closest('button[data-category]');
        if (!btn) return;
        state.category = btn.dataset.category;
        renderAfterFilterChange();
      });
    }

    if (el.favOnlyBtn) el.favOnlyBtn.addEventListener('click', function () {
      state.favOnly = !state.favOnly;
      renderMyPanel();
      renderOverview();
      renderGrid();
    });

    if (el.recentList) el.recentList.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-key]');
      if (!btn) return;
      setSearch(btn.dataset.key);
      closeSidebar();
      window.scrollTo(0, 0);
    });

    if (el.resetFilters) el.resetFilters.addEventListener('click', resetAll);
    if (el.resetAllBtn) el.resetAllBtn.addEventListener('click', resetAll);
    if (el.clearSearchBtn) el.clearSearchBtn.addEventListener('click', clearSearch);

    if (el.emptySuggestions) el.emptySuggestions.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-suggest]');
      if (btn) setSearch(btn.dataset.suggest);
    });

    el.paramGrid.addEventListener('click', function (event) {
      var card = event.target.closest('.param-card');
      if (!card) return;
      var key = card.dataset.key;
      var mod = active();

      var detailBtn = event.target.closest('button[data-action="detail"]');
      if (detailBtn) {
        addRecent(key);
        card.classList.add('is-expanded');
        document.body.classList.add('detail-open');
        return;
      }

      var closeBtn = event.target.closest('button[data-action="close-detail"]');
      if (closeBtn) {
        card.classList.remove('is-expanded');
        document.body.classList.remove('detail-open');
        return;
      }

      var copyBtn = event.target.closest('button[data-action="copy"]');
      if (copyBtn) {
        var param = activeData().find(function (p) { return keyOf(mod, p) === key; });
        if (param) {
          addRecent(key);
          handleCopy(copyBtn, param);
        }
        return;
      }

      var favBtn = event.target.closest('button[data-action="fav"]');
      if (favBtn) {
        toggleFav(key);
        return;
      }

      addRecent(key);
    });

    window.addEventListener('resize', function () {
      syncHeaderHeight();
      if (window.innerWidth > 900) closeSidebar();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      closeSidebar();
      var expanded = el.paramGrid.querySelector('.param-card.is-expanded');
      if (expanded) expanded.classList.remove('is-expanded');
      document.body.classList.remove('detail-open');
    });
  }

  function setSearch(value) {
    var mod = active();
    state.q = value;
    el.searchInput.value = value;
    el.searchClear.hidden = !value;
    state.favOnly = false;
    state.category = 'all';
    state.series = 'all';
    renderAfterFilterChange();
    /* 区间/变量号搜索时，若结果唯一，保持列表；由 renderGrid 处理 */
    if (mod.id === 'sysvars' && value) {
      /* 无额外行为，保持通用 */
    }
  }

  function clearSearch() {
    state.q = '';
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    renderGrid();
    renderOverview();
    el.searchInput.focus();
  }

  function resetAll() {
    state.q = '';
    state.category = 'all';
    state.series = 'all';
    state.favOnly = false;
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    renderAll();
    el.searchInput.focus();
  }

  function openSidebar() {
    el.sidebar.classList.add('is-open');
    el.sidebarOverlay.hidden = false;
    el.sidebarToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    el.sidebar.classList.remove('is-open');
    el.sidebarOverlay.hidden = true;
    el.sidebarToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function syncHeaderHeight() {
    if (!el.header) return;
    document.documentElement.style.setProperty('--header-height', el.header.offsetHeight + 'px');
  }

  /* ---------------- 数据装载 ---------------- */

  function loadModule(id) {
    var mod = moduleDefs[id];
    var issues = [];
    if (!mod.meta || !Array.isArray(mod.raw)) {
      mod.data = [];
      mod.issues = [];
      console.warn('[FANUC 数据] ' + mod.label + '数据未加载：请确认 ' +
        (id === 'params' ? 'params.js / params-extra.js' : 'sysvars.js') + ' 已正确引入。');
      return { issues: [], missing: true };
    }
    mod.data = sortData(mod, mod.raw.slice());
    mod.data.forEach(function (p) { p.__issues = null; });
    issues = id === 'params' ? validateParams(mod) : validateSysvars(mod);
    mod.issues = issues;
    return { issues: issues, missing: false };
  }

  function reportIssues() {
    var all = [];
    Object.keys(moduleDefs).forEach(function (id) {
      var mod = moduleDefs[id];
      (mod.issues || []).forEach(function (issue) {
        all.push(mod.label + ' ' + issue.label + '：' + issue.messages.join('；'));
      });
    });
    if (all.length) {
      console.warn('[FANUC 数据校验] 发现 ' + all.length + ' 条问题：');
      all.forEach(function (msg) { console.warn('  ' + msg); });
      el.dataWarning.hidden = false;
      el.dataWarning.textContent = '数据校验：发现 ' + all.length +
        ' 条问题（已在对应卡片标注“数据异常”，详情见浏览器控制台）。';
    } else {
      console.info('[FANUC 数据校验] 通过。参数 ' + (moduleDefs.params.data || []).length +
        ' 条，系统变量 ' + (moduleDefs.sysvars.data || []).length + ' 条。');
    }
  }

  function showFatal(message) {
    el.resultSummary.textContent = active().itemWord + '数据未加载';
    el.dataWarning.hidden = false;
    el.dataWarning.textContent = message;
    el.emptyState.hidden = false;
    renderEmptyState();
  }

  function init() {
    syncHeaderHeight();

    if (!window.FANUC_PARAM_META || !Array.isArray(window.FANUC_PARAMS)) {
      el.dataWarning.hidden = false;
      el.dataWarning.textContent = '未找到 window.FANUC_PARAM_META 或 window.FANUC_PARAMS，请确认 params.js 已正确加载。';
      return;
    }

    loadModule('params');
    loadModule('sysvars');

    initStoredState();
    renderTabs();
    reportIssues();

    var mod = active();
    el.searchInput.placeholder = mod.searchPlaceholder;
    if (el.searchHint) el.searchHint.textContent = mod.searchHint;
    el.totalCount.textContent = (mod.data || []).length + ' ' + mod.countWord;

    renderAll();
    bindEvents();

    if (!(moduleDefs.params.data || []).length) {
      showFatal('参数数据为空。请在 params.js / params-extra.js 中添加参数后刷新页面。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
