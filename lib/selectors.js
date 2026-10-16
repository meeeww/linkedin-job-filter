/**
 * Centralized DOM selectors / heuristics for LinkedIn Jobs.
 * Prefer stable signals (hrefs, data-*, componentkey, role, aria) over CSS class names.
 * Covers legacy /jobs/search and newer /jobs/search-results (SDUI / hashed classes).
 */
(function (global) {
  'use strict';

  const LJF = global.LJF || (global.LJF = {});

  LJF.selectors = {
    /**
     * Scrolling results list (search-results SDUI).
     * Ground truth: data-testid="lazy-column" componentkey="SearchResultsMainContent"
     */
    resultsListRoots: [
      '[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
      '[data-component-type="LazyColumn"][componentkey="SearchResultsMainContent"]',
      '[data-testid="lazy-column"]',
      '.jobs-search-results-list',
      '.scaffold-layout__list',
      '.jobs-search__results-list',
      'ul.scaffold-layout__list-container',
      'div.jobs-search-results-list',
      '[data-results-list-top-scroll-marker]',
    ],

    /** Observer / legacy fallback roots */
    jobListRoots: [
      '[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
      '[data-testid="lazy-column"]',
      '.jobs-search-results-list',
      '.scaffold-layout__list',
      '.jobs-search__results-list',
      'ul.scaffold-layout__list-container',
      'div.jobs-search-results-list',
      '[data-results-list-top-scroll-marker]',
      'main',
      '[role="main"]',
    ],

    /**
     * Selected job detail pane (right/main panel on search-results).
     * Ground truth: data-sdui-screen="...SemanticJobDetails"
     */
    detailPanes: [
      '[data-sdui-screen*="SemanticJobDetails"]',
      '[data-sdui-screen*="JobDetails"]',
      '.jobs-search__job-details--container',
      '.job-view-layout',
      '.jobs-details',
      '.scaffold-layout__detail',
    ],

    /**
     * Individual job cards — attribute / role first, class names last.
     * search-results UI: div[role=button][componentkey^=job-card...]
     */
    jobCards: [
      '[data-occludable-job-id]',
      '[data-job-id]',
      'li[data-occludable-job-id]',
      'div[componentkey^="job-card-component-ref-"]',
      'div[componentkey^="job-card"]',
      'div[role="button"][componentkey*="job-card"]',
      'div[role="button"][componentkey*="jobCard"]',
      'div[role="listitem"][componentkey*="job"]',
      'li.jobs-search-results__list-item',
      'li.scaffold-layout__list-item',
      'div.job-card-container',
      'div.base-card.job-search-card',
      'div.job-search-card',
      'article.job-search-card',
    ],

    /** Links that identify a job listing */
    jobViewLinks: [
      'a[href*="/jobs/view/"]',
      'a[href*="currentJobId="]',
      'a[href*="/jobs/search-results/"][href*="currentJobId"]',
    ],

    /** Company name / link within a card */
    companyLinks: [
      'a[href*="/company/"]',
      'a[href*="linkedin.com/company/"]',
    ],

    /** Logo / avatar images often carry the company name in alt */
    companyImages: [
      'img[alt]',
      'img[aria-label]',
    ],

    /** Visible company name text (legacy class hooks + loose fallbacks) */
    companyName: [
      '.job-card-container__primary-description',
      '.job-card-container__company-name',
      '.artdeco-entity-lockup__subtitle',
      'h4.base-search-card__subtitle',
      '.job-card-list__company-name',
      '[data-testid*="company"]',
      '[class*="company-name" i]',
      '[class*="primary-description" i]',
    ],

    /** Anchor point to insert the block button (detail pane only) */
    buttonAnchors: [
      'a[href*="/company/"]',
      '[aria-label*="Empresa," i]',
      '[aria-label*="Company," i]',
      '.job-details-jobs-unified-top-card__company-name',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.jobs-unified-top-card__company-name',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      'h4.base-search-card__subtitle',
    ],

    promotedMarkers: [
      '.job-card-container__footer-item--promoted',
      '[class*="promoted" i]',
      '[class*="Promoted"]',
      '[aria-label*="Promoted" i]',
      '[aria-label*="Patrocinad" i]',
    ],

    promotedTextPatterns: [/patrocinad[oa]/i, /promoted/i, /sponsored/i],
  };

  LJF.queryFirst = function queryFirst(selectorList, root) {
    const scope = root || document;
    for (let i = 0; i < selectorList.length; i++) {
      try {
        const el = scope.querySelector(selectorList[i]);
        if (el) return el;
      } catch (_) {
        /* ignore invalid selectors */
      }
    }
    return null;
  };

  LJF.queryAllFirstMatch = function queryAllFirstMatch(selectorList, root) {
    const scope = root || document;
    for (let i = 0; i < selectorList.length; i++) {
      try {
        const nodes = scope.querySelectorAll(selectorList[i]);
        if (nodes && nodes.length) {
          return Array.prototype.slice.call(nodes);
        }
      } catch (_) {
        /* ignore */
      }
    }
    return [];
  };

  function addCardCandidate(seen, cards, node) {
    if (!node || node.nodeType !== 1 || seen.has(node)) return;

    let ancestorIsCard = false;
    seen.forEach(function (existing) {
      if (existing.contains && existing.contains(node) && existing !== node) {
        ancestorIsCard = true;
      }
    });
    if (ancestorIsCard) return;

    const toRemove = [];
    seen.forEach(function (existing) {
      if (node.contains(existing) && existing !== node) {
        toRemove.push(existing);
      }
    });
    toRemove.forEach(function (inner) {
      seen.delete(inner);
      const idx = cards.indexOf(inner);
      if (idx !== -1) cards.splice(idx, 1);
    });

    seen.add(node);
    cards.push(node);
  }

  /**
   * Walk up from a job/company link to a sensible card container.
   * @param {Element} el
   * @returns {Element|null}
   */
  LJF.closestJobCard = function closestJobCard(el) {
    if (!el || !el.closest) return null;

    const byAttr =
      el.closest('[data-occludable-job-id]') ||
      el.closest('[data-job-id]') ||
      el.closest('[componentkey*="job-card" i]') ||
      el.closest('[componentkey*="jobCard" i]') ||
      el.closest('div[role="button"][componentkey]') ||
      el.closest('li.jobs-search-results__list-item') ||
      el.closest('li.scaffold-layout__list-item') ||
      el.closest('div.job-card-container') ||
      el.closest('div.base-card') ||
      el.closest('article');

    if (byAttr) return byAttr;

    // Generic: climb until a block that looks like a list row (bounded depth)
    let node = el;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
      const parent = node.parentElement;
      if (!parent) break;
      const role = parent.getAttribute && parent.getAttribute('role');
      const tag = parent.tagName;
      if (
        tag === 'LI' ||
        role === 'listitem' ||
        role === 'button' ||
        (parent.getAttribute && parent.getAttribute('componentkey'))
      ) {
        return parent;
      }
      // Prefer a container that also has a company signal
      if (
        parent.querySelector &&
        (parent.querySelector('a[href*="/company/"]') ||
          parent.querySelector('a[href*="/jobs/view/"]')) &&
        parent !== document.body &&
        parent.childElementCount >= 1
      ) {
        // Keep climbing one more if parent is tiny wrapper
        if (parent.offsetHeight && parent.offsetHeight < 40) {
          node = parent;
          continue;
        }
        return parent;
      }
      node = parent;
    }
    return null;
  };

  /**
   * Results list container (lazy-column), preferring SearchResultsMainContent.
   * @param {ParentNode} [root=document]
   * @returns {Element|null}
   */
  LJF.findResultsListRoot = function findResultsListRoot(root) {
    const scope = root || document;
    const preferred = LJF.queryFirst(
      [
        '[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
        '[data-component-type="LazyColumn"][componentkey="SearchResultsMainContent"]',
      ],
      scope
    );
    if (preferred) return preferred;

    // Any lazy-column that already contains job cards
    let columns;
    try {
      columns = scope.querySelectorAll('[data-testid="lazy-column"], [data-component-type="LazyColumn"]');
    } catch (_) {
      columns = [];
    }
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      // Skip detail-pane lazy columns (nested under SemanticJobDetails)
      if (col.closest && col.closest('[data-sdui-screen*="JobDetails"], [data-sdui-screen*="SemanticJobDetails"]')) {
        continue;
      }
      if (
        col.querySelector &&
        (col.querySelector('[componentkey^="job-card-component-ref-"]') ||
          col.querySelector('[data-occludable-job-id]') ||
          col.querySelector('div.job-card-container'))
      ) {
        return col;
      }
    }

    return LJF.queryFirst(LJF.selectors.resultsListRoots, scope);
  };

  /**
   * Selected job detail pane.
   * @param {ParentNode} [root=document]
   * @returns {Element|null}
   */
  LJF.findDetailPane = function findDetailPane(root) {
    return LJF.queryFirst(LJF.selectors.detailPanes, root || document);
  };

  /**
   * True if node lives inside the scrolling results lazy-column (not detail).
   * @param {Element} el
   * @returns {boolean}
   */
  LJF.isInResultsList = function isInResultsList(el) {
    if (!el || !el.closest) return false;
    const list = LJF.findResultsListRoot(document);
    if (list && list.contains(el)) {
      // Detail pane may itself contain a lazy-column; exclude those
      if (el.closest('[data-sdui-screen*="JobDetails"], [data-sdui-screen*="SemanticJobDetails"]')) {
        return false;
      }
      return true;
    }
    // Fallback: job-card refs are list items on search-results
    if (el.closest('[componentkey^="job-card-component-ref-"]')) {
      if (el.closest('[data-sdui-screen*="JobDetails"], [data-sdui-screen*="SemanticJobDetails"]')) {
        return false;
      }
      return true;
    }
    return false;
  };

  /**
   * Collect unique job cards using selectors + link heuristics.
   * @param {ParentNode} [root=document]
   * @returns {Element[]}
   */
  LJF.findJobCards = function findJobCards(root) {
    const scope = root || document;
    const seen = new Set();
    const cards = [];

    LJF.selectors.jobCards.forEach(function (sel) {
      let nodes;
      try {
        nodes = scope.querySelectorAll(sel);
      } catch (_) {
        return;
      }
      Array.prototype.forEach.call(nodes, function (node) {
        addCardCandidate(seen, cards, node);
      });
    });

    // Heuristic: any /jobs/view/ or currentJobId link → climb to card
    const linkSels = LJF.selectors.jobViewLinks.concat(['a[href*="/jobs/view/"]']);
    linkSels.forEach(function (sel) {
      let links;
      try {
        links = scope.querySelectorAll(sel);
      } catch (_) {
        return;
      }
      Array.prototype.forEach.call(links, function (link) {
        const card = LJF.closestJobCard(link);
        if (card) addCardCandidate(seen, cards, card);
      });
    });

    // Heuristic: company links that sit near job titles (search-results often has company <a>)
    try {
      const companyLinks = scope.querySelectorAll('a[href*="/company/"]');
      Array.prototype.forEach.call(companyLinks, function (link) {
        // Skip nav / footer chrome
        if (link.closest && (link.closest('header') || link.closest('nav') || link.closest('footer'))) {
          return;
        }
        const card = LJF.closestJobCard(link);
        if (!card) return;
        // Must look job-related: job view link, componentkey, or role=button list row
        const looksLikeJob =
          card.matches &&
          (card.matches('[componentkey*="job" i]') ||
            card.matches('[data-occludable-job-id]') ||
            card.matches('[data-job-id]') ||
            card.matches('[role="button"]') ||
            card.matches('li') ||
            !!card.querySelector('a[href*="/jobs/view/"]') ||
            !!card.querySelector('a[href*="currentJobId="]'));
        if (looksLikeJob) addCardCandidate(seen, cards, card);
      });
    } catch (_) {
      /* ignore */
    }

    return cards;
  };

  /**
   * Pick a DOM node to append the block button next to company info.
   * @param {Element} card
   * @returns {Element}
   */
  LJF.findButtonAnchor = function findButtonAnchor(card) {
    const fromSelectors = LJF.queryFirst(LJF.selectors.buttonAnchors, card);
    if (fromSelectors) return fromSelectors;

    const companyLink = card.querySelector && card.querySelector('a[href*="/company/"]');
    if (companyLink && companyLink.parentElement) return companyLink.parentElement;

    // search-results ground truth: company is the 2nd meaningful <p>
    if (card.querySelectorAll && LJF.inferCompanyNameFromText) {
      const companyName = LJF.inferCompanyNameFromText(card);
      if (companyName) {
        const paras = card.querySelectorAll('p');
        for (let i = 0; i < paras.length; i++) {
          const t = (paras[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (t === companyName || t.indexOf(companyName) !== -1) {
            return paras[i].parentElement || paras[i];
          }
        }
      }
    }

    // search-results: text often in data-display-contents paragraphs
    const display = card.querySelector && card.querySelector('[data-display-contents]');
    if (display && display.parentElement) return display.parentElement;

    return card;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
