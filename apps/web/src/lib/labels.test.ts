import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HandoutStatus, RoleName } from '@hmp/db';
import { EVENT_ROLE_MATRIX } from '@hmp/workflow';
import { ENTITY_LABEL, STATUS_LABEL, actionSentence, roleLabel, statusLabel } from './labels';

// Plain words everywhere: every status, role, workflow event and audit action
// the code can record has a sentence, so nothing raw reaches a page.

const FALLBACK = 'Updated the request';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('labels', () => {
  it('every handout status has a label, and none is the raw code', () => {
    for (const s of Object.values(HandoutStatus)) {
      expect(STATUS_LABEL[s], s).toBeTruthy();
      expect(statusLabel(s)).not.toBe(s);
    }
  });

  it('every role has a label', () => {
    for (const r of Object.values(RoleName)) expect(roleLabel(r)).not.toBe(r);
  });

  it('every workflow event has its own sentence', () => {
    for (const event of Object.keys(EVENT_ROLE_MATRIX)) {
      const sentence = actionSentence(`handout.transition.${event}`);
      expect(sentence, event).not.toBe('Moved the handout on');
    }
  });

  it('every audit action written by the code has its own sentence', () => {
    const roots = [join(__dirname, '..'), join(__dirname, '../../../../packages')];
    const actions = new Set<string>();
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\b(?:action|auditAction): '([a-z_.]+)'/g))
          actions.add(m[1]!);
      }
    }
    expect(actions.size).toBeGreaterThan(20);
    const missing = [...actions].filter((a) => actionSentence(a) === FALLBACK);
    expect(missing).toEqual([]);
  });

  it('every audit item type written by the code has a plain name', () => {
    const roots = [join(__dirname, '..'), join(__dirname, '../../../../packages')];
    const entities = new Set<string>();
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        for (const m of readFileSync(file, 'utf8').matchAll(/[^A-Za-z]entity: '([A-Za-z]+)'/g))
          entities.add(m[1]!);
      }
    }
    expect(entities.size).toBeGreaterThan(10);
    expect([...entities].filter((e) => !(e in ENTITY_LABEL))).toEqual([]);
  });
});
