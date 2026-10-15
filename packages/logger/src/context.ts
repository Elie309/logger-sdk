import { AsyncLocalStorage } from "node:async_hooks";
import type { Attributes } from "./types.js";

export interface RequestContext extends Attributes {
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with ambient context; every event logged inside inherits requestId/traceId/spanId. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...context }, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
