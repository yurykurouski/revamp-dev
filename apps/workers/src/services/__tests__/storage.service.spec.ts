import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env.js';
import { StorageService } from '../storage.service.js';

describe('StorageService', () => {
  let mockS3Send: ReturnType<typeof vi.fn>;
  let mockS3Client: any;
  let service: StorageService;

  beforeEach(() => {
    mockS3Send = vi.fn().mockResolvedValue({});
    mockS3Client = {
      send: mockS3Send,
    };
    service = new StorageService(mockS3Client, 'test-bucket');
  });

  it('should generate correct public URLs', () => {
    const url = service.getPublicUrl('test-bucket', 'screenshots/123/desktop.webp');
    expect(url).toContain('test-bucket/screenshots/123/desktop.webp');
  });

  it('should upload a buffer and return the public URL', async () => {
    const buffer = Buffer.from('fake-image-bytes');
    const resultUrl = await service.uploadBuffer({
      bucket: 'test-bucket',
      key: 'test-key.webp',
      buffer,
      contentType: 'image/webp',
    });

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const command = mockS3Send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'test-key.webp',
      Body: buffer,
      ContentType: 'image/webp',
    });
    expect(resultUrl).toContain('test-bucket/test-key.webp');
  });

  it('should upload desktop and mobile screenshots with standard key format', async () => {
    const buffer = Buffer.from('screenshot-bytes');
    const desktopUrl = await service.uploadScreenshot('lead-xyz', 'desktop', buffer);
    const mobileUrl = await service.uploadScreenshot('lead-xyz', 'mobile', buffer);

    expect(desktopUrl).toContain('test-bucket/screenshots/lead-xyz/desktop.webp');
    expect(mobileUrl).toContain('test-bucket/screenshots/lead-xyz/mobile.webp');
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('should upload full-page screenshots under {type}-full.webp keys (REV-21)', async () => {
    mockS3Send.mockResolvedValue({});
    const service = new StorageService(mockS3Client as any, 'test-bucket');
    const buffer = Buffer.from('full-page');

    const desktopFull = await service.uploadScreenshot('lead-xyz', 'desktop-full', buffer);
    const mobileFull = await service.uploadScreenshot('lead-xyz', 'mobile-full', buffer);

    expect(desktopFull).toContain('test-bucket/screenshots/lead-xyz/desktop-full.webp');
    expect(mobileFull).toContain('test-bucket/screenshots/lead-xyz/mobile-full.webp');
  });

  it('should check bucket existence and create it if not found', async () => {
    // 1st call fails (HeadBucket), 2nd call succeeds (CreateBucket)
    mockS3Send
      .mockRejectedValueOnce(new Error('Bucket not found'))
      .mockResolvedValueOnce({});

    await service.ensureBucket('custom-bucket');
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });
  it('stores a raw page version in the demos bucket and returns its key (REV-138)', async () => {
    const key = await service.uploadPageVersion('falco-dent-abc123', 3, '<!DOCTYPE html><html></html>');
    expect(key).toBe('v/falco-dent-abc123/versions/3.html');
    const put = mockS3Send.mock.calls.map((c) => c[0]).find((c) => c instanceof PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: env.S3_BUCKET_DEMOS,
      Key: 'v/falco-dent-abc123/versions/3.html',
      ContentType: 'text/html; charset=utf-8',
    });
    expect(Buffer.from(put.input.Body).toString('utf8')).toBe('<!DOCTYPE html><html></html>');
  });

  it('deletes an object from the demos bucket by default (REV-138)', async () => {
    await service.deleteObject('v/s/versions/1.html');
    const command = mockS3Send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: env.S3_BUCKET_DEMOS, Key: 'v/s/versions/1.html' });
  });

  it('reads a stored page version as text from the demos bucket (REV-139)', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: { transformToString: async (encoding: string) => (encoding === 'utf-8' ? '<html>wersja 2</html>' : '') } });
    const html = await service.readPageVersion('v/x/versions/2.html');
    const command = mockS3Send.mock.calls[0][0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: env.S3_BUCKET_DEMOS, Key: 'v/x/versions/2.html' });
    expect(html).toBe('<html>wersja 2</html>');
  });

  it('rejects when the version is missing', async () => {
    mockS3Send.mockRejectedValueOnce(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }));
    await expect(service.readPageVersion('v/x/versions/9.html')).rejects.toThrow('does not exist');
    mockS3Send.mockResolvedValueOnce({});
    await expect(service.readPageVersion('v/x/versions/9.html')).rejects.toThrow('v/x/versions/9.html');
  });
});
