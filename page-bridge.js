/**
 * MAIN-world bridge (document_start).
 * - Intercepts fetch to map jobId → company from search-results RSC streams
 * - Captures LinkedIn native dismissJobMutation request bodies for optional replay
 * Communicates with the isolated content script via window CustomEvents (no cookies stored).
 */
(function () {
  'use strict';
  if (window.__LJF_PAGE_BRIDGE__) return;
  window.__LJF_PAGE_BRIDGE__ = true;

  const CHANNEL = 'ljf-bridge';

  function emit(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent(CHANNEL, { detail: Object.assign({ type: type }, detail || {}) }));
    } catch (_) {
      /* ignore */
    }
  }

  function extractMappings(text) {
    if (!text || typeof text !== 'string') return [];
    const found = [];
    const seen = new Set();

    // job-card-component-ref-123 or "jobId":123 / jobUrn ...:123
    const jobIds = new Set();
    const jobIdRe = /job-card-component-ref-(\d{5,})|(?:jobId|job_id|currentJobId)["'\s:=]+(\d{5,})|urn:li:job[A-Za-z]*:(\d{5,})/gi;
    let m;
    while ((m = jobIdRe.exec(text))) {
      const id = m[1] || m[2] || m[3];
      if (id) jobIds.add(id);
    }

    // company URL slugs / numeric ids near company references
    const companyUrls = [];
    const companyRe = /\/company\/([A-Za-z0-9\-_%]+)\/?/g;
    while ((m = companyRe.exec(text))) {
      companyUrls.push(decodeURIComponent(m[1]));
    }

    // Heuristic pairs: for each job id, look at a local window for company slug/name
    jobIds.forEach(function (jobId) {
      const idx = text.indexOf(jobId);
      if (idx === -1) return;
      const windowText = text.slice(Math.max(0, idx - 800), Math.min(text.length, idx + 1200));
      const slugMatch = windowText.match(/\/company\/([A-Za-z0-9\-_%]+)/);
      const nameMatch =
        windowText.match(/"companyName"\s*:\s*"([^"]{2,80})"/) ||
        windowText.match(/"company"\s*:\s*\{\s*"name"\s*:\s*"([^"]{2,80})"/) ||
        windowText.match(/Empresa,\s*([^"<\n]{2,80})/);
      const companyIdMatch = windowText.match(/urn:li:fsd_company:(\d+)/) || windowText.match(/"companyId"\s*:\s*"?(\d+)"?/);

      const payload = {
        jobId: jobId,
        companySlug: slugMatch ? decodeURIComponent(slugMatch[1]) : null,
        companyId: companyIdMatch ? companyIdMatch[1] : null,
        companyName: nameMatch ? nameMatch[1] : null,
      };
      const key = jobId + ':' + (payload.companyId || payload.companySlug || payload.companyName || '');
      if (seen.has(key)) return;
      seen.add(key);
      if (payload.companyId || payload.companySlug || payload.companyName) {
        found.push(payload);
      }
    });

    return found;
  }

  async function readBodyClone(response) {
    try {
      const clone = response.clone();
      const ct = (clone.headers && clone.headers.get && clone.headers.get('content-type')) || '';
      // Prefer text; octet-stream RSC often still has extractable UTF-8 strings
      if (/json|text|javascript|stream|octet/i.test(ct) || !ct) {
        return await clone.text();
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function () {
      const args = arguments;
      const input = args[0];
      const init = args[1] || {};
      let url = '';
      try {
        url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      } catch (_) {
        url = '';
      }

      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

      // Capture native dismiss mutation body (for opt-in replay later)
      if (/rsc-action\/actions\/server-request/i.test(url) && /dismissJobMutation/i.test(url)) {
        try {
          let body = init.body;
          if (typeof body === 'string') {
            emit('dismiss-capture', { url: url, body: body, method: method });
          } else if (body && typeof body === 'object' && typeof body.text === 'function') {
            body.text().then(function (t) {
              emit('dismiss-capture', { url: url, body: t, method: method });
            });
          }
        } catch (_) {
          /* ignore */
        }
      }

      return nativeFetch.apply(this, args).then(function (response) {
        try {
          const streamHeader =
            response.headers && response.headers.get && response.headers.get('x-li-rsc-stream');
          if (
            /flagship-web\/jobs\/search-results/i.test(url) ||
            streamHeader === 'true' ||
            /search-results/i.test(url)
          ) {
            readBodyClone(response).then(function (text) {
              const mappings = extractMappings(text);
              if (mappings.length) {
                emit('job-map', { mappings: mappings, url: url });
              }
            });
          }
        } catch (_) {
          /* ignore */
        }
        return response;
      });
    };
  }

  // Allow isolated world to request a dismiss replay (opt-in only; body from prior capture)
  window.addEventListener('ljf-dismiss-request', function (ev) {
    const detail = (ev && ev.detail) || {};
    if (!detail || !detail.url || !detail.body) {
      emit('dismiss-result', { ok: false, error: 'missing url/body' });
      return;
    }
    nativeFetch(detail.url, {
      method: detail.method || 'POST',
      credentials: 'same-origin',
      headers: detail.headers || { 'content-type': 'application/json' },
      body: detail.body,
    })
      .then(function (res) {
        emit('dismiss-result', { ok: res.ok, status: res.status });
      })
      .catch(function (err) {
        emit('dismiss-result', { ok: false, error: String(err && err.message ? err.message : err) });
      });
  });

  emit('bridge-ready', { ok: true });
})();
