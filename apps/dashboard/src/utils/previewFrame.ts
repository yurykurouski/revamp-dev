/**
 * Asks the published page in the preview frame to show a flagged fact (REV-140): the page scrolls to the text and
 * outlines it (`previewScript` in the workers' `finishMvpPage`). The frame is on another origin, so a message is the
 * only way in. False without a frame.
 */
export function showFactInPreview(frame: HTMLIFrameElement | null, text: string): boolean {
  const target = frame?.contentWindow;
  if (!target) return false;
  target.postMessage({ type: 'REVAMP_SHOW_TEXT', text }, '*');
  return true;
}
