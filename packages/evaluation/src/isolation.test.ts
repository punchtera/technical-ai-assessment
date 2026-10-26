import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './paths.js';

/** Recursively lists source files of an application, skipping generated code. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'generated') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : [];
  });
}

describe('ground-truth isolation', () => {
  it('application source never references synthetic labels or the evaluation package', () => {
    const offenders: string[] = [];
    for (const app of ['apps/api/src', 'apps/web/src', 'packages/triage-core/src']) {
      for (const file of sourceFiles(join(REPO_ROOT, app))) {
        const text = readFileSync(file, 'utf8');
        if (/ground-truth|labels\.jsonl|@fis\/evaluation|data\/synthetic/.test(text)) {
          offenders.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
