/** Clamp a 0..1 channel to a 0..255 integer. */
function chan(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * Figma colour ({ r, g, b, a } with channels in 0..1) → lowercase hex.
 * Appends an alpha byte only when alpha < 1.
 */
export function figmaColorToHex(
  c: { r: number; g: number; b: number; a?: number } | undefined | null,
  opacity?: number,
): string | null {
  if (!c) return null;
  const a = (c.a ?? 1) * (opacity ?? 1);
  const base = `#${toHex2(chan(c.r))}${toHex2(chan(c.g))}${toHex2(chan(c.b))}`;
  return a < 1 ? `${base}${toHex2(chan(a))}` : base;
}

/**
 * CSS colour string (`rgb(...)`, `rgba(...)`, or already hex) → lowercase hex.
 * Returns the input lowercased if it cannot be parsed (so nothing is silently lost).
 */
export function cssColorToHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "rgba(0, 0, 0, 0)") return "#00000000";
  if (s.startsWith("#")) return s;
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return s;
  const parts = m[1].split(",").map((p) => p.trim());
  if (parts.length < 3) return s;
  const r = parseInt(parts[0], 10);
  const g = parseInt(parts[1], 10);
  const b = parseInt(parts[2], 10);
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
  const base = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  return a < 1 ? `${base}${toHex2(Math.round(a * 255))}` : base;
}
