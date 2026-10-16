/**
 * LinkedIn Job Filter — content script
 * Injects «Bloquear empresa», hides blocked companies, watches for scroll-loaded cards.
 * Runs on all linkedin.com pages but only activates on /jobs/* routes (SPA-safe).
 */
(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-ljf-processed';
  const BTN_CLASS = 'ljf-block-btn';
  const HIDDEN_CLASS = 'ljf-hidden';
  const DEBOUNCE_MS = 120;
  const VERSION = '0.1.1';

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
      /* private mode / blocked storage */
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
    // Local HTML fixtures (file://.../test/fixture*.html)
    try {
      const href = location && location.href ? location.href : '';
      if (/fixture.*\.html/i.test(href) || /\/test\/fixture/i.test(path)) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function findListRoot() {
    return LJF.queryFirst(LJF.selectors.jobListRoots, document) || document.body;
  }

  function getAnchor(card) {
    return (LJF.findButtonAnchor && LJF.findButtonAnchor(card)) || card;
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
          .blockCompany(identity, 'job-card')
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

  function shouldHide(identity) {
    if (!identity) return false;
    return LJF.matchesBlocked(identity, blockedCompanies);
  }

  function applyCardState(card) {
    const identity = LJF.extractCompanyFromCard(card);
    if (!identity) {
      card.classList.remove(HIDDEN_CLASS);
      return { ok: false, identity: null };
    }

    if (shouldHide(identity)) {
      card.classList.add(HIDDEN_CLASS);
      return { ok: true, identity: identity, hidden: true };
    }

    card.classList.remove(HIDDEN_CLASS);

    if (!settings.showBlockButton) {
      return { ok: true, identity: identity, hidden: false };
    }

    if (card.querySelector('.' + BTN_CLASS)) {
      card.setAttribute(PROCESSED_ATTR, '1');
      return { ok: true, identity: identity, hidden: false, button: true };
    }

    const anchor = getAnchor(card);
    const btn = createBlockButton(identity);
    anchor.appendChild(btn);
    card.setAttribute(PROCESSED_ATTR, '1');
    return { ok: true, identity: identity, hidden: false, button: true };
  }

  function scanAndApply() {
    if (!isJobsPath()) {
      lastScanStats = {
        path: location.pathname,
        active: false,
        cards: 0,
        withCompany: 0,
        buttons: 0,
        hidden: 0,
        samples: [],
      };
      return lastScanStats;
    }

    const cards = LJF.findJobCards(document);
    let withCompany = 0;
    let buttons = 0;
    let hidden = 0;
    const samples = [];

    cards.forEach(function (card, index) {
      const result = applyCardState(card);
      if (result.ok) withCompany += 1;
      if (result.hidden) hidden += 1;
      if (result.button || (card.querySelector && card.querySelector('.' + BTN_CLASS))) buttons += 1;
      if (index < 5) {
        samples.push({
          tag: card.tagName,
          componentkey: card.getAttribute && card.getAttribute('componentkey'),
          jobId:
            (card.getAttribute && (card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id'))) ||
            null,
          company: result.identity ? result.identity.displayName : null,
          key: result.identity ? result.identity.key : null,
        });
      }
    });

    lastScanStats = {
      path: location.pathname + location.search,
      active: true,
      cards: cards.length,
      withCompany: withCompany,
      buttons: document.querySelectorAll('.' + BTN_CLASS).length,
      hidden: hidden,
      blockedCount: Object.keys(blockedCompanies || {}).length,
      samples: samples,
    };

    log('scan', lastScanStats);

    // Always surface a one-line summary when nothing was found (helps real-page diagnosis)
    if (!cards.length || !withCompany) {
      logAlways(
        'Diagnóstico: tarjetas=' +
          cards.length +
          ', con empresa=' +
          withCompany +
          ', botones=' +
          lastScanStats.buttons +
          ' en ' +
          location.pathname +
          ' — activa depuración con localStorage.ljfDebug="1" y recarga; luego LJFDebug.status()'
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

    const root = findListRoot();
    if (observer && observedRoot === root) return;

    teardownObserver();

    observedRoot = root;
    observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if ((m.addedNodes && m.addedNodes.length) || (m.type === 'attributes' && m.attributeName === 'componentkey')) {
          scheduleScan();
          return;
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['componentkey', 'data-occludable-job-id', 'data-job-id'],
    });
    log('MutationObserver anclado a', root === document.body ? 'body' : root.tagName + (root.className ? '.' + String(root.className).split(' ')[0] : ''));
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
      resetProcessedCards();
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

    // LinkedIn uses history.pushState / replaceState heavily
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

  function resetProcessedCards() {
    document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(PROCESSED_ATTR);
      const btn = el.querySelector('.' + BTN_CLASS);
      if (btn) btn.remove();
      el.classList.remove(HIDDEN_CLASS);
    });
    // Also remove orphan buttons if cards were re-rendered without the attr
    document.querySelectorAll('.' + BTN_CLASS).forEach(function (btn) {
      btn.remove();
    });
  }

  function init() {
    logAlways('content script v' + VERSION + ' cargado en', location.pathname, debugEnabled() ? '(debug ON)' : '(debug OFF — localStorage.ljfDebug="1")');

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
      resetProcessedCards();
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
        resetProcessedCards();
        return scanAndApply();
      });
    },
  };

  /**
   * Console helpers for real LinkedIn diagnosis:
   *   localStorage.ljfDebug = '1'; location.reload();
   *   LJFDebug.status()
   *   LJFDebug.scan()
   *   LJFDebug.enable()
   */
  globalThis.LJFDebug = {
    version: VERSION,
    enable: function () {
      try {
        localStorage.setItem('ljfDebug', '1');
      } catch (_) {
        globalThis.__LJF_DEBUG__ = true;
      }
      logAlways('Debug activado. Recarga la página o llama LJFDebug.scan()');
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
      resetProcessedCards();
      const stats = scanAndApply();
      console.info('[LJF] scan', stats);
      return stats;
    },
    last: function () {
      return lastScanStats;
    },
  };
})();
