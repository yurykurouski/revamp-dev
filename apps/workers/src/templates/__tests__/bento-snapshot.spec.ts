import { describe, expect, it } from 'vitest';
import { IBentoTemplateData, BENTO_LAYOUT_VARIANTS } from '@revamp/shared-types';
import { generateBentoHtml } from '../bento.template.js';

const data: IBentoTemplateData = {
  businessName: 'Warsaw Dental Center',
  language: 'pl',
  palette: { primary: '#0e7490', secondary: '#1e293b', accent: '#0e7490' },
  contacts: { phone: '+48 22 542 18 04', email: 'kontakt@wdc.example', address: 'ul. Powstańców Śląskich 7a', workingHours: 'Pn-Pt 9-21' },
  hero: { headline: 'Klinika', subheadline: 'Od 2010 roku.' },
  services: [{ title: 'Implanty', description: 'Tytan.', lucideIconName: 'shield-check' }],
  trustSignals: [],
  reviews: [{ author: 'Anna', comment: 'Polecam!', source: 'Website' }],
  gallery: ['https://wdc.example/1.jpg'],
  publicApiUrl: 'https://api.example/api/v1',
  trackingToken: 'tok_123',
};

// Taken before the shared pieces moved out of the template (REV-110); the move must not change a byte. Updated for
// REV-118, which adds the OpenGraph tags to the head and nothing else
describe('Bento output is unchanged by the shared extraction', () => {
  for (const layout of BENTO_LAYOUT_VARIANTS) {
    it(`renders the ${layout} layout exactly as before`, () => {
      expect(generateBentoHtml({ ...data, layout })).toMatchSnapshot();
    });
  }
  it('renders without a tracker or a logo exactly as before', () => {
    expect(generateBentoHtml({ ...data, publicApiUrl: undefined, trackingToken: undefined })).toMatchSnapshot();
  });
});
