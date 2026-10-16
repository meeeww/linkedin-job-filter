/**
 * Company identity extraction and key normalization.
 * Preference: company ID → canonical URL pathname → normalized name.
 */
(function (global) {
  'use strict';

  const LJF = global.LJF || (global.LJF = {});

  /**
   * @param {string} name
   * @returns {string}
   */
  LJF.normalizeName = function normalizeName(name) {
    if (!name) return '';
    return String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Parse a LinkedIn company href into id and/or pathname.
   * @param {string} href
   * @returns {{ companyId: string|null, companyUrl: string|null, pathname: string|null }}
   */
  LJF.parseCompanyHref = function parseCompanyHref(href) {
    const empty = { companyId: null, companyUrl: null, pathname: null };
    if (!href) return empty;
    try {
      const url = new URL(href, 'https://www.linkedin.com');
      const match = url.pathname.match(/\/company\/([^/?#]+)/i);
      if (!match) return empty;
      const slug = decodeURIComponent(match[1]).replace(/\/$/, '');
      const pathname = '/company/' + slug.toLowerCase() + '/';
      const companyUrl = 'https://www.linkedin.com' + pathname;
      const companyId = /^\d+$/.test(slug) ? slug : null;
      return { companyId: companyId, companyUrl: companyUrl, pathname: pathname };
    } catch (_) {
      return empty;
    }
  };

  /**
   * Build the primary storage key and identity payload from available fields.
   * @param {{ companyId?: string|null, companyUrl?: string|null, displayName?: string|null }} info
   * @returns {{ key: string, companyId: string|null, companyUrl: string|null, displayName: string }|null}
   */
  LJF.buildCompanyIdentity = function buildCompanyIdentity(info) {
    const displayName = (info && info.displayName ? String(info.displayName).trim() : '') || '';
    let companyId = (info && info.companyId) || null;
    let companyUrl = (info && info.companyUrl) || null;

    if (companyUrl) {
      const parsed = LJF.parseCompanyHref(companyUrl);
      if (parsed.companyUrl) companyUrl = parsed.companyUrl;
      if (!companyId && parsed.companyId) companyId = parsed.companyId;
    }

    let key = null;
    if (companyId) {
      key = 'company:' + companyId;
    } else if (companyUrl) {
      const parsed = LJF.parseCompanyHref(companyUrl);
      if (parsed.pathname) key = 'url:' + parsed.pathname;
    }

    if (!key) {
      const normalized = LJF.normalizeName(displayName);
      if (!normalized) return null;
      key = 'name:' + normalized;
    }

    return {
      key: key,
      companyId: companyId,
      companyUrl: companyUrl,
      displayName: displayName || companyId || companyUrl || key,
    };
  };

  /**
   * Extract company identity from a job card element.
   * @param {Element} card
   * @returns {{ key: string, companyId: string|null, companyUrl: string|null, displayName: string }|null}
   */
  LJF.extractCompanyFromCard = function extractCompanyFromCard(card) {
    if (!card || !LJF.selectors) return null;

    let companyUrl = null;
    let companyId = null;
    let displayName = '';

    const link = LJF.queryFirst(LJF.selectors.companyLinks, card);
    if (link) {
      const href = link.getAttribute('href') || link.href;
      const parsed = LJF.parseCompanyHref(href);
      companyUrl = parsed.companyUrl;
      companyId = parsed.companyId;
      displayName = (link.textContent || '').trim();
    }

    if (!displayName) {
      const nameEl = LJF.queryFirst(LJF.selectors.companyName, card);
      if (nameEl) {
        displayName = (nameEl.textContent || '').trim().replace(/\s+/g, ' ');
        if (!companyUrl) {
          const nested = nameEl.querySelector && nameEl.querySelector('a[href*="/company/"]');
          if (nested) {
            const parsed = LJF.parseCompanyHref(nested.getAttribute('href') || nested.href);
            companyUrl = parsed.companyUrl;
            companyId = companyId || parsed.companyId;
          }
        }
      }
    }

    // data attributes sometimes carry company / job metadata
    if (!companyId) {
      let dataId = card.getAttribute('data-company-id');
      if (!dataId && card.querySelector) {
        const el = card.querySelector('[data-company-id]');
        if (el) dataId = el.getAttribute('data-company-id');
      }
      if (dataId && /^\d+$/.test(dataId)) companyId = dataId;
    }

    return LJF.buildCompanyIdentity({
      companyId: companyId,
      companyUrl: companyUrl,
      displayName: displayName,
    });
  };

  /**
   * Whether a card looks promoted/sponsored.
   * @param {Element} card
   * @returns {boolean}
   */
  LJF.isPromotedCard = function isPromotedCard(card) {
    if (!card || !LJF.selectors) return false;
    if (LJF.queryFirst(LJF.selectors.promotedMarkers, card)) return true;
    const text = (card.textContent || '').slice(0, 500);
    return LJF.selectors.promotedTextPatterns.some(function (re) {
      return re.test(text);
    });
  };

  /**
   * True if the card matches any blocked identity (by id, url, or name).
   * @param {{ key: string, companyId?: string|null, companyUrl?: string|null, displayName?: string }} identity
   * @param {Record<string, object>} blockedMap
   * @returns {boolean}
   */
  LJF.matchesBlocked = function matchesBlocked(identity, blockedMap) {
    if (!identity || !blockedMap) return false;
    if (blockedMap[identity.key]) return true;

    if (identity.companyId && blockedMap['company:' + identity.companyId]) return true;

    if (identity.companyUrl) {
      const parsed = LJF.parseCompanyHref(identity.companyUrl);
      if (parsed.pathname && blockedMap['url:' + parsed.pathname]) return true;
      if (parsed.companyId && blockedMap['company:' + parsed.companyId]) return true;
    }

    const nameKey = 'name:' + LJF.normalizeName(identity.displayName);
    if (identity.displayName && blockedMap[nameKey]) return true;

    // Cross-match: blocked entry may have stored alternate identifiers
    const keys = Object.keys(blockedMap);
    for (let i = 0; i < keys.length; i++) {
      const entry = blockedMap[keys[i]];
      if (!entry) continue;
      if (identity.companyId && entry.companyId && identity.companyId === entry.companyId) return true;
      if (identity.companyUrl && entry.companyUrl) {
        const a = LJF.parseCompanyHref(identity.companyUrl).pathname;
        const b = LJF.parseCompanyHref(entry.companyUrl).pathname;
        if (a && b && a === b) return true;
      }
      if (
        identity.displayName &&
        entry.displayName &&
        LJF.normalizeName(identity.displayName) === LJF.normalizeName(entry.displayName)
      ) {
        return true;
      }
    }
    return false;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
