/**
 * Popup: list and unblock blocked companies.
 */
(function () {
  'use strict';

  const listRoot = document.getElementById('list-root');
  const countEl = document.getElementById('count');

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

      const meta = document.createElement('div');
      meta.className = 'meta';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = entry.displayName || entry.key;

      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = entry.blockedAt ? 'Bloqueada: ' + formatDate(entry.blockedAt) : '';

      meta.appendChild(name);
      if (date.textContent) meta.appendChild(date);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'unblock';
      btn.textContent = 'Desbloquear';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        LJF.storage.unblockCompany(entry.key).then(refresh);
      });

      li.appendChild(meta);
      li.appendChild(btn);
      ul.appendChild(li);
    });

    listRoot.innerHTML = '';
    listRoot.appendChild(ul);
  }

  function refresh() {
    return LJF.storage.getBlockedCompanies().then(render);
  }

  refresh();
  LJF.storage.onBlockedChange(render);
})();
