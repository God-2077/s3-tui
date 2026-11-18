import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadObject, reserveDestination } from "../src/s3/download.js";
import { CancelToken, isCancelled } from "../src/utils/cancel.js";
import type { ProgressSnapshot } from "../src/utils/progress.js";
import { BUCKET, MIB, clientFor, startMockS3 } from "./mockS3.js";

const SIZE = 3 * MIB + 123;

function makeData(size: number): Buffer {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) data[index] = (index * 31 + 7) % 251;
  return data;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function closeServer(server: import("node:http").Server): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

test("目标路径预留：连续预留同一路径不重复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-reserve-"));
  try {
    const reserved = new Set<string>();
    const target = join(directory, "photo.jpg");
    assert.equal(reserveDestination(target, reserved), target);
    assert.equal(reserveDestination(target, reserved), join(directory, "photo (1).jpg"));
    assert.equal(reserveDestination(target, reserved), join(directory, "photo (2).jpg"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("分段下载：S3 多线程 Range 与分段进度", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  const data = makeData(SIZE);
  objects.set("ranged.bin", data);
  const dest = join(directory, "ranged.bin");
  const progress: ProgressSnapshot[] = [];

  try {
    const loaded = await downloadObject({
      client,
      bucket: BUCKET,
      key: "ranged.bin",
      destPath: dest,
      token: new CancelToken(),
      onProgress: (snapshot) => progress.push(snapshot),
      totalSize: SIZE,
      threads: 4,
      chunkSize: MIB,
    });

    assert.equal(loaded, SIZE);
    assert.equal(await fileHash(dest), sha256(data));
    const last = progress.at(-1);
    assert.equal(last?.percent, 100);
    assert.equal(last?.part?.current, last?.part?.total);
    assert.ok((last?.part?.total ?? 0) > 1);
  } finally {
    client.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("分段下载：服务端不支持 Range 时回退单流", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3({ supportsRange: false });
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  const data = makeData(SIZE);
  objects.set("fallback.bin", data);
  const dest = join(directory, "fallback.bin");

  try {
    const loaded = await downloadObject({
      client,
      bucket: BUCKET,
      key: "fallback.bin",
      destPath: dest,
      token: new CancelToken(),
      onProgress: () => {},
      totalSize: SIZE,
      threads: 4,
      chunkSize: MIB,
    });

    assert.equal(loaded, SIZE);
    assert.equal(await fileHash(dest), sha256(data));
  } finally {
    client.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("分段下载：总大小不一致时回退单流", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  const data = makeData(SIZE);
  objects.set("mismatch.bin", data);
  const dest = join(directory, "mismatch.bin");

  try {
    const loaded = await downloadObject({
      client,
      bucket: BUCKET,
      key: "mismatch.bin",
      destPath: dest,
      token: new CancelToken(),
      onProgress: () => {},
      totalSize: SIZE + 1,
      threads: 4,
      chunkSize: MIB,
    });

    assert.equal(loaded, data.length);
    assert.equal(await fileHash(dest), sha256(data));
  } finally {
    client.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("下载：单线程不启用分段", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  const data = makeData(1024 * 1024 + 17);
  objects.set("single.bin", data);
  const dest = join(directory, "single.bin");
  const progress: ProgressSnapshot[] = [];

  try {
    const loaded = await downloadObject({
      client,
      bucket: BUCKET,
      key: "single.bin",
      destPath: dest,
      token: new CancelToken(),
      onProgress: (snapshot) => progress.push(snapshot),
      totalSize: data.length,
      threads: 1,
      chunkSize: MIB,
    });

    assert.equal(loaded, data.length);
    assert.equal(await fileHash(dest), sha256(data));
    assert.equal(progress.at(-1)?.part, undefined);
  } finally {
    client.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("分段下载：预签名 URL 支持 Range", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3();
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  const data = makeData(SIZE);
  objects.set("url.bin", data);
  const dest = join(directory, "url.bin");
  const progress: ProgressSnapshot[] = [];

  try {
    const loaded = await downloadObject({
      url: `${endpoint}/${BUCKET}/url.bin`,
      bucket: BUCKET,
      key: "url.bin",
      destPath: dest,
      token: new CancelToken(),
      onProgress: (snapshot) => progress.push(snapshot),
      totalSize: SIZE,
      threads: 4,
      chunkSize: MIB,
    });

    assert.equal(loaded, SIZE);
    assert.equal(await fileHash(dest), sha256(data));
    assert.ok((progress.at(-1)?.part?.total ?? 0) > 1);
  } finally {
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("下载：已取消的 token 不留下文件", { timeout: 60_000 }, async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-download-"));
  objects.set("cancelled.bin", makeData(SIZE));
  const dest = join(directory, "cancelled.bin");
  const token = new CancelToken();
  token.cancel();

  try {
    await assert.rejects(
      () =>
        downloadObject({
          client,
          bucket: BUCKET,
          key: "cancelled.bin",
          destPath: dest,
          token,
          onProgress: () => {},
          totalSize: SIZE,
          threads: 4,
          chunkSize: MIB,
        }),
      (error: unknown) => isCancelled(error),
    );
    assert.equal(await readFile(dest).then(() => true).catch(() => false), false);
  } finally {
    client.destroy();
    await closeServer(server);
    await rm(directory, { recursive: true, force: true });
  }
});
