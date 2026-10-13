// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pages = ['fire', 'teleport', 'endgame', 'electric', 'transitions', 'post', 'frost'];

export default defineConfig({
  resolve: { alias: { '@kit': resolve(import.meta.dirname, '../kit') } },
  server: { port: 5181, strictPort: true, fs: { allow: [resolve(import.meta.dirname, '..')] } },
  build: {
    target: 'es2022',
    // dist/ is copied into the site root, so keep its assets apart from other projects'.
    assetsDir: 'effects-assets',
    rolldownOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, p, 'index.html')])),
      // Keep /*! */ licence notices (the transition shaders') in the minified output.
      output: { comments: { legal: true } },
    },
  },
});
