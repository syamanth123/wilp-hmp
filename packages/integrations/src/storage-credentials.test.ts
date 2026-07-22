import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the raw config passed to the S3Client constructor so we can assert on
// whether `credentials` is present. A separate file from storage.test.ts on
// purpose: that file mocks command *sends* via aws-sdk-client-mock; here we
// replace the S3Client constructor itself. vitest isolates module mocks per file.
const { s3Ctor } = vi.hoisted(() => ({ s3Ctor: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg: unknown) {
      s3Ctor(cfg);
    }
  },
  // getS3Client never instantiates these — empty stand-ins satisfy the imports.
  HeadBucketCommand: class {},
  CreateBucketCommand: class {},
  PutObjectCommand: class {},
  GetObjectCommand: class {},
  DeleteObjectCommand: class {},
  PutObjectTaggingCommand: class {},
  GetObjectTaggingCommand: class {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

import { getS3Client } from './storage';

const ENV = { ...process.env };
beforeEach(() => s3Ctor.mockClear());
afterEach(() => {
  process.env = { ...ENV };
});

describe('getS3Client — credential provider selection', () => {
  it('OMITS the credentials block when S3_ACCESS_KEY/S3_SECRET_KEY are unset (enables the EC2 instance-role chain)', () => {
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    getS3Client(true); // fresh: bypass the module cache
    const cfg = s3Ctor.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect('credentials' in cfg).toBe(false);
  });

  it('omits credentials when only ONE of the two keys is set (avoids half-configured static creds)', () => {
    process.env.S3_ACCESS_KEY = 'only-access';
    delete process.env.S3_SECRET_KEY;
    getS3Client(true);
    const cfg = s3Ctor.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect('credentials' in cfg).toBe(false);
  });

  it('passes explicit static credentials when BOTH keys are set (MinIO / static-key deploys)', () => {
    process.env.S3_ACCESS_KEY = 'AKIA_TEST';
    process.env.S3_SECRET_KEY = 'secret_test';
    getS3Client(true);
    const cfg = s3Ctor.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(cfg.credentials).toEqual({ accessKeyId: 'AKIA_TEST', secretAccessKey: 'secret_test' });
  });
});
