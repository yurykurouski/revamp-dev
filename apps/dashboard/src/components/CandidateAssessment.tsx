import React from 'react';
import { Chip, Typography } from '@mui/material';
import { ISiteAssessment } from '@revamp/shared-types';
import { useTranslation } from 'react-i18next';
import {
  ASSESSMENT_CHIP_COLOR,
  AssessmentDetail,
  assessmentBucket,
  assessmentDetails,
  verdictArgument,
} from '../utils/siteAssessment.js';

/** The verdict chip of a discovered site's pre-assessment (REV-98) */
export const AssessmentVerdictChip: React.FC<{ assessment: ISiteAssessment }> = ({ assessment }) => {
  const { t } = useTranslation();
  const bucket = assessmentBucket(assessment);
  if (bucket === 'none') return null;
  return (
    <Chip
      size="small"
      variant={bucket === 'failed' ? 'outlined' : 'filled'}
      color={ASSESSMENT_CHIP_COLOR[bucket]}
      label={t(`discovery.assessment.verdict.${bucket}`)}
      data-testid="assessment-verdict"
    />
  );
};

/**
 * What the check found: one line with simple or complex and the redesign signs (or why the check
 * failed), then the argument for the verdict, e.g. why the site is a poor candidate
 */
export const AssessmentDetails: React.FC<{ assessment: ISiteAssessment }> = ({ assessment }) => {
  const { t } = useTranslation();
  const label = (detail: AssessmentDetail): string => {
    switch (detail.kind) {
      case 'complexity':
        return t(`discovery.assessment.complexitySign.${detail.sign}`, detail.values);
      case 'bad':
        return t(`discovery.assessment.badSign.${detail.sign}`, detail.values);
      case 'noSigns':
        return t('discovery.assessment.noSigns');
      case 'failure':
        return t(`discovery.assessment.failure.${detail.failure}`, detail.values);
    }
  };
  const parts = assessmentDetails(assessment).map(label);
  if (assessment.outcome === 'assessed' && assessment.simple) parts.unshift(t('discovery.assessment.simple'));
  const text = parts.join(' · ');
  const argument = verdictArgument(assessment);

  return (
    <>
      <Typography variant="caption" color="text.secondary" component="div" noWrap title={text} data-testid="assessment-details">
        {text}
      </Typography>
      {argument && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ fontStyle: 'italic' }} data-testid="assessment-reason">
          {t(`discovery.assessment.verdictReason.${argument.reason}`, argument.values)}
        </Typography>
      )}
    </>
  );
};
