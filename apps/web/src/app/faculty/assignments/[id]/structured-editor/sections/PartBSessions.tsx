'use client';

import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { ChipList } from '../chips/ChipList';

type Session = BitsHandoutV1['partB']['sessions'][number];

interface Props {
  value: Session[];
  onChange: (next: Session[]) => void;
  /**
   * T/R codes from Part A (textBooks + referenceBooks), passed by the root
   * editor so the references chip-list can suggest valid codes via typeahead.
   * The warn-if predicate flags any chip that doesn't contain ANY known code
   * (warning only — schema allows free-text in references; save isn't blocked).
   */
  availableReferences?: string[];
}

/**
 * Part B — Learning Plan (FULL, 11d-b). Replaces `PartBSessionsMinimal`.
 *
 * Per-session UI:
 *   - sessionNumber: text input (supports ranges like "5-6" — the schema
 *     made it string in 11a precisely for this case).
 *   - topicTitle: plain input.
 *   - subTopics: ChipList (horizontal pills). Stored as "; "-joined string
 *     on the model (the 11a contract); the section converts to/from string[]
 *     transparently so the ChipList's API stays clean.
 *   - references: ChipList with typeahead suggestions from Part A's T/R
 *     codes. Free-form chips are allowed (schema doesn't constrain them);
 *     chips that match no known code show an amber border but don't block.
 */
export function PartBSessions({ value, onChange, availableReferences = [] }: Props) {
  const updateRow = (idx: number, next: Session) =>
    onChange(value.map((row, i) => (i === idx ? next : row)));
  const removeRow = (idx: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  };
  const addRow = () => {
    const nextNum = String(value.length + 1);
    onChange([...value, { sessionNumber: nextNum, topicTitle: '', subTopics: '', references: [] }]);
  };

  // The schema stores subTopics as a "; "-joined string (the 11a contract,
  // documented in docs/dev-handoff-audit.md §1). The chip-list works on
  // string[]; we convert on the fly so the chip-list stays generic.
  const subTopicsArray = (s: string): string[] =>
    s
      ? s
          .split(/;\s*/)
          .map((p) => p.trim())
          .filter(Boolean)
      : [];
  const subTopicsString = (arr: string[]) => arr.filter(Boolean).join('; ');

  return (
    <section aria-label="Part B — Learning Plan" className="space-y-2" data-testid="bits-partb">
      <h3 className="text-base font-semibold">Part B — Learning Plan</h3>
      <p className="text-muted-foreground text-xs">
        Combine contact sessions with ranges like <span className="font-mono">5-6</span>. Sub-topics
        are chips (press Enter to add). References offer typeahead from Part A&apos;s T/R codes —
        free-form entries are saved as-is.
      </p>
      <div className="space-y-3">
        {value.map((row, idx) => (
          <div key={idx} className="grid grid-cols-[100px_1fr_auto] gap-2 rounded-md border p-2">
            <div className="grid gap-1">
              {idx === 0 && <Label className="text-xs">Session #</Label>}
              <input
                value={row.sessionNumber}
                onChange={(e) => updateRow(idx, { ...row, sessionNumber: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 font-mono text-sm"
                data-testid={`bits-partb-num-${idx}`}
              />
            </div>
            <div className="grid gap-2">
              <div className="grid gap-1">
                {idx === 0 && <Label className="text-xs">Topic title</Label>}
                <input
                  value={row.topicTitle}
                  onChange={(e) => updateRow(idx, { ...row, topicTitle: e.target.value })}
                  className="bg-background rounded-md border px-2 py-1 text-sm"
                  data-testid={`bits-partb-title-${idx}`}
                />
              </div>
              <ChipList
                label="Sub-topics"
                placeholder="Type a sub-topic, press Enter…"
                value={subTopicsArray(row.subTopics)}
                onChange={(arr) => updateRow(idx, { ...row, subTopics: subTopicsString(arr) })}
                testIdPrefix={`bits-partb-subtopics-${idx}`}
              />
              <ChipList
                label="References"
                placeholder='e.g. "T1 Chap 4" or "R2" — start typing to see Part A codes'
                value={row.references}
                onChange={(arr) => updateRow(idx, { ...row, references: arr })}
                suggestions={availableReferences}
                warnIf={(chip) => {
                  if (availableReferences.length === 0) return false;
                  // Warn if the chip doesn't mention ANY known code anywhere.
                  return !availableReferences.some((code) => chip.includes(code));
                }}
                testIdPrefix={`bits-partb-refs-${idx}`}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeRow(idx)}
              disabled={value.length <= 1}
              aria-label={`Remove session ${row.sessionNumber}`}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addRow} data-testid="bits-partb-add">
        + Add session
      </Button>
    </section>
  );
}
