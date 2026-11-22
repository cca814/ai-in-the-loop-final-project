import type { Metadata } from 'next';
import ReportWorkspace from './workspace';
import { stateDatasets } from './state-datasets';

export const metadata: Metadata = {
  title: 'Reports | Bridging Code and Intent',
  description: 'Review project state and draft a progress report.',
};

export default function ReportsPage() {
  return <ReportWorkspace datasets={stateDatasets} />;
}
