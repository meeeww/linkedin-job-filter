/**
 * chrome.storage.local abstraction for the blocked-company list.
 */
(function (global) {
  'use strict';

  const LJF = global.LJF || (global.LJF = {});

  const STORAGE_KEYS = {
    blockedCompanies: 'blockedCompanies',
    settings: 'settings',
    schemaVersion: 'schemaVersion',
  };

  const DEFAULT_SETTINGS = {
    hideMode: 'remove',
    hidePromoted: true,
    showBlockButton: true,
  };

  const SCHEMA_VERSION = 1;

  function getStorageArea() {
    if (global.chrome && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    // In-memory fallback for the local HTML fixture / unit checks
    if (!global.__LJF_MEMORY_STORAGE__) {
      global.__LJF_MEMORY_STORAGE__ = {
        blockedCompanies: {},
        settings: Object.assign({}, DEFAULT_SETTINGS),
        schemaVersion: SCHEMA_VERSION,
      };
    }
    const mem = global.__LJF_MEMORY_STORAGE__;
    return {
      get: function (keys, cb) {
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(function (k) {
          if (k in mem) out[k] = mem[k];
        });
        Promise.resolve().then(function () {
          cb(out);
        });
      },
      set: function (obj, cb) {
        Object.keys(obj).forEach(function (k) {
          mem[k] = obj[k];
        });
        Promise.resolve().then(function () {
          if (typeof cb === 'function') cb();
          if (global.__LJF_ON_STORAGE_CHANGED__) {
            const changes = {};
            Object.keys(obj).forEach(function (k) {
              changes[k] = { newValue: obj[k] };
            });
            global.__LJF_ON_STORAGE_CHANGED__(changes);
          }
        });
      },
    };
  }

  LJF.storage = {
    KEYS: STORAGE_KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SCHEMA_VERSION: SCHEMA_VERSION,

    /**
     * @returns {Promise<{ blockedCompanies: Record<string, object>, settings: object, schemaVersion: number }>}
     */
    loadAll: function loadAll() {
      return new Promise(function (resolve) {
        getStorageArea().get(
          [STORAGE_KEYS.blockedCompanies, STORAGE_KEYS.settings, STORAGE_KEYS.schemaVersion],
          function (data) {
            resolve({
              blockedCompanies: data[STORAGE_KEYS.blockedCompanies] || {},
              settings: Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.settings] || {}),
              schemaVersion: data[STORAGE_KEYS.schemaVersion] || SCHEMA_VERSION,
            });
          }
        );
      });
    },

    /**
     * @returns {Promise<Record<string, object>>}
     */
    getBlockedCompanies: function getBlockedCompanies() {
      return LJF.storage.loadAll().then(function (all) {
        return all.blockedCompanies;
      });
    },

    /**
     * Persist a blocked company entry.
     * @param {object} identity from LJF.buildCompanyIdentity
     * @param {string} [source='job-card']
     * @returns {Promise<object>} the stored entry
     */
    blockCompany: function blockCompany(identity, source) {
      if (!identity || !identity.key) {
        return Promise.reject(new Error('Identidad de empresa inválida'));
      }
      return LJF.storage.loadAll().then(function (all) {
        const entry = {
          key: identity.key,
          companyId: identity.companyId || null,
          companyUrl: identity.companyUrl || null,
          displayName: identity.displayName || identity.key,
          logoUrl: identity.logoUrl || null,
          blockedAt: new Date().toISOString(),
          source: source || 'job-card',
        };
        // Merge with existing so we keep the richest set of identifiers
        const prev = all.blockedCompanies[identity.key];
        if (prev) {
          entry.companyId = entry.companyId || prev.companyId || null;
          entry.companyUrl = entry.companyUrl || prev.companyUrl || null;
          entry.displayName = entry.displayName || prev.displayName;
          entry.logoUrl = entry.logoUrl || prev.logoUrl || null;
          entry.blockedAt = prev.blockedAt || entry.blockedAt;
        }
        all.blockedCompanies[identity.key] = entry;
        return LJF.storage._saveBlocked(all.blockedCompanies).then(function () {
          return entry;
        });
      });
    },

    /**
     * @param {string} key
     * @returns {Promise<void>}
     */
    unblockCompany: function unblockCompany(key) {
      return LJF.storage.getBlockedCompanies().then(function (map) {
        if (map[key]) delete map[key];
        return LJF.storage._saveBlocked(map);
      });
    },

    /**
     * @param {Record<string, object>} map
     * @returns {Promise<void>}
     */
    _saveBlocked: function _saveBlocked(map) {
      return new Promise(function (resolve) {
        const payload = {};
        payload[STORAGE_KEYS.blockedCompanies] = map;
        payload[STORAGE_KEYS.schemaVersion] = SCHEMA_VERSION;
        getStorageArea().set(payload, function () {
          resolve();
        });
      });
    },

    /**
     * Subscribe to storage changes (Chrome or fixture memory).
     * @param {(blockedCompanies: Record<string, object>) => void} callback
     */
    onBlockedChange: function onBlockedChange(callback) {
      if (global.chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          if (changes[STORAGE_KEYS.blockedCompanies]) {
            callback(changes[STORAGE_KEYS.blockedCompanies].newValue || {});
          }
        });
      } else {
        global.__LJF_ON_STORAGE_CHANGED__ = function (changes) {
          if (changes[STORAGE_KEYS.blockedCompanies]) {
            callback(changes[STORAGE_KEYS.blockedCompanies].newValue || {});
          }
        };
      }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
