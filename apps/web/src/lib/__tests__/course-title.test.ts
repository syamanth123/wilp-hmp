import { describe, expect, it } from 'vitest';
import { displayCourseTitle, titleCase } from '../course-title';

describe('course titles for display', () => {
  it.each([
    ['ENGINEERING MATERIALS', 'Engineering Materials'],
    ['IOT IN MANUFACTURING', 'IoT in Manufacturing'],
    ['ML SYSTEM OPTIMIZATION', 'ML System Optimization'],
    ['TESTABILITY FOR VLSI', 'Testability for VLSI'],
    ['ELECTRICAL & ELECTRONICS TECH', 'Electrical & Electronics Tech'],
    ['HARDWARE SOFTWARE CO-DESIGN', 'Hardware Software Co-Design'],
    ['THE ART OF  PROGRAMMING', 'The Art of Programming'],
    ['MATHEMATICS II', 'Mathematics II'],
  ])('%j → %j', (raw, shown) => expect(titleCase(raw)).toBe(shown));

  it('prefers the catalogue title; leaves a title that already has lower case alone', () => {
    expect(
      displayCourseTitle('DATA STORAGE TECH & NETWORKS', 'Data Storage Technology and Networks'),
    ).toBe('Data Storage Technology and Networks');
    expect(displayCourseTitle('Software Architectures')).toBe('Software Architectures');
    expect(displayCourseTitle('CALCULUS', null)).toBe('Calculus');
    expect(displayCourseTitle('IoT IN MANUFACTURING')).toBe('IoT in Manufacturing');
    expect(displayCourseTitle('Intro to AI and ML')).toBe('Intro to AI and ML');
  });
});
