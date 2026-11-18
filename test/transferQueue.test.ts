import test from "node:test";
import assert from "node:assert/strict";
import { takeStartableJobs } from "../src/hooks/transferQueue.js";

test("队列调度：上传和下载各自遵守并发上限", () => {
  const queues = {
    upload: ["u1", "u2", "u3"],
    download: ["d1", "d2", "d3"],
  };
  const counts = { upload: 0, download: 0 };
  const limits = { upload: 2, download: 1 };

  const started = takeStartableJobs(queues, counts, limits);
  assert.deepEqual(started, [
    { kind: "upload", job: "u1" },
    { kind: "upload", job: "u2" },
    { kind: "download", job: "d1" },
  ]);
  assert.deepEqual(queues.upload, ["u3"]);
  assert.deepEqual(queues.download, ["d2", "d3"]);
  assert.deepEqual(counts, { upload: 2, download: 1 });

  assert.deepEqual(takeStartableJobs(queues, counts, limits), []);
});

test("队列调度：按 FIFO 取任务，计数达到上限后不取", () => {
  const queues = { upload: ["a", "b"], download: [] };
  const counts = { upload: 1, download: 0 };

  const started = takeStartableJobs(queues, counts, { upload: 1, download: 2 });
  assert.deepEqual(started, []);
  assert.deepEqual(queues.upload, ["a", "b"]);
  assert.deepEqual(counts, { upload: 1, download: 0 });
});

test("队列调度：空队列返回空数组", () => {
  const queues = { upload: [], download: [] };
  const counts = { upload: 0, download: 0 };
  assert.deepEqual(takeStartableJobs(queues, counts, { upload: 3, download: 3 }), []);
});

test("队列调度：非法上限按 1 处理", () => {
  const queues = { upload: ["u1", "u2"], download: ["d1", "d2"] };
  const counts = { upload: 0, download: 0 };

  const started = takeStartableJobs(queues, counts, {
    upload: 0,
    download: Number.NaN,
  });
  assert.deepEqual(started, [
    { kind: "upload", job: "u1" },
    { kind: "download", job: "d1" },
  ]);
  assert.deepEqual(counts, { upload: 1, download: 1 });
});

test("队列调度：Infinity 也按 1 处理", () => {
  const queues = { upload: ["u1", "u2"], download: [] };
  const counts = { upload: 0, download: 0 };
  const started = takeStartableJobs(queues, counts, {
    upload: Number.POSITIVE_INFINITY,
    download: 1,
  });
  assert.deepEqual(started, [{ kind: "upload", job: "u1" }]);
  assert.deepEqual(counts, { upload: 1, download: 0 });
});
