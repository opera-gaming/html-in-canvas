// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

export type HtmlInCanvasApi = 'texElementImage2D' | 'texElementSubImage2D' | null;

export interface Capabilities {
  webgl2: boolean;
  api: HtmlInCanvasApi;
  supported: boolean;
}

export function detectFromContext(gl: object | null): Capabilities {
  if (!gl) return { webgl2: false, api: null, supported: false };
  let api: HtmlInCanvasApi = null;
  if ('texElementImage2D' in gl) api = 'texElementImage2D';
  else if ('texElementSubImage2D' in gl) api = 'texElementSubImage2D';
  return { webgl2: true, api, supported: api !== null };
}

export function detectCapabilities(): Capabilities {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  const caps = detectFromContext(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return caps;
}
