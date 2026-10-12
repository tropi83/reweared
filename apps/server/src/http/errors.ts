import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";
import { AppError, type GenerationErrorCode } from "@aiv/domain/models";
import type { HttpErrorCode } from "@aiv/contracts/common";

type ErrorCode = HttpErrorCode | GenerationErrorCode;

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  AUTH_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INVALID_REQUEST: 400,
  INVALID_IMAGE: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSUPPORTED_FORMAT: 415,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  PROVIDER_UNAVAILABLE: 503,
  STORAGE_ERROR: 503,
};

/** An error that reaches the client as `{ code, message }` with its HTTP status. The message must be user-safe. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Fastify's own errors that are the client's fault, mapped to our codes. */
const FASTIFY_CODES: Record<string, { status: number; code: HttpErrorCode; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported content type." },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: "VALIDATION_FAILED", message: "The request body is empty." },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, code: "VALIDATION_FAILED", message: "The request body is not valid JSON." },
  // @fastify/multipart (uploads)
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The file is too large." },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the image as multipart/form-data." },
  FST_FILES_LIMIT: { status: 400, code: "VALIDATION_FAILED", message: "Send one image at a time." },
  FST_PARTS_LIMIT: { status: 400, code: "VALIDATION_FAILED", message: "Too many form fields." },
  FST_FIELDS_LIMIT: { status: 400, code: "VALIDATION_FAILED", message: "Too many form fields." },
  FST_NO_FORM_DATA: { status: 400, code: "VALIDATION_FAILED", message: "No image was sent." },
  FST_PROTO_VIOLATION: { status: 400, code: "VALIDATION_FAILED", message: "Invalid form field name." },
  FST_MP_PREMATURE_CLOSE: { status: 400, code: "VALIDATION_FAILED", message: "The upload was interrupted." },
};

/**
 * Every error leaves as `{ code, message }`: known errors with their status and safe message, everything else
 * as a 500 `UNKNOWN_ERROR` whose details stay in the (redacted) log — never a stack trace or an internal
 * message in the response.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ code: "NOT_FOUND", message: "Not found." }));

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ code: error.code, message: error.message });
    if (error instanceof AppError) {
      return reply.code(STATUS_BY_CODE[error.code] ?? 500).send({ code: error.code, message: error.message });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "The request does not match the expected shape." });
    }
    const known = error.code ? FASTIFY_CODES[error.code] : undefined;
    if (known) return reply.code(known.status).send({ code: known.code, message: known.message });
    if (error.statusCode === 429) return reply.code(429).send({ code: "RATE_LIMITED", message: "Too many requests. Try again later." });
    if (isResponseSerializationError(error)) req.log.error({ err: error }, "response does not match its schema");
    else req.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ code: "UNKNOWN_ERROR", message: "Unexpected error." });
  });
}
