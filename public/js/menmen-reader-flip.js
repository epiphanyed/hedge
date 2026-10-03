/**
 * 闷闷移动端精读翻页引擎 (Menmen-Reader-Flip)
 * 路径: hedge/public/js/menmen-reader-flip.js
 * 特性:
 * 1. 采用标准 CSS Multi-column 流式分列，零外部三方依赖
 * 2. ★ 动态根容器自适应 (getDocRoot): 完美兼顾只读视图 (#doc) 与协同视图 (.ui-view-area .markdown-body)
 * 3. ★ 视口固定双层立体书脊微阴影遮罩 (body::before) + 羊皮纸微杂色点阵 (彻底杜绝多页阴影丢失缺陷)
 * 4. ★ 复杂排版元素防断裂与长代码块横向隔离 (pre overflow-x: auto -webkit-overflow-scrolling: touch)
 * 5. 5 档字号 (14/16/18/20/24px) 动态调谐与视口首行块级元素锚点重排算法 (零文字跳屏)
 * 6. 单手拇指热区 (thumb 85% 广阔区域) 与标准三段式热区矩阵
 * 7. 墨水屏 0ms 瞬翻与平滑滑动手势矩阵 (支持滑动弹性阻尼 dx * 0.3)
 * 8. ★ 双通道通信与跨端消息适配 (同时支持 React Native WebView 与 Web iframe)
 * 9. 划词选区与翻页手势严格互斥仲裁 (选区 >= 5 字符挂起翻页)
 * 10. 深度阅读度量自动上报闭环 (阅读深度 >= 85% 且停留 >= 20s)
 * 11. 捕获拦截 TOC 目录锚点跳转，平滑转换为横向列带定位
 * 12. 与图片灯箱 (menmen-img-lightbox-open) 及墨迹画布协同避让
 * 13. MathJax / KaTeX 异步排版与 OT MutationObserver 锚点稳定器算法
 * 14. ★ CSP Nonce 动态安全探测与继承 (getCspNonce)
 */
