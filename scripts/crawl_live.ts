import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { env } from '../apps/workers/src/config/env.js';
import { browserService } from '../apps/workers/src/services/browser.service.js';
import { ImageService } from '../apps/workers/src/services/image.service.js';
import { storageService } from '../apps/workers/src/services/storage.service.js';
import { Lead } from '../apps/workers/src/models/Lead.model.js';
import { Audit } from '../apps/workers/src/models/Audit.model.js';

interface CrawlReport {
  targetUrl: string;
  leadId: string;
  auditId: string;
  durationMs: number;
  desktop: {
    rawBytes: number;
    webpBytes: number;
    compressionRatio: string;
    url: string;
    artifactPath: string;
  };
  mobile: {
    rawBytes: number;
    webpBytes: number;
    compressionRatio: string;
    url: string;
    artifactPath: string;
  };
  minioConsoleUrl: string;
}

async function runLiveCrawl(urlToCrawl: string = 'https://stripe.com'): Promise<CrawlReport> {
  const startTime = Date.now();
  console.log(`\n======================================================`);
  console.log(`🚀 REV-7 LIVE DEMO: Playwright Headless Crawling & S3`);
  console.log(`🎯 Target URL: ${urlToCrawl}`);
  console.log(`======================================================\n`);

  // 1. Connect to Mongo
  console.log(`[1/6] Connecting to MongoDB (${env.MONGODB_URI})...`);
  await mongoose.connect(env.MONGODB_URI);
  console.log(`      ✅ Connected to MongoDB.`);

  // 2. Ensure MinIO bucket
  console.log(`[2/6] Checking S3 / MinIO storage bucket (${env.S3_BUCKET_ASSETS})...`);
  await storageService.ensureBucket();
  console.log(`      ✅ MinIO bucket "${env.S3_BUCKET_ASSETS}" verified.`);

  // 3. Create Demo Lead and Audit records
  console.log(`[3/6] Initializing Lead & Audit documents in MongoDB...`);
  const domain = new URL(urlToCrawl).hostname;
  const lead = await Lead.create({
    businessName: `${domain} (Live Demo)`,
    originalUrl: urlToCrawl,
    domain: domain,
    niche: 'other',
    contactEmail: `contact@${domain}`,
    status: 'AUDITING',
  });
  const audit = await Audit.create({
    leadId: lead._id,
    status: 'PROCESSING',
  });
  console.log(`      ✅ Lead created: ${lead._id}`);
  console.log(`      ✅ Audit initiated: ${audit._id}`);

  // 4. Capture dual-viewport screenshots
  console.log(`[4/6] Launching Playwright Chromium & capturing dual-viewport screenshots...`);
  console.log(`      🖥️  Desktop: 1440x900 (DPI 1.0)`);
  console.log(`      📱 Mobile:  375x812 (iPhone Retina DPI 2.0)`);
  const captureStart = Date.now();
  const { desktopBuffer, mobileBuffer } = await browserService.captureScreenshots(urlToCrawl);
  const captureDuration = Date.now() - captureStart;
  console.log(`      ✅ Captured both viewports in ${captureDuration}ms`);

  // 5. Compress using Sharp WebP
  console.log(`[5/6] Optimizing screenshots with Sharp (WebP quality 80)...`);
  const [desktopWebp, mobileWebp] = await Promise.all([
    ImageService.compressToWebp(desktopBuffer, { quality: 80 }),
    ImageService.compressToWebp(mobileBuffer, { quality: 80 }),
  ]);
  const desktopSavings = ((1 - desktopWebp.length / desktopBuffer.length) * 100).toFixed(1);
  const mobileSavings = ((1 - mobileWebp.length / mobileBuffer.length) * 100).toFixed(1);
  console.log(`      Desktop: ${(desktopBuffer.length / 1024).toFixed(1)}KB -> ${(desktopWebp.length / 1024).toFixed(1)}KB (${desktopSavings}% reduction)`);
  console.log(`      Mobile:  ${(mobileBuffer.length / 1024).toFixed(1)}KB -> ${(mobileWebp.length / 1024).toFixed(1)}KB (${mobileSavings}% reduction)`);

  // 6. Upload to MinIO and copy to Artifacts
  console.log(`[6/6] Uploading WebP assets to MinIO & saving to conversation artifacts...`);
  const [desktopUrl, mobileUrl] = await Promise.all([
    storageService.uploadScreenshot(lead._id.toString(), 'desktop', desktopWebp),
    storageService.uploadScreenshot(lead._id.toString(), 'mobile', mobileWebp),
  ]);

  // Update MongoDB
  audit.status = 'COMPLETED';
  audit.desktopScreenshotUrl = desktopUrl;
  audit.mobileScreenshotUrl = mobileUrl;
  audit.screenshotUrls = {
    desktopOriginal: desktopUrl,
    mobileOriginal: mobileUrl,
  };
  audit.completedAt = new Date();
  await audit.save();

  lead.status = 'AUDITED';
  await lead.save();

  // Save to Artifact directory for rich rendering
  const artifactDir = '/Users/yurykurouski/.gemini/antigravity-ide/brain/39092032-612f-4c75-b01e-421abe89a9d5';
  fs.mkdirSync(artifactDir, { recursive: true });
  const desktopArtifactPath = path.join(artifactDir, `desktop_live.webp`);
  const mobileArtifactPath = path.join(artifactDir, `mobile_live.webp`);
  fs.writeFileSync(desktopArtifactPath, desktopWebp);
  fs.writeFileSync(mobileArtifactPath, mobileWebp);

  const totalDuration = Date.now() - startTime;
  console.log(`\n🎉 Live Crawl Completed in ${totalDuration}ms!`);
  console.log(`------------------------------------------------------`);
  console.log(`🌐 Desktop MinIO URL: ${desktopUrl}`);
  console.log(`📱 Mobile MinIO URL:  ${mobileUrl}`);
  console.log(`🖼️  Artifact desktop:  ${desktopArtifactPath}`);
  console.log(`🖼️  Artifact mobile:   ${mobileArtifactPath}`);
  console.log(`🗄️  MinIO Web Console:  http://localhost:9001 (minioadmin / minioadmin)`);
  console.log(`------------------------------------------------------\n`);

  await browserService.close();
  await mongoose.disconnect();

  return {
    targetUrl: urlToCrawl,
    leadId: lead._id.toString(),
    auditId: audit._id.toString(),
    durationMs: totalDuration,
    desktop: {
      rawBytes: desktopBuffer.length,
      webpBytes: desktopWebp.length,
      compressionRatio: `${desktopSavings}%`,
      url: desktopUrl,
      artifactPath: desktopArtifactPath,
    },
    mobile: {
      rawBytes: mobileBuffer.length,
      webpBytes: mobileWebp.length,
      compressionRatio: `${mobileSavings}%`,
      url: mobileUrl,
      artifactPath: mobileArtifactPath,
    },
    minioConsoleUrl: 'http://localhost:9001/browser/revamp-assets/screenshots',
  };
}

const targetUrl = process.argv[2] || 'https://stripe.com';
runLiveCrawl(targetUrl).catch((err) => {
  console.error('Fatal crawl error:', err);
  process.exit(1);
});
