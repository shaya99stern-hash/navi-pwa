export type HapticIntent = "selection" | "impact-light" | "impact-medium" | "success" | "warning" | "error";

const VIBRATE_PATTERNS: Record<HapticIntent, number | number[]> = {
  selection: 8,
  "impact-light": 12,
  "impact-medium": 18,
  success: [12, 30, 18],
  warning: [18, 40, 18],
  error: [24, 30, 24, 30, 24]
};

/* Number of Taptic pulses to fire on iOS, where each native switch toggle
   produces one fixed-strength tick. */
const IOS_PULSES: Record<HapticIntent, number[]> = {
  selection: [0],
  "impact-light": [0],
  "impact-medium": [0],
  success: [0, 90],
  warning: [0, 110],
  error: [0, 90, 180]
};

let iosTrigger: HTMLLabelElement | null = null;

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
}

/* iOS Safari (17.4+) plays a system haptic when a native switch control is
   toggled through a label activation. A visually hidden switch gives web
   apps a real Taptic Engine tick where navigator.vibrate is unavailable. */
function ensureIosTrigger(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (iosTrigger?.isConnected) return iosTrigger;
  // WebKit only plays the tick for a switch it actually paints, so the trigger
  // has to stay in the render tree: `display:none`, `visibility:hidden`,
  // `opacity:0`, and clipping all silence it. A 1px, almost-transparent control
  // in the corner is imperceptible but still painted.
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  // `line-height:0` plus a block input keeps the control inside the label's own
  // 1px box; left to inline layout it lands below the viewport, where it is no
  // longer painted and the tick is lost again.
  label.style.cssText =
    "position:fixed;left:0;bottom:24px;width:1px;height:1px;line-height:0;opacity:0.01;pointer-events:none;";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  input.style.cssText = "display:block;width:1px;height:1px;margin:0;";
  label.appendChild(input);
  document.body.appendChild(label);
  iosTrigger = label;
  return label;
}

function pulseIos(intent: HapticIntent) {
  const trigger = ensureIosTrigger();
  if (!trigger) return;
  for (const delay of IOS_PULSES[intent]) {
    if (delay === 0) trigger.click();
    else window.setTimeout(() => trigger.click(), delay);
  }
}

/**
 * When a real gesture last happened.
 *
 * Both haptic mechanisms need transient user activation: `navigator.vibrate`
 * is refused outright without it — the browser logs "Blocked call to
 * navigator.vibrate because user hasn't tapped on the frame" — and the iOS
 * trick works by activating a real control, which has the same requirement.
 *
 * Activation expires quickly, and roughly forty haptic calls in this app fire
 * *after* an await: a network round trip, a clipboard write, a transcription.
 * By then the window has closed, so those taps produced no feedback at all
 * while identical taps elsewhere did. That inconsistency is what makes the
 * haptics feel broken rather than absent.
 *
 * Nothing here can grant activation the platform withheld. What it can do is
 * stop pretending: a haptic with no chance of firing is skipped rather than
 * attempted, which keeps the console clean and, more importantly, tells the
 * calling code the truth — if feedback matters, fire it on the gesture rather
 * than on the result.
 */
let lastGestureAt = 0;

/** How long after a real gesture a haptic is still worth attempting. */
const ACTIVATION_WINDOW_MS = 1_000;

if (typeof window !== "undefined") {
  const mark = () => { lastGestureAt = Date.now(); };
  /* Capture phase, passive: this must observe every gesture without being
     cancellable by a handler that stops propagation, and without ever
     delaying a scroll. */
  for (const event of ["pointerdown", "touchstart", "keydown"] as const) {
    window.addEventListener(event, mark, { capture: true, passive: true });
  }
}

/** Whether the platform will honour a haptic right now. */
function activationLikely(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  if (activation && typeof activation.isActive === "boolean") return activation.isActive;
  // No UserActivation API: fall back to how recently a gesture was seen.
  return Date.now() - lastGestureAt < ACTIVATION_WINDOW_MS;
}

export function haptic(intent: HapticIntent, enabled = true): void {
  if (!enabled || typeof navigator === "undefined") return;
  /* Skip rather than attempt. The call would be refused anyway, and the
     refusal costs a console warning on every one of them. */
  if (!activationLikely() && Date.now() - lastGestureAt >= ACTIVATION_WINDOW_MS) return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(VIBRATE_PATTERNS[intent]);
      return;
    }
    if (isIos()) pulseIos(intent);
  } catch {
    // Haptics are best-effort; visual feedback always accompanies them.
  }
}
