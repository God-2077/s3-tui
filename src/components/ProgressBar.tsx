import React from "react";
import { Text } from "ink";

export interface ProgressBarProps {
  percent: number;
  width?: number;
  tone?: "upload" | "download" | "done" | "error";
}

const TONE_COLOR: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  upload: "cyan",
  download: "blue",
  done: "green",
  error: "red",
};

export function ProgressBar({ percent, width = 14, tone = "upload" }: ProgressBarProps) {
  const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((clamped / 100) * width);
  return (
    <Text>
      <Text color={TONE_COLOR[tone]}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(Math.max(0, width - filled))}</Text>
    </Text>
  );
}