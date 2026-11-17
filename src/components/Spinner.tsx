import React, { useEffect, useState } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ active = true }: { active?: boolean }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [active]);

  return <Text color="cyan">{active ? FRAMES[frame] : " "}</Text>;
}