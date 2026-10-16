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
      // Drop parenthetical suffixes: "Acme Corp (ACC)" → "acme corp"
      .replace(/\([^)]{0,40}\)/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Job id from SDUI componentkey / data attributes / view links.
   * @param {Element} card
   * @returns {string|null}
   */
  LJF.extractJobIdFromCard = function extractJobIdFromCard(card) {
    if (!card) return null;
    const key =
      (card.getAttribute && (card.getAttribute('componentkey') || card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id'))) ||
      '';
    let m = String(key).match(/job-card-component-ref-(\d+)/i) || String(key).match(/^(\d{5,})$/);
    if (m) return m[1];
    if (card.querySelector) {
      const nested = card.querySelector('[componentkey*="job-card-component-ref-"]');
      if (nested) {
        m = String(nested.getAttribute('componentkey') || '').match(/job-card-component-ref-(\d+)/i);
        if (m) return m[1];
      }
      const link = card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
      if (link) {
        const href = link.getAttribute('href') || '';
        m = href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/);
        if (m) return m[1];
      }
    }
    return null;
  };

  /**
   * All comparable keys for an identity (for multi-key matching).
   * @param {{ key?: string, companyId?: string|null, companyUrl?: string|null, displayName?: string }} identity
   * @returns {string[]}
   */
  LJF.identityKeys = function identityKeys(identity) {
    const keys = [];
    if (!identity) return keys;
    if (identity.key) keys.push(identity.key);
    if (identity.companyId) keys.push('company:' + identity.companyId);
    if (identity.companyUrl) {
      const parsed = LJF.parseCompanyHref(identity.companyUrl);
      if (parsed.pathname) keys.push('url:' + parsed.pathname);
      if (parsed.companyId) keys.push('company:' + parsed.companyId);
      // Also slug without trailing slash variants
      if (parsed.pathname) {
        const slug = parsed.pathname.replace(/^\/company\//, '').replace(/\/$/, '');
        if (slug && !/^\d+$/.test(slug)) keys.push('slug:' + slug.toLowerCase());
      }
    }
    if (identity.displayName) {
      const n = LJF.normalizeName(identity.displayName);
      if (n) keys.push('name:' + n);
    }
    if (identity.aliases && identity.aliases.length) {
      identity.aliases.forEach(function (a) {
        if (a) keys.push(a);
      });
    }
    return Array.from(new Set(keys));
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
   * Canonical company profile URL (strip /life/, /about/, query, hash).
   * @param {string} href
   * @returns {string|null}
   */
  LJF.canonicalCompanyUrl = function canonicalCompanyUrl(href) {
    const parsed = LJF.parseCompanyHref(href);
    return parsed.companyUrl || null;
  };

  /**
   * Build the primary storage key and identity payload from available fields.
   * @param {{ companyId?: string|null, companyUrl?: string|null, displayName?: string|null, logoUrl?: string|null }} info
   * @returns {{ key: string, companyId: string|null, companyUrl: string|null, displayName: string, logoUrl: string|null }|null}
   */
  LJF.buildCompanyIdentity = function buildCompanyIdentity(info) {
    const displayName = (info && info.displayName ? String(info.displayName).trim() : '') || '';
    let companyId = (info && info.companyId) || null;
    let companyUrl = (info && info.companyUrl) || null;
    const logoUrl = (info && info.logoUrl) || null;

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
      logoUrl: logoUrl,
    };
  };

  /**
   * Pick the best company logo URL from a detail-pane subtree.
   * @param {Element} root
   * @returns {string|null}
   */
  LJF.extractLogoUrl = function extractLogoUrl(root) {
    if (!root || !root.querySelectorAll) return null;

    const imgs = root.querySelectorAll('img[src]');
    let fallback = null;
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.getAttribute('src') || '';
      if (!src || src.indexOf('data:') === 0) continue;
      // Skip tiny tracking pixels
      const w = parseInt(img.getAttribute('width') || '0', 10);
      const h = parseInt(img.getAttribute('height') || '0', 10);
      if ((w && w < 16) || (h && h < 16)) continue;

      const alt = (img.getAttribute('alt') || img.getAttribute('aria-label') || '').toLowerCase();
      const nearCompany =
        (img.closest && img.closest('a[href*="/company/"]')) ||
        /logo|empresa|company|logotipo/i.test(alt);

      if (nearCompany) {
        // Prefer absolute LinkedIn media URLs
        if (/^https?:\/\//i.test(src)) return src;
        if (!fallback) fallback = src;
      } else if (!fallback && /media\.licdn\.com|company-logo|\/company\//i.test(src)) {
        fallback = src;
      }
    }
    return fallback;
  };

  /**
   * Extract rich company identity from the job detail pane (has /company/ links + logos).
   * @param {Element} pane
   * @returns {{ key: string, companyId: string|null, companyUrl: string|null, displayName: string, logoUrl: string|null }|null}
   */
  LJF.extractCompanyFromDetailPane = function extractCompanyFromDetailPane(pane) {
    if (!pane) return null;

    let companyUrl = null;
    let companyId = null;
    let displayName = '';
    let logoUrl = null;

    const link =
      pane.querySelector('a[href*="/company/"]') ||
      pane.querySelector('[aria-label*="Empresa," i] a[href*="/company/"]') ||
      pane.querySelector('[aria-label*="Company," i] a[href*="/company/"]');

    if (link) {
      companyUrl = LJF.canonicalCompanyUrl(link.getAttribute('href') || link.href);
      const parsed = LJF.parseCompanyHref(companyUrl || link.getAttribute('href'));
      companyId = parsed.companyId;
      displayName = cleanLabel(link.textContent);

      const labeled =
        link.closest('[aria-label*="Empresa," i], [aria-label*="Company," i]') ||
        pane.querySelector('[aria-label*="Empresa," i], [aria-label*="Company," i]');
      if (labeled) {
        const aria = labeled.getAttribute('aria-label') || '';
        const m = aria.match(/Empresa,\s*(.+)$/i) || aria.match(/Company,\s*(.+)$/i);
        if (m) displayName = cleanLabel(m[1]);
      }

      if (!displayName) {
        const img = link.querySelector('img[alt]');
        if (img) {
          displayName = cleanLabel(img.getAttribute('alt')).replace(
            /^(logotipo de empresa para|company logo for)\s+/i,
            ''
          );
        }
      }

      logoUrl = LJF.extractLogoUrl(link) || LJF.extractLogoUrl(link.parentElement) || null;
    }

    if (!logoUrl) logoUrl = LJF.extractLogoUrl(pane);

    if (!displayName) {
      // Fallback to text heuristics inside the pane header region
      displayName = LJF.inferCompanyNameFromText(pane);
    }

    return LJF.buildCompanyIdentity({
      companyId: companyId,
      companyUrl: companyUrl,
      displayName: displayName,
      logoUrl: logoUrl,
    });
  };

  function cleanLabel(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeNoiseLine(line) {
    if (!line || line.length < 2) return true;
    if (line === '·' || line === '•' || line === '|') return true;
    if (/^\d+\s*(ofertas|jobs|results)/i.test(line)) return true;
    if (
      /^(promoted|patrocinad|sponsored|easy apply|solicitudaci[oó]n sencilla|adelántate|evaluando solicitudes)/i.test(
        line
      )
    ) {
      return true;
    }
    // Posted-time / relative dates (use word boundaries — avoid matching "mes" inside names)
    if (
      /(hace\s+\d|\d+\s*(hour|hours|day|days|week|weeks|month|months|hora|horas|día|días|semana|semanas|mes|meses)\b|\bago$)/i.test(
        line
      ) &&
      line.length < 48
    ) {
      return true;
    }
    if (/^\d[\d.,\s]*\s*(€|\$|£|¥|k\b)/i.test(line)) return true; // salary snippets
    if (/\bcontactos? trabajan aquí\b/i.test(line)) return true;
    if (/^[\d.,\s€$£¥·•\-–—]+$/.test(line)) return true;
    return false;
  }

  function looksLikeJobTitleLine(line) {
    if (!line) return false;
    // Verified jobs often append this in the title <p>
    if (/\(empleo verificado\)/i.test(line)) return true;
    // Titles often use "Role | Focus" or are quite long; keep threshold high so
    // long company names (e.g. "NewPoint Information Technology Consulting") pass
    if (/\s\|\s/.test(line)) return true;
    if (line.length >= 72) return true;
    return false;
  }

  function looksLikeLocationLine(line) {
    if (!line) return false;
    return (
      /\((en remoto|remoto|remote|hybrid|híbrido|on-?site|presencial)\)/i.test(line) ||
      /^(remote|híbrido|hybrid|presencial)\b/i.test(line) ||
      /\b(área metropolitana|metropolitan area)\b/i.test(line)
    );
  }

  /**
   * Infer company display name from card text when no /company/ link exists
   * (common on /jobs/search-results/ SDUI cards).
   *
   * Ground truth (2026 search-results): title in first <p>, company in the next
   * short <p> (e.g. "Hasten Group"), then location ("España (En remoto)").
   *
   * @param {Element} card
   * @returns {string}
   */
  LJF.inferCompanyNameFromText = function inferCompanyNameFromText(card) {
    if (!card) return '';

    // Logo alt text is often the company name (skip empty alts common on SDUI)
    const imgs = card.querySelectorAll ? card.querySelectorAll('img[alt], img[aria-label]') : [];
    for (let i = 0; i < imgs.length; i++) {
      const alt = cleanLabel(imgs[i].getAttribute('alt') || imgs[i].getAttribute('aria-label'));
      if (!alt) continue;
      if (/logo|photo|profile|image|avatar/i.test(alt) && alt.length < 12) continue;
      if (alt.length >= 2 && alt.length <= 60 && !/^linkedin/i.test(alt)) {
        return alt.replace(/\s+logo$/i, '').trim();
      }
    }

    // aria-label on the card: sometimes "Job title at Company"
    const aria = cleanLabel(card.getAttribute && card.getAttribute('aria-label'));
    if (aria) {
      const atMatch = aria.match(/\bat\s+(.+)$/i) || aria.match(/\ben\s+(.+)$/i);
      if (atMatch && atMatch[1] && atMatch[1].length < 60) {
        return cleanLabel(atMatch[1]);
      }
    }

    // Prefer direct <p> texts — matches search-results markup:
    //   p0 title (may be long / duplicated), p1 company, p2 location, then meta
    const paras = card.querySelectorAll ? card.querySelectorAll('p') : [];
    const lines = [];
    const seen = new Set();
    Array.prototype.forEach.call(paras, function (el) {
      let t = cleanLabel(el.textContent);
      if (!t) return;
      // Title nodes often duplicate visible + aria-hidden text; collapse repeats
      t = t.replace(/(.+?)\1\b/g, '$1').replace(/(.+?)\s+\1\b/g, '$1').trim();
      if (!t || seen.has(t)) return;
      if (looksLikeNoiseLine(t)) return;
      seen.add(t);
      lines.push(t);
    });

    // On LinkedIn job cards the first meaningful line is the title; company is next.
    // Only treat a single-line card as "company-only" (rare).
    if (lines.length >= 2) {
      for (let i = 1; i < lines.length; i++) {
        if (looksLikeLocationLine(lines[i])) continue;
        if (looksLikeJobTitleLine(lines[i])) continue;
        if (lines[i].length > 70) continue;
        return lines[i];
      }
    } else if (lines.length === 1 && !looksLikeJobTitleLine(lines[0]) && !looksLikeLocationLine(lines[0])) {
      return lines[0];
    }

    // Fallback: innerText split — same title-then-company rule
    const raw = cleanLabel(card.innerText || card.textContent || '');
    const textLines = raw
      .split('\n')
      .map(cleanLabel)
      .filter(function (l) {
        return l && !looksLikeNoiseLine(l);
      });
    if (textLines.length >= 2) {
      for (let i = 1; i < textLines.length; i++) {
        if (looksLikeLocationLine(textLines[i])) continue;
        if (looksLikeJobTitleLine(textLines[i])) continue;
        if (textLines[i].length <= 70) return textLines[i];
      }
    }

    return '';
  };

  /**
   * Extract company identity from a job card element.
   * @param {Element} card
   * @returns {{ key: string, companyId: string|null, companyUrl: string|null, displayName: string }|null}
   */
  LJF.extractCompanyFromCard = function extractCompanyFromCard(card) {
    if (!card) return null;

    let companyUrl = null;
    let companyId = null;
    let displayName = '';

    // 1) Explicit /company/ links (strongest signal)
    const links = card.querySelectorAll ? card.querySelectorAll('a[href*="/company/"]') : [];
    if (links.length) {
      const link = links[0];
      const href = link.getAttribute('href') || link.href;
      const parsed = LJF.parseCompanyHref(href);
      companyUrl = parsed.companyUrl;
      companyId = parsed.companyId;
      displayName = cleanLabel(link.textContent);
      // Sometimes the link wraps only a logo with empty text
      if (!displayName) {
        const img = link.querySelector && link.querySelector('img[alt]');
        if (img) displayName = cleanLabel(img.getAttribute('alt'));
      }
    }

    // 2) Legacy / named company nodes
    if (!displayName && LJF.selectors) {
      const nameEl = LJF.queryFirst(LJF.selectors.companyName, card);
      if (nameEl) {
        displayName = cleanLabel(nameEl.textContent);
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

    // 3) data-company-id
    if (!companyId) {
      let dataId = card.getAttribute && card.getAttribute('data-company-id');
      if (!dataId && card.querySelector) {
        const el = card.querySelector('[data-company-id]');
        if (el) dataId = el.getAttribute('data-company-id');
      }
      if (dataId && /^\d+$/.test(dataId)) companyId = dataId;
    }

    // 4) Text / logo heuristics for SDUI cards without company links
    if (!displayName) {
      displayName = LJF.inferCompanyNameFromText(card);
    }

    const built = LJF.buildCompanyIdentity({
      companyId: companyId,
      companyUrl: companyUrl,
      displayName: displayName,
      logoUrl: null,
    });
    if (built) {
      built.jobId = LJF.extractJobIdFromCard(card);
    }
    return built;
  };

  /**
   * Whether a card looks promoted/sponsored.
   * @param {Element} card
   * @returns {boolean}
   */
  LJF.isPromotedCard = function isPromotedCard(card) {
    if (!card) return false;
    if (LJF.selectors && LJF.queryFirst(LJF.selectors.promotedMarkers, card)) return true;
    const text = (card.textContent || '').slice(0, 500);
    const patterns = (LJF.selectors && LJF.selectors.promotedTextPatterns) || [
      /patrocinad[oa]/i,
      /promoted/i,
      /sponsored/i,
    ];
    return patterns.some(function (re) {
      return re.test(text);
    });
  };

  /**
   * True if the card matches any blocked identity (by id, url, slug, or normalized name).
   * Optional jobMap: { [jobId]: { companyId, companySlug, companyName } } from RSC bridge.
   * @param {{ key: string, companyId?: string|null, companyUrl?: string|null, displayName?: string, jobId?: string|null }} identity
   * @param {Record<string, object>} blockedMap
   * @param {Record<string, object>} [jobMap]
   * @returns {boolean}
   */
  LJF.matchesBlocked = function matchesBlocked(identity, blockedMap, jobMap) {
    if (!identity || !blockedMap) return false;

    // Enrich from RSC job map when list cards lack /company/ links
    if (identity.jobId && jobMap && jobMap[identity.jobId]) {
      const meta = jobMap[identity.jobId];
      if (!identity.companyId && meta.companyId) identity.companyId = meta.companyId;
      if (!identity.companyUrl && meta.companySlug) {
        identity.companyUrl = 'https://www.linkedin.com/company/' + meta.companySlug + '/';
      }
      if (!identity.displayName && meta.companyName) identity.displayName = meta.companyName;
      if (!identity.key) {
        const rebuilt = LJF.buildCompanyIdentity(identity);
        if (rebuilt) identity.key = rebuilt.key;
      }
    }

    const idKeys = LJF.identityKeys(identity);
    for (let i = 0; i < idKeys.length; i++) {
      if (blockedMap[idKeys[i]]) return true;
    }

    const blockedKeys = Object.keys(blockedMap);
    for (let i = 0; i < blockedKeys.length; i++) {
      const entry = blockedMap[blockedKeys[i]];
      if (!entry) continue;
      const entryKeys = LJF.identityKeys(entry);
      for (let j = 0; j < idKeys.length; j++) {
        if (entryKeys.indexOf(idKeys[j]) !== -1) return true;
      }

      // Soft name containment for slight mismatches (min length 4)
      const a = LJF.normalizeName(identity.displayName || '');
      const b = LJF.normalizeName(entry.displayName || '');
      if (a && b && a.length >= 4 && b.length >= 4 && (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) {
        return true;
      }
    }
    return false;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
