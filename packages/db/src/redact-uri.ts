/**
 * A MongoDB connection string that is safe to log: the password becomes `***` (REV-198).
 * The local URI carries the revamp_app password and the production one the Atlas password,
 * so logs print this, never `MONGODB_URI` itself.
 */
export function redactMongoUri(uri: string): string {
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^@/]*@)?(.*)$/);
  if (!match) return '<not a MongoDB URI>';
  const [, scheme, credentials, rest] = match;
  if (!credentials) return uri;
  const user = credentials.slice(0, -1).split(':')[0];
  return `${scheme}${user}:***@${rest}`;
}
