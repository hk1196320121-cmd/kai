export function mcpToInternal(mcpValue: number): number {
  const clamped = Math.max(0, Math.min(1, mcpValue));
  return Math.round(clamped * 9) + 1;
}

export function internalToMcp(internalValue: number): number {
  const clamped = Math.max(1, Math.min(10, internalValue));
  return (clamped - 1) / 9;
}
