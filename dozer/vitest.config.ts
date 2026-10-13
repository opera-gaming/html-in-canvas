// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Process page.css so tests can read the capture rules via `?raw`.
    css: { include: [/page\.css/] },
  },
});
