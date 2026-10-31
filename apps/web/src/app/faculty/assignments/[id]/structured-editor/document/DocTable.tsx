'use client';

import type { ReactNode } from 'react';

export interface DocColumn<T> {
  header: string;
  /** Renders the editable cell for one row. */
  cell: (row: T, index: number, update: (next: T) => void) => ReactNode;
}

interface Props<T> {
  /** The renderer's table class, so column widths match the published handout. */
  className: string;
  columns: DocColumn<T>[];
  rows: T[];
  onChange: (next: T[]) => void;
  /** Builds the row "+ Add row" appends (given the current rows). */
  makeRow?: (rowsSoFar: T[]) => T;
  /** Replaces the default append when adding needs a different shape (evaluation). */
  addRowOverride?: () => void;
  /** Renumbers codes after an add or delete (CO1, CO2, … / T1, T2, …). */
  renumber?: (rows: T[]) => T[];
  /** Rows that must always remain (the schema needs at least this many). */
  minRows?: number;
  addLabel: string;
  /** Shown inside the table while it has no rows. */
  emptyText: string;
  testId: string;
  /** Plain-words problem shown under the table (D4). */
  problem?: string | null;
  /** Extra content beside the add button (e.g. the weight total). */
  footer?: ReactNode;
  /** Optional per-row label for the delete button's accessible name. */
  rowLabel?: (row: T, index: number) => string;
}

/**
 * A handout table edited in place (handout-editor-ux D3): the same markup and
 * column widths as the published table; every cell is editable; "+ Add row"
 * under the table; a small delete icon appears beside a row on hover; codes
 * renumber themselves after adding or deleting.
 */
export function DocTable<T>({
  className,
  columns,
  rows,
  onChange,
  makeRow,
  renumber,
  minRows = 0,
  addLabel,
  emptyText,
  testId,
  problem,
  footer,
  rowLabel,
  addRowOverride,
}: Props<T>) {
  const apply = (next: T[]) => onChange(renumber ? renumber(next) : next);
  const canDelete = rows.length > minRows;

  return (
    <div className="hed-table-block" data-testid={testId}>
      <table className={className}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="hed-empty-row">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="hed-row" data-testid={`${testId}-row-${i}`}>
                {columns.map((c, ci) => (
                  <td key={c.header}>
                    {c.cell(row, i, (next) => onChange(rows.map((r, j) => (j === i ? next : r))))}
                    {ci === columns.length - 1 && (
                      <button
                        type="button"
                        className="hed-row-del"
                        onClick={() => apply(rows.filter((_, j) => j !== i))}
                        disabled={!canDelete}
                        title={canDelete ? 'Delete this row' : 'At least one row is needed here'}
                        aria-label={`Delete ${rowLabel ? rowLabel(row, i) : `row ${i + 1}`}`}
                        data-testid={`${testId}-del-${i}`}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="hed-table-foot">
        <button
          type="button"
          className="hed-add"
          onClick={() =>
            addRowOverride ? addRowOverride() : makeRow && apply([...rows, makeRow(rows)])
          }
          data-testid={`${testId}-add`}
        >
          + {addLabel}
        </button>
        {footer}
      </div>
      {problem && (
        <span className="hed-problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

/** Renumber a coded list: CO1, CO2, … in row order. */
export function renumberCodes<T extends { code: string }>(prefix: string) {
  return (rows: T[]): T[] => rows.map((r, i) => ({ ...r, code: `${prefix}${i + 1}` }));
}
