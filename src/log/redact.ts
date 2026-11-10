/**
 * Redaction for logs and the audit log. Three layers:
 *
 * 1. By key: fields whose name says "secret" (clientSecret, botToken, apiKey, refreshToken, …).
 * 2. By value: every registered secret (the env secrets, and OAuth tokens once M5 loads them)
 *    is cut out of any string it appears in.
 * 3. By shape: api-key style URL params and "Bearer …" headers.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PARTS =
  /(secret|password|passwd|passphrase|privatekey|secretkey|seedphrase|mnemonic|apikey|bearer|authorization|cookie|keypair)/;
const SENSITIVE_TOKEN_KEY = /(^|access|auth|bot|grpc|refresh|session|api|id)token$/;

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k === "seed" || SENSITIVE_KEY_PARTS.test(k) || SENSITIVE_TOKEN_KEY.test(k);
}

const URL_SECRET_PARAM = /([?&](?:api[-_]?key|apikey|access[-_]?token|token|key|secret|auth)=)[^&\s#"']+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/%]+=*/gi;

const MIN_SECRET_LENGTH = 8;

export interface Redactor {
  addSecret(value: string): void;
  redactString(s: string): string;
  redact(value: unknown): unknown;
}

export function createRedactor(initialSecrets: readonly string[] = []): Redactor {
  let secrets: string[] = [];

  const addSecret = (value: string) => {
    const v = value.trim();
    if (v.length < MIN_SECRET_LENGTH || secrets.includes(v)) return;
    // Longest first, so a secret that contains another is removed whole.
    secrets = [...secrets, v].sort((a, b) => b.length - a.length);
  };
  initialSecrets.forEach(addSecret);

  const redactString = (s: string): string => {
    let out = s;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out.replace(URL_SECRET_PARAM, `$1${REDACTED}`).replace(BEARER, `Bearer ${REDACTED}`);
  };

  const walk = (value: unknown, seen: WeakSet<object>): unknown => {
    if (typeof value === "string") return redactString(value);
    if (typeof value === "bigint") return value.toString();
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        ...(value.stack ? { stack: redactString(value.stack) } : {}),
      };
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, seen));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const keepAsIs = v === null || v === undefined || typeof v === "boolean";
      out[k] = isSensitiveKey(k) && !keepAsIs ? REDACTED : walk(v, seen);
    }
    return out;
  };

  return { addSecret, redactString, redact: (value) => walk(value, new WeakSet()) };
}
