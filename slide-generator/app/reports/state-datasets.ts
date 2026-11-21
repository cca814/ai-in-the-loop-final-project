import normal from '../../schemas/examples/normal.json';
import missingRisks from '../../schemas/examples/missing_risks.json';
import featureDone from '../../schemas/examples/feature_done.json';
import pr1 from '../../test-data/p-limit/states/001-pr-1.json';
import pr4 from '../../test-data/p-limit/states/002-pr-4.json';
import pr7 from '../../test-data/p-limit/states/003-pr-7.json';
import pr8 from '../../test-data/p-limit/states/004-pr-8.json';
import pr9 from '../../test-data/p-limit/states/005-pr-9.json';
import pr11 from '../../test-data/p-limit/states/006-pr-11.json';
import pr12 from '../../test-data/p-limit/states/007-pr-12.json';
import pr20 from '../../test-data/p-limit/states/008-pr-20.json';
import pr28 from '../../test-data/p-limit/states/009-pr-28.json';
import pr30 from '../../test-data/p-limit/states/010-pr-30.json';
import pr35 from '../../test-data/p-limit/states/011-pr-35.json';
import pr47 from '../../test-data/p-limit/states/012-pr-47.json';
import pr50 from '../../test-data/p-limit/states/013-pr-50.json';
import pr71 from '../../test-data/p-limit/states/014-pr-71.json';
import pr83 from '../../test-data/p-limit/states/015-pr-83.json';
import pr79 from '../../test-data/p-limit/states/016-pr-79.json';
import pr88 from '../../test-data/p-limit/states/017-pr-88.json';
import pr93 from '../../test-data/p-limit/states/018-pr-93.json';
import pr98 from '../../test-data/p-limit/states/019-pr-98.json';
import pr108 from '../../test-data/p-limit/states/020-pr-108.json';
import pr109 from '../../test-data/p-limit/states/021-pr-109.json';

export const stateDatasets = [
  { id: 'demo', label: '範例專案 · Demo App', snapshots: [
    { id: 'normal', label: '一般進度', state: normal },
    { id: 'missingRisks', label: '缺少風險評估', state: missingRisks },
    { id: 'featureDone', label: '功能完成', state: featureDone },
  ] },
  { id: 'p-limit', label: 'p-limit · 21 次真實 PR merge', snapshots: [
    { id: 'p-limit-pr-1', label: '01 · PR #1 · 2016-10-31', state: pr1 },
    { id: 'p-limit-pr-4', label: '02 · PR #4 · 2018-01-04', state: pr4 },
    { id: 'p-limit-pr-7', label: '03 · PR #7 · 2018-06-06', state: pr7 },
    { id: 'p-limit-pr-8', label: '04 · PR #8 · 2018-06-14', state: pr8 },
    { id: 'p-limit-pr-9', label: '05 · PR #9 · 2018-12-25', state: pr9 },
    { id: 'p-limit-pr-11', label: '06 · PR #11 · 2019-03-02', state: pr11 },
    { id: 'p-limit-pr-12', label: '07 · PR #12 · 2019-04-26', state: pr12 },
    { id: 'p-limit-pr-20', label: '08 · PR #20 · 2020-04-05', state: pr20 },
    { id: 'p-limit-pr-28', label: '09 · PR #28 · 2020-05-18', state: pr28 },
    { id: 'p-limit-pr-30', label: '10 · PR #30 · 2020-06-06', state: pr30 },
    { id: 'p-limit-pr-35', label: '11 · PR #35 · 2020-07-12', state: pr35 },
    { id: 'p-limit-pr-47', label: '12 · PR #47 · 2020-11-25', state: pr47 },
    { id: 'p-limit-pr-50', label: '13 · PR #50 · 2021-02-23', state: pr50 },
    { id: 'p-limit-pr-71', label: '14 · PR #71 · 2023-11-01', state: pr71 },
    { id: 'p-limit-pr-83', label: '15 · PR #83 · 2024-07-04', state: pr83 },
    { id: 'p-limit-pr-79', label: '16 · PR #79 · 2024-07-08', state: pr79 },
    { id: 'p-limit-pr-88', label: '17 · PR #88 · 2024-12-19', state: pr88 },
    { id: 'p-limit-pr-93', label: '18 · PR #93 · 2025-08-14', state: pr93 },
    { id: 'p-limit-pr-98', label: '19 · PR #98 · 2025-10-19', state: pr98 },
    { id: 'p-limit-pr-108', label: '20 · PR #108 · 2026-07-20', state: pr108 },
    { id: 'p-limit-pr-109', label: '21 · PR #109 · 2026-08-31', state: pr109 },
  ] },
];

