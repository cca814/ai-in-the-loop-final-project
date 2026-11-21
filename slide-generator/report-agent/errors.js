export class ConfigurationError extends Error {}
export class ModelOutputError extends Error {
  constructor(message, code = 'MODEL_OUTPUT_INVALID') { super(message); this.code = code; }
}
export class GenerationOutputError extends ModelOutputError {
  constructor(message, code, page, field) {
    super(message);
    this.code = code;
    this.page = page;
    this.field = field;
  }
}
export class RepositorySelectionError extends ModelOutputError {}
export class RevisionOutputError extends ModelOutputError {
  constructor(message, code = 'REVISION_JSON_INVALID') {
    super(message);
    this.code = code;
  }
}

export class ProviderError extends Error {
  constructor(status, attempts = 1, kind = 'http') {
    super(status ? `LLM request failed (HTTP ${status}; ${attempts} attempts)` : `LLM request failed (${kind})`);
    this.status = status;
    this.attempts = attempts;
    this.kind = kind;
  }
}
