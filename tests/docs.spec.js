// @ts-check
// Doc-drift guard: every source module under js/ must be referenced by name in
// CLAUDE.md. This enforces "updating the docs is part of done" — a stale
// CLAUDE.md silently misleads every future session (human or AI). If this fails,
// you added or renamed a module without documenting it: add a bullet to the
// Architecture section of CLAUDE.md describing what it does.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Playwright runs specs from the repo root; package.json is type:commonjs, so
// avoid import.meta here (unsupported by the CJS transform).
const ROOT = process.cwd();

/** recursively list *.js under js/ (relative paths, forward slashes) */
function listModules(dir = 'js', acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) listModules(rel, acc);
    else if (entry.name.endsWith('.js')) acc.push(rel);
  }
  return acc;
}

test('every js/ module is documented in CLAUDE.md', () => {
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const modules = listModules();
  // A module counts as documented if its basename (e.g. `guide.js`) appears in
  // CLAUDE.md — bullets reference either the basename or the full path.
  const undocumented = modules.filter((m) => !claude.includes(path.basename(m)));
  expect(undocumented, `Undocumented modules — add them to CLAUDE.md:\n${undocumented.join('\n')}`).toEqual([]);
});
