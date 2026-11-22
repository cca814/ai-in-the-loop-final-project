import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { prepareState } from '../report-agent/state.js';

export const schema = JSON.parse(readFileSync(new URL('../schemas/project_state.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
export function validateState(state) {
  if (!validate(state)) throw new Error(`State schema invalid: ${validate.errors.slice(0, 8).map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  for (const section of ['features', 'milestones', 'risks']) {
    if (new Set(state[section].map(item => item.id)).size !== state[section].length) throw new Error(`Duplicate ${section} identifiers`);
  }
  return prepareState(state);
}
