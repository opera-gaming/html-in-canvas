// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Injected by snapshot-site.mjs --gx. GX Corner redirects away without Opera GX's internal APIs, so stub
// the few it calls (product/version, localised strings, tabs); everything else resolves to undefined.
(() => {
  const label = (k) =>
    k
      .replace(/^(title|label|button|btn|text|desc|tooltip|header|heading|cta|section|menu|nav)_/, '')
      .replace(/_/g, ' ')
      .replace(/\bgx\b/g, 'GX')
      .replace(/^./, (c) => c.toUpperCase());
  // The real strings table ships with the browser; derive labels from snake_case keys in the page's scripts.
  const strings = async () => {
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => /\.m?js(\?|$)/.test(u));
    const texts = await Promise.all(
      urls.map((u) =>
        fetch(u)
          .then((r) => r.text())
          .catch(() => ''),
      ),
    );
    const out = {};
    for (const t of texts)
      for (const m of t.matchAll(/[`'"]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)[`'"]/g)) out[m[1]] = label(m[1]);
    return out;
  };
  const values = {
    getProduct: () => 'Opera GX',
    getVersion: () => '120.0.5543.61',
    getEdition: () => 'GX',
    query: () => [{ id: 1, windowId: 1 }],
    getCurrent: () => ({ id: 1, windowId: 1 }),
    getStrings: strings,
  };
  const api = (name) =>
    new Proxy(function () {}, {
      get(_t, k) {
        if (k === 'then') return undefined; // not a thenable
        if (k === 'addListener' || k === 'removeListener' || k === 'hasListener') return () => {};
        return api(k);
      },
      apply(_t, _this, args) {
        const p = Promise.resolve(values[name]?.());
        for (const a of args) if (typeof a === 'function') p.then((v) => a(v));
        return p;
      },
    });
  window.opr = api('opr');
  window.chrome = Object.assign(window.chrome || {}, {
    operaResourcesPrivate: api('operaResourcesPrivate'),
    settingsPrivate: api('settingsPrivate'),
    management: api('management'),
    tabs: api('tabs'),
    windows: api('windows'),
  });
})();
