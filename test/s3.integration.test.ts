import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPage, sumPrefixSize } from "../src/s3/list.js";
import { uploadFile } from "../src/s3/upload.js";
import { downloadObject } from "../src/s3/download.js";
import { deleteKeys } from "../src/s3/delete.js";
import { presignGet } from "../src/s3/presign.js";
import { CancelToken } from "../src/utils/cancel.js";
import type { ProgressSnapshot } from "../src/utils/progress.js";
import { BUCKET, MIB, clientFor, startMockS3 } from "./mockS3.js";

test("S3 客户端端到端：列表、上传、分片、下载、删除、预签名", { timeout: 60_000 }, async () => {
  const { server, endpoint } = await startMockS3();
  const client = clientFor(endpoint);
  const directory = await mkdtemp(join(tmpdir(), "s3-tui-test-"));
  const token = new CancelToken();

  try {
    const empty = await listPage(client, BUCKET, "");
    assert.deepEqual(empty.entries, []);

    // 小文件：单次 PUT
    const smallPath = join(directory, "notes.txt");
    await writeFile(smallPath, "hello s3-tui\n", "utf8");
    const smallProgress: ProgressSnapshot[] = [];
    await uploadFile({
      client,
      bucket: BUCKET,
      key: "notes.txt",
      filePath: smallPath,
      contentType: "text/plain; charset=utf-8",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: (snapshot) => smallProgress.push(snapshot),
    });
    assert.equal(smallProgress.at(-1)?.percent, 100);

    // 目录列表 + 前缀列表
    const root = await listPage(client, BUCKET, "");
    assert.deepEqual(
      root.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["file:notes.txt"],
    );

    const photoPath = join(directory, "photo.bin");
    await writeFile(photoPath, Buffer.alloc(3 * MIB, 7));
    await uploadFile({
      client,
      bucket: BUCKET,
      key: "photos/photo.bin",
      filePath: photoPath,
      contentType: "application/octet-stream",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: () => {},
    });

    const rootWithFolder = await listPage(client, BUCKET, "");
    assert.deepEqual(
      rootWithFolder.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["dir:photos", "file:notes.txt"],
    );
    const photos = await listPage(client, BUCKET, "photos/");
    assert.equal(photos.entries.length, 1);
    assert.equal(photos.entries[0]?.name, "photo.bin");
    assert.equal(photos.entries[0]?.size, 3 * MIB);

    // 递归大小统计：包含子目录里的文件
    const nestedContent = "nested file\n";
    const nestedPath = join(directory, "nested.txt");
    await writeFile(nestedPath, nestedContent, "utf8");
    await uploadFile({
      client,
      bucket: BUCKET,
      key: "photos/2026/nested.txt",
      filePath: nestedPath,
      contentType: "text/plain; charset=utf-8",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: () => {},
    });
    assert.equal(await sumPrefixSize(client, BUCKET, "photos/"), 3 * MIB + Buffer.byteLength(nestedContent));
    assert.equal(
      await sumPrefixSize(client, BUCKET, ""),
      3 * MIB + Buffer.byteLength(nestedContent) + Buffer.byteLength("hello s3-tui\n"),
    );

    // 大文件：3 个分片（5 + 5 + 2 MiB）
    const largeBuffer = Buffer.alloc(12 * MIB);
    for (let index = 0; index < largeBuffer.length; index += 1) {
      largeBuffer[index] = index % 251;
    }
    const largePath = join(directory, "large.bin");
    await writeFile(largePath, largeBuffer);
    const largeProgress: ProgressSnapshot[] = [];
    await uploadFile({
      client,
      bucket: BUCKET,
      key: "photos/large.bin",
      filePath: largePath,
      contentType: "application/octet-stream",
      partSize: 5 * MIB,
      multipartThreshold: 5 * MIB,
      concurrency: 2,
      token,
      onProgress: (snapshot) => largeProgress.push(snapshot),
    });
    assert.equal(largeProgress.at(-1)?.percent, 100);
    assert.ok(largeProgress.some((snapshot) => snapshot.part?.total === 3));

    // 下载并比对内容
    const downloadPath = join(directory, "downloaded.bin");
    const downloadProgress: ProgressSnapshot[] = [];
    await downloadObject({
      client,
      bucket: BUCKET,
      key: "photos/large.bin",
      destPath: downloadPath,
      token,
      onProgress: (snapshot) => downloadProgress.push(snapshot),
    });
    const downloaded = await readFile(downloadPath);
    assert.equal(createHash("sha256").update(downloaded).digest("hex"), createHash("sha256").update(largeBuffer).digest("hex"));
    assert.equal(downloadProgress.at(-1)?.percent, 100);

    // 预签名（不请求服务端，只验证 URL 形状）
    const signed = await presignGet(client, BUCKET, "photos/large.bin", 900);
    assert.ok(signed.startsWith(endpoint));
    assert.match(signed, /X-Amz-Signature=/);
    assert.match(signed, /X-Amz-Expires=900/);

    // 批量删除
    const deleted = await deleteKeys(client, BUCKET, [
      "notes.txt",
      "photos/photo.bin",
      "photos/large.bin",
      "photos/2026/nested.txt",
    ]);
    assert.equal(deleted.deleted, 4);
    assert.equal(deleted.failures.length, 0);
    assert.deepEqual((await listPage(client, BUCKET, "")).entries, []);
  } finally {
    client.destroy();
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
