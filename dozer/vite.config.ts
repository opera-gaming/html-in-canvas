// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';

process.env.VITE_SITE_BASE ??= '/';

export default defineConfig({
  server: { port: 5180, strictPort: true },
  build: { target: 'es2022' },
});
