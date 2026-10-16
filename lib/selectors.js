/**
 * Centralized DOM selectors for LinkedIn Jobs.
 * Ordered by reliability. Last verified against LinkedIn Jobs search markup (2026-03).
 * Update only this file when LinkedIn changes the DOM.
 */
(function (global) {
  'use strict';

  const LJF = global.LJF || (global.LJF = {});

  LJF.selectors = {
    /** Roots that typically wrap the job results list */
    jobListRoots: [
      '.jobs-search-results-list',
      '.scaffold-layout__list',
      '.jobs-search__results-list',
      'ul.scaffold-layout__list-container',
      'div.jobs-search-results-list',
      '[data-results-list-top-scroll-marker]',
    ],

    /** Individual job cards / list items */
    jobCards: [
      'li.jobs-search-results__list-item',
      'li.scaffold-layout__list-item[data-occludable-job-id]',
      'div.job-card-container',
      'div.job-card-list',
      'div.base-card.job-search-card',
      'li.ember-view.jobs-search-results__list-item',
      '[data-job-id]',
      'li[data-occludable-job-id]',
    ],

    /** Company name / link within a card (prefer /company/ links) */
    companyLinks: [
      'a[href*="/company/"]',
      'a.job-card-container__company-name',
      'a.job-card-container__primary-description',
      '.artdeco-entity-lockup__subtitle a[href*="/company/"]',
      'h4.base-search-card__subtitle a',
      'a[data-tracking-control-name*="company"]',
    ],

    /** Visible company name text (when no reliable link) */
    companyName: [
      '.job-card-container__primary-description',
      '.job-card-container__company-name',
      '.artdeco-entity-lockup__subtitle',
      'h4.base-search-card__subtitle',
      '.job-card-list__company-name',
      '[class*="job-card"] [class*="company"]',
    ],

    /** Anchor point to insert the block button (near company name) */
    buttonAnchors: [
      '.job-card-container__primary-description',
      '.artdeco-entity-lockup__subtitle',
      'h4.base-search-card__subtitle',
      '.job-card-container__metadata-wrapper',
      '.artdeco-entity-lockup__content',
      '.job-card-list__entity-lockup',
    ],

    /** Signals that a listing is promoted / sponsored */
    promotedMarkers: [
      '.job-card-container__footer-item--promoted',
      '[class*="promoted"]',
      '[class*="Promoted"]',
    ],

    promotedTextPatterns: [/patrocinad[oa]/i, /promoted/i, /sponsored/i],
  };

  /**
   * Return the first element matching any selector under root (or document).
   * @param {string[]} selectorList
   * @param {ParentNode} [root=document]
   * @returns {Element|null}
   */
  LJF.queryFirst = function queryFirst(selectorList, root) {
    const scope = root || document;
    for (let i = 0; i < selectorList.length; i++) {
      try {
        const el = scope.querySelector(selectorList[i]);
        if (el) return el;
      } catch (_) {
        /* ignore invalid selectors in older browsers */
      }
    }
    return null;
  };

  /**
   * Return all elements matching the first selector that yields results.
   * Falls back across the list so we do not double-count with overlapping selectors.
   * @param {string[]} selectorList
   * @param {ParentNode} [root=document]
   * @returns {Element[]}
   */
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

  /**
   * Collect unique job cards using all selectors, de-duplicating by node.
   * Prefers outermost cards when one matches nested inside another.
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
        if (seen.has(node)) return;
        // Skip if an ancestor is already a collected card
        let ancestorIsCard = false;
        seen.forEach(function (existing) {
          if (existing.contains && existing.contains(node) && existing !== node) {
            ancestorIsCard = true;
          }
        });
        if (ancestorIsCard) return;
        // If this node contains a previously collected inner card, replace it
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
      });
    });

    return cards;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
