import type { Request } from 'express';
import type { CorsOptions, CorsOptionsDelegate } from 'cors';

interface CorsEnv {
  CORS_ORIGIN: string;
  API_PREFIX: string;
  S3_ENDPOINT: string;
  PREVIEW_DOMAIN: string;
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Origins that serve generated MVPs: the S3/MinIO endpoint locally, PREVIEW_DOMAIN in production.
 */
export const getPreviewOrigins = (env: CorsEnv): string[] =>
  [originOf(env.S3_ENDPOINT), originOf(`https://${env.PREVIEW_DOMAIN}`)].filter(
    (origin): origin is string => Boolean(origin),
  );

/**
 * The dashboard origin may call the whole API. MVP pages may also call the public telemetry
 * routes (/track/*) to send tracker events (REV-52). navigator.sendBeacon always sends in
 * credentials mode "include", so those responses must allow credentials too; the origins are
 * an explicit allow-list, never "*".
 */
export const createCorsOptionsDelegate = (env: CorsEnv): CorsOptionsDelegate<Request> => {
  const dashboardOptions: CorsOptions = { origin: env.CORS_ORIGIN, credentials: true };
  const trackOptions: CorsOptions = { origin: [env.CORS_ORIGIN, ...getPreviewOrigins(env)], credentials: true };
  const trackPrefix = `${env.API_PREFIX.replace(/\/+$/, '')}/track/`;

  return (req, callback) => {
    const path = req.originalUrl ?? req.url ?? '';
    callback(null, path.startsWith(trackPrefix) ? trackOptions : dashboardOptions);
  };
};
