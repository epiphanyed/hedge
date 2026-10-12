/**
 * MenMen Draw.io (diagrams.net) Integration & Bidirectional SVG Editor (v24.0)
 *
 * Core Capabilities:
 * 1. Mounts .menmen-drawio-toggle right next to handwriting icon (.menmen-ink-toggle)
 * 2. Deterministic mutual exclusion with both handwriting implementations (menmen-editor-fix.js & menmen-handwriting.js)
 * 3. Full-edit-area overlay modal (.ui-edit-area in ?both/?edit, .ui-content/viewport in ?view/paged)
 * 4. Exports embedded-XML SVG (xmlsvg) -> POST /uploadimage (explicit articleId binding + 401 HttpOnly ticket auto-renew)
 * 5. Bidirectional editing + zoom from preview (#doc in scroll & CSS multi-column paged mode, desktop + touch)
 * 6. OT-resilient source replacement via canonical resource-key matching + syncscroll [data-startline] + cm.markText / cm.setBookmark
 */
;(function () {
  'use strict';

  if (window.__menmenDrawioLoaded) return;
  window.__menmenDrawioLoaded = true;

  // =========================================================================
  // 1. 顶层立即快照初始 URL 参数 + sessionStorage 持久化 (防御 history.replaceState + F5 刷新)
  // =========================================================================
  var bootParams = new URLSearchParams(window.location.search || '');
  var initialNoteId = (bootParams.get('noteId') || '').trim() ||
    decodeURIComponent((window.location.pathname || '').replace(/^\//, '').split('/')[0] || '');
  var storageCtxKey = 'menmen.drawio.ctx.' + (initialNoteId || 'default');
  var storedCtx = {};
  try {
    storedCtx = JSON.parse(window.sessionStorage.getItem(storageCtxKey) || '{}') || {};
  } catch (e) {
    storedCtx = {};
  }

  var rawToken = (bootParams.get('token') || storedCtx.token || '').trim().replace(/^Bearer\s+/i, '').trim();
  var bootContext = {
    articleId: (bootParams.get('articleId') || storedCtx.articleId || '').trim(),
    noteId: (bootParams.get('noteId') || storedCtx.noteId || initialNoteId || '').trim(),
    lang: (bootParams.get('lang') || storedCtx.lang || '').trim(),
    token: rawToken,
    uploadTicket: (bootParams.get('uploadTicket') || storedCtx.uploadTicket || '').trim(),
    canSync: (bootParams.get('canSync') || storedCtx.canSync || '').trim(),
    accessMode: (bootParams.get('accessMode') || storedCtx.accessMode || '').trim(),
    canManage: (bootParams.get('canManage') || storedCtx.canManage || '').trim()
  };

  try {
    window.sessionStorage.setItem(storageCtxKey, JSON.stringify(bootContext));
  } catch (e) {}

  var EMPTY_DIAGRAM_XML =
    '<mxfile host="menmen" modified="' + new Date().toISOString() + '" agent="MenMen-Drawio" version="24.0.0" type="embed">' +
      '<diagram id="page-1" name="第 1 页">' +
        '<mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">' +
          '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root>' +
        '</mxGraphModel>' +
      '</diagram>' +
    '</mxfile>';

  // 兼容 markdown-it-imsize 语法及可选 ?query/#hash 参数的 SVG 图片正则：
  // match[1] = alt, match[2] = 纯净 .svg URL (含可选 ?query/#hash), match[3] = 可选的 "title" 或 =WxH 尺寸参数
  var MD_SVG_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^\s)"]+\.svg(?:[?#][^\s)"]*)?)((?:\s+[^)]*)?)\)/gi;
  var HTML_SVG_IMAGE_RE = /<img\b[^>]*?\bsrc=(["'])([^"']+\.svg(?:[?#][^"']*)?)\1[^>]*>/gi;

  // SVG 源码检测与内存缓存池：Map<canonicalKey, { isDrawio: boolean, xmlText: string }>
  var svgCache = new Map();
  var svgProbeInflight = new Map();
  var syncDebounceTimer = null;
  var iframeInitTimeoutTimer = null;

  var DEFAULT_PUBLIC_DRAWIO_URL =
    'https://embed.diagrams.net/?embed=1&ui=kennedy&spin=1&modified=unsavedChanges&proto=json&configure=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0&lang=zh';

  var state = {
    isOpen: false,
    isFullscreen: false,
    openSessionSeq: 0,
    mode: 'create',             // 'create' | 'edit'
    saveStrategy: 'normal',     // 'normal' | 'save-as-new'
    isIframeReady: false,
    isBootingIframe: false,
    isExporting: false,
    isUploading: false,
    isDirty: false,
    hasConflict: false,
    pendingXmlToLoad: null,
    editingTargetUrl: null,
    editingOccurrenceIdx: 0,
    editingStartLineHint: null,
    editingEndLineHint: null,
    editingMarker: null,
    createCursorBookmark: null,
    createCursorFallbackPos: null,
    editingImgEl: null,
    isApplyingChange: false,
    cmChangeHandler: null,
    hoveredImgEl: null,
    cmListenerAttached: false
  };

  var dom = {
    toolbarBtn: null,
    modal: null,
    titleEl: null,
    dirtyDot: null,
    conflictBanner: null,
    saveAsNewBtn: null,
    submitBtn: null,
    submitLabel: null,
    fullscreenBtn: null,
    cancelBtn: null,
    loadingEl: null,
    loadingTextEl: null,
    loadingRetryBtn: null,
    iframe: null,
    hoverPill: null
  };

  // =========================================================================
  // 2. 工具函数与编辑器/权限探测（兼容双实现手写板并解除 readOnly: 'nocursor'）
  // =========================================================================
  function getCodeMirror() {
    if (window.editor && typeof window.editor.getDoc === 'function') {
      return window.editor;
    }
    var cmEl = document.querySelector('.CodeMirror');
    if (cmEl && cmEl.CodeMirror) {
      return cmEl.CodeMirror;
    }
    return null;
  }

  function isHandwritingPadOpen() {
    if (window.__menmenInk && typeof window.__menmenInk.isOpen === 'function' && window.__menmenInk.isOpen()) {
      return true;
    }
    var inkBtn = document.querySelector('.menmen-ink-toggle');
    if (inkBtn && inkBtn.classList.contains('active')) return true;
    var overlay = document.querySelector('.ui-edit-area .menmen-ink-overlay');
    if (overlay && overlay.style.display !== 'none' && overlay.offsetHeight > 0) return true;
    return false;
  }

  function closeHandwritingIfOpen() {
    // 1. 复位 menmen-handwriting.js#L1057 的 overlayOpen 状态（注意其暴露的是 toggle 而非 close）
    if (window.__menmenInk && typeof window.__menmenInk.isOpen === 'function' && window.__menmenInk.isOpen()) {
      try {
        if (typeof window.__menmenInk.close === 'function') {
          window.__menmenInk.close();
        } else if (typeof window.__menmenInk.toggle === 'function') {
          window.__menmenInk.toggle();
        }
      } catch (e) {}
    }
    // 2. 复位 menmen-editor-fix.js#L568 的 padOpen 状态与 DOM 遮罩
    var overlay = document.querySelector('.ui-edit-area .menmen-ink-overlay');
    var inkBtn = document.querySelector('.menmen-ink-toggle');
    var closeBtn = document.querySelector('.ui-edit-area .menmen-ink-overlay .btn-close');
    if (closeBtn && ((overlay && overlay.style.display !== 'none') || (inkBtn && inkBtn.classList.contains('active')))) {
      try { closeBtn.click(); } catch (e) {}
    }
    if (isHandwritingPadOpen()) {
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } catch (e) {}
    }
    // 3. 显式收起手写调色盘气泡与工具栏画笔托盘
    var colorPop = document.querySelector('.menmen-ink-color-pop');
    if (colorPop) colorPop.classList.add('hidden');
    var inkTray = document.querySelector('.menmen-ink-tray');
    if (inkTray) {
      inkTray.classList.remove('open');
      inkTray.setAttribute('hidden', '');
    }
    // 4. 在非只读模式下解除手写板设置的 readOnly: 'nocursor'
    if (!(document.body && document.body.classList.contains('menmen-readonly'))) {
      var cm = getCodeMirror();
      if (cm && typeof cm.getOption === 'function' && cm.getOption('readOnly') === 'nocursor') {
        cm.setOption('readOnly', false);
      }
    }
  }

  function closeImageLightboxIfOpen() {
    if (window.__menmenImageLightbox && typeof window.__menmenImageLightbox.close === 'function') {
      try { window.__menmenImageLightbox.close(); } catch (e) {}
    }
    var strayLightboxes = document.querySelectorAll('.menmen-img-lightbox');
    for (var i = 0; i < strayLightboxes.length; i++) {
      try { strayLightboxes[i].remove(); } catch (e) {}
    }
    if (document.body) {
      document.body.classList.remove('menmen-img-lightbox-open');
    }
  }

  /** 与 ArticleSyncAuthRules.canManualSync / Plato canManualHedgedocSync 对齐 */
  function canManualHedgedocSync() {
    if (bootContext.canSync === '1') return true;
    if (bootContext.canSync === '0') return false;
    if (bootContext.canManage === '1') return true;
    if (!canCurrentUserEdit()) return false;
    if (bootContext.accessMode === '' || bootContext.accessMode == null) return true;
    var code = parseInt(bootContext.accessMode, 10);
    if (isNaN(code)) return true;
    return code === 0;
  }

  function canCurrentUserEdit() {
    if (document.body && document.body.classList.contains('menmen-readonly')) {
      return false;
    }
    // 同步联检 HedgeDoc 原生 index.js#L2273 的 havePermission()，防止 locked/protected 状态下 beforeChange 静默拦截
    if (window.loaded && typeof window.havePermission === 'function' && !window.havePermission()) {
      return false;
    }
    var cm = getCodeMirror();
    if (!cm) return false;
    if (typeof cm.getOption === 'function') {
      var ro = cm.getOption('readOnly');
      // 注意：menmen-editor-fix.js 在打开手写板时会设 readOnly = 'nocursor'，此时用户仍有编辑权
      if (ro === true) return false;
      if (ro === 'nocursor' && !isHandwritingPadOpen()) return false;
    }
    return true;
  }

  /**
   * 防御长耗时绘图期间 Socket.IO 瞬时闪断导致 index.js#L2369 将 CodeMirror 设为 readOnly: true
   * 或 index.js#L3434 将 cmClient.editorAdapter.ignoreNextChange 设为 true：
   * 若检测到临时断线只读，主动触发 socket.connect() 并等待最多 4000ms 恢复可写。
   */
  function ensureEditorWritableBeforeApply() {
    var cm = getCodeMirror();
    if (!cm) return Promise.resolve(false);
    closeHandwritingIfOpen();

    var sock = window.cmClient && window.cmClient.serverAdapter && window.cmClient.serverAdapter.socket;
    var isTempReadOnly = typeof cm.getOption === 'function' && cm.getOption('readOnly') === true &&
      !(document.body && document.body.classList.contains('menmen-readonly'));
    var isSocketDisconnected = sock && sock.connected === false;

    if (!isTempReadOnly && !isSocketDisconnected) {
      return Promise.resolve(true);
    }

    if (sock && typeof sock.connect === 'function' && sock.connected === false) {
      try { sock.connect(); } catch (e) {}
    }

    return new Promise(function (resolve) {
      var started = Date.now();
      var timer = setInterval(function () {
        var nowRo = typeof cm.getOption === 'function' ? cm.getOption('readOnly') : false;
        var nowConnected = !sock || sock.connected !== false;
        if (!nowRo && nowConnected) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started >= 4000) {
          clearInterval(timer);
          // 若非只读模式但因瞬时网络抖动仍处于 readOnly，临时解除 readOnly 以便写入本地文档缓冲区
          if (!(document.body && document.body.classList.contains('menmen-readonly')) && nowRo === true) {
            try { cm.setOption('readOnly', false); } catch (e) {}
          }
          resolve(true);
        }
      }, 120);
    });
  }

  function resolveNoteId() {
    if (bootContext.noteId) return bootContext.noteId;
    if (typeof window.noteid === 'string' && window.noteid) return window.noteid;
    var seg = (window.location.pathname || '').replace(/^\//, '').split('/')[0];
    return decodeURIComponent(seg || '');
  }

  /**
   * 三重锁定当前文章 ID，彻底防止多标签页并发打开不同文章时 upload_ticket Cookie 串文：
   * 1) URL 查询串 ?articleId=xxx
   * 2) sessionStorage 持久化的 bootContext.articleId
   * 3) 从 noteId (固定格式 a_{articleId}) 正则提取
   */
  function resolveArticleId() {
    var fromSearch = new URLSearchParams(window.location.search || '').get('articleId');
    if (fromSearch && /^\d+$/.test(fromSearch.trim())) return fromSearch.trim();
    if (bootContext.articleId && /^\d+$/.test(bootContext.articleId)) return bootContext.articleId;
    var nid = resolveNoteId();
    var m = nid && nid.match(/^a_(\d+)$/);
    return m ? m[1] : '';
  }

  /**
   * 与后端 MediaReferenceParser.toResourceObjectKey 及前端 extra.js#normalizeMenmenMediaUrl 保持同构：
   * 无论输入是 http://192.168.x.x:9999/oss/resources/{uuid}/{file}.svg、/blog/resources/{uuid}/{file}.svg
   * 还是 /oss/resources/{uuid}/{file}.svg，均统一归一化为 resources/{uuid}/{file}.svg。
   */
  function normalizeSvgUrl(rawUrl) {
    if (!rawUrl) return '';
    var trimmed = String(rawUrl).trim().split(/\s+/)[0];
    var pathname = trimmed;
    try {
      var u = new URL(trimmed, window.location.origin);
      pathname = decodeURIComponent(u.pathname);
    } catch (e) {
      pathname = trimmed.split('?')[0].split('#')[0];
    }
    var resIdx = pathname.indexOf('resources/');
    if (resIdx !== -1) {
      return pathname.slice(resIdx).replace(/^\/+/, '');
    }
    return pathname;
  }

  /**
   * 优先读取后端 config.menmen.drawioUrl 注入的 window.MENMEN_DRAWIO_URL（支持私有化容器部署），
   * 默认回退至官方 https://embed.diagrams.net，彻底避免未配反代时请求 /drawio 落入 HedgeDoc /:noteId 通配路由。
   */
  function resolveDrawioEmbedUrl(forcePublicFallback) {
    if (forcePublicFallback) return DEFAULT_PUBLIC_DRAWIO_URL;
    if (window.MENMEN_DRAWIO_URL && String(window.MENMEN_DRAWIO_URL).trim()) {
      return String(window.MENMEN_DRAWIO_URL).trim();
    }
    return DEFAULT_PUBLIC_DRAWIO_URL;
  }

  function serverBaseUrl() {
    if (typeof window.serverurl === 'string' && window.serverurl) {
      return window.serverurl.replace(/\/$/, '');
    }
    if (window.location && window.location.origin) {
      return window.location.origin;
    }
    return '';
  }

  /**
   * 保持与 menmen-editor-fix.js#L594 的 uploadImageUrl() 一致，绝不在 URL 查询串中拼接 ?articleId=，
   * 防止途经 hedgedoc/lib/web/auth/menmen-ticket.js#L173 时因 fromHostArticle && !token 触发 req.logout() 销毁 connect.sid。
   * articleId 与 noteId 统一通过 multipart/form-data 的 FormData 字段（Spring MVC @RequestParam 原生读取）与 X-HD-Note-Id 请求头传递。
   */
  function buildUploadUrl() {
    var base = serverBaseUrl();
    return base ? (base + '/uploadimage') : '/uploadimage';
  }

  // =========================================================================
  // 3. 工具栏按钮挂载（紧邻手写图标 .menmen-ink-toggle 右侧）
  // =========================================================================
  function ensureDrawioToolbarButton() {
    var toolbar = document.querySelector('.ui-edit-area .toolbar');
    if (!toolbar) return null;

    var existingBtn = toolbar.querySelector('.menmen-drawio-toggle');
    if (existingBtn) {
      if (!existingBtn.dataset.drawioBound) {
        existingBtn.dataset.drawioBound = '1';
        existingBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          onToolbarButtonClick();
        });
      }
      dom.toolbarBtn = existingBtn;
      return existingBtn;
    }

    var inkGroup = toolbar.querySelector('.menmen-ink-group');
    var inkToggle = toolbar.querySelector('.menmen-ink-toggle');
    var inkTray = toolbar.querySelector('.menmen-ink-tray');

    var btn = document.createElement('a');
    btn.href = '#';
    btn.setAttribute('role', 'button');
    btn.className = 'btn btn-sm menmen-drawio-toggle';
    btn.title = '插入 / 编辑 Draw.io 流程图 (Ctrl+Alt+D)';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.dataset.drawioBound = '1';
    btn.innerHTML = '<i class="fa fa-sitemap fa-fw menmen-drawio-icon" aria-hidden="true"></i>';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onToolbarButtonClick();
    });

    if (inkTray && inkTray.parentNode) {
      inkTray.insertAdjacentElement('afterend', btn);
    } else if (inkToggle && inkToggle.parentNode) {
      inkToggle.insertAdjacentElement('afterend', btn);
    } else if (inkGroup) {
      inkGroup.appendChild(btn);
    } else {
      toolbar.appendChild(btn);
    }

    dom.toolbarBtn = btn;
    return btn;
  }

  function findSvgMatchOnCursorLine(cm) {
    if (!cm) return null;
    var cursor = cm.getCursor();
    var lineText = cm.getLine(cursor.line) || '';
    var candidates = [];

    MD_SVG_IMAGE_RE.lastIndex = 0;
    var match;
    while ((match = MD_SVG_IMAGE_RE.exec(lineText)) !== null) {
      var norm = normalizeSvgUrl(match[2]);
      if (svgCache.has(norm) && !svgCache.get(norm).isDrawio) continue;
      var fullMatchStart = match.index;
      var fullMatchEnd = fullMatchStart + match[0].length;
      var altPart = '![' + match[1] + '](';
      var insideParens = match[0].slice(altPart.length, -1);
      var leadingSpaces = (insideParens.match(/^\s*/) || [''])[0].length;
      var urlStartCh = fullMatchStart + altPart.length + leadingSpaces;
      var urlEndCh = urlStartCh + match[2].length;
      candidates.push({
        alt: match[1],
        url: match[2],
        tokenStart: fullMatchStart,
        tokenEnd: fullMatchEnd,
        from: { line: cursor.line, ch: urlStartCh },
        to: { line: cursor.line, ch: urlEndCh }
      });
    }

    HTML_SVG_IMAGE_RE.lastIndex = 0;
    var hm;
    while ((hm = HTML_SVG_IMAGE_RE.exec(lineText)) !== null) {
      var hNorm = normalizeSvgUrl(hm[2]);
      if (svgCache.has(hNorm) && !svgCache.get(hNorm).isDrawio) continue;
      var relIdx = hm[0].indexOf(hm[2]);
      if (relIdx !== -1) {
        candidates.push({
          alt: 'drawio',
          url: hm[2],
          tokenStart: hm.index,
          tokenEnd: hm.index + hm[0].length,
          from: { line: cursor.line, ch: hm.index + relIdx },
          to: { line: cursor.line, ch: hm.index + relIdx + hm[2].length }
        });
      }
    }

    if (!candidates.length) return null;
    for (var i = 0; i < candidates.length; i++) {
      if (cursor.ch >= candidates[i].tokenStart && cursor.ch <= candidates[i].tokenEnd) {
        return candidates[i];
      }
    }
    return candidates[0];
  }

  function updateToolbarButtonCursorHint() {
    if (!dom.toolbarBtn) return;
    var cm = getCodeMirror();
    var lineMatch = findSvgMatchOnCursorLine(cm);
    if (lineMatch) {
      dom.toolbarBtn.classList.add('has-line-diagram');
      dom.toolbarBtn.title = '编辑当前行的 Draw.io 图表 (' + lineMatch.url.split('/').pop() + ')';
    } else {
      dom.toolbarBtn.classList.remove('has-line-diagram');
      dom.toolbarBtn.title = '插入 Draw.io 流程图 (Ctrl+Alt+D)';
    }
  }

  function onToolbarButtonClick() {
    if (state.isOpen) {
      requestCloseModal();
      return;
    }
    closeHandwritingIfOpen();
    var cm = getCodeMirror();
    var lineMatch = findSvgMatchOnCursorLine(cm);
    if (lineMatch) {
      openDrawioForExistingSvg(lineMatch.url, {
        startLineHint: lineMatch.from.line,
        endLineHint: lineMatch.to.line,
        directRange: { from: lineMatch.from, to: lineMatch.to }
      });
    } else {
      openDrawioForCreate();
    }
  }

  // =========================================================================
  // 4. 覆盖整个编辑区域的弹框 DOM 构建与几何对齐 (.ui-edit-area / .ui-content)
  // =========================================================================
  function ensureModalDOM() {
    if (dom.modal) return dom.modal;

    var modal = document.createElement('div');
    modal.className = 'menmen-drawio-modal hidden-print';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Draw.io 图表编辑器');
    modal.hidden = true;

    modal.innerHTML =
      '<div class="menmen-drawio-header">' +
        '<div class="menmen-drawio-header-left">' +
          '<span class="menmen-drawio-badge"><i class="fa fa-sitemap"></i> Draw.io</span>' +
          '<span class="menmen-drawio-title">新建流程图</span>' +
          '<span class="menmen-drawio-dirty-dot" hidden>● 未保存</span>' +
          '<span class="menmen-drawio-conflict-banner" hidden>' +
            '<i class="fa fa-exclamation-triangle"></i> 原图表所在行已被协作者修改' +
          '</span>' +
        '</div>' +
        '<div class="menmen-drawio-header-actions">' +
          '<button type="button" class="menmen-drawio-btn menmen-drawio-btn-ghost" data-action="fullscreen" title="切换全屏工作台">' +
            '<i class="fa fa-expand"></i> <span>全屏</span>' +
          '</button>' +
          '<button type="button" class="menmen-drawio-btn menmen-drawio-btn-cancel" data-action="cancel">取消</button>' +
          '<button type="button" class="menmen-drawio-btn menmen-drawio-btn-secondary" data-action="save-as-new" hidden>' +
            '<i class="fa fa-plus-circle"></i> 另存为新图表' +
          '</button>' +
          '<button type="button" class="menmen-drawio-btn menmen-drawio-btn-primary" data-action="insert" disabled>' +
            '<i class="fa fa-check"></i> <span class="menmen-drawio-submit-label">插入</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="menmen-drawio-body">' +
        '<div class="menmen-drawio-loading">' +
          '<i class="fa fa-spinner fa-spin"></i>' +
          '<span class="menmen-drawio-loading-text">正在加载 Draw.io 图形工作台...</span>' +
          '<button type="button" class="menmen-drawio-btn menmen-drawio-btn-cancel" data-action="retry-boot" hidden>' +
            '<i class="fa fa-refresh"></i> 重新加载图形工作台' +
          '</button>' +
        '</div>' +
        '<iframe class="menmen-drawio-iframe" title="Draw.io Editor" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
      '</div>';

    document.body.appendChild(modal);

    dom.modal = modal;
    dom.titleEl = modal.querySelector('.menmen-drawio-title');
    dom.dirtyDot = modal.querySelector('.menmen-drawio-dirty-dot');
    dom.conflictBanner = modal.querySelector('.menmen-drawio-conflict-banner');
    dom.saveAsNewBtn = modal.querySelector('[data-action="save-as-new"]');
    dom.submitBtn = modal.querySelector('[data-action="insert"]');
    dom.submitLabel = modal.querySelector('.menmen-drawio-submit-label');
    dom.fullscreenBtn = modal.querySelector('[data-action="fullscreen"]');
    dom.cancelBtn = modal.querySelector('[data-action="cancel"]');
    dom.loadingEl = modal.querySelector('.menmen-drawio-loading');
    dom.loadingTextEl = modal.querySelector('.menmen-drawio-loading-text');
    dom.loadingRetryBtn = modal.querySelector('[data-action="retry-boot"]');
    dom.iframe = modal.querySelector('.menmen-drawio-iframe');

    dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
    dom.cancelBtn.addEventListener('click', requestCloseModal);
    dom.submitBtn.addEventListener('click', function () {
      triggerDiagramExport('normal');
    });
    dom.saveAsNewBtn.addEventListener('click', function () {
      triggerDiagramExport('save-as-new');
    });
    dom.loadingRetryBtn.addEventListener('click', function () {
      bootDrawioIframe(true);
    });

    // 阻断弹框内部触控事件向 document 冒泡，防止触发 menmen-reader-flip.js#L1479 的 setupPullToRefresh() 下拉刷新整页重载
    var stopModalTouchBubble = function (ev) { ev.stopPropagation(); };
    modal.addEventListener('touchstart', stopModalTouchBubble, { passive: true });
    modal.addEventListener('touchmove', stopModalTouchBubble, { passive: true });
    modal.addEventListener('touchend', stopModalTouchBubble, { passive: true });

    return modal;
  }

  function bootDrawioIframe(usePublicFallback) {
    if (iframeInitTimeoutTimer) {
      clearTimeout(iframeInitTimeoutTimer);
      iframeInitTimeoutTimer = null;
    }
    state.isIframeReady = false;
    state.isBootingIframe = true;
    if (dom.loadingEl) dom.loadingEl.hidden = false;
    if (dom.loadingTextEl) dom.loadingTextEl.textContent = '正在加载 Draw.io 图形工作台...';
    if (dom.loadingRetryBtn) dom.loadingRetryBtn.hidden = true;
    dom.iframe.src = resolveDrawioEmbedUrl(Boolean(usePublicFallback));

    // 8 秒 init 握手超时守护：若自定义源网络不通，自动展现一键重试/切换官方源按钮
    iframeInitTimeoutTimer = setTimeout(function () {
      if (!state.isIframeReady && state.isOpen) {
        state.isBootingIframe = false;
        if (dom.loadingTextEl) {
          dom.loadingTextEl.textContent = 'Draw.io 工作台响应超时，请点击下方按钮重试';
        }
        if (dom.loadingRetryBtn) {
          dom.loadingRetryBtn.hidden = false;
        }
      }
    }, 8000);
  }

  function getViewportMinTop() {
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var minTop = 0;

    // 避让顶部固定导航栏 (.navbar-fixed-top, z-index: 1030)，防止长文档向下滚动后 bounds.top < 0 导致弹框顶栏被遮挡
    var navbar = document.querySelector('.navbar-fixed-top, .navbar');
    if (navbar && navbar.offsetHeight > 0) {
      var navRect = navbar.getBoundingClientRect();
      if (navRect.bottom > minTop && navRect.top < vh) {
        minTop = Math.max(minTop, Math.round(navRect.bottom));
      }
    }

    // 兼容最新新增的译文草稿置顶横幅 (#menmen-translate-draft-banner, z-index: 1200)，防止横幅遮挡弹框顶栏按钮
    var translateBanner = document.getElementById('menmen-translate-draft-banner');
    if (translateBanner && translateBanner.offsetHeight > 0) {
      var bannerRect = translateBanner.getBoundingClientRect();
      if (bannerRect.bottom > minTop && bannerRect.top < vh) {
        minTop = Math.max(minTop, Math.round(bannerRect.bottom));
      }
    }

    return minTop;
  }

  function syncModalBounds() {
    if (!dom.modal || !state.isOpen || state.isFullscreen) return;
    if (document.body && document.body.classList.contains('menmen-reader-paged')) return;

    var editArea = document.querySelector('.ui-edit-area');
    var targetContainer = null;

    if (editArea) {
      var rect = editArea.getBoundingClientRect();
      if (rect.width >= 180 && rect.height >= 180) {
        targetContainer = editArea;
      }
    }

    if (!targetContainer) {
      targetContainer =
        document.querySelector('.ui-content') ||
        document.querySelector('.ui-view-area') ||
        document.body;
    }

    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    var minTop = getViewportMinTop();
    var bounds = targetContainer.getBoundingClientRect();

    var finalTop = Math.max(minTop, Math.min(Math.round(bounds.top), vh - 280));
    var finalLeft = Math.max(0, Math.round(bounds.left));
    var finalWidth = Math.max(320, Math.min(Math.round(bounds.width), vw - finalLeft));
    var visibleBottom = Math.round(bounds.bottom);
    var finalHeight = (visibleBottom > finalTop + 280 && visibleBottom <= vh)
      ? (visibleBottom - finalTop)
      : Math.max(280, vh - finalTop);

    dom.modal.style.top = finalTop + 'px';
    dom.modal.style.left = finalLeft + 'px';
    dom.modal.style.width = finalWidth + 'px';
    dom.modal.style.height = finalHeight + 'px';
  }

  function toggleFullscreen() {
    if (!dom.modal) return;
    state.isFullscreen = !state.isFullscreen;
    dom.modal.classList.toggle('is-fullscreen', state.isFullscreen);
    var icon = dom.fullscreenBtn.querySelector('.fa');
    var label = dom.fullscreenBtn.querySelector('span');
    if (state.isFullscreen) {
      if (icon) icon.className = 'fa fa-compress';
      if (label) label.textContent = '还原';
    } else {
      if (icon) icon.className = 'fa fa-expand';
      if (label) label.textContent = '全屏';
      syncModalBounds();
    }
  }

  // =========================================================================
  // 5. OT 协同级源码精确定位 + CodeMirror TextMarker (cm.markText) 实时追踪
  // =========================================================================
  function clearEditingMarkerAndWatch() {
    var cm = getCodeMirror();
    if (state.editingMarker) {
      try {
        state.editingMarker.clear();
      } catch (e) {}
      state.editingMarker = null;
    }
    if (state.createCursorBookmark) {
      try {
        state.createCursorBookmark.clear();
      } catch (e) {}
      state.createCursorBookmark = null;
    }
    state.createCursorFallbackPos = null;
    if (cm && state.cmChangeHandler) {
      cm.off('change', state.cmChangeHandler);
      state.cmChangeHandler = null;
    }
    if (state.editingImgEl) {
      state.editingImgEl.classList.remove('is-editing');
      state.editingImgEl = null;
    }
    state.mode = 'idle';
    state.editingTargetUrl = null;
    state.editingOccurrenceIdx = 0;
    state.editingStartLineHint = null;
    state.editingEndLineHint = null;
    state.hasConflict = false;
    if (dom.conflictBanner) dom.conflictBanner.hidden = true;
    if (dom.saveAsNewBtn) dom.saveAsNewBtn.hidden = true;
  }

  function locateSvgUrlRangeInEditor(cm, targetUrl, options) {
    if (!cm || !targetUrl) return null;
    options = options || {};

    if (options.directRange && options.directRange.from && options.directRange.to) {
      return options.directRange;
    }

    var targetNorm = normalizeSvgUrl(targetUrl);
    var lineCount = cm.lineCount();

    function scanLineRangeForUrl(startLine, endLine, targetOccurrence) {
      var safeStart = Math.max(0, startLine);
      var safeEnd = Math.min(lineCount - 1, endLine);
      var matches = [];

      for (var lineNo = safeStart; lineNo <= safeEnd; lineNo++) {
        var lineText = cm.getLine(lineNo) || '';

        MD_SVG_IMAGE_RE.lastIndex = 0;
        var m;
        while ((m = MD_SVG_IMAGE_RE.exec(lineText)) !== null) {
          if (normalizeSvgUrl(m[2]) === targetNorm) {
            var prefixLen = ('![' + m[1] + '](').length;
            var inside = m[0].slice(prefixLen, -1);
            var leadSpaces = (inside.match(/^\s*/) || [''])[0].length;
            var chStart = m.index + prefixLen + leadSpaces;
            var chEnd = chStart + m[2].length;
            matches.push({
              from: { line: lineNo, ch: chStart },
              to: { line: lineNo, ch: chEnd }
            });
          }
        }

        HTML_SVG_IMAGE_RE.lastIndex = 0;
        var hm;
        while ((hm = HTML_SVG_IMAGE_RE.exec(lineText)) !== null) {
          if (normalizeSvgUrl(hm[2]) === targetNorm) {
            var relIdx = hm[0].indexOf(hm[2]);
            if (relIdx !== -1) {
              matches.push({
                from: { line: lineNo, ch: hm.index + relIdx },
                to: { line: lineNo, ch: hm.index + relIdx + hm[2].length }
              });
            }
          }
        }
      }

      if (matches.length === 0) return null;
      var idx = typeof targetOccurrence === 'number' ? targetOccurrence : 0;
      return matches[Math.min(idx, matches.length - 1)];
    }

    // 优先级 1：利用 syncscroll.js 注入的 [data-startline] / [data-endline] 精确扫描该块
    if (typeof options.startLineHint === 'number') {
      var endHint = typeof options.endLineHint === 'number' ? options.endLineHint : options.startLineHint;
      var hintedMatch = scanLineRangeForUrl(options.startLineHint, endHint, 0);
      if (hintedMatch) return hintedMatch;
    }

    // 优先级 2：全文扫描并按同 URL 出现序号 occurrenceIndex 精确取回
    return scanLineRangeForUrl(0, lineCount - 1, options.occurrenceIdx || 0);
  }

  function attachEditingMarkerAndWatch(cm, targetUrl, locateOptions) {
    clearEditingMarkerAndWatch();
    if (!cm || !targetUrl) return;

    var range = locateSvgUrlRangeInEditor(cm, targetUrl, locateOptions);
    if (!range) return;

    state.editingMarker = cm.markText(range.from, range.to, {
      className: 'menmen-drawio-cm-editing',
      inclusiveLeft: false,
      inclusiveRight: false
    });

    var targetNorm = normalizeSvgUrl(targetUrl);

    state.cmChangeHandler = function (cmInstance, changeObj) {
      if (!state.isOpen || state.mode !== 'edit') return;
      if (state.isApplyingChange) return;

      var currentPos = state.editingMarker ? state.editingMarker.find() : null;
      if (!currentPos) {
        // 防御 index.js#L2799 socket.on('doc') 调用 editor.setValue(body) 清空所有 TextMarker 的情况：
        // 先尝试在新文档中重新检索并自愈挂载 editingMarker，仅当目标 URL 确实不存在时才判定为协同冲突
        var reAnchored = locateSvgUrlRangeInEditor(cmInstance, targetUrl, {
          startLineHint: state.editingStartLineHint,
          endLineHint: state.editingEndLineHint,
          occurrenceIdx: state.editingOccurrenceIdx
        });
        if (reAnchored) {
          state.editingMarker = cmInstance.markText(reAnchored.from, reAnchored.to, {
            className: 'menmen-drawio-cm-editing',
            inclusiveLeft: false,
            inclusiveRight: false
          });
          return;
        }
        markEditingConflict();
        return;
      }
      var currentText = cmInstance.getRange(currentPos.from, currentPos.to);
      if (normalizeSvgUrl(currentText) !== targetNorm) {
        markEditingConflict();
      }
    };

    cm.on('change', state.cmChangeHandler);
  }

  function markEditingConflict() {
    state.hasConflict = true;
    if (dom.conflictBanner) dom.conflictBanner.hidden = false;
    if (dom.saveAsNewBtn) dom.saveAsNewBtn.hidden = false;
    if (dom.submitLabel) dom.submitLabel.textContent = '覆盖原位置';
  }

  // =========================================================================
  // 6. 打开与关闭 Draw.io 弹框（新建 / 二次编辑）
  // =========================================================================
  function openDrawioForCreate() {
    if (!canCurrentUserEdit()) return;
    state.openSessionSeq++;
    closeHandwritingIfOpen();
    closeImageLightboxIfOpen();
    ensureModalDOM();
    hideHoverPill();
    clearEditingMarkerAndWatch();

    // 仿照 menmen-handwriting.js#L921 使用 setBookmark 锚定初始光标，同时保存 createCursorFallbackPos 防御 socket.on('doc') 的 setValue 重置
    var cm = getCodeMirror();
    if (cm && typeof cm.getDoc === 'function') {
      var doc = cm.getDoc();
      if (doc) {
        var initialCur = doc.getCursor();
        state.createCursorFallbackPos = { line: initialCur.line, ch: initialCur.ch };
        if (typeof doc.setBookmark === 'function') {
          try {
            state.createCursorBookmark = doc.setBookmark(initialCur, { insertLeft: true });
          } catch (e) {}
        }
      }
    }

    state.mode = 'create';
    state.editingTargetUrl = null;
    state.isDirty = false;
    state.pendingXmlToLoad = EMPTY_DIAGRAM_XML;

    dom.titleEl.textContent = '新建流程图';
    dom.submitLabel.textContent = '插入';
    dom.dirtyDot.hidden = true;

    showModalAndLoadXml(EMPTY_DIAGRAM_XML);
  }

  function openDrawioForExistingSvg(svgUrl, options) {
    if (!canCurrentUserEdit()) return;
    var reqSeq = ++state.openSessionSeq;
    options = options || {};
    closeHandwritingIfOpen();
    closeImageLightboxIfOpen();
    ensureModalDOM();
    hideHoverPill();

    var cm = getCodeMirror();
    attachEditingMarkerAndWatch(cm, svgUrl, {
      startLineHint: options.startLineHint,
      endLineHint: options.endLineHint,
      occurrenceIdx: options.occurrenceIdx || 0,
      directRange: options.directRange || null
    });

    if (options.imgEl) {
      state.editingImgEl = options.imgEl;
      state.editingImgEl.classList.add('is-editing');
    }

    dom.loadingEl.hidden = false;
    dom.submitBtn.disabled = true;

    fetchAndValidateDrawioSvg(svgUrl)
      .then(function (result) {
        if (reqSeq !== state.openSessionSeq) return;
        if (!result || !result.isDrawio) {
          dom.loadingEl.hidden = true;
          dom.submitBtn.disabled = false;
          var rejectImg = options.imgEl || state.editingImgEl;
          if (rejectImg) rejectImg.classList.remove('menmen-drawio-editable');
          clearEditingMarkerAndWatch();
          updateToolbarButtonCursorHint();
          var rejectMsg = options.imgEl
            ? '该图片不是 Draw.io 图表，无法在预览中编辑。请确认文件为含 mxfile 的 Draw.io 导出 SVG。'
            : '当前行的 SVG 不是 Draw.io 图表。请移动光标到 Draw.io 图表行，或使用工具栏「插入」新建图表。';
          window.alert(rejectMsg);
          return;
        }
        state.mode = 'edit';
        state.editingTargetUrl = svgUrl;
        state.editingOccurrenceIdx = options.occurrenceIdx || 0;
        state.editingStartLineHint = options.startLineHint;
        state.editingEndLineHint = options.endLineHint;
        state.isDirty = false;
        var fileName = svgUrl.split('/').pop() || 'diagram.svg';
        dom.titleEl.textContent = '编辑图表 (' + fileName + ')';
        dom.submitLabel.textContent = '更新图表';
        dom.dirtyDot.hidden = true;
        var xmlToUse = result.xmlText || EMPTY_DIAGRAM_XML;
        state.pendingXmlToLoad = xmlToUse;
        showModalAndLoadXml(xmlToUse);
      })
      .catch(function (err) {
        if (reqSeq !== state.openSessionSeq) return;
        dom.loadingEl.hidden = true;
        dom.submitBtn.disabled = false;
        console.error('[MenMen-Drawio] 加载 SVG 失败:', err);
        window.alert('读取原 SVG 图表数据失败，请检查网络连接后重试。');
        clearEditingMarkerAndWatch();
      });
  }

  function showModalAndLoadXml(xmlString) {
    state.isOpen = true;
    dom.modal.hidden = false;
    // 同时挂载 menmen-drawio-open 与 modal-open，原生命中 menmen-reader-flip.js#L134 的 isModalOpen() 熔断器
    document.body.classList.add('menmen-drawio-open', 'modal-open');

    if (dom.toolbarBtn) {
      dom.toolbarBtn.classList.add('active');
      dom.toolbarBtn.setAttribute('aria-pressed', 'true');
    }

    syncModalBounds();

    if (!state.isIframeReady) {
      dom.loadingEl.hidden = false;
      dom.submitBtn.disabled = true;
      if (!state.isBootingIframe) {
        bootDrawioIframe(false);
      }
    } else {
      sendLoadToDrawioIframe(xmlString);
    }
  }

  function requestCloseModal() {
    if (!state.isOpen) return;
    if (state.isDirty && !state.isUploading) {
      var confirmed = window.confirm('当前 Draw.io 图表有未保存的修改，确定放弃修改并关闭吗？');
      if (!confirmed) return;
    }
    forceCloseModal();
  }

  function forceCloseModal() {
    state.openSessionSeq++;
    if (iframeInitTimeoutTimer) {
      clearTimeout(iframeInitTimeoutTimer);
      iframeInitTimeoutTimer = null;
    }
    state.isOpen = false;
    state.isExporting = false;
    state.isUploading = false;
    state.isDirty = false;
    clearEditingMarkerAndWatch();

    if (dom.modal) {
      dom.modal.hidden = true;
    }
    document.body.classList.remove('menmen-drawio-open', 'modal-open');

    if (dom.toolbarBtn) {
      dom.toolbarBtn.classList.remove('active');
      dom.toolbarBtn.setAttribute('aria-pressed', 'false');
    }
    updateToolbarButtonCursorHint();
  }

  // =========================================================================
  // 7. Draw.io postMessage JSON 通信协议与 xmlsvg 导出上传 (含 Sa-Token + 401 Ticket 自动续期)
  // =========================================================================
  function postToDrawio(payload) {
    if (!dom.iframe || !dom.iframe.contentWindow) return;
    dom.iframe.contentWindow.postMessage(JSON.stringify(payload), '*');
  }

  function sendLoadToDrawioIframe(xmlString) {
    dom.loadingEl.hidden = false;
    postToDrawio({
      action: 'load',
      xml: xmlString || EMPTY_DIAGRAM_XML,
      autosave: 0
    });
  }

  function triggerDiagramExport(saveStrategy) {
    if (!state.isOpen || !state.isIframeReady || state.isExporting || state.isUploading) return;
    state.isExporting = true;
    state.saveStrategy = saveStrategy || 'normal';
    dom.submitBtn.disabled = true;
    dom.submitLabel.textContent = '正在导出 SVG...';

    postToDrawio({
      action: 'export',
      format: 'xmlsvg',
      xml: 1,
      embedXml: 1,
      spinKey: 'saving',
      scale: 1,
      border: 8
    });
  }

  // 使用捕获阶段 (true) 拦截来自 Draw.io iframe 的消息，避免触发 menmen-reader-flip.js 的跨源告警
  window.addEventListener('message', function (event) {
    if (!dom.iframe || event.source !== dom.iframe.contentWindow) return;
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    if (typeof event.data !== 'string' || event.data.charAt(0) !== '{') return;

    var msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    switch (msg.event) {
      case 'configure':
        postToDrawio({
          action: 'configure',
          config: {
            defaultFonts: ['Microsoft YaHei', 'PingFang SC', 'Helvetica', 'Arial']
          }
        });
        break;

      case 'init':
        if (iframeInitTimeoutTimer) {
          clearTimeout(iframeInitTimeoutTimer);
          iframeInitTimeoutTimer = null;
        }
        state.isIframeReady = true;
        state.isBootingIframe = false;
        if (dom.loadingRetryBtn) dom.loadingRetryBtn.hidden = true;
        if (state.pendingXmlToLoad) {
          sendLoadToDrawioIframe(state.pendingXmlToLoad);
        }
        break;

      case 'load':
        dom.loadingEl.hidden = true;
        dom.submitBtn.disabled = false;
        state.isDirty = false;
        if (dom.dirtyDot) dom.dirtyDot.hidden = true;
        break;

      case 'autosave':
      case 'change':
        if (state.isOpen) {
          state.isDirty = true;
          if (dom.dirtyDot) dom.dirtyDot.hidden = false;
        }
        break;

      case 'save':
        triggerDiagramExport('normal');
        break;

      case 'export':
        state.isExporting = false;
        handleExportedXmlSvg(msg.data);
        break;

      case 'exit':
        requestCloseModal();
        break;
    }
  }, true);

  function decodeSvgDataUriToText(dataUriOrRaw) {
    if (!dataUriOrRaw) throw new Error('Empty export data');
    if (dataUriOrRaw.indexOf('<svg') !== -1) {
      return dataUriOrRaw;
    }
    var commaIdx = dataUriOrRaw.indexOf(',');
    if (commaIdx === -1) throw new Error('Invalid SVG data URI');
    var meta = dataUriOrRaw.slice(0, commaIdx);
    var body = dataUriOrRaw.slice(commaIdx + 1);
    if (meta.indexOf(';base64') !== -1) {
      var binary = window.atob(body);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(body);
  }

  // 统一使用 serverBaseUrl() 前缀并通过 application/x-www-form-urlencoded 请求体传递 articleId（绝不在 URL query 中拼接 ?articleId=，防止触发 menmen-ticket.js#L173 强制登出）
  // 注意：Sa-Token (application.yml#L94) 未配置 token-prefix，对齐 plato/src/api/request.ts#L46 与 menmen-ticket.js#L198 直接传递原始 bootContext.token
  function tryRenewUploadTicket() {
    var articleId = resolveArticleId();
    if (!articleId) return Promise.resolve(false);
    var renewUrl = serverBaseUrl() + '/api/hedgedoc/upload-ticket/renew';
    var formParams = new URLSearchParams();
    formParams.set('articleId', articleId);
    var headers = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    };
    if (bootContext.token) {
      headers['Authorization'] = bootContext.token;
    }
    return window.fetch(renewUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: formParams.toString()
    }).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (json) {
        var newTicket = json && json.data && json.data.uploadTicket;
        var ttl = (json && json.data && Number(json.data.uploadTicketTtlSeconds)) || 900;
        if (newTicket) {
          bootContext.uploadTicket = String(newTicket);
          try {
            window.sessionStorage.setItem(storageCtxKey, JSON.stringify(bootContext));
          } catch (e) {}
          try {
            var maxAge = Math.max(60, Math.floor(ttl));
            document.cookie = 'upload_ticket=' + encodeURIComponent(String(newTicket)) + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax';
          } catch (e) {}
        }
        return true;
      }).catch(function () {
        return true;
      });
    }).catch(function () {
      return false;
    });
  }

  function postSvgFormData(svgText, isRetry) {
    var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    var fileName = 'drawio-' + Date.now() + '.svg';
    var file = new File([blob], fileName, { type: 'image/svg+xml' });

    var formData = new FormData();
    formData.append('image', file, fileName);
    formData.append('upload', file, fileName);
    var articleId = resolveArticleId();
    var noteId = resolveNoteId();
    if (articleId) formData.append('articleId', articleId);
    if (noteId) formData.append('noteId', noteId);
    if (bootContext.uploadTicket) formData.append('uploadTicket', bootContext.uploadTicket);

    var headers = {};
    if (noteId) headers['X-HD-Note-Id'] = noteId;
    if (bootContext.token) headers['Authorization'] = bootContext.token;

    return window.fetch(buildUploadUrl(), {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
      headers: headers
    }).then(function (res) {
      if ((res.status === 401 || res.status === 403) && !isRetry) {
        return tryRenewUploadTicket().then(function (renewed) {
          if (renewed) return postSvgFormData(svgText, true);
          throw new Error('上传凭证已过期（HTTP ' + res.status + '），请刷新页面后重试');
        });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // 等待 2000ms 确保 CodeMirror 的 Socket.IO OT 操作已落入 HedgeDoc 内存，通过 POST 表单体传递 articleId（绝不在 URL query 传 ?articleId=，避免直连 :3000 时触发 menmen-ticket.js#L173 强制登出）
  function scheduleBackgroundSyncToMinio() {
    // 与 Blog ArticleSyncAuthRules.canManualSync、Plato canManualHedgedocSync 一致：无写权限时不调用 sync，避免 403 控制台噪音。
    // 冻结模式下仅管理员可手动 sync 时，宜从页面 bootstrap 注入 canSync（/article/{id}/access 或 sync-status），勿仅依赖 canCurrentUserEdit()。
    if (!canManualHedgedocSync()) return;
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(function () {
      var articleId = resolveArticleId();
      if (!articleId) return;
      var formParams = new URLSearchParams({ articleId: articleId });
      if (bootContext.lang) formParams.set('lang', bootContext.lang);
      var headers = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      };
      if (bootContext.token) headers['Authorization'] = bootContext.token;
      window.fetch(serverBaseUrl() + '/api/hedgedoc/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: formParams.toString()
      }).then(function (res) {
        if (res.status === 409 || res.status === 401 || res.status === 403) {
          // 409: 另一同步任务正持有 Redis 锁 article:sync:lock:{articleId}；401/403: 由退出编辑器或定时归档任务兜底
          return null;
        }
        return res;
      }).catch(function () {});
    }, 2000);
  }

  function handleExportedXmlSvg(svgDataUri) {
    var svgText;
    try {
      svgText = decodeSvgDataUriToText(svgDataUri);
    } catch (err) {
      console.error('[MenMen-Drawio] 解析导出的 SVG 失败:', err);
      dom.submitBtn.disabled = false;
      dom.submitLabel.textContent = state.mode === 'edit' ? '更新图表' : '插入';
      return;
    }

    state.isUploading = true;
    dom.submitLabel.textContent = '正在上传...';

    postSvgFormData(svgText, false)
      .then(function (data) {
        var newSvgUrl = data && (data.link || data.url || (data[0] && data[0].url));
        if (!newSvgUrl) throw new Error('上传响应缺少 link 字段');

        svgCache.set(normalizeSvgUrl(newSvgUrl), {
          isDrawio: true,
          xmlText: svgText
        });

        dom.submitLabel.textContent = '正在写入文档...';
        return ensureEditorWritableBeforeApply().then(function () {
          var applied = applySvgUrlToMarkdown(newSvgUrl);
          if (!applied) {
            state.isUploading = false;
            dom.submitBtn.disabled = false;
            dom.submitLabel.textContent = state.mode === 'edit' ? '重试写入' : '重试插入';
            window.prompt(
              '图表已上传成功，但当前编辑器处于只读、字数超限或离线状态未能自动写入。请复制以下 Markdown 手动粘贴，或待恢复后再次点击按钮：',
              '![drawio](' + newSvgUrl + ')'
            );
            return;
          }
          scheduleBackgroundSyncToMinio();
          forceCloseModal();
        });
      })
      .catch(function (err) {
        console.error('[MenMen-Drawio] 上传 SVG 失败:', err);
        state.isUploading = false;
        dom.submitBtn.disabled = false;
        dom.submitLabel.textContent = state.mode === 'edit' ? '更新图表' : '插入';
        window.alert('上传 Draw.io SVG 图表失败：' + err.message);
      });
  }

  // 双阶段触发分页列宽重算：80ms（乐观 DOM 更新后）与 280ms（index.js partialUpdate 异步替换 <p class="part"> 后）
  function notifyReaderFlipReflow() {
    if (
      document.body &&
      document.body.classList.contains('menmen-reader-paged') &&
      window.__menmenReaderFlip &&
      typeof window.__menmenReaderFlip.recalculate === 'function'
    ) {
      setTimeout(function () {
        if (window.__menmenReaderFlip && typeof window.__menmenReaderFlip.recalculate === 'function') {
          window.__menmenReaderFlip.recalculate(true);
        }
      }, 80);
      setTimeout(function () {
        if (window.__menmenReaderFlip && typeof window.__menmenReaderFlip.recalculate === 'function') {
          window.__menmenReaderFlip.recalculate(true);
        }
      }, 280);
    }
  }

  function resolveCreateInsertCursor(doc) {
    if (state.createCursorBookmark && typeof state.createCursorBookmark.find === 'function') {
      var bookmarked = state.createCursorBookmark.find();
      if (bookmarked) return bookmarked;
    }
    if (state.createCursorFallbackPos && typeof doc.lineCount === 'function') {
      var maxLine = Math.max(0, doc.lineCount() - 1);
      var safeLine = Math.min(Math.max(0, state.createCursorFallbackPos.line), maxLine);
      var lineStr = doc.getLine(safeLine) || '';
      var safeCh = Math.min(Math.max(0, state.createCursorFallbackPos.ch), lineStr.length);
      return { line: safeLine, ch: safeCh };
    }
    return doc.getCursor();
  }

  function optimisticallyUpdatePreviewImgs(oldUrl, newSvgUrl, occurrenceIdx) {
    if (state.editingImgEl) {
      state.editingImgEl.addEventListener('load', notifyReaderFlipReflow, { once: true });
      state.editingImgEl.src = newSvgUrl;
      markImgAsDrawioEditable(state.editingImgEl);
      return;
    }
    if (!oldUrl) {
      notifyReaderFlipReflow();
      return;
    }
    var oldNorm = normalizeSvgUrl(oldUrl);
    var imgs = document.querySelectorAll('#doc img, .markdown-body img');
    var matched = [];
    for (var i = 0; i < imgs.length; i++) {
      var rawSrc = imgs[i].getAttribute('src') || '';
      if (rawSrc && normalizeSvgUrl(rawSrc) === oldNorm) {
        matched.push(imgs[i]);
      }
    }
    if (matched.length > 0) {
      var idx = typeof occurrenceIdx === 'number' ? Math.min(occurrenceIdx, matched.length - 1) : 0;
      var targetImg = matched[Math.max(0, idx)];
      targetImg.addEventListener('load', notifyReaderFlipReflow, { once: true });
      targetImg.src = newSvgUrl;
      markImgAsDrawioEditable(targetImg);
    } else {
      notifyReaderFlipReflow();
    }
  }

  function applySvgUrlToMarkdown(newSvgUrl) {
    if (!canCurrentUserEdit()) return false;
    var cm = getCodeMirror();
    if (!cm) return false;

    var doc = cm.getDoc();
    var maxLength = typeof cm.getOption === 'function' ? cm.getOption('maxLength') : undefined;
    var beforeValue = doc.getValue();

    if (state.mode === 'edit' && state.saveStrategy !== 'save-as-new' && state.editingTargetUrl) {
      var targetRange = null;

      if (state.editingMarker) {
        targetRange = state.editingMarker.find();
      }
      if (!targetRange) {
        targetRange = locateSvgUrlRangeInEditor(cm, state.editingTargetUrl, {
          startLineHint: state.editingStartLineHint,
          endLineHint: state.editingEndLineHint,
          occurrenceIdx: state.editingOccurrenceIdx
        });
      }

      if (targetRange) {
        var oldLen = doc.getRange(targetRange.from, targetRange.to).length;
        if (typeof maxLength === 'number' && maxLength > 0 && (beforeValue.length - oldLen + newSvgUrl.length > maxLength)) {
          return false;
        }
        state.isApplyingChange = true;
        try {
          // 对齐 codemirror.inline-attachment.js#L35 粘贴图片的标准 '+input' 源标识
          doc.replaceRange(newSvgUrl, targetRange.from, targetRange.to, '+input');
        } finally {
          state.isApplyingChange = false;
        }
        if (doc.getValue().indexOf(newSvgUrl) === -1) {
          // 若被 index.js#L3386 enforceMaxLength 截断产生了半截残缺文本，立即回滚还原
          if (doc.getValue() !== beforeValue && typeof cm.undo === 'function') {
            try { cm.undo(); } catch (e) {}
          }
          return false;
        }
        optimisticallyUpdatePreviewImgs(state.editingTargetUrl, newSvgUrl, state.editingOccurrenceIdx);
        return true;
      }
    }

    // 优先使用打开弹框瞬间记录的 createCursorBookmark 书签坐标（经 CodeMirror OT 自动平移），次选 Clamped FallbackPos，彻底免疫 setValue 与 changeMode->restoreInfo 重置
    var cursor = resolveCreateInsertCursor(doc);
    var lineText = doc.getLine(cursor.line) || '';
    var prefix = lineText.trim().length > 0 ? '\n\n' : '';
    var suffix = '\n';
    var markdownSnippet = prefix + '![drawio](' + newSvgUrl + ')' + suffix;
    if (typeof maxLength === 'number' && maxLength > 0 && (beforeValue.length + markdownSnippet.length > maxLength)) {
      return false;
    }
    state.isApplyingChange = true;
    try {
      // 对齐 codemirror.inline-attachment.js#L35 粘贴图片的标准 '+input' 源标识
      doc.replaceRange(markdownSnippet, cursor, cursor, '+input');
    } finally {
      state.isApplyingChange = false;
    }
    if (doc.getValue().indexOf(newSvgUrl) === -1) {
      if (doc.getValue() !== beforeValue && typeof cm.undo === 'function') {
        try { cm.undo(); } catch (e) {}
      }
      return false;
    }
    notifyReaderFlipReflow();
    return true;
  }

  // =========================================================================
  // 8. 预览区 Draw.io SVG 探测、双击/触屏捕获与全局悬浮「[ ✎ 编辑图表 | 🔍 放大 ]」双动作胶囊
  // =========================================================================
  // 将源码中的历史局域网绝对 URL (如 http://192.168.x.x:9999/oss/resources/... 或 http://10.x.x.x:9000/blog/resources/...)
  // 转换为当前页面的同源路径 (/oss/resources/... 或 /uploads/...)，确保在纯编辑模式 (?edit) 下直接点击工具栏编辑旧图表时也能携带同源 Cookie 无 CORS 报错拉取
  function toSameOriginFetchSvgUrl(rawUrl) {
    var norm = normalizeSvgUrl(rawUrl);
    if (norm.indexOf('resources/') === 0) {
      return '/oss/' + norm;
    }
    try {
      var parsed = new URL(String(rawUrl || '').trim(), window.location.origin);
      if (parsed.pathname.indexOf('/oss/') === 0 || parsed.pathname.indexOf('/uploads/') === 0) {
        return parsed.pathname + parsed.search;
      }
    } catch (e) {}
    return rawUrl;
  }

  function fetchAndValidateDrawioSvg(svgUrl) {
    var norm = normalizeSvgUrl(svgUrl);
    if (svgCache.has(norm)) {
      return Promise.resolve(svgCache.get(norm));
    }
    if (svgProbeInflight.has(norm)) {
      return svgProbeInflight.get(norm);
    }

    var fetchUrl = toSameOriginFetchSvgUrl(svgUrl);
    var p = window.fetch(fetchUrl, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (svgText) {
        // 勿用 content=" 单独判定（普通 SVG metadata 会误判）；见 §一 #9
        var isDrawio =
          svgText.indexOf('<mxfile') !== -1 ||
          svgText.indexOf('&lt;mxfile') !== -1 ||
          svgText.indexOf('mxGraphModel') !== -1;
        var entry = { isDrawio: isDrawio, xmlText: svgText };
        svgCache.set(norm, entry);
        svgProbeInflight.delete(norm);
        return entry;
      })
      .catch(function (err) {
        svgProbeInflight.delete(norm);
        throw err;
      });

    svgProbeInflight.set(norm, p);
    return p;
  }

  function isProbiableSvgUrl(norm, rawSrc) {
    if (!norm) return false;
    if (
      norm.indexOf('resources/') === 0 ||
      norm.indexOf('/oss/') === 0 ||
      norm.indexOf('/uploads/') === 0 ||
      norm.indexOf('uploads/') === 0
    ) {
      return true;
    }
    try {
      var u = new URL(rawSrc, window.location.origin);
      return u.origin === window.location.origin && /\.svg$/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  // 当 index.js#L3742 partialUpdate() 将 <p class="part"> 替换为新 DOM 节点时，确保新 <img> 加载完成后同步触发分页列宽重算
  function markImgAsDrawioEditable(img) {
    if (!img) return;
    img.classList.add('menmen-drawio-editable');
    if (!img.complete && !img.dataset.drawioReflowBound) {
      img.dataset.drawioReflowBound = '1';
      img.addEventListener('load', notifyReaderFlipReflow, { once: true });
    }
  }

  function scanPreviewForDrawioImages(rootContainer) {
    var root = rootContainer || document;
    var imgs = root.querySelectorAll('.markdown-body img');
    if (!imgs.length) return;

    var occurrenceCounter = new Map();

    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var src = img.getAttribute('src') || '';
      if (!src) continue;
      var alt = (img.getAttribute('alt') || '').trim().toLowerCase();
      if (!/\.svg(?:$|[?#\s])/i.test(src) && alt.indexOf('drawio') !== 0) continue;

      var norm = normalizeSvgUrl(src);
      var occIdx = occurrenceCounter.get(norm) || 0;
      occurrenceCounter.set(norm, occIdx + 1);
      img.dataset.drawioOccIdx = String(occIdx);

      // svgCache 结论优先于 alt/文件名启发式（§一 #11）
      if (svgCache.has(norm)) {
        if (svgCache.get(norm).isDrawio) {
          markImgAsDrawioEditable(img);
        } else {
          img.classList.remove('menmen-drawio-editable');
        }
        continue;
      }

      if (alt.indexOf('drawio') === 0 || norm.toLowerCase().indexOf('drawio') !== -1) {
        markImgAsDrawioEditable(img);
        continue;
      }

      if (isProbiableSvgUrl(norm, src) && img.dataset.drawioProbed !== norm) {
        img.dataset.drawioProbed = norm;
        ;(function (targetImg, targetSrc) {
          fetchAndValidateDrawioSvg(targetSrc)
            .then(function (res) {
              if (res && res.isDrawio) {
                markImgAsDrawioEditable(targetImg);
              } else if (res) {
                targetImg.classList.remove('menmen-drawio-editable');
              }
            })
            .catch(function () {});
        })(img, src);
      }
    }
  }

  function extractLineHintsFromImg(imgEl) {
    if (!imgEl) return {};
    var partEl = imgEl.closest('[data-startline]');
    if (!partEl) return {};
    var s = parseInt(partEl.getAttribute('data-startline'), 10);
    var e = parseInt(partEl.getAttribute('data-endline'), 10);
    return {
      startLineHint: isNaN(s) ? undefined : Math.max(0, s - 1),
      endLineHint: isNaN(e) ? undefined : Math.max(0, e - 1)
    };
  }

  function ensureHoverPill() {
    if (dom.hoverPill) return dom.hoverPill;
    var pill = document.createElement('div');
    pill.className = 'menmen-drawio-hover-pill hidden-print';
    pill.hidden = true;
    pill.innerHTML =
      '<button type="button" class="menmen-drawio-pill-btn" data-pill-action="edit" title="打开 Draw.io 编辑此图表 (或直接双击图表)">' +
        '<i class="fa fa-pencil"></i> <span>编辑图表</span>' +
      '</button>' +
      '<span class="menmen-drawio-pill-divider" aria-hidden="true"></span>' +
      '<button type="button" class="menmen-drawio-pill-btn" data-pill-action="zoom" title="全屏放大查看图表细节">' +
        '<i class="fa fa-search-plus"></i> <span>放大</span>' +
      '</button>';

    // 阻止触控与鼠标按下事件冒泡，防止在分页模式下点击胶囊触发 menmen-reader-flip.js 的翻页热区
    var stopBubble = function (ev) { ev.stopPropagation(); };
    pill.addEventListener('touchstart', stopBubble, { passive: true });
    pill.addEventListener('touchend', stopBubble, { passive: true });
    pill.addEventListener('mousedown', stopBubble);

    pill.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-pill-action]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var targetImg = state.hoveredImgEl;
      if (!targetImg) return;
      var action = btn.getAttribute('data-pill-action');
      if (action === 'zoom') {
        hideHoverPill();
        if (window.__menmenImageLightbox && typeof window.__menmenImageLightbox.open === 'function') {
          window.__menmenImageLightbox.open(targetImg);
        }
        return;
      }
      var hints = extractLineHintsFromImg(targetImg);
      openDrawioForExistingSvg(targetImg.getAttribute('src'), {
        imgEl: targetImg,
        occurrenceIdx: parseInt(targetImg.dataset.drawioOccIdx || '0', 10) || 0,
        startLineHint: hints.startLineHint,
        endLineHint: hints.endLineHint
      });
    });

    document.body.appendChild(pill);
    dom.hoverPill = pill;
    return pill;
  }

  function showHoverPillForImg(imgEl) {
    if (!canCurrentUserEdit() || state.isOpen) return;
    var pill = ensureHoverPill();
    state.hoveredImgEl = imgEl;
    pill.hidden = false;
    var rect = imgEl.getBoundingClientRect();
    var pillWidth = pill.offsetWidth || 152;
    var minTop = getViewportMinTop();
    var desiredTop = Math.max(minTop + 8, Math.round(rect.top + 8));
    if (rect.bottom > minTop + 40) {
      desiredTop = Math.min(desiredTop, Math.round(rect.bottom - 36));
    }
    pill.style.top = Math.max(8, desiredTop) + 'px';
    pill.style.left = Math.max(8, Math.round(rect.right - pillWidth - 8)) + 'px';
  }

  function hideHoverPill() {
    if (dom.hoverPill) {
      dom.hoverPill.hidden = true;
    }
    state.hoveredImgEl = null;
  }

  // 在 window 捕获阶段拦截双击事件，早于 document (menmen-image-lightbox.browser.js) 与 #doc (menmen-image-lightbox.js)
  // 若目标图片位于已打开的灯箱 (.menmen-img-lightbox) 内部，则放行让灯箱执行原生双击关闭逻辑
  window.addEventListener('dblclick', function (e) {
    var target = e.target;
    if (!target || target.tagName !== 'IMG') return;
    if (target.closest && target.closest('.menmen-img-lightbox, .menmen-drawio-modal')) return;
    if (!target.classList.contains('menmen-drawio-editable')) return;
    if (!canCurrentUserEdit()) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    var hints = extractLineHintsFromImg(target);
    openDrawioForExistingSvg(target.getAttribute('src'), {
      imgEl: target,
      occurrenceIdx: parseInt(target.dataset.drawioOccIdx || '0', 10) || 0,
      startLineHint: hints.startLineHint,
      endLineHint: hints.endLineHint
    });
  }, true);

  document.addEventListener('mouseover', function (e) {
    var target = e.target;
    if (target && target.tagName === 'IMG' && target.classList.contains('menmen-drawio-editable')) {
      showHoverPillForImg(target);
      return;
    }
    if (target && target.closest && target.closest('.menmen-drawio-hover-pill')) {
      return;
    }
    if (state.hoveredImgEl) {
      hideHoverPill();
    }
  });

  // 支持平板/触屏设备（无 mouseover）轻点 Draw.io 图表呼出 [ ✎ 编辑图表 | 🔍 放大 ] 胶囊
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (target && target.tagName === 'IMG' && target.classList.contains('menmen-drawio-editable')) {
      if (canCurrentUserEdit() && !state.isOpen) {
        showHoverPillForImg(target);
      }
      return;
    }
    if (target && target.closest && target.closest('.menmen-drawio-hover-pill')) {
      return;
    }
    if (state.hoveredImgEl) {
      hideHoverPill();
    }
  });

  // 滚动时除隐藏悬浮胶囊外，若窄屏顶栏触发 $().showUp('.navbar') 自动收起/展开，同步对齐弹框上边界
  window.addEventListener('scroll', function () {
    hideHoverPill();
    if (state.isOpen && !state.isFullscreen) {
      syncModalBounds();
    }
  }, true);

  window.addEventListener('resize', function () {
    hideHoverPill();
    syncModalBounds();
  });

  // 监听浏览器原生全屏切换 (menmen-fullscreen.js) 与 HedgeDoc 视图模式切换 (changeMode)，多帧复核弹框几何尺寸
  var scheduleMultiFrameSyncBounds = function () {
    hideHoverPill();
    if (!state.isOpen) return;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(syncModalBounds);
    } else {
      syncModalBounds();
    }
    setTimeout(syncModalBounds, 60);
    setTimeout(syncModalBounds, 150);
  };
  document.addEventListener('fullscreenchange', scheduleMultiFrameSyncBounds);
  document.addEventListener('webkitfullscreenchange', scheduleMultiFrameSyncBounds);

  // 防止用户在 Draw.io 弹框内有未保存修改时误触浏览器刷新/关闭标签页
  window.addEventListener('beforeunload', function (e) {
    if (state.isOpen && state.isDirty && !state.isUploading) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // 在 window 捕获阶段处理快捷键 Ctrl+Alt+D、ESC、Ctrl+Alt+H 互斥拦截以及 Ctrl+Alt+E/V/B 视图切换跟随
  window.addEventListener('keydown', function (e) {
    var keyLower = String(e.key || '').toLowerCase();
    if (e.ctrlKey && e.altKey && keyLower === 'd') {
      if (canCurrentUserEdit()) {
        e.preventDefault();
        e.stopPropagation();
        onToolbarButtonClick();
      }
      return;
    }
    if (!state.isOpen) return;
    if (e.ctrlKey && e.altKey && (keyLower === 'e' || keyLower === 'v' || keyLower === 'b')) {
      scheduleMultiFrameSyncBounds();
      return;
    }
    if (e.ctrlKey && e.altKey && keyLower === 'h') {
      requestCloseModal();
      // 若用户在确认框中选择「取消」保留 Draw.io 弹框，则阻断 Ctrl+Alt+H 传向 menmen-editor-fix.js
      if (state.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      requestCloseModal();
    }
  }, true);

  // 在 window 捕获阶段（早于 menmen-editor-fix.js#L1161 的 document 监听）拦截 .menmen-ink-toggle 点击及顶栏视图切换按钮
  window.addEventListener('click', function (e) {
    if (!state.isOpen) return;
    if (e.target && e.target.closest) {
      if (e.target.closest('.menmen-ink-toggle')) {
        requestCloseModal();
        // 若用户在未保存确认框中点「取消」保留 Draw.io，必须阻断事件继续向下触发手写板 openPad()
        if (state.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }
        return;
      }
      if (e.target.closest('.ui-edit, .ui-view, .ui-both, .ui-mode, .menmen-view-layout-group')) {
        scheduleMultiFrameSyncBounds();
      }
    }
  }, true);

  // =========================================================================
  // 9. 初始化、分栏拖拽 ResizeObserver 跟随与对外暴露 API (window.__menmenDrawio)
  // =========================================================================
  function tryBindCodeMirrorCursorActivity() {
    if (state.cmListenerAttached) return;
    var cm = getCodeMirror();
    if (cm && typeof cm.on === 'function') {
      state.cmListenerAttached = true;
      cm.on('cursorActivity', updateToolbarButtonCursorHint);
      updateToolbarButtonCursorHint();
    }
  }

  function tryBindLayoutResizeObserver() {
    if (typeof window.ResizeObserver !== 'function') return;
    var ro = new window.ResizeObserver(function () {
      if (state.isOpen && !state.isFullscreen) {
        syncModalBounds();
      }
    });
    var editArea = document.querySelector('.ui-edit-area');
    var contentArea = document.querySelector('.ui-content');
    if (editArea) ro.observe(editArea);
    if (contentArea) ro.observe(contentArea);
  }

  function init() {
    ensureDrawioToolbarButton();
    scanPreviewForDrawioImages(document);
    tryBindCodeMirrorCursorActivity();
    tryBindLayoutResizeObserver();

    // 过滤 CodeMirror 高频打字/光标闪烁产生的内部 DOM 变更，并以 80ms 防抖合并执行，确保对现有编辑打字性能 0 影响
    var mutationScanTimer = null;
    var observer = new MutationObserver(function (mutations) {
      var shouldScan = false;
      for (var i = 0; i < mutations.length; i++) {
        var t = mutations[i].target;
        if (!t || !t.closest) {
          shouldScan = true;
          break;
        }
        if (!t.closest('.CodeMirror-lines, .CodeMirror-cursors, .CodeMirror-measure, .menmen-drawio-modal, .menmen-drawio-hover-pill')) {
          shouldScan = true;
          break;
        }
      }
      if (!shouldScan) return;
      if (mutationScanTimer) clearTimeout(mutationScanTimer);
      mutationScanTimer = setTimeout(function () {
        mutationScanTimer = null;
        ensureDrawioToolbarButton();
        scanPreviewForDrawioImages(document);
        tryBindCodeMirrorCursorActivity();
      }, 80);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__menmenDrawio = {
    isOpen: function () { return state.isOpen; },
    canEdit: canCurrentUserEdit,
    openCreate: openDrawioForCreate,
    openEdit: openDrawioForExistingSvg,
    close: requestCloseModal
  };
