/**
 * The promise, or a rejection after `ms` (REV-202, REV-203). The Redis connection retries forever
 * (`maxRetriesPerRequest: null`), so a queue call needs a limit or a Redis outage hangs the request.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
