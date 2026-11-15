import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { startMongoReplSet } from '../testing/mongo-memory.js';

// REV-201: a lead has at most one MvpProject and one EmailCampaign, and the database enforces it

const mvpFields = (n: number) => ({
  auditId: new Types.ObjectId(),
  previewSlug: `slug-${n}-${new Types.ObjectId().toString()}`,
  fullPreviewUrl: `http://localhost/v/slug-${n}/index.html`,
  storageHtmlPath: `v/slug-${n}/index.html`,
});

const campaignFields = (n: number) => ({
  status: 'SCHEDULED',
  senderEmail: 'sender@example.com',
  recipientEmail: 'owner@example.com',
  subject: `Subject ${n}`,
  bodyHtml: '<p>Hi</p>',
  bodyPlainText: 'Hi',
  trackingToken: `token-${n}-${new Types.ObjectId().toString()}`,
});

describe('leadId is unique on MvpProject and EmailCampaign (REV-201)', () => {
  it('declares a unique leadId index on both schemas', () => {
    for (const model of [MvpProject, EmailCampaign]) {
      expect(model.schema.indexes()).toContainEqual([{ leadId: 1 }, expect.objectContaining({ unique: true })]);
    }
  });

  describe('on a real MongoDB', () => {
    let mongo: Awaited<ReturnType<typeof startMongoReplSet>>;

    beforeAll(async () => {
      mongo = await startMongoReplSet();
      await mongoose.connect(mongo.uri);
      await Promise.all([MvpProject.init(), EmailCampaign.init()]);
    }, 180_000);

    afterAll(async () => {
      await mongoose.disconnect();
      await mongo?.stop();
    });

    beforeEach(async () => {
      await Promise.all([MvpProject.deleteMany({}), EmailCampaign.deleteMany({})]);
    });

    it('rejects a second MvpProject for the same lead', async () => {
      const leadId = new Types.ObjectId();
      await MvpProject.create({ leadId, ...mvpFields(1) });
      await expect(MvpProject.create({ leadId, ...mvpFields(2) })).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects a second EmailCampaign for the same lead', async () => {
      const leadId = new Types.ObjectId();
      await EmailCampaign.create({ leadId, ...campaignFields(1) });
      await expect(EmailCampaign.create({ leadId, ...campaignFields(2) })).rejects.toMatchObject({ code: 11000 });
    });

    // Same shape as deploy.worker: filter on leadId, leadId not in the update
    it('leaves one MvpProject after 20 concurrent upserts for one lead', async () => {
      const leadId = new Types.ObjectId();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          MvpProject.findOneAndUpdate(
            { leadId },
            { $set: { ...mvpFields(n), isPublished: true }, $inc: { generationCount: 1 } },
            { upsert: true, new: true, strict: false },
          ).exec(),
        ),
      );
      expect(results.every((doc) => doc?.leadId.equals(leadId))).toBe(true);
      expect(await MvpProject.countDocuments({ leadId })).toBe(1);
      expect((await MvpProject.findOne({ leadId }).lean())?.generationCount).toBe(20);
    });

    // Same shape as outreach approve: an implicit $set without leadId
    it('leaves one EmailCampaign after 20 concurrent upserts for one lead', async () => {
      const leadId = new Types.ObjectId();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, n) =>
          EmailCampaign.findOneAndUpdate({ leadId }, campaignFields(n), { upsert: true, new: true }).exec(),
        ),
      );
      expect(results.every((doc) => doc?.leadId.equals(leadId))).toBe(true);
      expect(await EmailCampaign.countDocuments({ leadId })).toBe(1);
    });
  });
});
