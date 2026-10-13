// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

// Generates src/transitions/generated.ts from the GameMaker transition prefab (github.com/opera-gaming, MIT): every
// shaders/shdr_*/shdr_*.fsh plus its defaults from objects/obj_transition/Create_0.gml, credited to the author of
// the gl-transitions shader it was ported from.
//
//   node tools/import-transitions.mjs <prefab-transition>/transitions <gl-transitions>
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creditsFrom, renderGenerated } from './transitions.mjs';

const [root, glTransitions] = process.argv.slice(2);
if (!root || !glTransitions)
  throw new Error('usage: node tools/import-transitions.mjs <prefab-transition>/transitions <gl-transitions>');
const credit = creditsFrom(glTransitions);

const create = readFileSync(join(root, 'objects/obj_transition/Create_0.gml'), 'utf8');
const shaderOrder = [...create.matchAll(/^\s*(shdr_\w+),\s*$/gm)].map((m) => m[1]);
// `  { starting_angle_f: 90.0}, // kAngular - shdr_angular`
const defaults = new Map();
for (const m of create.matchAll(/^\s*(\{.*\}),\s*\/\/\s*k\w+\s*-\s*(shdr_\w+)/gm)) {
  const json = m[1].replace(/(\w+)\s*:/g, '"$1":').replace(/,\s*\}/g, '}');
  defaults.set(m[2], JSON.parse(json));
}

/** GameMaker param keys carry a type suffix; a few have none and are floats. */
function toUniform(key, value) {
  const m = /^(.*)_(f|i|b|vec2|vec3|vec4)$/.exec(key);
  const [name, kind] = m ? [m[1], m[2]] : [key, 'f'];
  return { name, kind, value: kind === 'b' ? (value ? 1 : 0) : value };
}

const label = (shader) =>
  shader
    .replace(/^shdr_/, '')
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * GLSL ES 1.0 drivers let a global be initialised from uniforms; GLSL ES 3.0 does not. Such globals become plain
 * declarations, assigned (in order) at the top of main().
 */
function hoistGlobalInitialisers(src) {
  const assigns = [];
  const decl = /^\s*(float|vec2|vec3|vec4|int|ivec2|bool)\s+(\w+)\s*=\s*(.+?);[ \t]*(\/\/.*)?$/;
  let depth = 0; // only declarations outside every function body are globals
  const lines = src.split('\n').map((line) => {
    const m = depth === 0 ? decl.exec(line) : null;
    for (const ch of line.replace(/\/\/.*$/, '')) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    if (!m) return line;
    assigns.push(`  ${m[2]} = ${m[3]};`);
    return `${m[1]} ${m[2]};`;
  });
  if (!assigns.length) return src;
  return lines.join('\n').replace(/void\s+main\s*\(\s*\)\s*\{/, (m) => `${m}\n${assigns.join('\n')}`);
}

const shaders = readdirSync(join(root, 'shaders')).filter((d) => d.startsWith('shdr_'));
const entries = shaderOrder
  .filter((s) => shaders.includes(s))
  .map((shader) => {
    const src = hoistGlobalInitialisers(
      readFileSync(join(root, 'shaders', shader, `${shader}.fsh`), 'utf8').replace(/\r\n/g, '\n'),
    );
    const params = Object.entries(defaults.get(shader) ?? {}).map(([k, v]) => toUniform(k, v));
    const id = shader.replace(/^shdr_/, '');
    const { author, license } = credit(id);
    return { id, label: label(shader), author, license, params, source: src };
  });

const out = renderGenerated(entries);
const dest = join(dirname(fileURLToPath(import.meta.url)), '../src/transitions/generated.ts');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out);
console.log(`${entries.length} transitions -> ${dest}`);
