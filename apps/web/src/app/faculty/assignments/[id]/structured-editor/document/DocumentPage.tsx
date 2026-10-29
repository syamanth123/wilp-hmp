'use client';

import type { ReactNode } from 'react';
import { BITS_HANDOUT_CSS } from '@hmp/db';
import { HANDOUT_HOST_CSS } from './handout-host-css';

/**
 * Editor-only affordances layered on top of the published handout's stylesheet
 * (handout-editor-ux D1/D2). Everything is scoped under `.hed-page` so nothing
 * leaks into the app, and nothing here is used by the renderer.
 */
const EDITOR_CSS = `
.hed-page { background: #fff; border: 1px solid #e3e1da; border-radius: 10px; box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.06); padding: 28px 32px 36px; }
.hed-page .bits-handout { padding: 0; }
.hed-field-wrap { display: block; position: relative; }
.hed-field-inline { display: inline-block; vertical-align: top; }
.hed-field-inline .hed-field { height: 1.4em !important; line-height: 1.4em; }
.hed-field { display: block; width: 100%; resize: none; overflow: hidden; font: inherit; color: inherit; line-height: inherit; text-align: inherit; background: transparent; border: 0; outline: 1px dashed transparent; outline-offset: 2px; border-radius: 3px; padding: 0 2px; margin: 0 -2px; transition: outline-color .12s, background-color .12s; }
.hed-field-inline .hed-field { display: inline-block; text-align: center; }
.hed-field:hover { outline-color: #9aa3b5; cursor: text; }
.hed-field:focus { background: #fff8d6; outline: 1px solid #e0c35a; }
.hed-field::placeholder { color: #9b9b9b; font-style: italic; }
.hed-field-problem { outline: 1px dashed #c24135; }
.hed-problem { display: block; margin-top: 3px; font-size: 12px; color: #b4231a; font-style: normal; }
.hed-readonly { color: inherit; }
.hed-hint { display: block; font-size: 11.5px; color: #8a8a8a; margin-top: 2px; }
.hed-page .bits-handout-header .hed-field { text-align: center; }
.hed-hours { white-space: nowrap; color: #444; }
.hed-section-divider { margin: 28px 0 8px; border-top: 1px dashed #c9c6bb; padding-top: 10px; font-size: 12px; color: #8a8a8a; text-transform: uppercase; letter-spacing: .06em; }
`;

/** The handout page itself: published stylesheet + editor affordances. */
export function DocumentPage({ children }: { children: ReactNode }) {
  return (
    <div className="hed-page" data-testid="bits-document-page">
      <style>{[BITS_HANDOUT_CSS, HANDOUT_HOST_CSS, EDITOR_CSS].join('\n')}</style>
      <div className="bits-handout">{children}</div>
    </div>
  );
}
