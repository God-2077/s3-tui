import test from "node:test";
import assert from "node:assert/strict";
import {
  clampCursor,
  layoutInputLine,
  nextCursor,
  previousCursor,
} from "../src/utils/input.js";
import { displayWidth } from "../src/utils/format.js";

function caretColumns(view: ReturnType<typeof layoutInputLine>): number {
  return view.at ? displayWidth(view.at) : 1;
}

function assertConsistent(value: string, cursor: number, width: number): void {
  const view = layoutInputLine(value, cursor, width);
  const position = clampCursor(value, cursor);
  const atEnd = position >= value.length;

  assert.equal(
    view.at,
    atEnd ? "" : String.fromCodePoint(value.codePointAt(position) ?? 0),
    "光标字符应与光标位置一致",
  );
  assert.ok(
    displayWidth(view.before) + caretColumns(view) + displayWidth(view.after) <= width,
    "可见内容不能超过可用列宽: " + JSON.stringify({ value, cursor, width, view }),
  );

  if (!view.leftClipped && !view.rightClipped) {
    assert.equal(view.before + view.at + view.after, value);
    assert.equal(view.before, value.slice(0, position));
  }
  if (view.leftClipped) assert.ok(view.before.startsWith("…"));
  if (view.rightClipped && view.after) assert.ok(view.after.endsWith("…"));
}

test("空输入也会给光标留出一格", () => {
  assert.deepEqual(layoutInputLine("", 0, 10), {
    before: "",
    at: "",
    after: "",
    leftClipped: false,
    rightClipped: false,
  });
  assert.deepEqual(layoutInputLine("", 5, 10), layoutInputLine("", 0, 10));
});

test("短文本在末尾、中间、开头的可见片段", () => {
  assert.deepEqual(layoutInputLine("abc", 3, 10), {
    before: "abc",
    at: "",
    after: "",
    leftClipped: false,
    rightClipped: false,
  });
  assert.deepEqual(layoutInputLine("abc", 1, 10), {
    before: "a",
    at: "b",
    after: "c",
    leftClipped: false,
    rightClipped: false,
  });
  assert.deepEqual(layoutInputLine("abc", 0, 10), {
    before: "",
    at: "a",
    after: "bc",
    leftClipped: false,
    rightClipped: false,
  });
});

test("CJK 宽字符按显示列宽计算", () => {
  const view = layoutInputLine("中文abc", 2, 10);
  assert.equal(view.before, "中文");
  assert.equal(view.at, "a");
  assert.equal(view.after, "bc");
  assert.equal(displayWidth(view.before), 4);
});

test("超宽文本在末尾向左滚动并显示左省略号", () => {
  const value = "a".repeat(40);
  const view = layoutInputLine(value, 40, 34);
  assert.equal(view.at, "");
  assert.equal(view.after, "");
  assert.equal(view.rightClipped, false);
  assert.equal(view.leftClipped, true);
  assert.ok(view.before.startsWith("…"));
  assert.equal(displayWidth(view.before) + 1, 34);
});

test("超宽文本在开头向右裁剪并显示右省略号", () => {
  const value = "b".repeat(40);
  const view = layoutInputLine(value, 0, 34);
  assert.equal(view.before, "");
  assert.equal(view.leftClipped, false);
  assert.equal(view.at, "b");
  assert.equal(view.rightClipped, true);
  assert.ok(view.after.endsWith("…"));
  assert.equal(displayWidth(view.before) + 1 + displayWidth(view.after), 34);
});

test("超宽文本在中部时窗口跟随光标", () => {
  const value = "abcdefghij".repeat(4);
  const view = layoutInputLine(value, 20, 34);
  assert.equal(view.at, "a");
  assert.equal(view.before, value.slice(0, 20));
  assert.equal(view.leftClipped, false);
  assert.equal(view.rightClipped, true);
  assert.ok(view.after.endsWith("…"));
  assert.equal(displayWidth(view.before) + 1 + displayWidth(view.after), 34);
});

test("光标落在宽字符上时按 2 列计算", () => {
  const value = "中".repeat(30);
  const view = layoutInputLine(value, 10, 9);
  assert.equal(view.at, "中");
  assert.ok(view.leftClipped);
  assert.ok(view.before.startsWith("…"));
  assert.ok(displayWidth(view.before) + 2 + displayWidth(view.after) <= 9);
});

test("长文本窗口随光标滚动到两端", () => {
  const value = "0123456789".repeat(6);
  const start = layoutInputLine(value, 0, 20);
  const middle = layoutInputLine(value, 30, 20);
  const end = layoutInputLine(value, value.length, 20);

  assert.equal(start.before, "");
  assert.equal(start.at, "0");
  assert.equal(start.leftClipped, false);
  assert.equal(start.rightClipped, true);

  assert.equal(middle.at, "0");
  assert.equal(middle.leftClipped, true);
  assert.equal(middle.rightClipped, true);

  assert.equal(end.at, "");
  assert.equal(end.leftClipped, true);
  assert.equal(end.before.startsWith("…"), true);
  assert.equal(end.rightClipped, false);
});

test("代理对：光标吸附与左右移动按 code point", () => {
  const value = "a🎉b";
  assert.equal(value.length, 4);

  assert.equal(clampCursor(value, 2), 1);
  assert.equal(clampCursor(value, 1), 1);
  assert.equal(clampCursor(value, 3), 3);
  assert.equal(previousCursor(value, 3), 1);
  assert.equal(nextCursor(value, 1), 3);
  assert.equal(previousCursor(value, 0), 0);
  assert.equal(nextCursor(value, 4), 4);
  assert.equal(nextCursor(value, 2), 3);

  const view = layoutInputLine(value, 2, 10);
  assert.equal(view.before, "a");
  assert.equal(view.at, "🎉");
  assert.equal(view.after, "b");
});

test("任意光标位置都不撑破宽度且光标字符正确", () => {
  const values = [
    "",
    "hello",
    "中文测试",
    "e\u0301",
    "a🎉b",
    "🎉".repeat(10),
    "a".repeat(100),
    "混合 abc 中文 🎉".repeat(3),
  ];
  for (const value of values) {
    for (const width of [5, 8, 16, 34, 40]) {
      for (let cursor = 0; cursor <= value.length; cursor += 1) {
        assertConsistent(value, cursor, width);
      }
    }
  }
});

test("极窄宽度也不抛错且不撑破", () => {
  const view = layoutInputLine("中文", 1, 2);
  assert.ok(displayWidth(view.before) + caretColumns(view) + displayWidth(view.after) <= 2);
});
