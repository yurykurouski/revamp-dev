import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { DiscoveryCandidateStatus, IDiscoveryCandidate, IDiscoveryImportResult } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import {
  countCandidates,
  importableIds,
  pruneSelection,
  summarizeImport,
  useImportDiscoveryMutation,
} from '../hooks/useDiscovery.js';

const STATUS_ORDER: DiscoveryCandidateStatus[] = ['new', 'existing_lead', 'duplicate', 'no_website', 'invalid'];

const STATUS_CHIP_COLOR = {
  new: 'success',
  existing_lead: 'info',
  duplicate: 'default',
  no_website: 'default',
  invalid: 'warning',
} as const;

interface DiscoveryReviewProps {
  jobId: string;
  candidates: IDiscoveryCandidate[];
}

/**
 * Lists every business a discovery search found and imports the operator's selection as leads (REV-29).
 */
export const DiscoveryReview: React.FC<DiscoveryReviewProps> = ({ jobId, candidates }) => {
  const { t } = useTranslation();
  const importMutation = useImportDiscoveryMutation(jobId);

  const counts = useMemo(() => countCandidates(candidates), [candidates]);
  const skippedCount = candidates.length - counts.new;

  // New businesses start selected; imported ones drop out as polling marks them existing_lead
  const [selected, setSelected] = useState<Set<string>>(() => new Set(importableIds(candidates)));
  const [showSkipped, setShowSkipped] = useState(counts.new === 0);
  const [lastImport, setLastImport] = useState<IDiscoveryImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setSelected((current) => pruneSelection(current, candidates));
  }, [candidates]);

  const rows = showSkipped ? candidates : candidates.filter((c) => c.status === 'new');
  const importable = importableIds(candidates);
  const allSelected = importable.length > 0 && importable.every((id) => selected.has(id));

  const toggle = (externalId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(importable));

  const handleImport = async () => {
    setImportError(null);
    try {
      const result = await importMutation.mutateAsync([...selected]);
      setLastImport(result);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : t('discovery.errors.importFailed'));
    }
  };

  const summary = lastImport ? summarizeImport(lastImport) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
          <Chip
            key={status}
            size="small"
            variant={status === 'new' ? 'filled' : 'outlined'}
            color={STATUS_CHIP_COLOR[status]}
            label={`${t(`discovery.candidateStatus.${status}`)}: ${counts[status]}`}
          />
        ))}
      </Box>

      {summary && (
        <Alert severity={summary.failed > 0 ? 'warning' : 'success'} sx={{ borderRadius: 2 }} onClose={() => setLastImport(null)}>
          {t('discovery.importDone', { imported: summary.imported })}
          {summary.skipped > 0 && ` ${t('discovery.importSkipped', { skipped: summary.skipped })}`}
          {summary.failed > 0 && ` ${t('discovery.importFailedCount', { failed: summary.failed })}`}
        </Alert>
      )}
      {importError && (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {importError}
        </Alert>
      )}

      {counts.new === 0 && !summary ? (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {t('discovery.nothingNewHint')}
        </Alert>
      ) : (
        counts.new > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('discovery.reviewHint')}
          </Typography>
        )
      )}

      {rows.length > 0 && (
        <TableContainer sx={{ maxHeight: 360, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    disabled={importable.length === 0 || importMutation.isPending}
                    onChange={toggleAll}
                    inputProps={{ 'aria-label': t('discovery.selectAll') }}
                  />
                </TableCell>
                <TableCell>{t('discovery.columns.business')}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{t('discovery.columns.city')}</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('discovery.columns.phone')}</TableCell>
                <TableCell>{t('discovery.columns.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => {
                const isNew = c.status === 'new';
                return (
                  <TableRow
                    key={c.externalId}
                    hover={isNew}
                    onClick={isNew && !importMutation.isPending ? () => toggle(c.externalId) : undefined}
                    sx={{ cursor: isNew ? 'pointer' : 'default', opacity: isNew ? 1 : 0.6 }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.has(c.externalId)}
                        disabled={!isNew || importMutation.isPending}
                        inputProps={{ 'aria-label': c.name }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(c.externalId)}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: { xs: 125, sm: 260 } }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={c.name}>
                        {c.name}
                      </Typography>
                      {c.website && (
                        <Link
                          href={c.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="caption"
                          onClick={(e) => e.stopPropagation()}
                          sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {c.domain ?? c.website}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{c.city ?? '—'}</TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, whiteSpace: 'nowrap' }}>
                      {c.phone ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={STATUS_CHIP_COLOR[c.status]}
                        label={t(`discovery.candidateStatus.${c.status}`)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {skippedCount > 0 && (
          <FormControlLabel
            control={<Switch size="small" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />}
            label={<Typography variant="body2">{t('discovery.showSkipped', { skipped: skippedCount })}</Typography>}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {importable.length > 0 && (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={selected.size === 0 || importMutation.isPending}
            startIcon={importMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <PlaylistAddIcon />}
            sx={{ fontWeight: 700 }}
          >
            {importMutation.isPending ? t('discovery.importing') : t('discovery.import', { selected: selected.size })}
          </Button>
        )}
      </Box>
    </Box>
  );
};
