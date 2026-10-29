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
.hed-table-block { position: relative; margin-bottom: 4px; }
.hed-table-block table td { position: relative; }
.hed-row-del { position: absolute; right: -28px; top: 4px; width: 22px; height: 22px; border: 0; border-radius: 50%; background: transparent; color: #a33; font-size: 12px; line-height: 22px; cursor: pointer; opacity: 0; transition: opacity .12s, background-color .12s; }
.hed-row:hover .hed-row-del, .hed-row-del:focus-visible { opacity: 1; }
.hed-row-del:hover { background: #fbe9e7; }
.hed-row-del:disabled { color: #bbb; cursor: not-allowed; }
.hed-row:hover > td { background: #fbfaf6; }
.hed-table-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 6px; }
.hed-add { border: 0; background: transparent; color: #1f3a68; font-size: 13px; font-weight: 600; padding: 2px 0; cursor: pointer; }
.hed-add:hover { text-decoration: underline; }
.hed-link { border: 0; background: transparent; color: #8a8a8a; font-size: 12px; font-weight: 400; cursor: pointer; margin-left: 10px; }
.hed-link:hover { color: #b4231a; text-decoration: underline; }
.hed-h3-row { display: flex; align-items: baseline; }
.hed-empty-row { color: #9b9b9b; font-style: italic; text-align: center !important; }
.hed-code { font-variant-numeric: tabular-nums; }
.hed-muted { color: #777; font-size: 0.95em; }
.hed-weight { white-space: nowrap; }
.hed-total { font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.hed-total-ok { background: #e7f5ec; color: #1e6a40; border: 1px solid #c9e5d3; }
.hed-total-bad { background: #fbeaea; color: #97251e; border: 1px solid #f1cccc; }
.hed-rte { position: relative; }
.hed-rte-page { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 3px; padding: 0 2px; margin: 6px -2px; transition: outline-color .12s, background-color .12s; }
.hed-rte-page:hover { outline-color: #9aa3b5; cursor: text; }
.hed-rte-page:focus, .hed-rte-page.ProseMirror-focused { background: #fff8d6; outline: 1px solid #e0c35a; }
.hed-rte-page p { margin: 6px 0; }
.hed-rte-placeholder { position: absolute; left: 2px; top: 6px; color: #9b9b9b; font-style: italic; pointer-events: none; }
.hed-page .bits-handout-footer { margin-top: 32px; }
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
