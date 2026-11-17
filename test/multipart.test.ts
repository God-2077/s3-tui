import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PARTS, MIN_PART_SIZE, offsetsForParts, planParts } from "../src/utils/parts.js";

const MIB = 1024 * 1024;

test("小于一片的文件只有一片", () => {
  assert.deepEqual(planParts(100, 8 * MIB), [100]);
  assert.deepEqual(planParts(0, 8 * MIB), []);
});

test("分片大小不低于 5 MiB", () => {
  const size = 12 * MIB;
  const parts = planParts(size, 1 * MIB);
  assert.deepEqual(parts, [MIN_PART_SIZE, MIN_PART_SIZE, size - 2 * MIN_PART_SIZE]);
});

test("整数倍与最后一片", () => {
  assert.deepEqual(planParts(16 * MIB, 8 * MIB), [8 * MIB, 8 * MIB]);
  assert.deepEqual(planParts(20 * MIB, 8 * MIB), [8 * MIB, 8 * MIB, 4 * MIB]);
});

test("超过 10000 片时自动放大分片", () => {
  const size = 60 * 1024 * MIB; // 60 GiB
  const parts = planParts(size, 8 * MIB);
  assert.ok(parts.length <= MAX_PARTS);
  assert.equal(
    parts.reduce((total, part) => total + part, 0),
    size,
  );
});

test("offsetsForParts 生成闭区间且连续", () => {
  const parts = [5, 3, 1];
  assert.deepEqual(offsetsForParts(parts), [
    { start: 0, end: 4 },
    { start: 5, end: 7 },
    { start: 8, end: 8 },
  ]);
});

test("part size 非法时回落到 5 MiB", () => {
  assert.deepEqual(planParts(6 * MIB, 0), [MIN_PART_SIZE, 1 * MIB]);
  assert.deepEqual(planParts(6 * MIB, Number.NaN), [MIN_PART_SIZE, 1 * MIB]);
});