import { z } from "zod";
import { LOG_LEVELS } from "./level.js";

export const SCHEMA_VERSION = 1;

/** Limits shared by SDKs and servers so both sides agree on what is acceptable. */
export const LIMITS = {
  maxBatchSize: 500,
  maxMessageLength: 8_192,
  maxAttributesBytes: 64 * 1024,
  maxStackLength: 32_768,
  maxErrorCauseDepth: 5,
} as const;

export const LogLevelSchema = z.enum(LOG_LEVELS);

export interface SerializedError {
  name?: string | undefined;
  message?: string | undefined;
  stack?: string | undefined;
  cause?: SerializedError | undefined;
}

export const SerializedErrorSchema: z.ZodType<SerializedError> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    message: z.string().optional(),
    stack: z.string().max(LIMITS.maxStackLength).optional(),
    cause: SerializedErrorSchema.optional(),
  }),
);

export const LogEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Client-generated UUID (v7), used by servers to deduplicate retries. */
  id: z.string().min(1).max(64),
  /** ISO 8601 UTC timestamp. */
  timestamp: z.iso.datetime(),
  level: LogLevelSchema,
  message: z.string().max(LIMITS.maxMessageLength),
  environment: z.string().optional(),
  service: z.string().optional(),
  release: z.string().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  error: SerializedErrorSchema.optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  sdk: z.object({ name: z.string(), version: z.string() }).optional(),
});

export type LogEvent = z.infer<typeof LogEventSchema>;

export const IngestRequestSchema = z.object({
  events: z.array(LogEventSchema).min(1).max(LIMITS.maxBatchSize),
});

export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative().default(0),
});

export type IngestResponse = z.infer<typeof IngestResponseSchema>;
