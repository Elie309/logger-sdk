import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { LogEvent } from "@elie309/contracts";
import type { Transport } from "./types.js";

export interface FileTransportOptions {
  /** Active log file, e.g. `./logs/app.log`. Rotated files get a timestamp suffix. */
  path: string;
  /** Rotate when the active file would exceed this many bytes. Default 10 MiB. */
  maxBytes?: number;
  /** Also rotate when the UTC day changes. Default true. */
  rotateDaily?: boolean;
  /** Keep at most this many rotated files. Default 7. */
  maxFiles?: number;
  /** Delete rotated files older than this many days. Default: no age limit. */
  maxAgeDays?: number;
}

/** Appends events as NDJSON (one JSON object per line) with size/daily rotation and pruning. */
export class FileTransport implements Transport {
  readonly #opts: Required<Omit<FileTransportOptions, "maxAgeDays">> & { maxAgeDays?: number };
  #stream: WriteStream | undefined;
  #size = 0;
  #day = "";
  #chain: Promise<void> = Promise.resolve();

  constructor(options: FileTransportOptions) {
    this.#opts = { maxBytes: 10 * 1024 * 1024, rotateDaily: true, maxFiles: 7, ...options };
  }

  write(events: readonly LogEvent[]): Promise<void> {
    // Serialize writes so rotation never interleaves with appends.
    const task = this.#chain.then(() => this.#append(events));
    this.#chain = task.catch(() => undefined);
    return task;
  }

  async flush(): Promise<void> {
    await this.#chain;
  }

  async close(): Promise<void> {
    await this.#chain;
    await this.#closeStream();
  }

  async #append(events: readonly LogEvent[]): Promise<void> {
    const payload = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
    const bytes = Buffer.byteLength(payload);
    const today = new Date().toISOString().slice(0, 10);

    if (!this.#stream) await this.#open(today);
    const dayChanged = this.#opts.rotateDaily && this.#day !== today;
    if (this.#size > 0 && (dayChanged || this.#size + bytes > this.#opts.maxBytes)) {
      await this.#rotate(today);
    }

    const stream = this.#stream;
    if (!stream) throw new Error("FileTransport stream unavailable");
    await new Promise<void>((resolve, reject) => {
      stream.write(payload, (error) => (error ? reject(error) : resolve()));
    });
    this.#size += bytes;
  }

  async #open(day: string): Promise<void> {
    await mkdir(dirname(this.#opts.path), { recursive: true });
    this.#size = await stat(this.#opts.path).then(
      (s) => s.size,
      () => 0,
    );
    this.#day = day;
    this.#stream = createWriteStream(this.#opts.path, { flags: "a" });
    // Surface stream errors on the next write instead of crashing the process.
    this.#stream.on("error", () => undefined);
  }

  async #closeStream(): Promise<void> {
    const stream = this.#stream;
    this.#stream = undefined;
    if (!stream) return;
    await new Promise<void>((resolve) => stream.end(resolve));
  }

  async #rotate(day: string): Promise<void> {
    await this.#closeStream();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(this.#opts.path, `${this.#opts.path}.${stamp}`);
    await this.#open(day);
    await this.#prune();
  }

  async #prune(): Promise<void> {
    const dir = dirname(this.#opts.path);
    const prefix = `${basename(this.#opts.path)}.`;
    const names = (await readdir(dir)).filter((n) => n.startsWith(prefix)).sort();
    const doomed = new Set(names.slice(0, Math.max(0, names.length - this.#opts.maxFiles)));

    if (this.#opts.maxAgeDays !== undefined) {
      const cutoff = Date.now() - this.#opts.maxAgeDays * 86_400_000;
      for (const name of names) {
        const info = await stat(join(dir, name)).catch(() => undefined);
        if (info && info.mtimeMs < cutoff) doomed.add(name);
      }
    }
    await Promise.all([...doomed].map((n) => unlink(join(dir, n)).catch(() => undefined)));
  }
}
