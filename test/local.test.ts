import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_UPLOAD_FILES,
  collectFiles,
  listLocalDirectory,
  planPickerUploads,
} from "../src/utils/local.js";

test("本地目录：目录优先、隐藏点文件、文件大小", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "s3-tui-local-"));
  try {
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, "empty"));
    await mkdir(join(root, "zeta"));
    await writeFile(join(root, "b.txt"), "bb");
    await writeFile(join(root, "c.txt"), "ccc");
    await writeFile(join(root, ".hidden"), "hidden");

    const entries = await listLocalDirectory(root);
    assert.deepEqual(
      entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["dir:alpha", "dir:empty", "dir:zeta", "file:b.txt", "file:c.txt"],
    );
    assert.equal(entries[3]?.size, 2);
    assert.equal(entries[4]?.size, 3);
    assert.equal(entries[0]?.path, join(root, "alpha"));

    const withHidden = await listLocalDirectory(root, { showHidden: true });
    assert.ok(withHidden.some((entry) => entry.name === ".hidden"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("本地目录：递归收集文件并使用 / 分隔", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "s3-tui-local-"));
  try {
    await mkdir(join(root, "alpha", "nested"), { recursive: true });
    await writeFile(join(root, "alpha", "a.txt"), "a");
    await writeFile(join(root, "alpha", "nested", "b.bin"), "bb");
    await writeFile(join(root, "root.txt"), "root");

    const files = await collectFiles(root);
    assert.deepEqual(
      files.map((file) => file.relative),
      ["alpha/a.txt", "alpha/nested/b.bin", "root.txt"],
    );
    assert.deepEqual(
      files.map((file) => file.size),
      [1, 2, 4],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("上传规划：文件与目录映射到 S3 key", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "s3-tui-local-"));
  try {
    await mkdir(join(root, "alpha", "nested"), { recursive: true });
    await mkdir(join(root, "empty"));
    await writeFile(join(root, "root.txt"), "root");
    await writeFile(join(root, "alpha", "a.txt"), "a");
    await writeFile(join(root, "alpha", "nested", "b.bin"), "bb");

    const plan = await planPickerUploads(
      [join(root, "root.txt"), join(root, "alpha"), join(root, "empty")],
      "base/prefix",
    );
    assert.deepEqual(
      plan.files.map((file) => file.key),
      [
        "base/prefix/root.txt",
        "base/prefix/alpha/a.txt",
        "base/prefix/alpha/nested/b.bin",
      ],
    );
    assert.equal(plan.emptyDirs, 1);
    assert.equal(plan.truncated, false);
    assert.deepEqual(
      plan.files.map((file) => file.size),
      [4, 1, 2],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("上传规划：空前缀、空目录和数量截断", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "s3-tui-local-"));
  try {
    await mkdir(join(root, "alpha"));
    await writeFile(join(root, "one.txt"), "1");
    await writeFile(join(root, "alpha", "two.txt"), "22");

    const plan = await planPickerUploads([join(root, "one.txt"), join(root, "alpha")], "", {
      maxFiles: 1,
    });
    assert.deepEqual(plan.files.map((file) => file.key), ["one.txt"]);
    assert.equal(plan.truncated, true);
    assert.equal(MAX_UPLOAD_FILES, 2000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
