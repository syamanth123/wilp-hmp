import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';

// getSignedUrl lives in a separate package — mock it directly so we can assert
// the presign arguments without a real signing flow.
const getSignedUrlMock = vi.fn(
  (..._args: unknown[]): Promise<string> =>
    Promise.resolve('https://minio.local/presigned?sig=xyz'),
);
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

import { ensureBucket, uploadAndPresign, deleteObject, tagObject } from './storage';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
  getSignedUrlMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureBucket', () => {
  it('does nothing when the bucket already exists (HeadBucket succeeds)', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    const client = new S3Client({});
    await ensureBucket(client, 'hmp-lms-exports');
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });

  it('creates the bucket when HeadBucket reports it missing', async () => {
    s3Mock
      .on(HeadBucketCommand)
      .rejects(Object.assign(new Error('not found'), { name: 'NotFound' }));
    s3Mock.on(CreateBucketCommand).resolves({});
    const client = new S3Client({});
    await ensureBucket(client, 'hmp-lms-exports');
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(CreateBucketCommand)[0]!.args[0].input).toMatchObject({
      Bucket: 'hmp-lms-exports',
    });
  });

  it('tolerates a BucketAlreadyOwnedByYou race on create', async () => {
    s3Mock.on(HeadBucketCommand).rejects(new Error('missing'));
    s3Mock
      .on(CreateBucketCommand)
      .rejects(Object.assign(new Error('owned'), { name: 'BucketAlreadyOwnedByYou' }));
    const client = new S3Client({});
    await expect(ensureBucket(client, 'hmp-lms-exports')).resolves.toBeUndefined();
  });
});

describe('uploadAndPresign', () => {
  it('ensures bucket, puts the object, and returns a presigned URL with the given expiry', async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});
    const client = new S3Client({});

    const url = await uploadAndPresign(client, {
      bucket: 'hmp-lms-exports',
      key: 'lms-exports/2026/HMP-2026-0042.zip',
      body: Buffer.from('zip-bytes'),
      contentType: 'application/zip',
      expiresIn: 86_400,
    });

    expect(url).toBe('https://minio.local/presigned?sig=xyz');

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.args[0].input).toMatchObject({
      Bucket: 'hmp-lms-exports',
      Key: 'lms-exports/2026/HMP-2026-0042.zip',
      ContentType: 'application/zip',
    });

    // presign called with the GET command + the requested expiry
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const presignArgs = getSignedUrlMock.mock.calls[0]!;
    expect(presignArgs[2]).toMatchObject({ expiresIn: 86_400 });
  });
});

describe('deleteObject', () => {
  it('sends a DeleteObject for the given bucket + key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const client = new S3Client({});

    await deleteObject(client, 'hmp-handout-attachments', 'attachments/req-1/uuid-1');

    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'hmp-handout-attachments',
      Key: 'attachments/req-1/uuid-1',
    });
  });
});

describe('tagObject', () => {
  it('replaces the tag set with the provided tags', async () => {
    s3Mock.on(PutObjectTaggingCommand).resolves({});
    const client = new S3Client({});

    await tagObject(client, 'hmp-handout-attachments', 'attachments/req-1/uuid-1', {
      archived: 'true',
    });

    const calls = s3Mock.commandCalls(PutObjectTaggingCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: 'hmp-handout-attachments',
      Key: 'attachments/req-1/uuid-1',
      Tagging: { TagSet: [{ Key: 'archived', Value: 'true' }] },
    });
  });
});
