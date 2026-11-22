// One schema for the API and the workers, defined in @revamp/db (REV-48)
export { Audit, type IAuditDocument, findAuditForLead, auditBelongsToLead } from '@revamp/db';
