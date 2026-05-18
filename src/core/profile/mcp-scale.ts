export function mcpToInternal(mcpValue: number): number {
  const clamped = Math.max(0, Math.min(1, mcpValue));
  return Math.round(clamped * 9) + 1;
}

export function internalToMcp(internalValue: number): number {
  return (internalValue - 1) / 9;
}