import test from "node:test";
import assert from "node:assert/strict";
import {
  basename,
  expandHome,
  folderKey,
  joinKey,
  keyToRelativePath,
  moveTargetKey,
  normalizeObjectKey,
  normalizePrefix,
  parentPrefix,
  prefixRelativePath,
  resolveMoveTarget,
} from "../src/utils/key.js";

test("normalizePrefix", () => {
  assert.equal(normalizePrefix(""), "");
  assert.equal(normalizePrefix("/"), "");
  assert.equal(normalizePrefix("photos"), "photos/");
  assert.equal(normalizePrefix("/photos/2024/"), "photos/2024/");
});

test("joinKey 处理前缀边界", () => {
  assert.equal(joinKey("", "a.txt"), "a.txt");
  assert.equal(joinKey("photos/", "a.jpg"), "photos/a.jpg");
  assert.equal(joinKey("photos", "a.jpg"), "photos/a.jpg");
});

test("parentPrefix", () => {
  assert.equal(parentPrefix(""), "");
  assert.equal(parentPrefix("photos/"), "");
  assert.equal(parentPrefix("photos/2024/"), "photos/");
  assert.equal(parentPrefix("a/b/c/"), "a/b/");
});

test("basename", () => {
  assert.equal(basename("a/b/c.txt"), "c.txt");
  assert.equal(basename("photos/2024/"), "2024");
  assert.equal(basename("top.txt"), "top.txt");
});

test("keyToRelativePath 去掉空段与 .. 段", () => {
  assert.equal(keyToRelativePath("/a//b/../c.txt"), "a/c.txt");
  assert.equal(keyToRelativePath("photos/2024/a.jpg"), "photos/2024/a.jpg");
});

test("normalizeObjectKey 只去掉前导 /", () => {
  assert.equal(normalizeObjectKey("/photos/a.jpg"), "photos/a.jpg");
  assert.equal(normalizeObjectKey("  //photos/2024/  "), "photos/2024/");
  assert.equal(normalizeObjectKey("a/b/"), "a/b/");
});

test("folderKey 拼接当前目录并补结尾 /", () => {
  assert.equal(folderKey("photos/", "2024/相册"), "photos/2024/相册/");
  assert.equal(folderKey("", "notes"), "notes/");
  assert.equal(folderKey("photos/", "/archive/"), "photos/archive/");
  assert.equal(folderKey("photos/", " / "), "");
});

test("prefixRelativePath 去掉目录前缀并过滤 ..", () => {
  assert.equal(prefixRelativePath("photos/", "photos/2024/a.jpg"), "2024/a.jpg");
  assert.equal(prefixRelativePath("photos/", "photos/"), "");
  assert.equal(prefixRelativePath("photos/", "photos/../secret.txt"), "secret.txt");
  assert.equal(prefixRelativePath("", "photos/a.jpg"), "photos/a.jpg");
});

test("moveTargetKey 保留相对路径与占位对象结尾 /", () => {
  assert.equal(moveTargetKey("photos/", "archive/", "photos/2024/a.jpg"), "archive/2024/a.jpg");
  assert.equal(moveTargetKey("photos/", "archive/", "photos/2024/"), "archive/2024/");
  assert.equal(moveTargetKey("photos/", "archive/", "photos/"), "archive/");
});

test("resolveMoveTarget 校验文件目标", () => {
  const file = { kind: "file" as const, key: "photos/a.jpg" };
  assert.deepEqual(resolveMoveTarget(file, "/archive/b.jpg"), { target: "archive/b.jpg" });
  assert.deepEqual(resolveMoveTarget(file, "photos/a.jpg"), { error: "新 key 与当前 key 相同" });
  assert.deepEqual(resolveMoveTarget(file, "archive/"), { error: "文件的新 key 不能以 / 结尾" });
  assert.deepEqual(resolveMoveTarget(file, " / "), { error: "新 key 不能为空" });
});

test("resolveMoveTarget 校验目录目标且禁止移入自身", () => {
  const dir = { kind: "dir" as const, key: "photos/" };
  assert.deepEqual(resolveMoveTarget(dir, "archive/2024"), { target: "archive/2024/" });
  assert.deepEqual(resolveMoveTarget(dir, "photos"), { error: "新目录与当前目录相同" });
  assert.deepEqual(resolveMoveTarget(dir, "photos/2024"), { error: "不能移动到自身或子目录" });
  assert.deepEqual(resolveMoveTarget(dir, "/"), { error: "新目录不能为空" });
});

test("expandHome", () => {
  assert.equal(expandHome("~/x", "/home/u"), "/home/u/x");
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("/tmp/x", "/home/u"), "/tmp/x");
});