/**
 * LinkedIn Job Filter — content script
 *
 * - Hide blocked companies in the results lazy-column (incl. scroll-loaded cards)
 * - Show «Bloquear empresa» ONLY in the job detail pane (not in the list)
 * - Capture logo + company URL from the detail pane when blocking
 */
(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-ljf-processed';
  const DETAIL_PROCESSED_ATTR = 'data-ljf-detail-processed';
  const BTN_CLASS = 'ljf-block-btn';
  const HIDDEN_CLASS = 'ljf-hidden';
  const DEBOUNCE_MS = 120;
  const VERSION = '0.2.0';

  let blockedCompanies = {};
  let settings = Object.assign({}, LJF.storage.DEFAULT_SETTINGS);
  let observer = null;
  let debounceTimer = null;
  let observedRoot = null;
  let active = false;
  let lastScanStats = null;

  function debugEnabled() {
    try {
      if (globalThis.__LJF_DEBUG__ === true) return true;
      if (location && /(?:\?|&)ljfDebug=1(?:&|$)/.test(location.search)) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('ljfDebug') === '1') return true;
    } catch (_) {
      /* private mode */
    }
    return false;
  }

  function log() {
    if (!debugEnabled()) return;
    if (typeof console === 'undefined' || !console.info) return;
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[LJF]');
    console.info.apply(console, args);
  }

  function logAlways() {
    if (typeof console === 'undefined' || !console.info) return;
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[LJF]');
    console.info.apply(console, args);
  }

  function isJobsPath(pathname) {
    if (globalThis.__LJF_FORCE_JOBS__ === true) return true;
    const path = pathname || (location && location.pathname) || '';
    if (/^\/jobs(\/|$)/i.test(path)) return true;
    try {
      const href = location && location.href ? location.href : '';
      if (/fixture.*\.html/i.test(href) || /\/test\/fixture/i.test(path)) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function findObserverRoot() {
    return (
      LJF.findResultsListRoot(document) ||
      LJF.queryFirst(LJF.selectors.jobListRoots, document) ||
      document.body
    );
  }

  function hideCardRow(card) {
    card.classList.add(HIDDEN_CLASS);
    // Also hide the following <hr> separator used between SDUI cards
    const next = card.nextElementSibling;
    if (next && next.tagName === 'HR') {
      next.classList.add(HIDDEN_CLASS);
    }
  }

  function showCardRow(card) {
    card.classList.remove(HIDDEN_CLASS);
    const next = card.nextElementSibling;
    if (next && next.tagName === 'HR') {
      next.classList.remove(HIDDEN_CLASS);
    }
  }

  function removeListButtons(scope) {
    const root = scope || document;
    // Strip any legacy buttons inside the results list
    const list = LJF.findResultsListRoot(document);
    const nodes = root.querySelectorAll('.' + BTN_CLASS);
    Array.prototype.forEach.call(nodes, function (btn) {
      if (list && list.contains(btn)) {
        btn.remove();
      } else if (LJF.isInResultsList(btn)) {
        btn.remove();
      }
    });
  }

  function createBlockButton(identity) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = 'Bloquear empresa';
    btn.title = 'Ocultar todas las ofertas de ' + (identity.displayName || 'esta empresa');
    btn.setAttribute('aria-label', btn.title);
    btn.dataset.ljfKey = identity.key;

    btn.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Bloqueando…';
        LJF.storage
          .blockCompany(identity, 'job-detail')
          .then(function () {
            return LJF.storage.getBlockedCompanies();
          })
          .then(function (map) {
            blockedCompanies = map;
            scanAndApply();
          })
          .catch(function (err) {
            logAlways('Error al bloquear', err);
            btn.disabled = false;
            btn.textContent = 'Bloquear empresa';
          });
      },
      true
    );

    return btn;
  }

  /**
   * Hide/show cards inside the results lazy-column. Never inject buttons here.
   */
  function applyListHiding() {
    const listRoot = LJF.findResultsListRoot(document);
    const searchRoot = listRoot || document;
    const cards = LJF.findJobCards(searchRoot).filter(function (card) {
      // Only act on cards that belong to the results list
      if (listRoot) return listRoot.contains(card);
      return LJF.isInResultsList(card) || !LJF.findDetailPane(document);
    });

    let hidden = 0;
    let withCompany = 0;
    const samples = [];

    cards.forEach(function (card, index) {
      // Ensure no block button remains on list cards
      const stray = card.querySelector('.' + BTN_CLASS);
      if (stray) stray.remove();
      card.removeAttribute(PROCESSED_ATTR);

      const identity = LJF.extractCompanyFromCard(card);
      if (!identity) {
        showCardRow(card);
        return;
      }
      withCompany += 1;

      if (LJF.matchesBlocked(identity, blockedCompanies)) {
        hideCardRow(card);
        hidden += 1;
      } else {
        showCardRow(card);
      }

      if (index < 5) {
        samples.push({
          tag: card.tagName,
          componentkey: card.getAttribute && card.getAttribute('componentkey'),
          company: identity.displayName,
          key: identity.key,
          hidden: LJF.matchesBlocked(identity, blockedCompanies),
        });
      }
    });

    return {
      listRoot: listRoot
        ? (listRoot.getAttribute('componentkey') || listRoot.getAttribute('data-testid') || listRoot.tagName)
        : null,
      cards: cards.length,
      withCompany: withCompany,
      hidden: hidden,
      samples: samples,
    };
  }

  /**
   * Inject a single block button into the detail pane; capture logo + company URL.
   */
  function applyDetailButton() {
    const pane = LJF.findDetailPane(document);
    if (!pane) {
      return { detail: false, button: false, company: null };
    }

    // Remove duplicate detail buttons
    const existing = pane.querySelectorAll('.' + BTN_CLASS);
    const identity = LJF.extractCompanyFromDetailPane(pane);
    if (!identity) {
      Array.prototype.forEach.call(existing, function (b) {
        b.remove();
      });
      pane.removeAttribute(DETAIL_PROCESSED_ATTR);
      return { detail: true, button: false, company: null };
    }

    if (LJF.matchesBlocked(identity, blockedCompanies)) {
      Array.prototype.forEach.call(existing, function (b) {
        b.remove();
      });
      // Detail stays visible; list hiding covers the job cards
      return { detail: true, button: false, company: identity, blocked: true };
    }

    if (existing.length) {
      // Refresh dataset key if company changed (SPA selection)
      existing[0].dataset.ljfKey = identity.key;
      existing[0].disabled = false;
      existing[0].textContent = 'Bloquear empresa';
      // Drop extras
      for (let i = 1; i < existing.length; i++) existing[i].remove();
      pane.setAttribute(DETAIL_PROCESSED_ATTR, '1');
      return { detail: true, button: true, company: identity };
    }

    const anchor =
      (LJF.findButtonAnchor && LJF.findButtonAnchor(pane)) ||
      pane.querySelector('a[href*="/company/"]') ||
      pane;

    // Prefer inserting next to the company link row
    const btn = createBlockButton(identity);
    if (anchor.tagName === 'A' && anchor.parentElement) {
      anchor.parentElement.appendChild(btn);
    } else {
      anchor.appendChild(btn);
    }
    pane.setAttribute(DETAIL_PROCESSED_ATTR, '1');
    return { detail: true, button: true, company: identity };
  }

  function scanAndApply() {
    if (!isJobsPath()) {
      lastScanStats = { path: location.pathname, active: false };
      return lastScanStats;
    }

    removeListButtons(document);
    const listStats = applyListHiding();
    const detailStats = applyDetailButton();

    lastScanStats = {
      path: location.pathname + location.search,
      active: true,
      version: VERSION,
      listRoot: listStats.listRoot,
      cards: listStats.cards,
      withCompany: listStats.withCompany,
      hidden: listStats.hidden,
      detail: detailStats.detail,
      detailButton: !!detailStats.button,
      detailCompany: detailStats.company
        ? {
            key: detailStats.company.key,
            displayName: detailStats.company.displayName,
            companyUrl: detailStats.company.companyUrl,
            logoUrl: detailStats.company.logoUrl,
          }
        : null,
      blockedCount: Object.keys(blockedCompanies || {}).length,
      samples: listStats.samples,
    };

    log('scan', lastScanStats);

    if (!listStats.cards) {
      logAlways(
        'Diagnóstico: 0 tarjetas en lazy-column. Activa debug: localStorage.ljfDebug="1"; LJFDebug.status()'
      );
    }

    return lastScanStats;
  }

  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      if (!isJobsPath()) {
        teardownObserver();
        return;
      }
      scanAndApply();
      ensureObserver();
    }, DEBOUNCE_MS);
  }

  function teardownObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observedRoot = null;
  }

  function ensureObserver() {
    if (!isJobsPath()) {
      teardownObserver();
      return;
    }

    const root = findObserverRoot();
    if (observer && observedRoot === root) return;

    teardownObserver();
    observedRoot = root;
    observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.addedNodes && m.addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });

    // Also observe detail pane swaps (job selection)
    const detail = LJF.findDetailPane(document);
    if (detail && detail !== root) {
      observer.observe(detail, { childList: true, subtree: true });
    }

    log(
      'MutationObserver anclado a',
      root === document.body ? 'body' : root.getAttribute('componentkey') || root.tagName
    );
  }

  function onRouteMaybeChanged(reason) {
    const nowJobs = isJobsPath();
    log('ruta', reason, location.href, 'jobs=', nowJobs);
    if (nowJobs && !active) {
      active = true;
      observedRoot = null;
      scheduleScan();
    } else if (!nowJobs && active) {
      active = false;
      teardownObserver();
      resetProcessed();
    } else if (nowJobs) {
      observedRoot = null;
      scheduleScan();
    }
  }

  function watchSpaNavigation() {
    let lastUrl = location.href;
    const notify = function (reason) {
      if (location.href === lastUrl && reason !== 'force') return;
      lastUrl = location.href;
      onRouteMaybeChanged(reason || 'url');
    };

    window.addEventListener('popstate', function () {
      notify('popstate');
    });

    ['pushState', 'replaceState'].forEach(function (method) {
      const original = history[method];
      if (typeof original !== 'function') return;
      history[method] = function () {
        const ret = original.apply(this, arguments);
        try {
          notify(method);
        } catch (_) {
          /* ignore */
        }
        return ret;
      };
    });

    setInterval(function () {
      if (location.href !== lastUrl) notify('poll');
    }, 800);
  }

  function resetProcessed() {
    document.querySelectorAll('[' + PROCESSED_ATTR + '], [' + DETAIL_PROCESSED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(PROCESSED_ATTR);
      el.removeAttribute(DETAIL_PROCESSED_ATTR);
    });
    document.querySelectorAll('.' + BTN_CLASS).forEach(function (btn) {
      btn.remove();
    });
    document.querySelectorAll('.' + HIDDEN_CLASS).forEach(function (el) {
      el.classList.remove(HIDDEN_CLASS);
    });
  }

  function init() {
    logAlways(
      'content script v' + VERSION + ' cargado en',
      location.pathname,
      debugEnabled() ? '(debug ON)' : '(debug OFF)'
    );

    LJF.storage.loadAll().then(function (all) {
      blockedCompanies = all.blockedCompanies || {};
      settings = all.settings || settings;
      active = isJobsPath();
      if (active) {
        scanAndApply();
        ensureObserver();
      }
      watchSpaNavigation();
    });

    LJF.storage.onBlockedChange(function (map) {
      blockedCompanies = map || {};
      if (!isJobsPath()) return;
      resetProcessed();
      scanAndApply();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  globalThis.LJFContent = {
    scanAndApply: scanAndApply,
    scheduleScan: scheduleScan,
    refreshFromStorage: function refreshFromStorage() {
      return LJF.storage.loadAll().then(function (all) {
        blockedCompanies = all.blockedCompanies || {};
        settings = all.settings || settings;
        resetProcessed();
        return scanAndApply();
      });
    },
  };

  globalThis.LJFDebug = {
    version: VERSION,
    enable: function () {
      try {
        localStorage.setItem('ljfDebug', '1');
      } catch (_) {
        globalThis.__LJF_DEBUG__ = true;
      }
      logAlways('Debug activado. Recarga o LJFDebug.scan()');
    },
    disable: function () {
      try {
        localStorage.removeItem('ljfDebug');
      } catch (_) {
        /* ignore */
      }
      globalThis.__LJF_DEBUG__ = false;
    },
    status: function () {
      const stats = lastScanStats || scanAndApply();
      console.info('[LJF] status', stats);
      return stats;
    },
    scan: function () {
      resetProcessed();
      const stats = scanAndApply();
      console.info('[LJF] scan', stats);
      return stats;
    },
    last: function () {
      return lastScanStats;
    },
  };
})();
