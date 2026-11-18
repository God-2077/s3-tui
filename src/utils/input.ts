/** 文本输入框的可见窗口与光标位置：按终端显示列宽计算，兼容 CJK 与代理对。 */

import { charWidth, displayWidth } from "./format.js";

/** 输入行按可用列宽裁剪后的可见片段。 */
export interface InputLine {
  /** 光标前可见内容；左侧被裁剪时以 "…" 开头。 */
  before: string;
  /** 光标下的字符；光标在末尾时为空串。 */
  at: string;
  /** 光标后可见内容；右侧被裁剪时以 "…" 结尾。 */
  after: string;
  /** 左侧是否还有被裁剪掉的内容。 */
  leftClipped: boolean;
  /** 右侧是否还有被裁剪掉的内容。 */
  rightClipped: boolean;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 把光标位置限制在 [0, value.length]，并吸附到 code point 边界。 */
export function clampCursor(value: string, cursor: number): number {
  const clamped = Math.max(
    0,
    Math.min(value.length, Number.isFinite(cursor) ? Math.trunc(cursor) : 0),
  );
  if (clamped <= 0 || clamped >= value.length) return clamped;
  return isHighSurrogate(value.charCodeAt(clamped - 1)) && isLowSurrogate(value.charCodeAt(clamped))
    ? clamped - 1
    : clamped;
}

/** 左侧相邻的 code point 边界。 */
export function previousCursor(value: string, cursor: number): number {
  const position = clampCursor(value, cursor);
  if (position <= 0) return 0;
  const index = position - 1;
  return index > 0 &&
    isHighSurrogate(value.charCodeAt(index - 1)) &&
    isLowSurrogate(value.charCodeAt(index))
    ? index - 1
    : index;
}

/** 右侧相邻的 code point 边界。 */
export function nextCursor(value: string, cursor: number): number {
  const position = clampCursor(value, cursor);
  if (position >= value.length) return value.length;
  const index = position + 1;
  return index < value.length &&
    isHighSurrogate(value.charCodeAt(position)) &&
    isLowSurrogate(value.charCodeAt(index))
    ? index + 1
    : index;
}

/**
 * 计算输入行的可见窗口：光标所在字符（末尾为光标格）保证可见，
 * 放不下时随光标横向滚动，两侧以 "…" 标记被裁剪的内容。
 *
 * @param width 输入值 + 光标格可用的显示列数。
 */
export function layoutInputLine(value: string, cursor: number, width: number): InputLine {
  const position = clampCursor(value, cursor);
  const available = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const atEnd = position >= value.length;
  const at = atEnd ? "" : String.fromCodePoint(value.codePointAt(position) ?? 0);
  const caretWidth = at ? Math.max(1, charWidth(at)) : 1;
  const beforeText = value.slice(0, position);
  const afterText = atEnd ? "" : value.slice(position + at.length);

  if (displayWidth(value) + (atEnd ? 1 : 0) <= available) {
    return { before: beforeText, at, after: afterText, leftClipped: false, rightClipped: false };
  }

  // 右侧至少保留 1 格上下文，避免长文本时只剩左侧内容。
  const afterFirst = afterText
    ? String.fromCodePoint(value.codePointAt(position + at.length) ?? 0)
    : "";
  const rightReserve = afterFirst
    ? Math.min(Math.max(1, charWidth(afterFirst)), Math.max(0, available - caretWidth))
    : 0;
  const leftBudget = Math.max(0, available - caretWidth - rightReserve);

  // 左侧从光标往回按显示宽度回填；被裁剪时预留 1 列放 "…"。
  const beforeChars = Array.from(beforeText);
  const leftLimit = leftBudget >= 1 ? leftBudget - 1 : 0;
  let keptLeft = 0;
  let keptLeftWidth = 0;
  for (let index = beforeChars.length - 1; index >= 0; index -= 1) {
    const char = beforeChars[index]!;
    const charDisplayWidth = charWidth(char);
    if (keptLeftWidth + charDisplayWidth > leftLimit) break;
    keptLeftWidth += charDisplayWidth;
    keptLeft += 1;
  }
  const leftClipped = keptLeft < beforeChars.length;
  const leftEllipsis = leftClipped && leftBudget >= 1;
  const before =
    (leftEllipsis ? "…" : "") + beforeChars.slice(beforeChars.length - keptLeft).join("");
  const beforeWidth = keptLeftWidth + (leftEllipsis ? 1 : 0);

  // 右侧使用剩余预算；放不下时同样预留 1 列放 "…"。
  const rightBudget = Math.max(0, available - caretWidth - beforeWidth);
  const afterWidth = displayWidth(afterText);
  let after = "";
  let rightClipped = false;
  if (afterWidth > rightBudget) {
    rightClipped = true;
    if (rightBudget >= 1) {
      const limit = rightBudget - 1;
      let used = 0;
      let count = 0;
      for (const char of afterText) {
        const charDisplayWidth = charWidth(char);
        if (used + charDisplayWidth > limit) break;
        used += charDisplayWidth;
        count += 1;
      }
      after = Array.from(afterText).slice(0, count).join("") + "…";
    }
  } else {
    after = afterText;
  }

  return { before, at, after, leftClipped, rightClipped };
}
