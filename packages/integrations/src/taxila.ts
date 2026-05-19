// Taxila LMS publish stub.
// Returns a simulated success/failed result. Pure function — no network calls.
// Phase 3 swaps this with the real Taxila HTTP client behind the same signature.

export interface PublishInput {
  handoutId: string;
  versionNo: number;
  contentHtml: string;
  courseCode: string;
  courseTitle: string;
  programmeCode: string;
  semesterName: string;
}

export interface PublishResult {
  status: 'success' | 'failed';
  responseJson: Record<string, unknown>;
}

export async function publishToLms(input: PublishInput): Promise<PublishResult> {
  return {
    status: 'success',
    responseJson: {
      provider: 'taxila-stub',
      courseCode: input.courseCode,
      courseTitle: input.courseTitle,
      programmeCode: input.programmeCode,
      semesterName: input.semesterName,
      handoutId: input.handoutId,
      versionNo: input.versionNo,
      bytes: input.contentHtml.length,
      simulatedAt: new Date().toISOString(),
    },
  };
}
