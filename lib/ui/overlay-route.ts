"use client";

import { useEffect, useRef } from "react";

/**
 * Overlays that are part of the history, not floating on top of it.
 *
 * Nine surfaces in this app open by flipping a boolean: the drawer, settings,
 * connectors, projects, artifacts, the chat menu, the effort sheet, voice, the
 * message actions. None of them touched the history, and two things followed
 * from that.
 *
 * The back gesture left the app. On a phone, back is how you dismiss the thing
 * in front of you — it is the same motion as the X, and users reach for it
 * first. With settings open over a conversation, back skipped the settings
 * entirely and navigated away from the chat, or off the app when the chat was
 * the first thing opened. That is the "screen routing is not a hundred percent"
 * complaint, and it is not a feeling: the overlay simply was not a place you
 * could be, so there was nothing to come back from.
 *
 * And the address went stale. `/settings` opens the settings sheet, so closing
 * it left the URL claiming a screen that was no longer on show — reload and it
 * sprang open again, share the address and it sent someone to a sheet rather
 * than to the conversation.
 *
 * This makes an open overlay a real history entry. Back closes exactly one,
 * innermost first; the X unwinds the same entry so the address follows; and a
 * link straight to `/settings` still works, closing to the app rather than off
 * the end of the history.
 */

type Frame = {
  /** Runs the overlay's own close handler. Not called when it closed itself. */
  close: () => void;
  /** Lets the owning hook forget a frame that history has already discarded. */
  detach: () => void;
  /** Did we push the entry, or did a route navigation already provide one? */
  owned: boolean;
  /** Where to leave the address when an entry we did not push is closed. */
  restore: string;
  /** False once closed, so a pop cannot run the handler a second time. */
  live: boolean;
  /** Stamped into the history entry, so we can tell whether it is still on top. */
  id: number;
  /** The overlay is closing because we are navigating away; leave history alone. */
  released: boolean;
};

let nextFrameId = 1;

/* Innermost last. Settings can open connectors on top of itself, and back has
   to take those off in the order they went on. */
const stack: Frame[] = [];

/* Backs we asked for and have not yet been given.
 *
 * `history.back()` is asynchronous — the pop lands a tick or more later — and
 * one sheet replacing another does both halves in a single render: Settings
 * closes and Connectors opens from the same tap. The naive version issued the
 * back, then pushed the new entry before the back arrived, so the pop landed on
 * the entry that had just been added and unwound the wrong screen. Driving the
 * app is what surfaced it: tapping Connectors inside Settings dropped straight
 * back to the conversation.
 *
 * So a push waits behind an outstanding back. Nothing here is a timer or a
 * guess — the popstate event itself is the signal that the history has caught
 * up, and only then does the queue drain. */
const awaitingPop: Frame[] = [];
const deferred: Array<() => void> = [];

function drain(): void {
  while (awaitingPop.length === 0 && deferred.length) deferred.shift()?.();
}

function afterPending(action: () => void): void {
  if (awaitingPop.length) deferred.push(action);
  else action();
}

let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    /* Ours: the overlay is already closed and its frame already gone. Nothing
       to dismiss, but the history has settled, so anything held back can go. */
    if (awaitingPop.length) {
      awaitingPop.shift();
      drain();
      return;
    }
    /* Not every pop is ours. Navigating between chats pops entries this module
       never pushed, and an empty stack means exactly that. */
    const frame = stack.pop();
    if (!frame) return;
    frame.detach();
    if (frame.live) {
      frame.live = false;
      frame.close();
    }
  });

  /* The same gesture on a keyboard. Closing here goes through the overlay's own
     handler, so the history entry unwinds by the ordinary path rather than
     needing a second route out. */
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const frame = stack[stack.length - 1];
    if (!frame?.live) return;
    event.preventDefault();
    frame.close();
  });
}

/**
 * "I am about to navigate; the navigation is the history change."
 *
 * A drawer row that opens a real route does two things from one tap: it closes
 * the drawer and it navigates. Both are correct, and together they were wrong —
 * the close unwound the entry the drawer had pushed, and because
 * `history.back()` lands after the router has already pushed, the unwind
 * cancelled the navigation. Tapping Developer showed the Developer screen and
 * then bounced straight back to the conversation.
 *
 * Nothing about the close is different in that case except its meaning: the
 * overlay is not being dismissed, it is being left behind. Saying so is what
 * distinguishes the two, and the caller is the only one who knows which it is.
 */
