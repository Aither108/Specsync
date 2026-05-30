/** Parse a CSS length string ("44px", "1.5rem"→null unless px) to a px number. */
export function pxToNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const s = value.trim();
  if (s === "" || s === "normal" || s === "auto" || s === "none") return null;
  const m = s.match(/^(-?\d*\.?\d+)px$/);
  if (m) return parseFloat(m[1]);
  const plain = s.match(/^-?\d*\.?\d+$/);
  if (plain) return parseFloat(s);
  return null;
}

/** Normalise CSS font-weight keywords to numbers. */
export function normalizeFontWeight(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const s = value.trim().toLowerCase();
  if (s === "normal") return 400;
  if (s === "bold") return 700;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

/** Strip quotes and trailing fallback fonts so "Inter" and 'Inter', sans-serif compare equal. */
export function normalizeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0] ?? value;
  return first.replace(/["']/g, "").trim().toLowerCase() || null;
}

/**
 * Compare two property values for equality.
 * - numbers: equal within `tolerance` px
 * - strings: case-insensitive exact match
 * - one side null: not equal (a real mismatch the diff should surface)
 */
export function valuesEqual(
  a: number | string | null,
  b: number | string | null,
  tolerance: number,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= tolerance;
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}
