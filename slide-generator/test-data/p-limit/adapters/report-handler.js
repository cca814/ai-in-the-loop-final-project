// Local fixture integration only. Core modules do not import this adapter.
import { reportHandler } from '../../../report-agent/http.js';
import { retrieveRepositoryContext } from '../../../report-agent/repository-context.js';
import { loadHistoricalRepository } from './repository-loader.js';
import { loadMergeHistory } from './merge-loader.js';
export function fixtureReportHandler(mode, options = {}) {
  return reportHandler(mode, { loadHistory: loadMergeHistory, retrieveContext: (args, dependencies) => retrieveRepositoryContext(args, { ...dependencies, loadSnapshot: loadHistoricalRepository }), ...options });
}
