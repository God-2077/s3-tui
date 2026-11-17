import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../src/config.js";
import { createS3, closeS3 } from "../src/s3/client.js";
import { presignGet } from "../src/s3/presign.js";
import { uploadFile } from "../src/s3/upload.js";
import { downloadObject } from "../src/s3/download.js";
import { CancelToken } from "../src/utils/cancel.js";
import { BUCKET, MIB, startMockS3 } from "./mockS3.js";

function configFor(endpoint: string, extra: Record<string, string> = {}) {
  return parseConfig({
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test",
    S3_REGION: "us-east-1",
    S3_ENDPOINT: endpoint,
    S3_FORCE_PATH_STYLE: "true",
    ...extra,
  });
}

test("加速主机 endpoint 模式：自定义域签名保持精确 host", async () => {
  const { server, endpoint } = await startMockS3();
  const config = configFor(endpoint, {
    S3_ACCELERATE_HOST: "https://cdn.example.com",
    S3_ACCELERATE_MODE: "endpoint",
  });
  const s3 = createS3(config);
  try {
    const url = await presignGet(s3.transfer, BUCKET, "photos/a b.jpg", 900);
    const parsed = new URL(url);
    assert.equal(parsed.host, "cdn.example.com");
    assert.equal(parsed.pathname, "/photos/a%20b.jpg");
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), "900");
    assert.ok(parsed.searchParams.get("X-Amz-Signature"));
  } finally {
    closeS3(s3);
    server.close();
  }
});

test("加速主机 path style 模式：路径包含桶名", async () => {
  const { server, endpoint } = await startMockS3();
  const config = configFor(endpoint, {
    S3_ACCELERATE_HOST: "https://gateway.example.com",
    S3_ACCELERATE_MODE: "endpoint",
    S3_ACCELERATE_PATH_STYLE: "true",
  });
  const s3 = createS3(config);
  try {
    const url = await presignGet(s3.transfer, BUCKET, "a.txt", 900);
    assert.equal(new URL(url).host, "gateway.example.com");
    assert.equal(new URL(url).pathname, `/${BUCKET}/a.txt`);
  } finally {
    closeS3(s3);
    server.close();
  }
});

test("加速主机 endpoint 模式：上传/分片/下载实际走加速 host", { timeout: 30_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3({ bucketless: true });
  const config = configFor(endpoint, {
    S3_ACCELERATE_HOST: endpoint,
    S3_ACCELERATE_MODE: "endpoint",
  });
  const s3 = createS3(config);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-accel-"));
  const token = new CancelToken();

  try {
    const smallPath = join(directory, "notes.txt");
    await writeFile(smallPath, "accelerated\n", "utf8");
    await uploadFile({
      client: s3.transfer,
      bucket: BUCKET,
      key: "notes.txt",
      filePath: smallPath,
      contentType: "text/plain",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: () => {},
    });
    assert.equal(objects.get("notes.txt")?.toString(), "accelerated\n");

    const largePath = join(directory, "large.bin");
    const largeBody = Buffer.alloc(6 * MIB, 9);
    await writeFile(largePath, largeBody);
    await uploadFile({
      client: s3.transfer,
      bucket: BUCKET,
      key: "large.bin",
      filePath: largePath,
      contentType: "application/octet-stream",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: () => {},
    });
    assert.equal(objects.get("large.bin")?.length, 6 * MIB);

    const downloadPath = join(directory, "large-downloaded.bin");
    await downloadObject({
      client: s3.transfer,
      bucket: BUCKET,
      key: "large.bin",
      destPath: downloadPath,
      token,
      onProgress: () => {},
    });
    const downloaded = await readFile(downloadPath);
    assert.equal(downloaded.length, 6 * MIB);
    assert.ok(downloaded.every((byte) => byte === 9));
  } finally {
    closeS3(s3);
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});