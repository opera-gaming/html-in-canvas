// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { detectFromContext } from '../src/capabilities';

describe('detectFromContext', () => {
  it('reports unsupported when there is no context', () => {
    expect(detectFromContext(null)).toEqual({ webgl2: false, api: null, supported: false });
  });

  it('reports unsupported when neither API exists', () => {
    const gl = { texImage2D() {} };
    expect(detectFromContext(gl)).toEqual({ webgl2: true, api: null, supported: false });
  });

  it('prefers texElementImage2D when present', () => {
    const gl = { texElementImage2D() {}, texElementSubImage2D() {} };
    expect(detectFromContext(gl).api).toBe('texElementImage2D');
    expect(detectFromContext(gl).supported).toBe(true);
  });

  it('accepts texElementSubImage2D alone', () => {
    const gl = { texElementSubImage2D() {} };
    expect(detectFromContext(gl)).toEqual({ webgl2: true, api: 'texElementSubImage2D', supported: true });
  });
});
