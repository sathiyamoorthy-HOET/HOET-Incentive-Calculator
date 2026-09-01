"use client";

/**
 * Numeric cell that commits on blur or Enter rather than on every keystroke,
 * so half-typed values like "1." are never parsed. Remounts when the committed
 * value changes from elsewhere (an A-rate edit rescaling B, C and D, say).
 */
export default function NumInput({
  value,
  onCommit,
  step = "1",
  min,
  className = "",
  width,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: string;
  min?: string;
  className?: string;
  width?: number;
}) {
  return (
    <input
      key={String(value)}
      className={"n " + className}
      type="number"
      step={step}
      min={min}
      style={width ? { width } : undefined}
      defaultValue={value}
      onBlur={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v !== value) onCommit(v);
        else if (isNaN(v)) e.target.value = String(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
