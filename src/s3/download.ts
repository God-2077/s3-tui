import { createWriteStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { CancelToken, CancelledError, isCancelled } from "../utils/cancel.js";
import { keyToRelativePath } from "../utils/key.js";
import { ProgressMeter, createCountingTransform } from "../utils/progress.js";
import type { ProgressSnapshot } from "../utils/progress.js";

export interface DownloadOptions {
  /** 直接用 fetch 下载预签名 URL（rewrite 加速模式）。 */
  url?: string;
  client?: S3Client;
  bucket: string;
  key: string;
  destPath: string;
  token: CancelToken;
  onProgress: (snapshot: ProgressSnapshot) => void;
}

export function defaultDestination(downloadDir: string, key: string): string {
  const relative = keyToRelativePath(key) || basename(key) || "download";
  return join(downloadDir, relative);
}

/** 目标已存在时追加 " (1)"，避免静默覆盖。 */
export function uniqueDestination(target: string, reserved?: Set<string>): string {
  const exists = (candidate: string) => existsSync(candidate) || Boolean(reserved?.has(candidate));
  if (!exists(target)) return target;
  const extension = extname(target);
  const stem = target.slice(0, target.length - extension.length);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${extension}`;
}

export async function downloadObject(options: DownloadOptions): Promise<number> {
  const { token, destPath } = options;
  await mkdir(dirname(destPath), { recursive: true });

  let readable: Readable;
  let total = 0;

  if (options.url) {
    const response = await fetch(options.url, { signal: token.signal });
    if (!response.ok) {
      throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
    }
    const length = Number(response.headers.get("content-length"));
    total = Number.isFinite(length) && length > 0 ? length : 0;
    if (!response.body) throw new Error("下载失败：响应没有 body");
    readable = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  } else {
    if (!options.client) throw new Error("下载失败：缺少 S3 client");
    const response = await options.client.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: options.key }),
      { abortSignal: token.signal },
    );
    total = response.ContentLength ?? 0;
    if (!response.Body) throw new Error("下载失败：响应没有 body");
    readable = response.Body as unknown as Readable;
  }

  const meter = new ProgressMeter(total, options.onProgress);
  const file = createWriteStream(destPath);
  const offCancel = token.onCancel(() => {
    readable.destroy(new CancelledError());
    file.destroy(new CancelledError());
  });

  try {
    await pipeline(readable, createCountingTransform((bytes) => meter.add(bytes)), file);
  } catch (error) {
    offCancel();
    await unlink(destPath).catch(() => {});
    if (isCancelled(error) || token.cancelled) throw new CancelledError();
    throw error;
  }
  offCancel();
  meter.flush();
  return meter.loaded;
}