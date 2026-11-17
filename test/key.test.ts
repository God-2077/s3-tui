import test from "node:test";
import assert from "node:assert/strict";
import {
  basename,
  expandHome,
  joinKey,
  keyToRelativePath,
  normalizePrefix,
  parentPrefix,
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

test("expandHome", () => {
  assert.equal(expandHome("~/x", "/home/u"), "/home/u/x");
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("/tmp/x", "/home/u"), "/tmp/x");
});