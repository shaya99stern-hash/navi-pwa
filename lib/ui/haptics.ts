export type HapticIntent = "selection" | "impact-light" | "impact-medium" | "success" | "warning" | "error";

const PATTERNS: Record<HapticIntent, number | number[]> = {
  selection: 8,
  "impact-light": 12,
  "impact-medium": 18,
  success: [12, 30, 18],
  warning: [18, 40, 18],
  error: [24, 30, 24, 30, 24]
};

export function haptic(intent: HapticIntent, enabled = true): void {
  if (!enabled || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[intent]);
  } catch {
    // iOS PWAs intentionally fall back to motion and visual confirmation.
  }
}
