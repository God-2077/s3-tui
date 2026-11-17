import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
  type S3Client,
} from "@aws-sdk/client-s3";
import { CancelToken, CancelledError, isCancelled } from "../utils/cancel.js";
import { offsetsForParts, planParts } from "../utils/parts.js";
import { ProgressMeter, createCountingTransform } from "../utils/progress.js";
import type { ProgressSnapshot } from "../utils/progress.js";

export interface UploadOptions {
  client: S3Client;
  bucket: string;
  key: string;
  filePath: string;
  contentType: string;
  partSize: number;
  multipartThreshold: number;
  concurrency: number;
  token: CancelToken;
  onProgress: (snapshot: ProgressSnapshot) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 3;

export async function uploadFile(options: UploadOptions): Promise<number> {
  const { client, bucket, key, filePath, contentType, token } = options;
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`${filePath} 不是普通文件`);
  token.throwIfCancelled();

  if (info.size === 0) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.alloc(0),
        ContentLength: 0,
        ContentType: contentType,
      }),
      { abortSignal: token.signal },
    );
    options.onProgress({ loaded: 0, total: 0, percent: 100, speed: 0 });
    return 0;
  }

  if (info.size < options.multipartThreshold) {
    await putSingle(options, info.size);
    return info.size;
  }

  await multipartUpload(options, info.size);
  return info.size;
}

async function putSingle(options: UploadOptions, total: number): Promise<void> {
  const { client, bucket, key, filePath, contentType, token } = options;
  const meter = new ProgressMeter(total, options.onProgress);
  const body = createReadStream(filePath).pipe(
    createCountingTransform((bytes) => meter.add(bytes)),
  );
  const offCancel = token.onCancel(() => body.destroy(new CancelledError()));
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: total,
        ContentType: contentType,
      }),
      { abortSignal: token.signal },
    );
  } finally {
    offCancel();
  }
  meter.flush();
}

async function multipartUpload(options: UploadOptions, total: number): Promise<void> {
  const { client, bucket, key, filePath, contentType, token } = options;
  const partSizes = planParts(total, options.partSize);
  const ranges = offsetsForParts(partSizes);
  const meter = new ProgressMeter(total, options.onProgress);
  meter.setPart(0, partSizes.length);

  let uploadId: string | undefined;
  try {
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { abortSignal: token.signal },
    );
    uploadId = created.UploadId;
    if (!uploadId) throw new Error("CreateMultipartUpload 没有返回 UploadId");

    const completed = new Array<CompletedPart | undefined>(partSizes.length);
    let nextIndex = 0;
    let completedCount = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        token.throwIfCancelled();
        const index = nextIndex++;
        if (index >= partSizes.length) return;
        const partNumber = index + 1;
        const range = ranges[index]!;
        const partSize = partSizes[index]!;
        let attempt = 0;

        while (true) {
          token.throwIfCancelled();
          let counted = 0;
          const body = createReadStream(filePath, {
            start: range.start,
            end: range.end,
          }).pipe(
            createCountingTransform((bytes) => {
              counted += bytes;
              meter.add(bytes);
            }),
          );
          const offCancel = token.onCancel(() => body.destroy(new CancelledError()));
          try {
            const response = await client.send(
              new UploadPartCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                PartNumber: partNumber,
                Body: body,
                ContentLength: partSize,
              }),
              { abortSignal: token.signal },
            );
            if (!response.ETag) throw new Error(`分片 ${partNumber} 没有返回 ETag`);
            completed[index] = { ETag: response.ETag, PartNumber: partNumber };
            completedCount += 1;
            meter.setPart(completedCount, partSizes.length);
            break;
          } catch (error) {
            if (counted > 0) meter.add(-counted);
            if (isCancelled(error) || token.cancelled) throw new CancelledError();
            attempt += 1;
            if (attempt >= MAX_ATTEMPTS) throw error;
            await sleep(300 * attempt);
          } finally {
            offCancel();
          }
        }
      }
    };

    const workers = Math.max(1, Math.min(options.concurrency, partSizes.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    token.throwIfCancelled();

    const parts = completed.filter((part): part is CompletedPart => Boolean(part));
    if (parts.length !== partSizes.length) {
      throw new Error(`分片不完整：${parts.length}/${partSizes.length}`);
    }

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
      { abortSignal: token.signal },
    );
    meter.flush();
  } catch (error) {
    if (uploadId) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
      } catch {
        // 清理失败不覆盖原始错误
      }
    }
    if (isCancelled(error) || token.cancelled) throw new CancelledError();
    throw error;
  }
}