import { useCallback, useEffect, useState } from 'react';

/** How long the overlay waits for the regenerated preview to load before giving up (REV-53) */
export const REGENERATION_LOAD_TIMEOUT_MS = 20000;

interface RegenerationOverlayInput {
  /** A regenerate request is in flight or the lead is GENERATING */
  busy: boolean;
  /** Current (versioned) preview URL shown in the iframe */
  previewUrl: string;
}

/**
 * Decides when the MVP preview is covered by the regeneration overlay (REV-53): for as long as
 * the regeneration runs, then until the iframe has loaded the new version. When the run ends
 * without a new version (failure), or the new one never loads, the overlay goes away on its own.
 */
export const useRegenerationOverlay = ({ busy, previewUrl }: RegenerationOverlayInput) => {
  // Preview shown when the run started; a different URL afterwards means a new version
  const [startUrl, setStartUrl] = useState<string | null>(busy ? previewUrl : null);
  const [awaitingUrl, setAwaitingUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (busy) {
      setStartUrl((current) => current ?? previewUrl);
      setAwaitingUrl(null);
      return;
    }
    if (startUrl !== null) {
      setAwaitingUrl(previewUrl !== startUrl ? previewUrl : null);
      setStartUrl(null);
    }
  }, [busy, previewUrl, startUrl]);

  const waitingForLoad = awaitingUrl !== null && loadedUrl !== awaitingUrl;

  useEffect(() => {
    if (!waitingForLoad) return;
    const timer = setTimeout(() => setAwaitingUrl(null), REGENERATION_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [waitingForLoad]);

  const onFrameLoad = useCallback((url: string) => setLoadedUrl(url), []);

  return { visible: busy || waitingForLoad, onFrameLoad };
};
