"""Read-only validation using the unchanged, teammate-owned official schema."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parent
schema = json.loads((root.parent.parent / "schemas/project_state.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=FormatChecker())
states = sorted((root / "states").glob("*.json"))
if not states:
    raise SystemExit("No states found. Run node replay.mjs first.")
for path in states:
    validator.validate(json.loads(path.read_text(encoding="utf-8")))
print(f"Validated {len(states)} states against official Draft 2020-12 schema, including formats.")
