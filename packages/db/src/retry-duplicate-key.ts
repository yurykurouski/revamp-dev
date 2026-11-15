/**
 * Runs an upsert once more after a duplicate-key error (E11000), then gives up (REV-201).
 * MongoDB retries a concurrent upsert by itself only when the error comes from the unique index its
 * equality filter uses. An upsert that also writes another unique field (MvpProject.previewSlug)
 * can fail on that index first, depending on index order; by the second run the other writer's
 * document exists, so the upsert becomes an update.
 */
export async function retryOnDuplicateKey<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 11000) throw error;
    return operation();
  }
}
