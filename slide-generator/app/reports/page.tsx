import type { Metadata } from 'next';
import ReportWorkspace from './workspace';

export const metadata: Metadata = {
  title: 'Reports | Bridging Code and Intent',
  description: 'Review project state and draft a progress report.',
};

export default function ReportsPage() {
  return <ReportWorkspace />;
}
