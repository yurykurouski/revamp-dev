export const QUEUE_NAMES = {
  AUDIT: 'audit-queue',
  AI_GENERATION: 'ai-gen-queue',
  DEPLOY: 'deploy-queue',
  EMAIL_DISPATCH: 'email-queue',
  DISCOVERY: 'discovery-queue',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
