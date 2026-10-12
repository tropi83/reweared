/**
 * Credential redaction shared by the app's logger and the server's logs. Everything logged anywhere must
 * go through `redact` so API keys, bearer tokens, session cookies and refresh tokens never reach a console,
 * a diagnostics export or a log file. Images and prompts are never logged either.
 */

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /ya29\.[0-9A-Za-z_-]+/g, // Google OAuth access tokens
  /1\/\/[0-9A-Za-z_-]{20,}/g, // Google refresh tokens
  /\bre_[0-9A-Za-z_]{20,}/g, // Resend API keys
  /Bearer\s+[0-9A-Za-z._~+/=-]+/gi,
  // Better Auth session cookies (plain and __Secure- prefixed): keep the cookie name, drop the value.
  /((?:__Secure-)?better-auth\.session_(?:token|data)=)[^;\s,]+/gi,
  /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|set-auth-token|authorization|x-goog-api-key|client[_-]?secret|(?:aws[_-]?)?secret[_-]?access[_-]?key|password)"?\s*[:=]\s*)("?)[^",;\s}]+\2/gi,
];

export function redact(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: string | undefined) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}
