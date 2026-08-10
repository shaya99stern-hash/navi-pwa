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
};

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
        live: true
      };
      frameRef.current = frame;
      stack.push(frame);
      if (frame.owned) {
        const depth = stack.length;
        afterPending(() => window.history.pushState({ ...window.history.state, naviOverlay: depth }, "", path ?? window.location.href));
      }
      return;
    }

    if (!open && frameRef.current) {
      const frame = frameRef.current;
      frameRef.current = null;
      frame.live = false;
      const index = stack.lastIndexOf(frame);
      if (index < 0) return;

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
