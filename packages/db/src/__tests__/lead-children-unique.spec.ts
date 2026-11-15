import { describe, expect, it } from 'vitest';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';

// REV-201: a lead has at most one MvpProject and one EmailCampaign; the database tests are in real-mongo.spec.ts

describe('leadId is unique on MvpProject and EmailCampaign (REV-201)', () => {
  it('declares a unique leadId index on both schemas', () => {
    for (const model of [MvpProject, EmailCampaign]) {
      expect(model.schema.indexes()).toContainEqual([
        { leadId: 1 },
        expect.objectContaining({ unique: true }),
      ]);
    }
  });
});
