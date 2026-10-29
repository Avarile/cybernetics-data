import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Cockpit design §9.3: everything of the agent lives in this folder, in layers that import
 * downward only. containers wire the rest and may import anything; index.ts is the public surface.
 */
const allowed: Record<string, string[]> = {
  model: ['model'],
  data: ['model', 'data'],
  state: ['model', 'data', 'state'],
  voice: ['model', 'state', 'voice'],
  hooks: ['model', 'data', 'state', 'hooks', 'voice'],
  ui: ['model', 'ui', 'voice'],
};
/** The model layer is plain TypeScript. */
const frameworkFree = /^(?:react|next|zustand|@tanstack\/)/;

const root = __dirname;
const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [full] : [];
  });

/** Why `spec`, imported by `rel` in `layer`, breaks the rules; undefined when it does not. */
function problem(rel: string, layer: string, file: string, spec: string): string | undefined {
  if (spec.startsWith('.')) {
    const target = path.relative(root, path.resolve(path.dirname(file), spec));
    if (target.startsWith('..')) return `${rel} -> ${spec} (outside the agent folder)`;
    return allowed[layer].includes(target.split(path.sep)[0]) ? undefined : `${rel} -> ${target}`;
  }
  if (spec.includes('/blocks/agent')) return `${rel} -> ${spec} (use a relative import)`;
  if (layer === 'model' && frameworkFree.test(spec)) {
    return `${rel} -> ${spec} (model is framework-free)`;
  }
  return undefined;
}

function violations(): string[] {
  return sourceFiles(root).flatMap((file) => {
    const rel = path.relative(root, file);
    const layer = rel.split(path.sep)[0];
    if (!allowed[layer]) return [];
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(/from '([^']+)'/g)]
      .map(([, spec]) => problem(rel, layer, file, spec))
      .filter((v): v is string => Boolean(v));
  });
}

describe('agent folder layers', () => {
  it('imports only downward and stays in the folder', () => {
    expect(violations()).toEqual([]);
  });
});
