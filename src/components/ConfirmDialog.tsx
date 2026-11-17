import React from "react";
import { Box, Text, useInput } from "ink";

export interface ConfirmDialogProps {
  title: string;
  lines: string[];
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  lines,
  danger = false,
  confirmLabel = "确认",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "n") {
      onCancel();
      return;
    }
    if (key.return || input.toLowerCase() === "y") {
      onConfirm();
    }
  });

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="round"
      borderColor={danger ? "red" : "yellow"}
    >
      <Text bold color={danger ? "red" : "yellow"}>
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={danger ? "red" : "green"}>y</Text>/Enter {confirmLabel} ·{" "}
          <Text color="yellow">n</Text>/Esc 取消
        </Text>
      </Box>
    </Box>
  );
}