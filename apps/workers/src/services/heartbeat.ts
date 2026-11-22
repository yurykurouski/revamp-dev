import { writeFile } from 'node:fs/promises';

/** The file the container HEALTHCHECK in apps/workers/Dockerfile looks at (REV-217) */
export const HEARTBEAT_FILE = '/tmp/revamp-workers-heartbeat';
/** The HEALTHCHECK passes while the file is younger than a minute; four beats fit in that window */
export const HEARTBEAT_INTERVAL_MS = 15_000;

export interface HeartbeatOptions {
  /** True while the process can do its work: MongoDB connected and Redis ready */
  isHealthy: () => boolean;
  file?: string;
  intervalMs?: number;
  write?: (file: string, data: string) => Promise<unknown>;
}

/**
 * Touches a file every few seconds for as long as `isHealthy()` holds. The workers have no HTTP port,
 * so Docker asks "was the file written in the last minute?"; a crashed process, a lost MongoDB or a
 * lost Redis stops the beats and the container turns unhealthy. Returns the function that stops it.
 */
export function startHeartbeat({
  isHealthy,
  file = HEARTBEAT_FILE,
  intervalMs = HEARTBEAT_INTERVAL_MS,
  write = writeFile,
}: HeartbeatOptions): () => void {
  const beat = (): void => {
    if (!isHealthy()) return;
    write(file, new Date().toISOString()).catch((error: unknown) => {
      console.warn(`[Workers] Could not write the heartbeat file ${file}: ${(error as Error).message}`);
    });
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  // The beat must never keep a stopping process alive
  timer.unref();
  return () => clearInterval(timer);
}
