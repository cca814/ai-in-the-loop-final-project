import { pLimitDataset } from '../../test-data/p-limit/workspace-dataset';
import type { WorkspaceDataset } from './workspace-types';
import normal from '../../schemas/examples/normal.json';
import missingRisks from '../../schemas/examples/missing_risks.json';
import featureDone from '../../schemas/examples/feature_done.json';

export const stateDatasets = [
  { id: 'demo', label: '範例專案 · Demo App', snapshots: [
    { id: 'normal', label: '一般進度', state: normal },
    { id: 'missingRisks', label: '缺少風險評估', state: missingRisks },
    { id: 'featureDone', label: '功能完成', state: featureDone },
  ] },
  pLimitDataset,
] satisfies WorkspaceDataset[];