export function releaseOverlaysForNavigation(): void {
  for (const frame of stack) frame.released = true;
}

export type OverlayRoute = {
  /** Whether the overlay is on screen. The hook follows this, never sets it. */
  open: boolean;
  /** The overlay's own dismiss handler, run when the back gesture closes it. */
  onClose: () => void;
  /** Address to show while open. Omit to keep whatever is already there. */
  path?: string;
  /** Where to go when closing an entry we did not push — see `owned`. */
  restore?: string;
};

/**
 * Bind one overlay's open state to one history entry.
 *
 * Deliberately one-directional: the hook reads `open` and never writes it, so
 * the component keeps owning its own state and nothing here can desynchronise
 * from what is actually rendered.
 */
export function useOverlayRoute({ open, onClose, path, restore = "/" }: OverlayRoute): void {
  /* The handler is rebuilt every render; the frame is created once. Reading
     through a ref is what lets the frame call the current handler rather than
     the one that existed when the overlay opened. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const frameRef = useRef<Frame | null>(null);
  /* An overlay open on the very first render came from a route — `/settings`
     renders the shell with the sheet already showing — so the navigation that
     brought us here is its history entry, and pushing another would need two
     backs to leave one sheet. */
  const mounted = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    listen();

    const first = !mounted.current;
    mounted.current = true;

    if (open && !frameRef.current) {
      const frame: Frame = {
        close: () => closeRef.current(),
        detach: () => { frameRef.current = null; },
        owned: !first,
        restore: restoreRef.current,
        live: true,
        id: nextFrameId++,
        released: false
      };
      frameRef.current = frame;
      stack.push(frame);
      if (frame.owned) {
        afterPending(() => window.history.pushState({ ...window.history.state, naviOverlay: frame.id }, "", path ?? window.location.href));
      }
      return;
    }

    if (!open && frameRef.current) {
      const frame = frameRef.current;
      frameRef.current = null;
      frame.live = false;
      const index = stack.lastIndexOf(frame);
      if (index < 0) return;

      if (frame.released) {
        /* Leaving for a real route. The navigation is the history change, so
           touching history here would fight it — which is exactly what made
           the Developer screen appear and then vanish. */
        stack.splice(index, 1);
        return;
      }

      /* Is our entry still the current one? Something else may have pushed on
         top — a router navigation, most often — and going back would then undo
         that rather than this overlay. The id was stamped into the entry when
         it was pushed precisely so this can be checked rather than assumed. */
      const onTop = (window.history.state as { naviOverlay?: number } | null)?.naviOverlay === frame.id;
      if (frame.owned && !onTop) {
        stack.splice(index, 1);
        return;
      }

      if (!frame.owned) {
        /* Arrived by link. There may be nothing behind us — going back would
           leave the app to dismiss a sheet — so the address is corrected in
           place instead. */
        stack.splice(index, 1);
        window.history.replaceState({ ...window.history.state, naviOverlay: null }, "", frame.restore);
        return;
      }

      if (index === stack.length - 1) {
        /* Ours and on top: unwind it, so the address returns to whatever was
           behind the overlay without needing to know what that was. The frame
           leaves the stack now and the pop is expected later. */
        stack.splice(index, 1);
        awaitingPop.push(frame);
        window.history.back();
        return;
      }

      /* Closed out of order — an overlay underneath a newer one went away on
         its own. Drop the frame and leave the history alone; popping a middle
         entry is not something the History API can do, and the entries above
         are still the ones back should take off first. The cost is one stale
         entry beneath the ones still open, which back walks through harmlessly.
         Rare by construction: the hooks are declared outermost-first, so a
         replacement closes the outer sheet before the inner one is pushed. */
      stack.splice(index, 1);
    }
  }, [open, path]);
}

/** Test seam: the depth of the overlay stack. */
export function overlayDepth(): number {
  return stack.length;
}
