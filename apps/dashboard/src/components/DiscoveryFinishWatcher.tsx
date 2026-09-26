import React, { useEffect, useState } from 'react';
import { Alert, Button, IconButton, Snackbar } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import { DiscoveryFinishAction, discoveryFinishAction, newCandidateCount, useDiscoveryStatusQuery } from '../hooks/useDiscovery.js';

type Notice = Exclude<DiscoveryFinishAction, 'none'>;

const SEVERITY = { notifyReady: 'success', notifyEmpty: 'info', notifyFailed: 'error' } as const;

/**
 * Announces a discovery job sent to the background when it finishes, on every page (REV-41).
 * The notification never opens the modal by itself; clicking it does. New businesses stay on screen
 * until the operator acts, while an empty or failed search hides after a few seconds.
 */
export const DiscoveryFinishWatcher: React.FC = () => {
  const { isOpen, open, activeJobId, resultsSeen, notifiedJobId, markJobNotified } = useDiscoveryStore();
  const statusQuery = useDiscoveryStatusQuery(activeJobId);
  const { t } = useTranslation();
  // The kind outlives the open flag so the text doesn't change while the snackbar fades out
  const [notice, setNotice] = useState<Notice>('notifyReady');
  const [noticeOpen, setNoticeOpen] = useState(false);

  const action = discoveryFinishAction({
    activeJobId,
    status: statusQuery.data,
    isError: statusQuery.isError,
    resultsSeen,
    isOpen,
    notifiedJobId,
  });

  useEffect(() => {
    if (action === 'none' || !activeJobId) return;
    markJobNotified(activeJobId);
    setNotice(action);
    setNoticeOpen(true);
  }, [action, activeJobId, markJobNotified]);

  // Opening the modal any other way makes the notification redundant
  useEffect(() => {
    if (isOpen) setNoticeOpen(false);
  }, [isOpen]);

  const dismiss = () => setNoticeOpen(false);
  const showResults = () => {
    setNoticeOpen(false);
    open();
  };

  const message = {
    notifyReady: t('discovery.backgroundReady', { count: newCandidateCount(statusQuery.data?.result) }),
    notifyEmpty: t('discovery.backgroundNothingNew'),
    notifyFailed: t('discovery.backgroundFailed'),
  }[notice];

  return (
    <Snackbar
      open={noticeOpen && !isOpen}
      autoHideDuration={notice === 'notifyReady' ? null : 8000}
      onClose={(_, reason) => reason !== 'clickaway' && dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      {/* The whole notification opens the modal; the button spells that out */}
      <Alert
        severity={SEVERITY[notice]}
        variant="filled"
        onClick={showResults}
        data-testid="discovery-finish-notice"
        sx={{ borderRadius: 2, alignItems: 'center', cursor: 'pointer', boxShadow: 6 }}
        action={
          <>
            <Button color="inherit" size="small" sx={{ fontWeight: 700 }}>
              {notice === 'notifyReady' ? t('discovery.backgroundReview') : t('discovery.backgroundDetails')}
            </Button>
            <IconButton
              color="inherit"
              size="small"
              aria-label={t('discovery.backgroundDismiss')}
              onClick={(e) => {
                // Closing must not also open the modal through the notification's click
                e.stopPropagation();
                dismiss();
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        }
      >
        {message}
      </Alert>
    </Snackbar>
  );
};
