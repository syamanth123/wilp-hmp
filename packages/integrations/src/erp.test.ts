import { describe, it, expect } from 'vitest';
import {
  parseCoursesCsv,
  parseOfferingsCsv,
  parseProgrammesCsv,
  parseSlotBookingsCsv,
  parseHandoutRequestsCsv,
} from './erp';

describe('erp csv parsers', () => {
  it('parses a courses csv', () => {
    const csv = `code,title,credits,description
SE-ZG501,Software Architectures,4,Patterns and styles
SE-ZG502,OOAD,4,`;
    const r = parseCoursesCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.code).toBe('SE-ZG501');
    expect(r.rows[0]!.credits).toBe(4);
  });

  it('skips comment + blank lines', () => {
    const csv = `code,title,credits,description
# this is a comment

SE-ZG501,Software Architectures,4,x`;
    const r = parseCoursesCsv(csv);
    expect(r.rows).toHaveLength(1);
  });

  it('rejects invalid rows with line numbers', () => {
    const csv = `code,title,credits,description
,Bad Course,4,x`;
    const r = parseCoursesCsv(csv);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.line).toBe(2);
  });

  it('parses programmes+semesters csv', () => {
    const csv = `programme_code,programme_name,semester_name,year,term,start_date,end_date,exam_date,ec1_deadline
MTECH-SE,M.Tech SE,Sem-II 2025-26,2025,SECOND,2026-01-05,2026-05-15,2026-05-10,2026-04-15`;
    const r = parseProgrammesCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.year).toBe(2025);
    expect(r.rows[0]!.term).toBe('SECOND');
  });

  it('parses offerings csv', () => {
    const csv = `programme_code,semester_name,course_code,slot_info
MTECH-SE,Sem-II 2025-26,SE-ZG501,Sat-1800`;
    const r = parseOfferingsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.slot_info).toBe('Sat-1800');
  });

  it('parses slot bookings csv with class + exam rows', () => {
    const csv = `programme_code,semester_name,course_code,slot_type,slot,day_of_week,start_time,end_time,room
MTECH-SE,Sem-II 2025-26,SE-ZG501,class,A1,6,18:00,20:00,Online
MTECH-SE,Sem-II 2025-26,SE-ZG501,exam,FINAL,0,09:00,12:00,Hall-3`;
    const r = parseSlotBookingsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.slot_type).toBe('class');
    expect(r.rows[0]!.day_of_week).toBe(6);
    expect(r.rows[1]!.slot_type).toBe('exam');
    expect(r.rows[1]!.room).toBe('Hall-3');
  });

  it('rejects slot bookings with bad time format', () => {
    const csv = `programme_code,semester_name,course_code,slot_type,slot,day_of_week,start_time,end_time,room
MTECH-SE,Sem-II 2025-26,SE-ZG501,class,A1,6,18-00,20:00,Online`;
    const r = parseSlotBookingsCsv(csv);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.errors[0]!.message).toMatch(/start_time/);
  });

  it('rejects slot bookings with invalid day_of_week + slot_type', () => {
    const csv = `programme_code,semester_name,course_code,slot_type,slot,day_of_week,start_time,end_time,room
MTECH-SE,Sem-II 2025-26,SE-ZG501,labs,A1,9,18:00,20:00,Online`;
    const r = parseSlotBookingsCsv(csv);
    expect(r.ok).toBe(false);
  });
});

describe('parseHandoutRequestsCsv (Prompt 13)', () => {
  it('parses minimal programme/course/semester rows', () => {
    const csv = `programme_code,course_code,semester
MTECH-SE,SE ZG501,Sem-I 2025-26
MTECH-DS,CC ZG501,Sem-I 2025-26`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      programme_code: 'MTECH-SE',
      course_code: 'SE ZG501',
      semester: 'Sem-I 2025-26',
    });
  });

  it('reports a single line-1 error when a required column is missing (header guard)', () => {
    const csv = `programme_code,semester
MTECH-SE,Sem-I 2025-26`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(1);
    expect(r.errors[0]!.message).toMatch(/missing required column\(s\): course_code/);
  });

  it('tolerates reordered columns (header-keyed)', () => {
    const csv = `semester,course_code,programme_code
Sem-I 2025-26,SE ZG501,MTECH-SE`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.programme_code).toBe('MTECH-SE');
    expect(r.rows[0]!.semester).toBe('Sem-I 2025-26');
  });

  it('skips #-comment + blank lines (template sample rows are ignored)', () => {
    const csv = `programme_code,course_code,semester
# MTECH-SE,SE ZG501,Sem-I 2025-26  (example — ignored)

MTECH-SE,SE ZG501,Sem-I 2025-26`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('treats header-only (or empty) input as zero rows, ok', () => {
    expect(parseHandoutRequestsCsv('programme_code,course_code,semester').rows).toHaveLength(0);
    expect(parseHandoutRequestsCsv('programme_code,course_code,semester').ok).toBe(true);
    expect(parseHandoutRequestsCsv('').rows).toHaveLength(0);
  });

  it('rejects a row with a blank required field, with its line number', () => {
    const csv = `programme_code,course_code,semester
MTECH-SE,,Sem-I 2025-26`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.errors[0]!.message).toMatch(/course_code/);
  });

  it('handles quoted fields containing commas', () => {
    const csv = `programme_code,course_code,semester
MTECH-SE,SE ZG501,"Sem-I 2025-26, revised"`;
    const r = parseHandoutRequestsCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.rows[0]!.semester).toBe('Sem-I 2025-26, revised');
  });
});
