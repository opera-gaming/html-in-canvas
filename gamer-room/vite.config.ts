// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // No SPA fallback: a missing screen page must 404 (not serve the room) so ScreenSurface shows its fallback page.
  appType: 'mpa',
  // Keep the bundled libraries' licence notices in the minified output.
  build: { target: 'es2022', rolldownOptions: { output: { comments: { legal: true } } } },
});
