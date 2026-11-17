import test from "node:test";
import assert from "node:assert/strict";
import {
  displayWidth,
  fitText,
  formatBytes,
  formatDateShort,
  formatDateTime,
  formatEta,
  formatSpeed,
  padEndDisplay,
  padStartDisplay,
} from "../src/utils/format.js";

test("formatBytes 使用 1024 进制并保留合理精度", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
  assert.equal(formatBytes(1024 ** 3 * 100), "100 GB");
  assert.equal(formatBytes(-1), "0 B");
});

test("formatSpeed / formatEta", () => {
  assert.equal(formatSpeed(0), "—");
  assert.equal(formatSpeed(1024 * 1024), "1.0 MB/s");
  assert.equal(formatEta(undefined), "—");
  assert.equal(formatEta(300), "<1s");
  assert.equal(formatEta(25_000), "25s");
  assert.equal(formatEta(65_000), "1m05s");
  assert.equal(formatEta(3_700_000), "1h01m");
});

test("日期格式化", () => {
  const date = new Date(2026, 10, 17, 9, 5);
  assert.equal(formatDateShort(date), "11-17 09:05");
  assert.equal(formatDateTime(date), "2026-11-17 09:05");
  assert.equal(formatDateShort(undefined), "—");
});

test("终端宽度：CJK/emoji 占两列", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("a中b"), 4);
  assert.equal(displayWidth("🎉"), 2);
});

test("fitText 按宽度截断并补 …", () => {
  assert.equal(fitText("hello", 10), "hello");
  assert.equal(fitText("hello", 3), "he…");
  assert.equal(fitText("中文字符", 5), "中文…");
  assert.equal(fitText("abc", 0), "");
});

test("padEndDisplay / padStartDisplay 对齐", () => {
  assert.equal(padEndDisplay("中文", 6), "中文  ");
  assert.equal(padStartDisplay("1.5 MB", 8), "  1.5 MB");
  assert.equal(padEndDisplay("verylongname", 4), "ver…");
});