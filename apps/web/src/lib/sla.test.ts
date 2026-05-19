import { describe, it, expect } from 'vitest';
import { HandoutStatus, type WorkflowConfig } from '@hmp/db';
import { classify, slaHoursFor, holderForStatus } from './sla';

const cfg: WorkflowConfig = {
  id: 'c1',
  key: 'default',
  hogReviewSla: 72,
  pcReviewSla: 72,
  facultySubmitSla: 168,
  hogFinalSla: 48,
  offCampusMaxCourses: 3,
  matrixJson: {} as never,
  updatedAt: new Date(),
} as WorkflowConfig;

const now = new Date('2026-01-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('slaHoursFor', () => {
  it('maps HOG-held statuses to hogReviewSla', () => {
    expect(slaHoursFor(cfg, HandoutStatus.REQUESTED)).toBe(72);
    expect(slaHoursFor(cfg, HandoutStatus.ALLOCATED)).toBe(72);
  });
  it('maps faculty-held statuses to facultySubmitSla', () => {
    expect(slaHoursFor(cfg, HandoutStatus.ASSIGNED)).toBe(168);
    expect(slaHoursFor(cfg, HandoutStatus.IN_PROGRESS)).toBe(168);
    expect(slaHoursFor(cfg, HandoutStatus.REWORK_REQUESTED)).toBe(168);
  });
  it('maps SUBMITTED to pcReviewSla and UNDER_REVIEW to hogFinalSla', () => {
    expect(slaHoursFor(cfg, HandoutStatus.SUBMITTED)).toBe(72);
    expect(slaHoursFor(cfg, HandoutStatus.UNDER_REVIEW)).toBe(48);
  });
  it('returns null for terminal/non-SLA statuses', () => {
    expect(slaHoursFor(cfg, HandoutStatus.APPROVED)).toBeNull();
    expect(slaHoursFor(cfg, HandoutStatus.PUBLISHED)).toBeNull();
    expect(slaHoursFor(cfg, HandoutStatus.ARCHIVED)).toBeNull();
    expect(slaHoursFor(cfg, HandoutStatus.DRAFT)).toBeNull();
  });
});

describe('classify', () => {
  it('returns on_track when age < 75% of SLA', () => {
    const r = classify(HandoutStatus.REQUESTED, hoursAgo(10), cfg, now);
    expect(r.classification).toBe('on_track');
    expect(r.slaHours).toBe(72);
  });
  it('returns due_soon at >=75% but < SLA', () => {
    const r = classify(HandoutStatus.REQUESTED, hoursAgo(60), cfg, now); // 60/72 = 83%
    expect(r.classification).toBe('due_soon');
  });
  it('returns overdue at >= SLA', () => {
    const r = classify(HandoutStatus.REQUESTED, hoursAgo(80), cfg, now);
    expect(r.classification).toBe('overdue');
  });
  it('returns n_a for terminal statuses', () => {
    const r = classify(HandoutStatus.PUBLISHED, hoursAgo(1000), cfg, now);
    expect(r.classification).toBe('n_a');
    expect(r.slaHours).toBeNull();
  });
});

describe('holderForStatus', () => {
  it('routes each non-terminal status to a holder', () => {
    expect(holderForStatus(HandoutStatus.REQUESTED)).toBe('HOG');
    expect(holderForStatus(HandoutStatus.ALLOCATED)).toBe('PC');
    expect(holderForStatus(HandoutStatus.ASSIGNED)).toBe('FACULTY');
    expect(holderForStatus(HandoutStatus.IN_PROGRESS)).toBe('FACULTY');
    expect(holderForStatus(HandoutStatus.REWORK_REQUESTED)).toBe('FACULTY');
    expect(holderForStatus(HandoutStatus.SUBMITTED)).toBe('PC');
    expect(holderForStatus(HandoutStatus.UNDER_REVIEW)).toBe('HOG');
    expect(holderForStatus(HandoutStatus.APPROVED)).toBe('IC');
  });
  it('returns null for terminal statuses', () => {
    expect(holderForStatus(HandoutStatus.PUBLISHED)).toBeNull();
    expect(holderForStatus(HandoutStatus.ARCHIVED)).toBeNull();
  });
});
