import React from "react";
import { Box, Text } from "ink";

export interface ErrorPanelProps {
  message: string;
  hints: string[];
  title?: string;
}

export function ErrorPanel({ message, hints, title = "操作失败" }: ErrorPanelProps) {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="red">
      <Text bold color="red">
        {title}
      </Text>
      <Text color="white">{message}</Text>
      {hints.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {hints.map((hint) => (
            <Text key={hint} dimColor>
              • {hint}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color="green">r</Text> 重试 · <Text color="yellow">Esc</Text> 关闭
        </Text>
      </Box>
    </Box>
  );
}