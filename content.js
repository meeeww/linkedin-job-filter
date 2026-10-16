/**
 * LinkedIn Job Filter — content script (isolated world)
 *
 * Hides blocked companies in the results lazy-column (robust attr + CSS + inline).
 * Block button only in the job detail pane. Optional RSC job-map via page-bridge.
 */
(function () {
  'use strict';

  const DETAIL_PROCESSED_ATTR = 'data-ljf-detail-processed';
  const BLOCKED_ATTR = 'data-ljf-blocked';
  const BTN_CLASS = 'ljf-block-btn';
  const HIDDEN_CLASS = 'ljf-hidden';
  const DEBOUNCE_MS = 80;
  const VERSION = '0.3.0';
  const STYLE_ID = 'ljf-hide-style';

  let blockedCompanies = {};
  let settings = Object.assign({}, LJF.storage.DEFAULT_SETTINGS);
  let observer = null;
  let debounceTimer = null;
  let observedRoot = null;
  let active = false;
  let lastScanStats = null;
  /** @type {Record<string, { companyId?: string, companySlug?: string, companyName?: string }>} */
  let jobMap = {};

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

  /** Keep a last-child style tag so our !important rules win stylesheet order fights */
  function ensureHideStylesheet() {
    let el = document.getElementById(STYLE_ID);
    const css =
      '[' +
      BLOCKED_ATTR +
      '="1"],[' +
      BLOCKED_ATTR +
      '="1"][role="button"],.' +
      HIDDEN_CLASS +
      '{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;opacity:0!important;pointer-events:none!important;border:0!important;}';
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = css;
      (document.documentElement || document.head || document.body).appendChild(el);
    } else if (el.parentNode) {
      el.parentNode.appendChild(el); // move to end
    }
  }

  function applyInlineHide(el, hide) {
    if (!el || !el.style) return;
    if (hide) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('height', '0', 'important');
      el.style.setProperty('max-height', '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('margin', '0', 'important');
      el.style.setProperty('padding', '0', 'important');
      el.style.setProperty('opacity', '0', 'important');
    } else {
      ['display', 'visibility', 'height', 'max-height', 'overflow', 'margin', 'padding', 'opacity'].forEach(
        function (prop) {
          el.style.removeProperty(prop);
        }
      );
    }
  }

  function hideCardRow(card) {
    card.setAttribute(BLOCKED_ATTR, '1');
    card.classList.add(HIDDEN_CLASS);
    applyInlineHide(card, true);
    const next = card.nextElementSibling;
    if (next && next.tagName === 'HR') {
      next.setAttribute(BLOCKED_ATTR, '1');
      next.classList.add(HIDDEN_CLASS);
      applyInlineHide(next, true);
    }
  }

  function showCardRow(card) {
    card.removeAttribute(BLOCKED_ATTR);
    card.classList.remove(HIDDEN_CLASS);
    applyInlineHide(card, false);
    const next = card.nextElementSibling;
    if (next && next.tagName === 'HR') {
      next.removeAttribute(BLOCKED_ATTR);
      next.classList.remove(HIDDEN_CLASS);
      applyInlineHide(next, false);
    }
  }

  function findObserverRoot() {
    return (
      LJF.findResultsListRoot(document) ||
      LJF.queryFirst(LJF.selectors.jobListRoots, document) ||
      document.body
    );
  }

  function removeListButtons() {
    const list = LJF.findResultsListRoot(document);
    document.querySelectorAll('.' + BTN_CLASS).forEach(function (btn) {
      if ((list && list.contains(btn)) || LJF.isInResultsList(btn)) btn.remove();
    });
  }

  function enrichIdentity(identity, card) {
    if (!identity) return null;
    const jobId = LJF.extractJobIdFromCard(card);
    if (jobId) identity.jobId = jobId;
    if (jobId && jobMap[jobId]) {
      const meta = jobMap[jobId];
      if (!identity.companyId && meta.companyId) identity.companyId = meta.companyId;
      if (!identity.companyUrl && meta.companySlug) {
        identity.companyUrl = 'https://www.linkedin.com/company/' + meta.companySlug + '/';
      }
      if (!identity.displayName && meta.companyName) identity.displayName = meta.companyName;
      // Rebuild key if we gained a stronger id/url
      const rebuilt = LJF.buildCompanyIdentity(identity);
      if (rebuilt) {
        identity.key = rebuilt.key;
        identity.companyId = rebuilt.companyId;
        identity.companyUrl = rebuilt.companyUrl;
        identity.displayName = rebuilt.displayName || identity.displayName;
      }
    }
    return identity;
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
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
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
            maybeDismissVisibleJobs(identity);
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

  function applyListHiding() {
    ensureHideStylesheet();
    const listRoot = LJF.findResultsListRoot(document);
    const searchRoot = listRoot || document;
    const cards = LJF.findJobCards(searchRoot).filter(function (card) {
      if (listRoot) return listRoot.contains(card);
      return LJF.isInResultsList(card) || !LJF.findDetailPane(document);
    });

    let hidden = 0;
    let withCompany = 0;
    const samples = [];

    cards.forEach(function (card, index) {
      const stray = card.querySelector('.' + BTN_CLASS);
      if (stray) stray.remove();

      let identity = LJF.extractCompanyFromCard(card);
      identity = enrichIdentity(identity, card);

      // Even without a parsed company name, try jobMap-only match
      if (!identity) {
        const jobId = LJF.extractJobIdFromCard(card);
        if (jobId && jobMap[jobId]) {
          identity = LJF.buildCompanyIdentity({
            companyId: jobMap[jobId].companyId,
            companyUrl: jobMap[jobId].companySlug
              ? 'https://www.linkedin.com/company/' + jobMap[jobId].companySlug + '/'
              : null,
            displayName: jobMap[jobId].companyName,
          });
          if (identity) identity.jobId = jobId;
        }
      }

      if (!identity) {
        showCardRow(card);
        return;
      }
      withCompany += 1;

      if (LJF.matchesBlocked(identity, blockedCompanies, jobMap)) {
        hideCardRow(card);
        hidden += 1;
      } else {
        showCardRow(card);
      }

      if (index < 8) {
        samples.push({
          tag: card.tagName,
          componentkey: card.getAttribute && card.getAttribute('componentkey'),
          jobId: identity.jobId || LJF.extractJobIdFromCard(card),
          company: identity.displayName,
          key: identity.key,
          keys: LJF.identityKeys(identity),
          hidden: !!card.getAttribute(BLOCKED_ATTR),
        });
      }
    });

    return {
      listRoot: listRoot
        ? listRoot.getAttribute('componentkey') || listRoot.getAttribute('data-testid') || listRoot.tagName
        : null,
      cards: cards.length,
      withCompany: withCompany,
      hidden: hidden,
      jobMapSize: Object.keys(jobMap).length,
      samples: samples,
    };
  }

  function applyDetailButton() {
    const pane = LJF.findDetailPane(document);
    if (!pane) return { detail: false, button: false, company: null };

    const existing = pane.querySelectorAll('.' + BTN_CLASS);
    const identity = LJF.extractCompanyFromDetailPane(pane);
    if (!identity) {
      Array.prototype.forEach.call(existing, function (b) {
        b.remove();
      });
      pane.removeAttribute(DETAIL_PROCESSED_ATTR);
      return { detail: true, button: false, company: null };
    }

    if (LJF.matchesBlocked(identity, blockedCompanies, jobMap)) {
      Array.prototype.forEach.call(existing, function (b) {
        b.remove();
      });
      return { detail: true, button: false, company: identity, blocked: true };
    }

    if (existing.length) {
      existing[0].dataset.ljfKey = identity.key;
      existing[0].disabled = false;
      existing[0].textContent = 'Bloquear empresa';
      for (let i = 1; i < existing.length; i++) existing[i].remove();
      pane.setAttribute(DETAIL_PROCESSED_ATTR, '1');
      return { detail: true, button: true, company: identity };
    }

    const anchor =
      (LJF.findButtonAnchor && LJF.findButtonAnchor(pane)) ||
      pane.querySelector('a[href*="/company/"]') ||
      pane;
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
      lastScanStats = { path: location.pathname, active: false, version: VERSION };
      return lastScanStats;
    }

    removeListButtons();
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
      jobMapSize: listStats.jobMapSize,
      detail: detailStats.detail,
      detailButton: !!detailStats.button,
      detailCompany: detailStats.company
        ? {
            key: detailStats.company.key,
            displayName: detailStats.company.displayName,
            companyUrl: detailStats.company.companyUrl,
            logoUrl: detailStats.company.logoUrl,
            aliases: LJF.identityKeys(detailStats.company),
          }
        : null,
      blockedCount: Object.keys(blockedCompanies || {}).length,
      blockedKeys: Object.keys(blockedCompanies || {}),
      samples: listStats.samples,
    };

    log('scan', lastScanStats);
    if (!listStats.cards) {
      logAlways('Diagnóstico: 0 tarjetas en lazy-column — LJFDebug.status()');
    } else if (Object.keys(blockedCompanies).length && listStats.hidden === 0) {
      logAlways(
        'Diagnóstico: hay empresas bloqueadas pero 0 ocultas. Compara blockedKeys vs samples[].keys',
        lastScanStats.blockedKeys,
        listStats.samples
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
    observer = new MutationObserver(function () {
      scheduleScan();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['componentkey', 'data-occludable-job-id', 'style', 'class'],
    });
    const detail = LJF.findDetailPane(document);
    if (detail && detail !== root) {
      observer.observe(detail, { childList: true, subtree: true });
    }
    // Also watch document body for lazy-column replacement after RSC navigation
    if (root !== document.body) {
      observer.observe(document.body, { childList: true, subtree: false });
    }
    log('MutationObserver anclado a', root.getAttribute && root.getAttribute('componentkey') || root.tagName);
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
    document.querySelectorAll('[' + DETAIL_PROCESSED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(DETAIL_PROCESSED_ATTR);
    });
    document.querySelectorAll('.' + BTN_CLASS).forEach(function (btn) {
      btn.remove();
    });
    document.querySelectorAll('[' + BLOCKED_ATTR + '], .' + HIDDEN_CLASS).forEach(function (el) {
      el.removeAttribute(BLOCKED_ATTR);
      el.classList.remove(HIDDEN_CLASS);
      applyInlineHide(el, false);
    });
  }

  function listenBridge() {
    window.addEventListener('ljf-bridge', function (ev) {
      const detail = (ev && ev.detail) || {};
      if (detail.type === 'job-map' && detail.mappings && detail.mappings.length) {
        detail.mappings.forEach(function (row) {
          if (!row || !row.jobId) return;
          jobMap[row.jobId] = Object.assign({}, jobMap[row.jobId] || {}, row);
        });
        log('job-map +' + detail.mappings.length + ' total=' + Object.keys(jobMap).length);
        scheduleScan();
      }
      if (detail.type === 'dismiss-capture' && detail.body) {
        LJF.storage
          .saveDismissCapture({
            url: detail.url,
            body: detail.body,
            method: detail.method || 'POST',
            capturedAt: new Date().toISOString(),
          })
          .then(function () {
            logAlways(
              'Capturado dismissJobMutation nativo. Activa «Usar dismiss de LinkedIn» en el popup si quieres reutilizarlo (opt-in).'
            );
          });
      }
      if (detail.type === 'dismiss-result') {
        log('dismiss-result', detail);
      }
      if (detail.type === 'bridge-ready') {
        log('page-bridge listo');
      }
    });
  }

  /**
   * Opt-in: if we have a captured dismiss template and setting enabled,
   * try to dismiss visible job cards for the blocked company (same-origin only).
   */
  function maybeDismissVisibleJobs(identity) {
    if (!settings.useNativeDismiss) return;
    LJF.storage.getDismissCapture().then(function (capture) {
      if (!capture || !capture.body || !capture.url) {
        logAlways(
          'Dismiss opt-in activo pero no hay plantilla. Haz clic en el dismiss nativo de LinkedIn una vez (⋯ → Descartar) con ljfDebug=1 para capturarla.'
        );
        return;
      }
      const listRoot = LJF.findResultsListRoot(document);
      const cards = LJF.findJobCards(listRoot || document);
      let queued = 0;
      cards.forEach(function (card) {
        let id = LJF.extractCompanyFromCard(card);
        id = enrichIdentity(id, card);
        if (!id || !LJF.matchesBlocked(id, blockedCompanies, jobMap)) return;
        const jobId = (id.jobId || LJF.extractJobIdFromCard(card) || '').toString();
        if (!jobId) return;
        // Replace first long numeric id in the captured body with this jobId (best-effort)
        let body = capture.body;
        const replaced = body.replace(/\d{6,}/, jobId);
        if (replaced === body) {
          log('dismiss: no numeric job id field found in captured body');
          return;
        }
        body = replaced;
        queued += 1;
        // Rate-limit: stagger requests
        setTimeout(function () {
          window.dispatchEvent(
            new CustomEvent('ljf-dismiss-request', {
              detail: {
                url: capture.url,
                body: body,
                method: capture.method || 'POST',
                headers: { 'content-type': 'application/json' },
              },
            })
          );
        }, queued * 600);
      });
      if (queued) logAlways('Dismiss nativo encolado para', queued, 'ofertas (opt-in, best-effort)');
    });
  }

  function init() {
    ensureHideStylesheet();
    listenBridge();
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

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes.settings) return;
        settings = Object.assign({}, settings, changes.settings.newValue || {});
      });
    }
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
      logAlways('Debug ON — recarga o LJFDebug.scan()');
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
      console.info('[LJF] jobMap sample', Object.keys(jobMap).slice(0, 10).map(function (k) {
        return { jobId: k, meta: jobMap[k] };
      }));
      return stats;
    },
    scan: function () {
      resetProcessed();
      const stats = scanAndApply();
      console.info('[LJF] scan', stats);
      return stats;
    },
    jobMap: function () {
      return jobMap;
    },
    last: function () {
      return lastScanStats;
    },
  };
})();
