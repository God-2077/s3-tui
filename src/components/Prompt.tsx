import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

import { layoutInputLine, nextCursor, previousCursor } from "../utils/input.js";

export interface PromptProps {
  label: string;
  hint?: string;
  initialValue?: string;
  columns: number;
  error?: string;
  onChange?: (value: string) => void;
  validator?: (value: string) => string | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function Prompt({
  label,
  hint,
  initialValue = "",
  columns,
  error: externalError,
  onChange,
  validator,
  onSubmit,
  onCancel,
}: PromptProps) {
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  const [error, setError] = useState<string | undefined>(externalError);

  useEffect(() => {
    onChange?.(value);
    // onChange 只用于过滤预览，不参与输入循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (!trimmed) {
        setError("不能为空");
        return;
      }
      const problem = validator?.(trimmed);
      if (problem) {
        setError(problem);
        return;
      }
      onSubmit(trimmed);
      return;
    }

    if (key.leftArrow) {
      setCursor((current) => previousCursor(value, current));
      return;
    }
    if (key.rightArrow) {
      setCursor((current) => nextCursor(value, current));
      return;
    }
    if (key.home || (key.ctrl && input === "a")) {
      setCursor(0);
      return;
    }
    if (key.end || (key.ctrl && input === "e")) {
      setCursor(value.length);
      return;
    }
    if (key.backspace) {
      const from = previousCursor(value, cursor);
      if (from === cursor) return;
      setValue(value.slice(0, from) + value.slice(cursor));
      setCursor(from);
      setError(undefined);
      return;
    }
    if (key.delete) {
      const to = nextCursor(value, cursor);
      if (to === cursor) return;
      setValue(value.slice(0, cursor) + value.slice(to));
      setError(undefined);
      return;
    }
    if (key.ctrl && input === "u") {
      setValue("");
      setCursor(0);
      return;
    }
    if (key.ctrl && input === "w") {
      const before = value.slice(0, cursor);
      const trimmed = before.replace(/\s*\S*$/, "");
      setValue(trimmed + value.slice(cursor));
      setCursor(trimmed.length);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;

    const printable = input.replace(/[\r\n\t]/g, " ");
    if (!printable) return;
    setValue((current) => current.slice(0, cursor) + printable + current.slice(cursor));
    setCursor((current) => current + printable.length);
    setError(undefined);
  });

  const width = Math.max(16, columns - 6);
  const view = layoutInputLine(value, cursor, width);
  const hintLine = hint ?? "Enter 确认 · Esc 取消";

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="magenta">
      <Text bold color="magenta">
        {label}
      </Text>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <Text>{view.before}</Text>
        <Text inverse>{view.at || " "}</Text>
        <Text>{view.after}</Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>{hintLine}</Text>
    </Box>
  );
}