/**
 * Popup: list/unblock + opt-in native dismiss setting.
 */
(function () {
  'use strict';

  const listRoot = document.getElementById('list-root');
  const countEl = document.getElementById('count');
  const optDismiss = document.getElementById('opt-dismiss');
  const dismissStatus = document.getElementById('dismiss-status');

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('es', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch (_) {
      return iso;
    }
  }

  function companyHref(entry) {
    if (entry.companyUrl) return entry.companyUrl;
    if (entry.companyId) return 'https://www.linkedin.com/company/' + entry.companyId + '/';
    const name = entry.displayName || '';
    if (name) {
      return (
        'https://www.linkedin.com/search/results/companies/?keywords=' +
        encodeURIComponent(name)
      );
    }
    return null;
  }

  function sortedEntries(map) {
    return Object.keys(map)
      .map(function (key) {
        return map[key];
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return String(b.blockedAt || '').localeCompare(String(a.blockedAt || ''));
      });
  }

  function render(map) {
    const entries = sortedEntries(map || {});
    countEl.textContent =
      entries.length === 0
        ? ''
        : entries.length === 1
          ? '1 empresa bloqueada'
          : entries.length + ' empresas bloqueadas';

    if (!entries.length) {
      listRoot.innerHTML = '<p class="empty">No hay empresas bloqueadas.</p>';
      return;
    }

    const ul = document.createElement('ul');
    entries.forEach(function (entry) {
      const li = document.createElement('li');

      const logoWrap = document.createElement('div');
      logoWrap.className = 'logo-wrap';
      if (entry.logoUrl && /^https?:\/\//i.test(entry.logoUrl)) {
        const img = document.createElement('img');
        img.className = 'logo';
        img.alt = '';
        img.width = 36;
        img.height = 36;
        img.referrerPolicy = 'no-referrer';
        img.src = entry.logoUrl;
        img.addEventListener('error', function () {
          logoWrap.textContent = (entry.displayName || '?').charAt(0).toUpperCase();
          logoWrap.classList.add('logo-fallback');
        });
        logoWrap.appendChild(img);
      } else {
        logoWrap.classList.add('logo-fallback');
        logoWrap.textContent = (entry.displayName || '?').charAt(0).toUpperCase();
      }

      const meta = document.createElement('div');
      meta.className = 'meta';

      const href = companyHref(entry);
      if (href) {
        const nameLink = document.createElement('a');
        nameLink.className = 'name';
        nameLink.href = href;
        nameLink.target = '_blank';
        nameLink.rel = 'noopener noreferrer';
        nameLink.textContent = entry.displayName || entry.key;
        if (!entry.companyUrl && !entry.companyId) {
          nameLink.title = 'Buscar empresa en LinkedIn (sin URL guardada)';
        }
        meta.appendChild(nameLink);
      } else {
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = entry.displayName || entry.key;
        meta.appendChild(name);
      }

      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = entry.blockedAt ? 'Bloqueada: ' + formatDate(entry.blockedAt) : '';
      if (date.textContent) meta.appendChild(date);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'unblock';
      btn.textContent = 'Desbloquear';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        LJF.storage.unblockCompany(entry.key).then(refresh);
      });

      li.appendChild(logoWrap);
      li.appendChild(meta);
      li.appendChild(btn);
      ul.appendChild(li);
    });

    listRoot.innerHTML = '';
    listRoot.appendChild(ul);
  }

  function refreshDismissStatus() {
    return Promise.all([LJF.storage.getSettings(), LJF.storage.getDismissCapture()]).then(
      function (pair) {
        const settings = pair[0] || {};
        const capture = pair[1];
        optDismiss.checked = !!settings.useNativeDismiss;
        if (capture && capture.capturedAt) {
          dismissStatus.textContent =
            'Plantilla dismiss capturada: ' + formatDate(capture.capturedAt) + '.';
        } else {
          dismissStatus.textContent =
            'Sin plantilla aún. En Jobs: localStorage.ljfDebug="1", recarga, abre ⋯ en una tarjeta y pulsa Descartar una vez.';
        }
      }
    );
  }

  optDismiss.addEventListener('change', function () {
    LJF.storage.saveSettings({ useNativeDismiss: !!optDismiss.checked }).then(refreshDismissStatus);
  });

  function refresh() {
    return LJF.storage.getBlockedCompanies().then(render);
  }

  refresh();
  refreshDismissStatus();
  LJF.storage.onBlockedChange(render);
})();
