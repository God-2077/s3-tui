import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

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
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((current) => Math.min(value.length, current + 1));
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
      if (cursor === 0) return;
      setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor));
      setCursor((current) => Math.max(0, current - 1));
      setError(undefined);
      return;
    }
    if (key.delete) {
      if (cursor >= value.length) return;
      setValue((current) => current.slice(0, cursor) + current.slice(cursor + 1));
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
  let shown = value;
  if (value.length > width) {
    shown = `…${value.slice(value.length - width + 1)}`;
  }
  const hintLine = hint ?? "Enter 确认 · Esc 取消";

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="magenta">
      <Text bold color="magenta">
        {label}
      </Text>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <Text>{shown || " "}</Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>{hintLine}</Text>
    </Box>
  );
}