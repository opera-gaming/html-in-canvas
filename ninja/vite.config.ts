// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@kit': resolve(import.meta.dirname, '../kit') } },
  server: { port: 5182, strictPort: true, fs: { allow: [resolve(import.meta.dirname, '..')] } },
  build: { target: 'es2022' },
});
