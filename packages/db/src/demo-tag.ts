// The tag every seeded demo lead carries (REV-199). Its own module so runtime code can skip demo leads
// (REV-204) without importing the seed dataset, which runtime code never reads (REV-45).
export const DEMO_SEED_TAG = 'demo-seed';
