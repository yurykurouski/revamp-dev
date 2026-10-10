// The audit's full desktop capture, which the model sees when it designs or changes a page (REV-138, REV-139)

/** A capture that takes longer than this is left out rather than holding the generation */
const CAPTURE_TIMEOUT_MS = 15_000;

/** The audit's full desktop capture for the model; a capture that cannot be loaded leaves a text-only call */
export async function desktopCapture(url: string | undefined): Promise<Buffer | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[DesktopCapture] The desktop capture was not loaded (HTTP ${res.status}); generating without it`);
      return undefined;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.warn('[DesktopCapture] The desktop capture was not loaded; generating without it:', error);
    return undefined;
  }
}
