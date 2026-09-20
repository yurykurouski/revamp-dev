import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('should check bucket existence and create it if not found', async () => {
    // 1st call fails (HeadBucket), 2nd call succeeds (CreateBucket)
    mockS3Send
      .mockRejectedValueOnce(new Error('Bucket not found'))
      .mockResolvedValueOnce({});

    await service.ensureBucket('custom-bucket');
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });
});
