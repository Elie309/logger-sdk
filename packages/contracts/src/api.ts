import { z } from "zod";
import { LogEventSchema, LogLevelSchema, LogSourceSchema } from "./event.js";

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const LogQuerySchema = z.object({
  level: LogLevelSchema.optional(),
  minLevel: LogLevelSchema.optional(),
  source: LogSourceSchema.optional(),
  kind: z.string().optional(),
  service: z.string().optional(),
  environment: z.string().optional(),
  search: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().optional(),
});

export type LogQuery = z.infer<typeof LogQuerySchema>;

export const PageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export const LogPageSchema = PageSchema(LogEventSchema);

export type LogPage = z.infer<typeof LogPageSchema>;
