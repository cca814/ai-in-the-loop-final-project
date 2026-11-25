import "server-only";
import Ajv2020 from "ajv/dist/2020";

// Firestore auto IDs are 20 letters and digits.
export const REPORT_ID = /^[A-Za-z0-9]{20}$/;
const MAX_BYTES = 800 * 1024;

export type ReportInput = { name: string; type: "report" | "slides"; content: string };

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile<ReportInput>({
  type: "object",
  additionalProperties: false,
  required: ["name", "type", "content"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    type: { enum: ["report", "slides"] },
    content: { type: "string" },
  },
});

// Returns the checked body, or an error response to send back as is.
export async function readReport(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) {
    return { error: Response.json({ error: "payload_too_large" }, { status: 413 }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: Response.json({ error: "invalid_json" }, { status: 400 }) };
  }

  if (!validate(body)) {
    const details = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "(root)"} ${e.message}`,
    );
    return { error: Response.json({ error: "invalid_report", details }, { status: 400 }) };
  }
  return { value: body };
}
