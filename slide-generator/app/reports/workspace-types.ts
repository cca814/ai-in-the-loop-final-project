// Type-only import: the server validator and Firebase code never enter the browser.
import type { ProjectState } from '../../lib/project-state';

export type WorkspaceState = ProjectState;

export type GenerateReportInput = {
  states: WorkspaceState[];
  brief: string;
};

export type ExportKind = 'web' | 'pptx' | 'portable';

export type WorkspaceErrorCode =
  | 'empty_states'
  | 'project_mismatch'
  | 'empty_report'
  | 'empty_slides'
  | 'unavailable'
  | 'rate_limited';

// Adapters expose a known code, never a provider response or arbitrary message.
export class WorkspaceActionError extends Error {
  constructor(readonly code: WorkspaceErrorCode) {
    super(code);
    this.name = 'WorkspaceActionError';
  }
}

// Supplied by a client-side API adapter in the integration PR.
// Reject with WorkspaceActionError for known failures; other errors stay generic.
export type WorkspaceActions = {
  loadStates?: (projectId: string) => Promise<WorkspaceState[]>;
  generateReport?: (input: GenerateReportInput) => Promise<string>;
  generateSlides?: (input: { report: string; automaticEffects: boolean }) => Promise<string>;
  exportSlides?: (input: { markdown: string; kind: ExportKind }) => Promise<void>;
};
