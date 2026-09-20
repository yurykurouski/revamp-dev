import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuditWorker } from '../audit.worker.js';
import { Audit } from '../../models/Audit.model.js';
import { Lead } from '../../models/Lead.model.js';
import { browserService } from '../../services/browser.service.js';
import { ImageService } from '../../services/image.service.js';
import { storageService } from '../../services/storage.service.js';

vi.mock('../../models/Audit.model.js');
vi.mock('../../models/Lead.model.js');
vi.mock('../../services/browser.service.js');
vi.mock('../../services/image.service.js');
vi.mock('../../services/storage.service.js');
vi.mock('../../queues/connection.js', () => ({
  redisConnection: {} as any,
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;
const mockWorkerInstance = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => {
  return {
    Worker: vi.fn().mockImplementation(function (queueName: string, processor: any, opts: any) {
      capturedProcessor = processor;
      return {
        ...mockWorkerInstance,
        queueName,
        opts,
      };
    }),
  };
});

describe('AuditWorker (@revamp/workers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  it('should initialize worker for AUDIT queue', () => {
    const worker = createAuditWorker();
    expect(worker).toBeDefined();
    expect(capturedProcessor).toBeTypeOf('function');
  });

  it('should capture screenshots, compress to WebP, upload to S3, and update Audit in MongoDB', async () => {
    createAuditWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-456',
      data: {
        leadId: 'lead-123',
        url: 'https://test-dental.com',
        niche: 'dental',
      },
    };

    const mockAuditExec = vi.fn().mockResolvedValue({});
    const mockLeadExec = vi.fn().mockResolvedValue({});

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({
      exec: mockAuditExec,
    } as any);

    vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
      exec: mockLeadExec,
    } as any);

    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureScreenshots).mockResolvedValue({
      desktopBuffer: Buffer.from('raw-desktop-png'),
      mobileBuffer: Buffer.from('raw-mobile-png'),
    });
    vi.mocked(ImageService.compressToWebp)
      .mockResolvedValueOnce(Buffer.from('webp-desktop'))
      .mockResolvedValueOnce(Buffer.from('webp-mobile'));
    vi.mocked(storageService.uploadScreenshot)
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp')
      .mockResolvedValueOnce('http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp');

    const result = await capturedProcessor!(mockJob);

    // Initial status transitions
    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-123' },
      { status: 'PROCESSING' },
      { new: true },
    );
    expect(Lead.findByIdAndUpdate).toHaveBeenCalledWith(
      'lead-123',
      { status: 'AUDITING' },
      { new: true },
    );

    // Browser capture and WebP compression
    expect(browserService.captureScreenshots).toHaveBeenCalledWith('https://test-dental.com');
    expect(ImageService.compressToWebp).toHaveBeenCalledTimes(2);

    // S3 upload
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith(
      'lead-123',
      'desktop',
      expect.any(Buffer),
    );
    expect(storageService.uploadScreenshot).toHaveBeenCalledWith(
      'lead-123',
      'mobile',
      expect.any(Buffer),
    );

    // Audit document update with URLs
    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-123' },
      {
        desktopScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp',
        mobileScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp',
        screenshotUrls: {
          desktopOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp',
          mobileOriginal: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp',
        },
      },
      { new: true },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        leadId: 'lead-123',
        url: 'https://test-dental.com',
        desktopScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/desktop.webp',
        mobileScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/lead-123/mobile.webp',
      }),
    );
  });

  it('should record errorMessage on Audit and throw error when pipeline fails', async () => {
    createAuditWorker();
    expect(capturedProcessor).not.toBeNull();

    const mockJob = {
      id: 'job-err',
      data: {
        leadId: 'lead-err',
        url: 'https://invalid-site.xyz',
        niche: 'other',
      },
    };

    const mockAuditExec = vi.fn().mockResolvedValue({});
    const mockLeadExec = vi.fn().mockResolvedValue({});

    vi.spyOn(Audit, 'findOneAndUpdate').mockReturnValue({
      exec: mockAuditExec,
    } as any);

    vi.spyOn(Lead, 'findByIdAndUpdate').mockReturnValue({
      exec: mockLeadExec,
    } as any);

    vi.mocked(storageService.ensureBucket).mockResolvedValue(undefined);
    vi.mocked(browserService.captureScreenshots).mockRejectedValue(
      new Error('ERR_CONNECTION_REFUSED'),
    );

    await expect(capturedProcessor!(mockJob)).rejects.toThrow('ERR_CONNECTION_REFUSED');

    expect(Audit.findOneAndUpdate).toHaveBeenCalledWith(
      { leadId: 'lead-err' },
      {
        errorMessage: 'ERR_CONNECTION_REFUSED',
      },
    );
  });
});
