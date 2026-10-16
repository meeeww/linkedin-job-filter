/**
 * LinkedIn Job Filter — content script
 * Injects «Bloquear empresa», hides blocked companies, watches for scroll-loaded cards.
 */
(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-ljf-processed';
  const BTN_CLASS = 'ljf-block-btn';
  const HIDDEN_CLASS = 'ljf-hidden';
  const DEBOUNCE_MS = 100;

  let blockedCompanies = {};
  let settings = Object.assign({}, LJF.storage.DEFAULT_SETTINGS);
  let observer = null;
  let debounceTimer = null;
  let observedRoot = null;

  function log() {
    if (typeof console !== 'undefined' && console.debug) {
      // Prefix helps filter in DevTools when debugging selector breakage
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[LJF]');
      console.debug.apply(console, args);
    }
  }

  function findListRoot() {
    return LJF.queryFirst(LJF.selectors.jobListRoots, document) || document.body;
  }

  function getAnchor(card) {
    return LJF.queryFirst(LJF.selectors.buttonAnchors, card) || card;
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
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'Bloqueando…';
        LJF.storage
          .blockCompany(identity, 'job-card')
          .then(function () {
            // storage.onChanged will refresh; apply immediately for snappy UX
            return LJF.storage.getBlockedCompanies();
          })
          .then(function (map) {
            blockedCompanies = map;
            scanAndApply();
          })
          .catch(function (err) {
            log('Error al bloquear', err);
            btn.disabled = false;
            btn.textContent = 'Bloquear empresa';
          });
      },
      true
    );

    return btn;
  }

  function shouldHide(identity, card) {
    if (!identity) return false;
    if (!LJF.matchesBlocked(identity, blockedCompanies)) return false;
    if (!settings.hidePromoted && LJF.isPromotedCard(card)) {
      // Still hide organic; if somehow only promoted flag matters we keep default true
    }
    return true;
  }

  function applyCardState(card) {
    const identity = LJF.extractCompanyFromCard(card);
    if (!identity) {
      card.classList.remove(HIDDEN_CLASS);
      return;
    }

    if (shouldHide(identity, card)) {
      card.classList.add(HIDDEN_CLASS);
      return;
    }

    card.classList.remove(HIDDEN_CLASS);

    if (!settings.showBlockButton) return;
    if (card.getAttribute(PROCESSED_ATTR) === '1' && card.querySelector('.' + BTN_CLASS)) {
      return;
    }

    // Avoid duplicate buttons
    if (card.querySelector('.' + BTN_CLASS)) {
      card.setAttribute(PROCESSED_ATTR, '1');
      return;
    }

    const anchor = getAnchor(card);
    const btn = createBlockButton(identity);
    anchor.appendChild(btn);
    card.setAttribute(PROCESSED_ATTR, '1');
  }

  function scanAndApply() {
    const cards = LJF.findJobCards(document);
    if (!cards.length) {
      log('No se encontraron tarjetas de empleo (selectores pueden haber cambiado)');
    }
    cards.forEach(applyCardState);
  }

  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      scanAndApply();
      ensureObserver();
    }, DEBOUNCE_MS);
  }

  function ensureObserver() {
    const root = findListRoot();
    if (observer && observedRoot === root) return;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

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
    log('MutationObserver anclado a', root === document.body ? 'body' : root.className || root.tagName);
  }

  function watchSpaNavigation() {
    let lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // LinkedIn SPA navigation — re-bind observer and re-scan
        observedRoot = null;
        scheduleScan();
      }
    }, 1000);
  }

  function init() {
    LJF.storage.loadAll().then(function (all) {
      blockedCompanies = all.blockedCompanies || {};
      settings = all.settings || settings;
      scanAndApply();
      ensureObserver();
      watchSpaNavigation();
    });

    LJF.storage.onBlockedChange(function (map) {
      blockedCompanies = map || {};
      resetProcessedCards();
      scanAndApply();
    });
  }

  function resetProcessedCards() {
    document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(PROCESSED_ATTR);
      const btn = el.querySelector('.' + BTN_CLASS);
      if (btn) btn.remove();
      el.classList.remove(HIDDEN_CLASS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for the local fixture harness
  globalThis.LJFContent = {
    scanAndApply: scanAndApply,
    scheduleScan: scheduleScan,
    refreshFromStorage: function refreshFromStorage() {
      return LJF.storage.loadAll().then(function (all) {
        blockedCompanies = all.blockedCompanies || {};
        settings = all.settings || settings;
        resetProcessedCards();
        scanAndApply();
      });
    },
  };
})();
