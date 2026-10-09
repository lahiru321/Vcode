// Recognizable secrets are scrubbed from every log line before it is written (V1 doc §16
// "Redact recognizable secrets from persisted logs"). Key names are redacted by pino itself
// (REDACT_KEYS); this catches secret *values* wherever they end up: messages, error stacks,
// command lines, nested fields.

export const REDACTED = '[redacted]';

/** Well-known API key and token formats. Each match is replaced whole. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, // OpenAI
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google (Gemini)
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key ids
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];

/** `Bearer <token>`: the scheme stays. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi;

/**
 * `NAME=value` and `"NAME":"value"` where NAME looks secret (…KEY, …TOKEN, …SECRET,
 * …PASSWORD), e.g. an environment variable in a command line: the name stays.
 */
const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*`;
const ASSIGNMENT = new RegExp(String.raw`\b(${SECRET_NAME}=)[^\s"'&|;]+`, 'gi');
const JSON_FIELD = new RegExp(String.raw`("${SECRET_NAME}"\s*:\s*")(?:[^"\\]|\\.)+(")`, 'gi');

/** `text` with recognizable secrets replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result
    .replace(BEARER, `$1${REDACTED}`)
    .replace(ASSIGNMENT, `$1${REDACTED}`)
    .replace(JSON_FIELD, `$1${REDACTED}$2`);
}

interface LineStream {
  write(chunk: string): unknown;
  flushSync?(): void;
  end?(): void;
}

/** Wraps a log destination so every line is redacted before it is written. */
export function redactingStream<S extends LineStream>(stream: S): LineStream {
  return {
    write: (chunk: string) => stream.write(redactSecrets(chunk)),
    // pino.multistream calls flushSync only where it exists, and end() always.
    flushSync: stream.flushSync ? () => stream.flushSync?.() : undefined,
    end: () => stream.end?.(),
  };
}
