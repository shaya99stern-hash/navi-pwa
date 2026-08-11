/**
 * A `DOMException` constructor, on runtimes that forgot to ship one.
 *
 * Every aborted request in production ended the same way:
 *
 * ```
 * TypeError: DOMException is not a constructor
 * ```
 *
 * The trail runs through a dependency. `@ai-sdk/provider-utils` builds its
 * abort error with `new DOMException('Delay was aborted', 'AbortError')`, and
 * its `delay()` is on two hot paths this app uses on every single turn: the
 * retry backoff, and `smoothStream`, which delays between chunks while text is
 * streaming. The edge runtime exposes `DOMException` as a value but not as
 * something you may call `new` on, so the moment a stream was cancelled — a
 * user navigating away, a timeout firing, a failover moving to the next route —
 * the abort path threw a `TypeError` instead of the `AbortError` everything
 * upstream was written to catch.
 *
 * The damage is bigger than one wrong error name. Aborts are how this app moves
 * between providers, so the failure landed in the middle of failover and
 * replaced a recoverable, correctly-typed abort with an unrecognised crash. In
 * the trace that prompted this, it is the last line after all three providers
 * had already failed — the error about the error.
 *
 * Patching the dependency is not available; installing what it expects is. The
 * shim exists only when the real constructor is missing, carries the `name` and
 * `message` that `error.name === "AbortError"` checks depend on, and is a no-op
 * on every runtime that has the genuine article — which is all of them except
 * the one that matters here.
 */

/** Whether `DOMException` can actually be constructed on this runtime. */
function constructible(candidate: unknown): boolean {
  if (typeof candidate !== "function") return false;
  try {
    /* The only honest test is to build one. A `typeof` check passes on the
       edge runtime's non-constructible binding, which is exactly the case this
       whole module exists for. */
    new (candidate as new (message?: string, name?: string) => unknown)("probe", "AbortError");
    return true;
  } catch {
    return false;
  }
}

class ShimmedDomException extends Error {
  constructor(message = "", name = "Error") {
    super(message);
    this.name = name;
  }
}

/**
 * Install the shim if the runtime needs it. Safe to call more than once.
 *
 * Called for its side effect at module load by the routes that stream, because
 * the constructor has to exist before the first abort rather than before the
 * first import that happens to notice.
 */
export function ensureDomException(): void {
  /* Widened away from the DOM lib's own declaration on purpose: that type
     carries two dozen legacy numeric constants nothing reads, and satisfying
     them would mean writing them out to install a shim whose entire job is to
     carry a name and a message. */
  const scope = globalThis as unknown as { DOMException?: unknown };
  if (constructible(scope.DOMException)) return;
  scope.DOMException = ShimmedDomException;
}

ensureDomException();
