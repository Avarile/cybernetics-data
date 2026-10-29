import fs from 'fs';
import path from 'path';

/**
 * Cockpit design §9.2: layers depend downward only. Each top folder may import the folders listed
 * for it; the module file (agent.module.ts) is the composition root and may import anything.
 */
const allowed: Record<string, string[]> = {
  domain: ['domain'],
  application: ['domain', 'application', 'pack'],
  infrastructure: ['domain', 'application', 'infrastructure', 'pack'],
  toolkits: ['domain', 'application', 'toolkits', 'pack'],
  runtime: ['domain', 'toolkits', 'infrastructure', 'runtime', 'pack'],
  interface: ['application', 'domain', 'interface'],
  pack: ['domain', 'pack'],
};

/** Imports that broke the rules before they were checked; frozen, so no new one gets in. */
const knownExceptions = new Set([
  'application/admin/manage-credentials.usecase.ts -> infrastructure/execution-context',
  'application/chat/cancel-run.usecase.ts -> infrastructure/runs/run-registry',
  'application/chat/resume-turn.usecase.ts -> runtime/ui-parts',
  'application/chat/run-turn.usecase.ts -> runtime/ui-parts',
  'application/chat/turn-gate.ts -> infrastructure/runs/run-registry',
  'application/chat/turn-gate.ts -> runtime/agent-runtime',
  'application/installation/ensure-installation.usecase.ts -> infrastructure/agent-home',
  'application/installation/ensure-installation.usecase.ts -> infrastructure/execution-context',
  'application/installation/membership-scheduler.ts -> infrastructure/agent-home',
  'application/knowledge/knowledge-ingest.ts -> infrastructure/knowledge/chunker',
  'application/knowledge/knowledge-ingest.ts -> infrastructure/knowledge/pg-rag-store',
  'application/knowledge/knowledge-sync.scheduler.ts -> infrastructure/knowledge/search-tables',
  'application/knowledge/knowledge-sync.ts -> infrastructure/knowledge/pg-rag-store',
  'application/knowledge/knowledge-sync.ts -> infrastructure/knowledge/search-tables',
  'application/status/agent-status.query.ts -> infrastructure/execution-context',
  'application/threads/manage-threads.usecase.ts -> runtime/message-mapper',
  'interface/agent-settings.controller.ts -> infrastructure/execution-context',
  'toolkits/knowledge/knowledge.toolkit.ts -> infrastructure/knowledge/search-tables',
  'toolkits/tool-wrapper.ts -> infrastructure/execution-context',
]);

const root = __dirname;

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });

/** `file -> target` for every relative import that leaves the file's allowed layers. */
export function layerViolations(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file);
    const layer = rel.split(path.sep)[0];
    if (!allowed[layer]) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from '(\.[^']+)'/g)) {
      const target = path.relative(root, path.resolve(path.dirname(file), match[1]));
      if (target.startsWith('..')) continue;
      if (!allowed[layer].includes(target.split(path.sep)[0])) out.push(`${rel} -> ${target}`);
    }
  }
  return out;
}

describe('agent module layers', () => {
  it('imports only downward, apart from the frozen exceptions', () => {
    expect(layerViolations().filter((v) => !knownExceptions.has(v))).toEqual([]);
  });

  it('keeps no stale exception', () => {
    const now = new Set(layerViolations());
    expect([...knownExceptions].filter((v) => !now.has(v))).toEqual([]);
  });
});