(function menmenReaderFlipEngine() {
  'use strict';

  var currentPage = 0;
  var totalPages = 1;
  var isReaderActive = false;
  var currentTheme = 'light';
  var currentFontSize = 16;
  var tapMode = 'standard'; // 'standard' | 'thumb'
  var transitionMode = 'slide'; // 'slide' | 'none' | 'curl'

  var touchStartX = 0;
  var touchStartY = 0;
  var currentDeltaX = 0;
  var isTouching = false;
  var hasSwiped = false;
  var resizeTimer = null;
  var hudElement = null;
  var readingStartTime = Date.now();
  var depthReported = false;
  var currentAnchorElement = null;
  var engineBypassed = false;
  var freezeColumnsRecalculation = false;
  var viewportBaselineHeight = 0;
  var paginatingFlag = false;
  var longPressTimer = null;
  var isLongPressCandidate = false;
  var printSavedPage = 0;
  var printWasActive = false;
  var imgHoldTimer = null;
  var imgHoldActive = false;
  var hostDegraded = false;
  var lightboxFuseReady = false;

  var SWIPE_THRESHOLD_RATIO = 0.22; // 滑动超过 22% 屏幕触发翻页
  var MIN_SELECTION_LENGTH = 5;
  var EDGE_GESTURE_MARGIN = 16;
  var LONG_PRESS_MS = 350;
  var IMG_HOLD_MS = 500;
  var OT_RECALC_DEBOUNCE_MS = 350;
  var lastHudBridgePost = { current: -1, total: -1, percent: -1 };
  var readingActiveMs = 0;
  var readingVisibleSince = null;

  function isMobileUa() {
    try {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
        navigator.userAgent || ''
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * 动态探测获取正文根容器：
   * 1. 协同编辑/预览视图：.ui-view-area .markdown-body
   * 2. 只读发布视图：#doc.markdown-body
   */
  function getDocRoot() {
    return document.querySelector('.ui-view-area .markdown-body') ||
           document.getElementById('doc') ||
           document.querySelector('.markdown-body');
  }

  /**
   * 动态获取页面中已存在的 CSP nonce，防止在严格策略下注入失败
   */
  function getCspNonce() {
    var script = document.querySelector('script[nonce]');
    return script ? (script.nonce || script.getAttribute('nonce') || '') : '';
  }

  /**
   * 宿主双通道通用通信信道：
   * 1. React Native 原生 WebView (iOS / Android)
   * 2. Web / iframe 父子通信 (浏览器 / Electron)
   */
  function postToHost(message) {
    try {
      var payload = typeof message === 'string' ? message : JSON.stringify(message);
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent && window.parent !== window) {
        var targetOrigin = '*';
        try {
          if (window.__menmenHostOrigin) {
            targetOrigin = window.__menmenHostOrigin;
          } else if (document.referrer) {
            targetOrigin = new URL(document.referrer).origin;
          }
        } catch (originErr) { /* keep '*' fallback */ }
        window.parent.postMessage(message, targetOrigin);
      }
    } catch (e) {
      /* ignore bridge error */
    }
  }

  function getEffectiveSelectionText() {
    try {
      return (window.getSelection && window.getSelection().toString().trim()) || '';
    } catch (e) {
      return '';
    }
  }

  function isSlideDocument() {
    if (document.querySelector('.reveal')) return true;
    if (document.body && document.body.classList.contains('slides')) return true;
    return false;
  }

  function isModalOpen() {
    if (document.body && document.body.classList.contains('modal-open')) return true;
    if (document.querySelector('.modal.show, .modal.in')) return true;
    return false;
  }

  function isInkOverlayOpen() {
    try {
      return !!(window.__menmenInk && typeof window.__menmenInk.isOpen === 'function' && window.__menmenInk.isOpen());
    } catch (e) {
      return false;
    }
  }

  function isFlipCircuitBroken() {
    if (isModalOpen()) return true;
    if (isInkOverlayOpen()) return true;
    if (document.body && document.body.classList.contains('menmen-img-lightbox-open')) return true;
    if (isLongPressCandidate) return true;
    return false;
  }

  function isExcludedInteractiveElement(target) {
    if (!target) return false;
    if (isFlipCircuitBroken()) return true;
    if (target.closest && target.closest('.menmen-ink-pad, .menmen-ink-overlay, .menmen-img-lightbox, .menmen-card-shell, .menmen-card-tab, .menmen-table-scroller, .menmen-geo3d-toolbar, .menmen-geo3d-viewport, .geo3d-container')) return true;
    return false;
  }

  function clearLongPressTimer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function clearImgHoldTimer() {
    if (imgHoldTimer) {
      clearTimeout(imgHoldTimer);
      imgHoldTimer = null;
    }
  }

  function resolveUrlHashTargetPage() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return null;
    var id = decodeURIComponent(hash.slice(1));
    var targetEl = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
    if (!targetEl) return null;
    var pageWidth = getPageWidth();
    return Math.max(0, Math.floor(targetEl.offsetLeft / pageWidth));
  }

  function scheduleTwoPhaseRecalibration() {
    if (!isReaderActive) return;
    if (document.body) document.body.classList.add('menmen-reader-recalibrating');
    var anchor = currentAnchorElement || findFirstVisibleBlock();
    var ran = false;
    function finish() {
      if (!isReaderActive || ran) return;
      ran = true;
      if (document.body) document.body.classList.remove('menmen-reader-recalibrating');
      recalculatePages(true);
      if (anchor && anchor.parentNode) {
        var pageWidth = getPageWidth();
        currentPage = Math.max(0, Math.min(Math.floor(anchor.offsetLeft / pageWidth), totalPages - 1));
        applyPageTransform(false);
        updateHud();
      }
    }
    setTimeout(finish, 150);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(finish).catch(function () { /* ignore */ });
    }
    if (window.MathJax && window.MathJax.Hub) {
      window.MathJax.Hub.Queue(finish);
    }
    if (typeof window.menmenScheduleMathTypeset === 'function') {
      window.menmenScheduleMathTypeset();
    }
  }

  function applyInitialNavigationFromUrl() {
    var hashPage = resolveUrlHashTargetPage();
    if (hashPage != null) {
      flipTo(hashPage);
      return true;
    }
    var params = new URLSearchParams(window.location.search);
    var pageParam = params.get('page');
    if (pageParam) {
      flipTo(Math.max(0, Number(pageParam) - 1));
      scheduleTwoPhaseRecalibration();
      return true;
    }
    var percentParam = params.get('percent');
    if (percentParam != null && percentParam !== '') {
      var targetP = Math.round((Number(percentParam) / 100) * totalPages) - 1;
      flipTo(Math.max(0, targetP));
      scheduleTwoPhaseRecalibration();
      return true;
    }
    return false;
  }

  function setupHashNavigation() {
    window.addEventListener('hashchange', function onHashChange() {
      if (!isReaderActive) return;
      try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
      var p = resolveUrlHashTargetPage();
      if (p != null) flipTo(p);
    });
  }

  function isSystemEdgeGesture(clientX) {
    var w = window.innerWidth || document.documentElement.clientWidth || 360;
    return clientX < EDGE_GESTURE_MARGIN || clientX > w - EDGE_GESTURE_MARGIN;
  }

  // ★ 超长表格单页微包裹引擎（自动创建水平滚动隔离容器）
  function wrapTablesForOverflow() {
    var doc = getDocRoot();
    if (!doc) return;
    var tables = doc.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var tbl = tables[i];
      if (tbl.parentNode && !tbl.parentNode.classList.contains('menmen-table-scroller')) {
        var wrap = document.createElement('div');
        wrap.className = 'menmen-table-scroller';
        tbl.parentNode.insertBefore(wrap, tbl);
        wrap.appendChild(tbl);
      }
    }
  }

  function injectPaginationStyles() {
    var styleId = 'menmen-reader-flip-styles';
    if (document.getElementById(styleId)) return;

    var css = [
      '/* 视口与 Body 锁定 */',
      'html.menmen-reader-paged,',
      'body.menmen-reader-paged {',
      '  overflow: hidden !important;',
      '  width: 100vw !important;',
      '  height: 100vh !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  position: fixed !important;',
      '  top: 0 !important;',
      '  left: 0 !important;',
      '  touch-action: pan-y !important;',
      '  overscroll-behavior: none !important;',
      '  user-select: text !important;',
      '  -webkit-user-select: text !important;',
      '  -webkit-font-smoothing: antialiased;',
      '  background-color: #f2f3f5;',
      '}',
      '/* 隐藏干扰协同工具栏、编辑区分栏及全屏按钮 */',
      'body.menmen-reader-paged .ui-infobar,',
      'body.menmen-reader-paged .navbar,',
      'body.menmen-reader-paged .ui-edit-area,',
      'body.menmen-reader-paged .ui-view-area > .ui-toc,',
      'body.menmen-reader-paged .ui-toc-affix {',
      '  display: none !important;',
      '}',
      '/* 协同视图容器撑满视口并隐藏滚动条 */',
      'body.menmen-reader-paged .ui-content,',
      'body.menmen-reader-paged .ui-view-area {',
      '  width: 100vw !important;',
      '  height: 100vh !important;',
      '  max-width: 100vw !important;',
      '  position: fixed !important;',
      '  inset: 0 !important;',
      '  overflow: hidden !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '}',
      '/* CSS Multi-column 核心分列容器（兼顾 #doc 与 .ui-view-area .markdown-body） */',
      'body.menmen-reader-paged #doc,',
      'body.menmen-reader-paged .ui-view-area .markdown-body,',
      'body.menmen-reader-paged .ui-content .markdown-body {',
      '  column-width: 100vw !important;',
      '  column-gap: 0px !important;',
      '  column-fill: auto !important;',
      '  height: calc(100vh - 36px - env(safe-area-inset-bottom, 0px)) !important;',
      '  max-height: calc(100vh - 36px - env(safe-area-inset-bottom, 0px)) !important;',
      '  box-sizing: border-box !important;',
      '  padding-top: max(16px, env(safe-area-inset-top, 0px)) !important;',
      '  padding-bottom: max(20px, calc(16px + env(safe-area-inset-bottom, 0px))) !important;',
      '  padding-left: max(20px, env(safe-area-inset-left, 0px)) !important;',
      '  padding-right: max(20px, env(safe-area-inset-right, 0px)) !important;',
      '  margin: 0 !important;',
      '  width: 100vw !important;',
      '  max-width: 100vw !important;',
      '  transform: translate3d(0, 0, 0);',
      '  transition: transform 0.28s cubic-bezier(0.25, 1, 0.5, 1);',
      '  will-change: transform;',
      '  background-color: transparent !important;',
      '}',
      '/* 复杂排版元素防撕裂断页约束 */',
      'body.menmen-reader-paged table,',
      'body.menmen-reader-paged blockquote,',
      'body.menmen-reader-paged h1,',
      'body.menmen-reader-paged h2,',
      'body.menmen-reader-paged h3,',
      'body.menmen-reader-paged h4,',
      'body.menmen-reader-paged h5,',
      'body.menmen-reader-paged h6,',
      'body.menmen-reader-paged .menmen-card-shell {',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '  max-width: 100% !important;',
      '  box-sizing: border-box !important;',
      '}',
      '/* 超长表格单页微包裹水平滑动隔离（防撑裂列排版） */',
      'body.menmen-reader-paged .menmen-table-scroller {',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '  max-width: 100% !important;',
      '  overflow-x: auto !important;',
      '  overflow-y: hidden !important;',
      '  -webkit-overflow-scrolling: touch !important;',
      '  margin: 12px 0 !important;',
      '}',
      '/* 协同编辑光标与干扰选区静默脱敏 */',
      'body.menmen-reader-paged .ui-cursor,',
      'body.menmen-reader-paged .CodeMirror-cursor,',
      'body.menmen-reader-paged .ui-selection {',
      '  display: none !important;',
      '  opacity: 0 !important;',
      '}',
      '/* 多模态多媒体（视频/Iframe/Mermaid/SVG/学术扩展）单页防撕裂与 GPU 独立合成 */',
      'body.menmen-reader-paged iframe,',
      'body.menmen-reader-paged video,',
      'body.menmen-reader-paged embed,',
      'body.menmen-reader-paged .mermaid,',
      'body.menmen-reader-paged .viz-graph,',
      'body.menmen-reader-paged .sequence-diagram,',
      'body.menmen-reader-paged .menmen-card-shell {',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '  max-width: 100% !important;',
      '  box-sizing: border-box !important;',
      '  transform: translateZ(0);',
      '  will-change: transform;',
      '}',
      'body.menmen-reader-paged iframe[src*="bilibili"],',
      'body.menmen-reader-paged iframe[src*="youtube"] {',
      '  aspect-ratio: 16 / 9;',
      '  max-height: calc(100vh - 160px) !important;',
      '}',
      '/* 超长数学公式单页独立横滑隔离（防跨列穿透劈裂） */',
      'body.menmen-reader-paged .katex-display,',
      'body.menmen-reader-paged .MathJax_Display {',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '  max-width: 100% !important;',
      '  box-sizing: border-box !important;',
      '  overflow-x: auto !important;',
      '  overflow-y: hidden !important;',
      '  -webkit-overflow-scrolling: touch !important;',
      '  margin: 10px 0 !important;',
      '  padding: 4px 0 !important;',
      '}',
      '/* 长代码块独立水平横滑隔离（防越界穿透） */',
      'body.menmen-reader-paged pre {',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '  max-width: 100% !important;',
      '  box-sizing: border-box !important;',
      '  white-space: pre !important;',
      '  overflow-x: auto !important;',
      '  -webkit-overflow-scrolling: touch;',
      '}',
      '/* 图片自适应视口高度，防纵向截断 */',
      'body.menmen-reader-paged img {',
      '  display: block !important;',
      '  margin: 8px auto !important;',
      '  max-width: 100% !important;',
      '  max-height: calc(100vh - 120px) !important;',
      '  object-fit: contain !important;',
      '  break-inside: avoid !important;',
      '  page-break-inside: avoid !important;',
      '}',
      '/* ★ 视口固定双层书脊中缝立体阴影遮罩 (永驻视口左右两侧) */',
      'body.menmen-reader-paged.menmen-reader-paper::before {',
      '  content: "";',
      '  position: fixed;',
      '  inset: 0;',
      '  pointer-events: none;',
      '  z-index: 10;',
      '  box-shadow: inset 10px 0 20px -8px rgba(90, 75, 55, 0.18), inset -8px 0 16px -8px rgba(90, 75, 55, 0.08);',
      '}',
      '/* 仿真羊皮纸护眼色标与周期性微点阵 */',
      'body.menmen-reader-paged.menmen-reader-paper {',
      '  background-color: #f6f1e7 !important;',
      '  background-image: radial-gradient(#ebe3d5 0.75px, transparent 0.75px) !important;',
      '  background-size: 12px 12px !important;',
      '  color: #2c2824 !important;',
      '}',
      '/* 纸质出版级代码块容器与古籍线装细边 */',
      'body.menmen-reader-paged.menmen-reader-paper pre,',
      'body.menmen-reader-paged.menmen-reader-paper code {',
      '  background-color: #ede6d8 !important;',
      '  color: #3d352a !important;',
      '  border: 1px solid #ded5c2 !important;',
      '  border-radius: 4px;',
      '}',
      '/* 纸质出版级低饱和度墨色语法高亮映射 */',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-keyword,',
      'body.menmen-reader-paged.menmen-reader-paper .token.keyword { color: #235a82 !important; font-weight: 600; }',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-string,',
      'body.menmen-reader-paged.menmen-reader-paper .token.string { color: #9c3826 !important; }',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-comment,',
      'body.menmen-reader-paged.menmen-reader-paper .token.comment { color: #8c8273 !important; font-style: italic; }',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-title,',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-function,',
      'body.menmen-reader-paged.menmen-reader-paper .token.function { color: #6b387a !important; }',
      'body.menmen-reader-paged.menmen-reader-paper .hljs-number,',
      'body.menmen-reader-paged.menmen-reader-paper .token.number { color: #9e5917 !important; }',
      'body.menmen-reader-paged.menmen-reader-paper blockquote {',
      '  border-left-color: #b27a3b !important;',
      '  background-color: rgba(237, 230, 216, 0.45) !important;',
      '  color: #5c5244 !important;',
      '}',
      '/* ★ 夜间暖棕羊皮纸主题 (Night Sepia - 柔和护眼零蓝光) */',
      'body.menmen-reader-paged.menmen-reader-night-paper::before {',
      '  content: "";',
      '  position: fixed;',
      '  inset: 0;',
      '  pointer-events: none;',
      '  z-index: 10;',
      '  box-shadow: inset 10px 0 24px -6px rgba(0, 0, 0, 0.45), inset -8px 0 18px -6px rgba(0, 0, 0, 0.35);',
      '}',
      'body.menmen-reader-paged.menmen-reader-night-paper {',
      '  background-color: #221d18 !important;',
      '  background-image: radial-gradient(#2d2620 0.8px, transparent 0.8px) !important;',
      '  background-size: 14px 14px !important;',
      '  color: #d6cdbe !important;',
      '}',
      'body.menmen-reader-paged.menmen-reader-night-paper pre,',
      'body.menmen-reader-paged.menmen-reader-night-paper code {',
      '  background-color: #1a1612 !important;',
      '  color: #c4baa7 !important;',
      '  border: 1px solid #362e26 !important;',
      '}',
      'body.menmen-reader-paged.menmen-reader-night-paper .hljs-keyword { color: #6ba8d6 !important; }',
      'body.menmen-reader-paged.menmen-reader-night-paper .hljs-string { color: #d67a65 !important; }',
      'body.menmen-reader-paged.menmen-reader-night-paper .hljs-comment { color: #7f7466 !important; font-style: italic; }',
      'body.menmen-reader-paged.menmen-reader-night-paper img,',
      'body.menmen-reader-paged.menmen-reader-night-paper video,',
      'body.menmen-reader-paged.ui-night img,',
      'body.menmen-reader-paged.ui-night video {',
      '  filter: brightness(0.85) !important;',
      '}',
      'body.menmen-reader-paged pre.hljs-line-numbers,',
      'body.menmen-reader-paged .hljs-line-numbers {',
      '  white-space: pre !important;',
      '  word-break: normal !important;',
      '}',
      'body.menmen-reader-paged.menmen-reader-recalibrating #doc,',
      'body.menmen-reader-paged.menmen-reader-recalibrating .ui-view-area .markdown-body {',
      '  opacity: 0.96;',
      '  transition: opacity 0.12s ease;',
      '}',
      '/* 打印/PDF 导出：取消分列与 HUD，连续垂直平铺 */',
      '@media print {',
      '  body.menmen-reader-print-flatten #doc,',
      '  body.menmen-reader-print-flatten .ui-view-area .markdown-body {',
      '    column-width: auto !important;',
      '    height: auto !important;',
      '    max-height: none !important;',
      '    transform: none !important;',
      '    overflow: visible !important;',
      '  }',
      '  body.menmen-reader-print-flatten .menmen-flip-hud,',
      '  body.menmen-reader-print-flatten::before { display: none !important; }',
      '}',
      '/* ★ 墨水屏黑白极致模式 (E-Ink Monochrome - 0 阴影/0 渐变/0 动效纯刷) */',
      'body.menmen-reader-paged.menmen-reader-e-ink::before { display: none !important; }',
      'body.menmen-reader-paged.menmen-reader-e-ink {',
      '  background: #ffffff !important;',
      '  color: #000000 !important;',
      '  filter: grayscale(100%) contrast(125%) !important;',
      '}',
      'body.menmen-reader-paged.menmen-reader-e-ink pre,',
      'body.menmen-reader-paged.menmen-reader-e-ink code {',
      '  background: #f4f4f4 !important;',
      '  color: #000000 !important;',
      '  border: 1px solid #000000 !important;',
      '}',
      '/* 翻页底部极简 HUD 指示器（融入全面屏 Home Bar 避让） */',
      '.menmen-flip-hud {',
      '  position: fixed;',
      '  bottom: 0;',
      '  left: 0;',
      '  width: 100vw;',
      '  height: calc(36px + env(safe-area-inset-bottom, 0px));',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding-left: max(16px, env(safe-area-inset-left, 0px));',
      '  padding-right: max(16px, env(safe-area-inset-right, 0px));',
      '  padding-bottom: env(safe-area-inset-bottom, 0px);',
      '  box-sizing: border-box;',
      '  background: rgba(255, 255, 255, 0.88);',
      '  backdrop-filter: blur(12px);',
      '  -webkit-backdrop-filter: blur(12px);',
      '  border-top: 1px solid rgba(0, 0, 0, 0.08);',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  color: #64748b;',
      '  z-index: 9999;',
      '  pointer-events: none;',
      '}',
      'body.ui-night .menmen-flip-hud {',
      '  background: rgba(15, 23, 42, 0.88);',
      '  border-top: 1px solid rgba(255, 255, 255, 0.1);',
      '  color: #94a3b8;',
      '}',
      'body.menmen-reader-paper .menmen-flip-hud {',
      '  background: rgba(246, 241, 231, 0.92);',
      '  border-top: 1px solid rgba(90, 75, 55, 0.15);',
      '  color: #7c7263;',
      '}',
      'body.menmen-reader-night-paper .menmen-flip-hud {',
      '  background: rgba(34, 29, 24, 0.94);',
      '  border-top: 1px solid rgba(255, 255, 255, 0.1);',
      '  color: #a39785;',
      '}',
      'body.menmen-reader-e-ink .menmen-flip-hud {',
      '  background: #ffffff !important;',
      '  border-top: 1px solid #000000 !important;',
      '  color: #000000 !important;',
      '  backdrop-filter: none !important;',
      '}',
      '/* 分页模式右上角：退出 + 视图切换（样式内联注入，不依赖 menmen-custom.css 缓存） */',
      'body.menmen-reader-paged .menmen-paged-layout-dock {',
      '  position: fixed;',
      '  top: max(8px, env(safe-area-inset-top, 0px));',
      '  right: max(12px, env(safe-area-inset-right, 0px));',
      '  z-index: 10001;',
      '  pointer-events: auto;',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  justify-content: flex-end;',
      '  gap: 6px;',
      '  max-width: calc(100vw - 24px);',
      '}',
      'body.menmen-reader-paged .menmen-paged-layout-dock .menmen-view-layout-group {',
      '  display: inline-flex !important;',
      '}',
      'body.menmen-reader-paged .menmen-paged-layout-dock .menmen-view-layout-btn,',
      'body.menmen-reader-paged .menmen-paged-layout-dock .menmen-paged-exit-btn {',
      '  background: rgba(255, 255, 255, 0.92);',
      '  backdrop-filter: blur(10px);',
      '  -webkit-backdrop-filter: blur(10px);',
      '  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);',
      '  font-size: 13px;',
      '  padding: 6px 12px;',
      '  white-space: nowrap;',
      '}',
      'body.menmen-reader-paged.ui-night .menmen-paged-layout-dock .menmen-view-layout-btn,',
      'body.menmen-reader-paged.ui-night .menmen-paged-layout-dock .menmen-paged-exit-btn {',
      '  background: rgba(15, 23, 42, 0.88);',
      '  color: #e2e8f0;',
      '}',
      '/* 边缘阻尼弹性回弹微 Toast */',
      '.menmen-flip-toast {',
      '  position: fixed;',
      '  top: 50%;',
      '  left: 50%;',
      '  transform: translate(-50%, -50%);',
      '  padding: 8px 16px;',
      '  background: rgba(0, 0, 0, 0.75);',
      '  color: #ffffff;',
      '  font-size: 13px;',
      '  border-radius: 20px;',
      '  pointer-events: none;',
      '  z-index: 10002;',
      '  opacity: 0;',
      '  transition: opacity 0.2s ease;',
      '}',
      '.menmen-flip-toast.active { opacity: 1; }'
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.type = 'text/css';

    var nonce = getCspNonce();
    if (nonce) {
      styleEl.nonce = nonce;
      styleEl.setAttribute('nonce', nonce);
    }

    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);
  }

  function getPageWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 360;
  }

  function findFirstVisibleBlock() {
    var doc = getDocRoot();
    if (!doc) return null;
    var pageWidth = getPageWidth();
    var currentLeft = currentPage * pageWidth;

    var blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, pre, table, blockquote');
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i];
      if (el.offsetLeft >= currentLeft - 10) {
        return el;
      }
    }
    return null;
  }

  function recalculatePages(keepAnchor) {
    var doc = getDocRoot();
    if (!doc || !isReaderActive) return;
    if (freezeColumnsRecalculation) return;

    paginatingFlag = true;
    try {
      var pageWidth = getPageWidth();
      var scrollW = doc.scrollWidth;
      totalPages = Math.max(1, Math.ceil(scrollW / pageWidth));

      // 锚点元素对齐：如果提供了锚点且公式/字号排版完毕，优先根据锚点校准页码
      if (keepAnchor && currentAnchorElement && currentAnchorElement.parentNode) {
        var anchorLeft = currentAnchorElement.offsetLeft;
        currentPage = Math.max(0, Math.min(Math.floor(anchorLeft / pageWidth), totalPages - 1));
      } else if (currentPage >= totalPages) {
        currentPage = totalPages - 1;
      }

      wrapTablesForOverflow();
      applyPageTransform(false);
      updateHud();
      checkReadingDepth();
    } finally {
      paginatingFlag = false;
    }
  }

  function applyPageTransform(animated, customOffset) {
    var doc = getDocRoot();
    if (!doc) return;

    var pageWidth = getPageWidth();
    var baseOffset = -currentPage * pageWidth;
    var finalOffset = customOffset !== undefined ? baseOffset + customOffset : baseOffset;

    if (transitionMode === 'none') {
      doc.style.transition = 'none';
    } else {
      doc.style.transition = animated ? 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
    }

    doc.style.transform = 'translate3d(' + finalOffset + 'px, 0, 0)';
    currentAnchorElement = findFirstVisibleBlock();
  }

  function updateHud() {
    if (!hudElement && isReaderActive) {
      hudElement = document.createElement('div');
      hudElement.className = 'menmen-flip-hud';
      hudElement.setAttribute('role', 'status');
      hudElement.setAttribute('aria-live', 'polite');
      document.body.appendChild(hudElement);
    }
    if (!hudElement) return;

    var percent = Math.min(100, Math.round(((currentPage + 1) / totalPages) * 100));
    hudElement.setAttribute('aria-label', '第 ' + (currentPage + 1) + ' 页，共 ' + totalPages + ' 页');
    hudElement.innerHTML = [
      '<span>第 ' + (currentPage + 1) + ' / ' + totalPages + ' 页</span>',
      '<span>' + percent + '%</span>'
    ].join('');

    var bridgeCurrent = currentPage + 1;
    if (
      lastHudBridgePost.current !== bridgeCurrent ||
      lastHudBridgePost.total !== totalPages ||
      lastHudBridgePost.percent !== percent
    ) {
      lastHudBridgePost.current = bridgeCurrent;
      lastHudBridgePost.total = totalPages;
      lastHudBridgePost.percent = percent;
      postToHost({
        type: 'menmen-hedgedoc-page-change',
        current: bridgeCurrent,
        total: totalPages,
        percent: percent
      });
    }
  }

  function accumulateReadingVisibleTime() {
    if (readingVisibleSince != null) {
      readingActiveMs += Date.now() - readingVisibleSince;
      readingVisibleSince = null;
    }
  }

  var DEPTH_QUEUE_KEY = '@menmen:offline_depth_queue';
  var DEPTH_ACK_RETRY_MS = 12000;
  /** 无宿主 Ack 熔断上限；Plato 契约：plato/__tests__/readerFlipAcceptanceMatrix.contract.test.ts #11 */
  var DEPTH_ACK_MAX_RETRIES = 5;
  var depthAckRetryTimer = null;
  var depthAckBackoffMs = DEPTH_ACK_RETRY_MS;

  function newDepthEventId() {
    return 'depth_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function readDepthQueue() {
    try {
      var raw = localStorage.getItem(DEPTH_QUEUE_KEY);
      var queue = raw ? JSON.parse(raw) : [];
      return Array.isArray(queue) ? queue : [];
    } catch (e) {
      return [];
    }
  }

  function writeDepthQueue(queue) {
    try {
      if (!queue || !queue.length) {
        localStorage.removeItem(DEPTH_QUEUE_KEY);
      } else {
        localStorage.setItem(DEPTH_QUEUE_KEY, JSON.stringify(queue.slice(-50)));
      }
    } catch (e) { /* ignore */ }
  }

  function acknowledgeDepthEvent(eventId) {
    if (!eventId) return;
    var next = readDepthQueue().filter(function (item) {
      return item && item.eventId !== eventId;
    });
    writeDepthQueue(next);
    depthAckBackoffMs = DEPTH_ACK_RETRY_MS;
    if (next.length && !depthAckRetryTimer) {
      scheduleDepthAckRetry();
    }
  }

  function pruneExhaustedDepthQueue() {
    var queue = readDepthQueue();
    var valid = queue.filter(function (item) {
      return item && (item.ackAttempts || 0) < DEPTH_ACK_MAX_RETRIES;
    });
    if (valid.length !== queue.length) {
      writeDepthQueue(valid);
    }
    return valid;
  }

  function scheduleDepthAckRetry() {
    var valid = pruneExhaustedDepthQueue();
    if (!valid.length) {
      if (depthAckRetryTimer) {
        clearTimeout(depthAckRetryTimer);
        depthAckRetryTimer = null;
      }
      depthAckBackoffMs = DEPTH_ACK_RETRY_MS;
      return;
    }
    if (depthAckRetryTimer) return;
    depthAckRetryTimer = setTimeout(function () {
      depthAckRetryTimer = null;
      flushDepthQueueToHost();
    }, depthAckBackoffMs);
  }

  function enqueueDepthReport(payload) {
    var queue = readDepthQueue();
    var exists = queue.some(function (item) {
      return item && item.eventId === payload.eventId;
    });
    if (!exists) {
      queue.push(payload);
      writeDepthQueue(queue);
    }
  }

  function postDepthReport(payload) {
    if (!payload.eventId) payload.eventId = newDepthEventId();
    enqueueDepthReport(payload);
    postToHost(payload);
    scheduleDepthAckRetry();
  }

  function flushDepthQueueToHost() {
    var queue = readDepthQueue();
    if (!queue.length) return;
    var retained = [];
    queue.forEach(function (item) {
      if (!item || item.type !== 'menmen-reading-depth-reached') return;
      var attempts = (item.ackAttempts || 0) + 1;
      if (attempts > DEPTH_ACK_MAX_RETRIES) {
        try {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[menmen-reader-flip] depth report dropped after max ack retries:', item.eventId);
          }
        } catch (e) { /* ignore */ }
        return;
      }
      item.ackAttempts = attempts;
      retained.push(item);
      postToHost(item);
    });
    writeDepthQueue(retained);
    if (retained.length) {
      depthAckBackoffMs = Math.min(depthAckBackoffMs * 2, 96000);
      scheduleDepthAckRetry();
    } else {
      depthAckBackoffMs = DEPTH_ACK_RETRY_MS;
    }
  }

  function checkReadingDepth() {
    if (depthReported) return;
    var percent = ((currentPage + 1) / totalPages) * 100;
    if (typeof document !== 'undefined' && document.hidden && readingVisibleSince != null) {
      accumulateReadingVisibleTime();
    } else if (readingVisibleSince == null && !(typeof document !== 'undefined' && document.hidden)) {
      readingVisibleSince = Date.now();
    }
    var liveMs = readingActiveMs + (readingVisibleSince != null ? Date.now() - readingVisibleSince : 0);
    var durationSec = liveMs / 1000;
    if (percent >= 85 && durationSec >= 20) {
      depthReported = true;
      postDepthReport({
        type: 'menmen-reading-depth-reached',
        eventId: newDepthEventId(),
        percent: Math.round(percent),
        duration: Math.round(durationSec),
        timestamp: Date.now()
      });
    }
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function onReadingVisibilityChange() {
      if (!isReaderActive) return;
      if (document.hidden) {
        accumulateReadingVisibleTime();
      } else {
        readingVisibleSince = Date.now();
      }
    });
  }

  // 网络恢复：重置熔断计数后兜底探测一次（无宿主独立打开 HD 时不永久 12s 定时重试）
  function probeDepthQueueOnOnline() {
    var queue = readDepthQueue();
    if (!queue.length) return;
    var revived = queue.map(function (item) {
      if (!item) return item;
      var copy = {};
      for (var k in item) {
        if (Object.prototype.hasOwnProperty.call(item, k)) copy[k] = item[k];
      }
      copy.ackAttempts = 0;
      return copy;
    });
    writeDepthQueue(revived);
    depthAckBackoffMs = DEPTH_ACK_RETRY_MS;
    flushDepthQueueToHost();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function onOnlineFlush() {
      probeDepthQueueOnOnline();
    });
    if (readDepthQueue().length) {
      scheduleDepthAckRetry();
    }
  }

  var toastTimer = null;
  function showToast(text) {
    var toast = document.querySelector('.menmen-flip-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'menmen-flip-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('active');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('active');
    }, 1200);
  }

  function triggerHaptic(duration) {
    try {
      if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(duration || 10);
      }
    } catch (e) { /* ignore */ }
  }

  function flipNext() {
    if (currentPage < totalPages - 1) {
      currentPage++;
      applyPageTransform(true);
      updateHud();
      checkReadingDepth();
      clearDomSelectionAfterFlip();
    } else {
      // 尾页向后拉回弹与震动
      triggerHaptic(12);
      showToast('已是最后一页');
      applyPageTransform(true, -28);
      setTimeout(function () { applyPageTransform(true, 0); }, 180);
    }
  }

  function flipPrev() {
    if (currentPage > 0) {
      currentPage--;
      applyPageTransform(true);
      updateHud();
      checkReadingDepth();
      clearDomSelectionAfterFlip();
    } else {
      // 首页向前拉回弹与震动
      triggerHaptic(12);
      showToast('已是第一页');
      applyPageTransform(true, 28);
      setTimeout(function () { applyPageTransform(true, 0); }, 180);
    }
  }

  function flipTo(target) {
    if (typeof target === 'number') {
      var prev = currentPage;
      currentPage = Math.max(0, Math.min(target, totalPages - 1));
      applyPageTransform(true);
      updateHud();
      if (currentPage !== prev) clearDomSelectionAfterFlip();
    }
  }

  function applyReaderTheme(theme) {
    currentTheme = theme || 'light';
    if (!document.body) return;
    document.body.classList.toggle('ui-night', currentTheme === 'dark');
    document.body.classList.toggle('menmen-reader-paper', currentTheme === 'paper');
    document.body.classList.toggle('menmen-reader-night-paper', currentTheme === 'night-paper');
    document.body.classList.toggle('menmen-reader-e-ink', currentTheme === 'e-ink');
    if (currentTheme === 'e-ink') {
      transitionMode = 'none';
    }
    postToHost({ type: 'menmen-hedgedoc-theme-sync', mode: currentTheme });
  }

  // ★ 视口焦点锚点保持算法（字号重排或旋转后视线零跳动）
  function preserveFocusAnchorDuringReflow(workCallback) {
    var doc = getDocRoot();
    if (!doc) return;
    var pageWidth = getPageWidth();
    var currentScrollLeft = currentPage * pageWidth;

    // 寻找视口中心偏上 1/3 处的锚点元素
    var blocks = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, pre, blockquote, table');
    var targetAnchor = null;
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i];
      if (el.offsetLeft >= currentScrollLeft - 10) {
        targetAnchor = el;
        break;
      }
    }

    if (workCallback) workCallback();

    function reflowAfterAnchorLayout() {
      var newPageWidth = getPageWidth();
      var scrollW = doc.scrollWidth;
      totalPages = Math.max(1, Math.ceil(scrollW / newPageWidth));
      if (targetAnchor && targetAnchor.parentNode) {
        var newLeft = targetAnchor.offsetLeft;
        currentPage = Math.max(0, Math.min(Math.floor(newLeft / newPageWidth), totalPages - 1));
      } else if (currentPage >= totalPages) {
        currentPage = totalPages - 1;
      }
      applyPageTransform(false);
      updateHud();
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(reflowAfterAnchorLayout);
      });
    } else {
      setTimeout(reflowAfterAnchorLayout, 60);
    }
  }

  function setFontSize(px) {
    var size = Number(px) || 16;
    currentFontSize = size;
    var doc = getDocRoot();
    if (!doc) return;

    preserveFocusAnchorDuringReflow(function () {
      doc.style.fontSize = size + 'px';
      var lh = size >= 20 ? '1.85' : size >= 18 ? '1.8' : '1.75';
      doc.style.lineHeight = lh;
    });
  }

  function setTapMode(mode) {
    tapMode = mode === 'thumb' ? 'thumb' : 'standard';
  }

  function setTransitionMode(mode) {
    transitionMode = mode === 'none' ? 'none' : mode === 'curl' ? 'curl' : 'slide';
  }

  function clearDomSelectionAfterFlip() {
    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { /* ignore */ }
  }

  function isInputOrEditor(el) {
    if (!el) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('.CodeMirror, .CodeMirror-code, [contenteditable="true"]')) return true;
    return false;
  }

  function setupInputs() {
    var touchStartTime = 0;
    var isStylus = false;

    window.addEventListener('touchstart', function onTouchStart(e) {
      if (!isReaderActive) return;
      // ★ 多点触控捏合手势瞬时解耦：将主控权让位给浏览器原生双指缩放或图片灯箱
      if (e.touches.length > 1) {
        isTouching = false;
        hasSwiped = false;
        clearLongPressTimer();
        isLongPressCandidate = false;
        applyPageTransform(true, 0);
        return;
      }
      if (isFlipCircuitBroken() || isExcludedInteractiveElement(e.target) || isInputOrEditor(e.target)) return;

      var touch = e.touches[0];
      if (touch && (touch.pointerType === 'pen' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents === false))) {
        return;
      }
      if (touch && isSystemEdgeGesture(touch.clientX)) return;

      var sel = getEffectiveSelectionText();
      if (sel.length >= MIN_SELECTION_LENGTH) return;

      isTouching = true;
      hasSwiped = false;
      isLongPressCandidate = false;
      clearLongPressTimer();
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      currentDeltaX = 0;
      touchStartTime = Date.now();

      longPressTimer = setTimeout(function () {
        if (isTouching && !hasSwiped) {
          isLongPressCandidate = true;
          isTouching = false;
          applyPageTransform(true, 0);
        }
      }, LONG_PRESS_MS);

      imgHoldActive = false;
      clearImgHoldTimer();
      var imgEl = e.target && e.target.closest && e.target.closest('img');
      var docRoot = getDocRoot();
      if (imgEl && docRoot && docRoot.contains(imgEl)) {
        imgHoldTimer = setTimeout(function () {
          if (isTouching && !hasSwiped) {
            imgHoldActive = true;
            isLongPressCandidate = true;
            isTouching = false;
            applyPageTransform(true, 0);
          }
        }, IMG_HOLD_MS);
      }
    }, { passive: true });

    window.addEventListener('touchmove', function onTouchMove(e) {
      if (!isTouching || !isReaderActive) return;
      if (e.touches.length > 1) {
        isTouching = false;
        applyPageTransform(true, 0);
        return;
      }
      if (isExcludedInteractiveElement(e.target) || isInputOrEditor(e.target)) {
        isTouching = false;
        applyPageTransform(true, 0);
        return;
      }

      var sel = getEffectiveSelectionText();
      if (sel.length >= MIN_SELECTION_LENGTH) {
        isTouching = false;
        applyPageTransform(true, 0);
        return;
      }

      var dx = e.touches[0].clientX - touchStartX;
      var dy = e.touches[0].clientY - touchStartY;

      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        clearLongPressTimer();
        clearImgHoldTimer();
        isLongPressCandidate = false;
        imgHoldActive = false;
      }

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        hasSwiped = true;
        // ★ 非线性对数阻尼公式（边界橡皮筋回弹）
        if ((currentPage === 0 && dx > 0) || (currentPage === totalPages - 1 && dx < 0)) {
          var absDx = Math.abs(dx);
          var damped = absDx / (1 + (absDx / 180));
          dx = dx > 0 ? damped : -damped;
        }
        currentDeltaX = dx;
        applyPageTransform(false, currentDeltaX);
      }
    }, { passive: true });

    window.addEventListener('touchend', function onTouchEnd(e) {
      clearLongPressTimer();
      clearImgHoldTimer();
      if (isLongPressCandidate || imgHoldActive || !isTouching || !isReaderActive) {
        isTouching = false;
        imgHoldActive = false;
        return;
      }
      isTouching = false;

      var sel = getEffectiveSelectionText();
      if (sel.length >= MIN_SELECTION_LENGTH) {
        applyPageTransform(true, 0);
        return;
      }

      var pageWidth = getPageWidth();
      var pageHeight = window.innerHeight || 600;
      var threshold = pageWidth * SWIPE_THRESHOLD_RATIO;
      var touchDuration = Date.now() - touchStartTime;
      var didFlip = false;

      if (hasSwiped) {
        if (currentDeltaX < -threshold) {
          flipNext();
          didFlip = true;
        } else if (currentDeltaX > threshold) {
          flipPrev();
          didFlip = true;
        } else {
          applyPageTransform(true, 0);
        }
      } else if (touchDuration < 250 && Math.abs(currentDeltaX) < 8) {
        var touchX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchStartX;
        var touchY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : touchStartY;
        var ratioX = touchX / pageWidth;
        var ratioY = touchY / pageHeight;

        if (tapMode === 'thumb') {
          // 单手拇指热区 (顶部 20% 唤起 HUD，左侧 15% 上一页，其余 85% 任意点击向后翻页)
          if (ratioY < 0.2) {
            postToHost({ type: 'menmen-hedgedoc-center-tap' });
          } else if (ratioX < 0.15) {
            flipPrev();
            didFlip = true;
          } else {
            flipNext();
            didFlip = true;
          }
        } else {
          // 标准三段式热区
          if (ratioX < 0.3) {
            flipPrev();
            didFlip = true;
          } else if (ratioX > 0.7) {
            flipNext();
            didFlip = true;
          } else {
            postToHost({ type: 'menmen-hedgedoc-center-tap' });
          }
        }
      } else {
        applyPageTransform(true, 0);
      }
      if (didFlip) clearDomSelectionAfterFlip();
    }, { passive: true });

    // ★ 全物理键盘与无障碍快捷键仲裁
    window.addEventListener('keydown', function onKeyDown(e) {
      if (!isReaderActive) return;
      if (isModalOpen() || isInkOverlayOpen()) return;
      if (isInputOrEditor(e.target)) return;

      var code = e.code;
      if (code === 'ArrowRight' || code === 'PageDown' || (code === 'Space' && !e.shiftKey) || code === 'KeyL' || code === 'KeyJ') {
        e.preventDefault();
        flipNext();
      } else if (code === 'ArrowLeft' || code === 'PageUp' || (code === 'Space' && e.shiftKey) || code === 'KeyH' || code === 'KeyK') {
        e.preventDefault();
        flipPrev();
      } else if (code === 'Home') {
        e.preventDefault();
        flipTo(0);
      } else if (code === 'End') {
        e.preventDefault();
        flipTo(totalPages - 1);
      } else if (code === 'Escape') {
        e.preventDefault();
        postToHost({ type: 'menmen-hedgedoc-center-tap' });
      }
    });

    // ★ 触控板与鼠标滚轮动量积分与 350ms 冷却锁
    var wheelLock = false;
    var accumulatedDelta = 0;
    var wheelLockTimer = null;

    window.addEventListener('wheel', function onWheel(e) {
      if (!isReaderActive) return;
      if (isFlipCircuitBroken()) return;
      if (isExcludedInteractiveElement(e.target)) return;
      if (isInputOrEditor(e.target)) return;

      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      accumulatedDelta += delta;

      if (wheelLock) return;

      if (Math.abs(accumulatedDelta) >= 80) {
        e.preventDefault();
        wheelLock = true;
        if (accumulatedDelta > 0) flipNext();
        else flipPrev();
        accumulatedDelta = 0;

        if (wheelLockTimer) clearTimeout(wheelLockTimer);
        wheelLockTimer = setTimeout(function () {
          wheelLock = false;
          accumulatedDelta = 0;
        }, 350);
      }
    }, { passive: false });

    // TOC 锚点拦截与横向坐标定位
    document.addEventListener('click', function onAnchorClick(e) {
      if (!isReaderActive) return;
      var anchor = e.target.closest && e.target.closest('a[href^="#"]');
      if (!anchor) return;
      var hash = anchor.getAttribute('href');
      if (!hash || hash === '#') return;
      var targetEl = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (targetEl) {
        e.preventDefault();
        e.stopPropagation();
        var pageWidth = getPageWidth();
        var targetLeft = targetEl.offsetLeft;
        var targetPage = Math.floor(targetLeft / pageWidth);
        flipTo(targetPage);
      }
    }, true);
  }

  function isPrivate172Host(host) {
    var parts = host.split('.');
    if (parts.length !== 4 || parts[0] !== '172') return false;
    var second = parseInt(parts[1], 10);
    return second >= 16 && second <= 31;
  }

  function isTrustedOrigin(origin) {
    if (!origin) return true;
    try {
      var u = new URL(origin);
      var host = u.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === window.location.hostname) return true;
      if (host.startsWith('192.168.') || host.startsWith('10.') || isPrivate172Host(host)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function handleHostMessage(e) {
      if (e.origin && !isTrustedOrigin(e.origin)) {
        try {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[menmen-reader-flip] blocked postMessage from untrusted origin:', e.origin);
          }
        } catch (err) { /* ignore */ }
        return;
      }
      var data = e.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (err) { return; }
      }
      if (!data) return;

      if (data.type === 'menmen-hedgedoc-flip-to') {
        var hashPage = resolveUrlHashTargetPage();
        if (hashPage != null) {
          flipTo(hashPage);
        } else if (data.page !== undefined) {
          flipTo(data.page - 1);
          scheduleTwoPhaseRecalibration();
        } else if (data.percent !== undefined) {
          var targetP = Math.round((data.percent / 100) * totalPages) - 1;
          flipTo(Math.max(0, targetP));
          scheduleTwoPhaseRecalibration();
        }
      } else if (data.type === 'menmen-theme-change') {
        applyReaderTheme(data.mode);
      } else if (data.type === 'menmen-font-size-change') {
        setFontSize(data.fontSize);
      } else if (data.type === 'menmen-tap-mode-change') {
        setTapMode(data.mode);
      } else if (data.type === 'menmen-transition-mode-change') {
        setTransitionMode(data.mode);
      } else if (data.type === 'menmen-reader-toggle') {
        var wantPaged = !!data.active;
        if (window.__menmenViewLayout && typeof window.__menmenViewLayout.setLayout === 'function') {
          if (wantPaged) {
            window.__menmenViewLayout.setLayout('paged');
          } else if (typeof window.__menmenViewLayout.exitPagedMode === 'function') {
            window.__menmenViewLayout.exitPagedMode();
          } else {
            window.__menmenViewLayout.setLayout(isMobileUa() ? 'wide' : 'centered');
          }
        } else {
          toggleReader(wantPaged);
        }
      } else if (data.type === 'menmen-hedgedoc-flip-cmd') {
        if (data.action === 'next') flipNext();
        else if (data.action === 'prev') flipPrev();
      } else if (data.type === 'menmen-host-degraded') {
        hostDegraded = !!data.active;
        if (hostDegraded) toggleReader(false);
      } else if (data.type === 'menmen-reading-depth-ack') {
        acknowledgeDepthEvent(data.eventId);
      } else if (data.type === 'menmen-hedgedoc-soft-refresh') {
        triggerPullRefresh();
      } else if (data.type === 'menmen-math-typeset') {
        if (typeof window.menmenScheduleMathTypesetWithRetries === 'function') {
          window.menmenScheduleMathTypesetWithRetries();
        } else if (typeof window.menmenScheduleMathTypeset === 'function') {
          window.menmenScheduleMathTypeset();
        }
      }
  }

  function pageScrollTop() {
    var el = document.scrollingElement || document.documentElement || document.body;
    return el ? el.scrollTop : 0;
  }

  function triggerPullRefresh() {
    if (typeof window.menmenRefreshNoteView === 'function') {
      window.menmenRefreshNoteView();
      return;
    }
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      postToHost({ type: 'menmen-hedgedoc-pull-refresh' });
      return;
    }
    try {
      window.location.reload();
    } catch (err) { /* ignore */ }
  }

  function setupPullToRefresh() {
    if (!('ontouchstart' in window)) return;
    var startY = 0;
    var tracking = false;
    var maxPull = 0;
    var threshold = 72;

    document.addEventListener('touchstart', function (e) {
      if (isReaderActive && totalPages > 1) return;
      if (pageScrollTop() > 8) return;
      if (document.body && document.body.classList.contains('menmen-img-lightbox-open')) return;
      if (!e.touches || !e.touches.length) return;
      startY = e.touches[0].clientY;
      tracking = true;
      maxPull = 0;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!tracking || !e.touches || !e.touches.length) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 0 && pageScrollTop() <= 8) {
        maxPull = Math.max(maxPull, dy);
      } else if (dy < -4) {
        tracking = false;
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!tracking) return;
      tracking = false;
      if (maxPull >= threshold) {
        triggerPullRefresh();
      }
      maxPull = 0;
    }, { passive: true });
  }

  function bindLightboxFuseHook() {
    if (lightboxFuseReady) return;
    function markReady() {
      lightboxFuseReady = true;
    }
    if (document.body && document.body.classList.contains('menmen-img-lightbox-open')) {
      markReady();
      return;
    }
    document.addEventListener('menmen-lightbox-ready', markReady, { once: true });
  }

  function setupMessageBridge() {
    window.addEventListener('message', handleHostMessage);
    document.addEventListener('message', handleHostMessage);
  }

  function setupVisualViewportFreeze() {
    if (!window.visualViewport) return;
    viewportBaselineHeight = window.visualViewport.height || window.innerHeight || 600;
    window.visualViewport.addEventListener('resize', function onVvResize() {
      if (!isReaderActive) return;
      var h = window.visualViewport.height || window.innerHeight;
      if (!viewportBaselineHeight) viewportBaselineHeight = h;
      var dropRatio = (viewportBaselineHeight - h) / viewportBaselineHeight;
      if (dropRatio > 0.25) {
        freezeColumnsRecalculation = true;
        return;
      }
      if (freezeColumnsRecalculation && h >= viewportBaselineHeight * 0.9) {
        freezeColumnsRecalculation = false;
        viewportBaselineHeight = h;
        recalculatePages(true);
      }
    });
  }

  function setupPrintFlatten() {
    window.addEventListener('beforeprint', function onBeforePrint() {
      printSavedPage = currentPage;
      printWasActive = isReaderActive;
      if (document.body) {
        document.body.classList.add('menmen-reader-print-flatten');
        document.body.classList.remove('menmen-reader-paged');
      }
      var doc = getDocRoot();
      if (doc) {
        doc.style.transform = 'none';
        doc.style.transition = 'none';
      }
    });
    window.addEventListener('afterprint', function onAfterPrint() {
      if (document.body) {
        document.body.classList.remove('menmen-reader-print-flatten');
        if (printWasActive) {
          document.body.classList.add('menmen-reader-paged');
        }
      }
      if (printWasActive) {
        currentPage = printSavedPage;
        recalculatePages(false);
      }
    });
  }

  function observeContentReflow() {
    window.addEventListener('resize', function onResize() {
      if (!isReaderActive || freezeColumnsRecalculation) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        recalculatePages(true);
      }, 180);
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (isReaderActive) recalculatePages(true);
      }).catch(function () { /* ignore */ });
    }

    setupVisualViewportFreeze();
    setupPrintFlatten();

    // MathJax 公式排版监听
    if (typeof window.menmenScheduleMathTypeset === 'function') {
      window.menmenScheduleMathTypeset();
    }
    if (window.MathJax && window.MathJax.Hub) {
      window.MathJax.Hub.Queue(function () {
        if (isReaderActive) {
          setTimeout(function () {
            recalculatePages(true);
          }, 80);
        }
      });
    }

    // 动态图片加载排版监听
    var doc = getDocRoot();
    if (doc) {
      var imgs = doc.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].complete) {
          imgs[i].addEventListener('load', function () {
            if (isReaderActive) setTimeout(function () { recalculatePages(true); }, 60);
          });
        }
      }
    }

    // 协同 OT DOM 变更观察
    if (doc && window.MutationObserver) {
      var observer = new MutationObserver(function () {
        if (isReaderActive) {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () {
            recalculatePages(true);
          }, OT_RECALC_DEBOUNCE_MS);
        }
      });
      observer.observe(doc, { childList: true, subtree: true, characterData: true });
    }
  }

  function pagedControlLabel(key, fallback) {
    var i18n = window.__menmenI18n;
    return (i18n && i18n[key]) || fallback;
  }

  var layoutDockSyncTries = 0;
  function scheduleViewLayoutDockSync() {
    layoutDockSyncTries = 0;
    (function tick() {
      if (window.__menmenViewLayout && typeof window.__menmenViewLayout.syncPagedLayoutDock === 'function') {
        window.__menmenViewLayout.syncPagedLayoutDock(true);
        return;
      }
      if (++layoutDockSyncTries < 60) setTimeout(tick, 100);
    })();
  }

  function ensurePagedControlBar() {
    if (!isReaderActive || !document.body) return;
    injectPaginationStyles();
    var dock = document.getElementById('menmen-paged-layout-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'menmen-paged-layout-dock';
      dock.className = 'menmen-paged-layout-dock';
      dock.setAttribute('role', 'toolbar');
      dock.setAttribute('aria-label', pagedControlLabel('viewLayout', 'View layout'));
      document.body.appendChild(dock);
    }
    var exitBtn = dock.querySelector('.menmen-paged-exit-btn');
    if (!exitBtn) {
      exitBtn = document.createElement('button');
      exitBtn.type = 'button';
      exitBtn.className = 'btn btn-default menmen-paged-exit-btn';
      exitBtn.innerHTML = '<i class="fa fa-times" aria-hidden="true"></i> <span class="menmen-paged-exit-label"></span>';
      exitBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.__menmenViewLayout && typeof window.__menmenViewLayout.exitPagedMode === 'function') {
          window.__menmenViewLayout.exitPagedMode();
        } else if (window.__menmenViewLayout && typeof window.__menmenViewLayout.setLayout === 'function') {
          window.__menmenViewLayout.setLayout('wide');
        } else {
          toggleReader(false);
          try {
            sessionStorage.setItem('menmen-preview-layout', 'wide');
          } catch (err) { /* ignore */ }
        }
      });
      dock.insertBefore(exitBtn, dock.firstChild);
    }
    var exitLabel = pagedControlLabel('layoutExitPaged', 'Exit paged mode');
    var exitSpan = exitBtn.querySelector('.menmen-paged-exit-label');
    if (exitSpan) exitSpan.textContent = exitLabel;
    exitBtn.setAttribute('title', exitLabel);
    exitBtn.setAttribute('aria-label', exitLabel);
    scheduleViewLayoutDockSync();
  }

  function removePagedControlBar() {
    if (window.__menmenViewLayout && typeof window.__menmenViewLayout.syncPagedLayoutDock === 'function') {
      window.__menmenViewLayout.syncPagedLayoutDock(false);
      return;
    }
    var dock = document.getElementById('menmen-paged-layout-dock');
    if (dock) dock.remove();
  }

  function toggleReader(active) {
    if (engineBypassed || hostDegraded) return;
    isReaderActive = active !== undefined ? active : !isReaderActive;
    if (document.body) {
      document.body.classList.toggle('menmen-reader-paged', isReaderActive);
      if (isReaderActive) {
        readingStartTime = Date.now();
        readingActiveMs = 0;
        readingVisibleSince = (typeof document !== 'undefined' && document.hidden) ? null : Date.now();
        depthReported = false;
        lastHudBridgePost = { current: -1, total: -1, percent: -1 };
        injectPaginationStyles();
        ensurePagedControlBar();
        setTimeout(function () {
          recalculatePages(false);
          applyInitialNavigationFromUrl();
        }, 50);
      } else {
        removePagedControlBar();
        if (hudElement) {
          hudElement.remove();
          hudElement = null;
        }
      }
    }
    // 广播分页状态给宿主端，驱动 ArticleFloatingDock 避让
    postToHost({
      type: 'menmen-hedgedoc-paged-state',
      isPaged: isReaderActive,
      currentPage: currentPage + 1,
      totalPages: totalPages
    });
    if (window.__menmenViewLayout && typeof window.__menmenViewLayout.syncPagedLayoutDock === 'function') {
      window.__menmenViewLayout.syncPagedLayoutDock(isReaderActive);
    } else if (isReaderActive) {
      scheduleViewLayoutDockSync();
    }
  }

  function checkBatteryMode() {
    try {
      if (typeof navigator !== 'undefined' && navigator.getBattery) {
        navigator.getBattery().then(function (battery) {
          if (battery.level <= 0.15 && !battery.charging) {
            transitionMode = 'none'; // 低电量自动降为 0ms 纯刷瞬翻，大幅节省 GPU 电量
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  function init() {
    if (isSlideDocument()) {
      engineBypassed = true;
      setupMessageBridge();
      postToHost({ type: 'menmen-hedgedoc-ready', slideBypass: true });
      return;
    }
    injectPaginationStyles();
    setupInputs();
    setupHashNavigation();
    bindLightboxFuseHook();
    setupMessageBridge();
    setupPullToRefresh();
    observeContentReflow();
    checkBatteryMode();

    var urlParams = new URLSearchParams(window.location.search);
    // 分页由 menmen-view-layout 的 'paged' 或显式 ?mode=reader 触发，禁止仅凭 isMobileUa() 自动进入（与现网强制 wide 行为兼容）
    if (urlParams.get('mode') === 'reader') {
      toggleReader(true);
    }
    if (urlParams.get('theme')) {
      applyReaderTheme(urlParams.get('theme'));
    }
    if (urlParams.get('fontSize')) {
      setFontSize(urlParams.get('fontSize'));
    }
    postToHost({ type: 'menmen-hedgedoc-ready' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 挂载全局对象供外部联动 (例如 menmen-view-layout.js)
  window.__menmenReaderFlip = {
    toggle: toggleReader,
    ensurePagedControlBar: ensurePagedControlBar,
    flipTo: flipTo,
    flipNext: flipNext,
    flipPrev: flipPrev,
    setTheme: applyReaderTheme,
    setFontSize: setFontSize,
    setTapMode: setTapMode,
    setTransitionMode: setTransitionMode,
    recalculate: recalculatePages,
    wrapTables: wrapTablesForOverflow,
    getRoot: getDocRoot,
    isPaginating: function () { return paginatingFlag; },
    isBypassed: function () { return engineBypassed; },
    isHostDegraded: function () { return hostDegraded; },
    isLightboxFuseReady: function () { return lightboxFuseReady; },
    isTrustedOrigin: isTrustedOrigin,
    resolveHashPage: resolveUrlHashTargetPage,
    getTransitionMode: function () { return transitionMode; },
  };
})();
