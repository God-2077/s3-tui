import test from "node:test";
import assert from "node:assert/strict";
import { listAllKeys, listAllObjects, listPage } from "../src/s3/list.js";
import {
  buildCopySource,
  createFolder,
  moveObjects,
  objectExists,
} from "../src/s3/manage.js";
import { moveTargetKey } from "../src/utils/key.js";
import { BUCKET, clientFor, startMockS3 } from "./mockS3.js";

test("buildCopySource 逐段编码对象 key", () => {
  assert.equal(buildCopySource("test-bucket", "photos/a b.jpg"), "/test-bucket/photos/a%20b.jpg");
  assert.equal(buildCopySource("test-bucket", "a/b#c?d"), "/test-bucket/a/b%23c%3Fd");
  assert.equal(buildCopySource("test-bucket", "photos/2024/"), "/test-bucket/photos/2024/");
});

test("createFolder 创建占位对象并可被列出", async () => {
  const { server, endpoint } = await startMockS3();
  const client = clientFor(endpoint);
  try {
    await createFolder(client, BUCKET, "photos/2024/");
    assert.equal(await objectExists(client, BUCKET, "photos/2024/"), true);
    assert.equal(await objectExists(client, BUCKET, "photos/missing/"), false);

    const root = await listPage(client, BUCKET, "");
    assert.deepEqual(
      root.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["dir:photos"],
    );
    const photos = await listPage(client, BUCKET, "photos/");
    assert.deepEqual(
      photos.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["dir:2024"],
    );

    await assert.rejects(createFolder(client, BUCKET, "bad"), /必须以 \/ 结尾/);
  } finally {
    client.destroy();
    server.close();
  }
});

test("listAllObjects 返回全部对象及大小", async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  try {
    objects.set("photos/2024/", Buffer.alloc(0));
    objects.set("photos/2024/a.jpg", Buffer.from("aaa"));
    objects.set("photos/2024/b.jpg", Buffer.from("bb"));
    const entries = await listAllObjects(client, BUCKET, "photos/");
    assert.deepEqual(
      entries.map((entry) => `${entry.key}:${entry.size}`),
      ["photos/2024/:0", "photos/2024/a.jpg:3", "photos/2024/b.jpg:2"],
    );
    assert.deepEqual(await listAllKeys(client, BUCKET, "photos/"), [
      "photos/2024/",
      "photos/2024/a.jpg",
      "photos/2024/b.jpg",
    ]);
  } finally {
    client.destroy();
    server.close();
  }
});

test("moveObjects 复制单个对象后删除源", async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  try {
    objects.set("photos/a.txt", Buffer.from("hello"));
    const result = await moveObjects(client, BUCKET, [
      { source: "photos/a.txt", target: "archive/2024/a.txt" },
    ]);
    assert.deepEqual(result, { moved: 1, failures: [] });
    assert.equal(objects.has("photos/a.txt"), false);
    assert.equal(objects.get("archive/2024/a.txt")?.toString(), "hello");
  } finally {
    client.destroy();
    server.close();
  }
});

test("moveObjects 移动目录并保留占位对象", async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  try {
    objects.set("photos/2024/", Buffer.alloc(0));
    objects.set("photos/2024/a.jpg", Buffer.from("aaa"));
    objects.set("photos/2024/b.jpg", Buffer.from("bbb"));
    const keys = await listAllKeys(client, BUCKET, "photos/");
    const pairs = keys.map((source) => ({
      source,
      target: moveTargetKey("photos/", "archive/", source),
    }));
    const result = await moveObjects(client, BUCKET, pairs, { concurrency: 2 });
    assert.equal(result.moved, 3);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(await listAllKeys(client, BUCKET, "photos/"), []);
    assert.equal(objects.get("archive/2024/")?.length, 0);
    assert.equal(objects.get("archive/2024/a.jpg")?.toString(), "aaa");
    assert.equal(objects.get("archive/2024/b.jpg")?.toString(), "bbb");
  } finally {
    client.destroy();
    server.close();
  }
});

test("moveObjects 复制失败时保留源对象", async () => {
  const { server, endpoint, objects } = await startMockS3();
  const client = clientFor(endpoint);
  try {
    objects.set("photos/keep.txt", Buffer.from("keep"));
    const result = await moveObjects(client, BUCKET, [
      { source: "photos/missing.txt", target: "archive/missing.txt" },
    ]);
    assert.equal(result.moved, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.key, "photos/missing.txt");
    assert.match(result.failures[0]?.message ?? "", /复制失败/);
    assert.equal(objects.get("photos/keep.txt")?.toString(), "keep");
    assert.equal(objects.has("archive/missing.txt"), false);
  } finally {
    client.destroy();
    server.close();
  }
});
