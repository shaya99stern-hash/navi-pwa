"use client";

import { Component, type ReactNode } from "react";

/**
 * One message failing to render, instead of the whole app.
 *
 * ## What this is for
 *
 * The owner reported it plainly: *"I don't like the fact that There was an
 * error and it took me to a different page."* They were making artifacts at the
 * time, and that is the clue — nothing in this app had an error boundary at
 * all. The only one was Next's route-level `app/error.tsx`, which is a
 * *whole-page* fallback by design.
 *
 * So any render-time throw anywhere in the thread — a malformed artifact
 * payload, a code block that trips the highlighter, one unexpected shape in one
 * saved message — replaced the entire screen with "NaviOS hit a temporary
 * problem". The conversation is still safe on the device, and the text on that
 * page says so, but the person is no longer looking at it. Everything they were
 * doing is gone from view because one paragraph would not draw.
 *
 * A message is exactly the right size for a boundary. It is the unit that
 * failed, it is independently meaningful, and the rest of the conversation has
 * nothing to do with it.
 *
 * ## Why the raw text is kept
 *
 * A reply that cannot be *formatted* has not stopped existing. Falling back to
 * unformatted text means a rendering bug costs the styling and nothing else —
 * the answer is still readable, still selectable, still copyable. Losing the
 * content because the markdown pass threw would be a worse outcome than the
 * error it is reporting.
 *
 * ## Resetting
 *
 * Keyed on the text, so a streaming message that throws on a half-written
 * fence recovers the moment the rest of it arrives. Without that, one bad
 * intermediate frame would leave the message broken for the rest of its life,
 * which is the shape most likely to bite: a partial artifact payload is
 * malformed for as long as it is partial, and valid a second later.
 */

type Props = { children: ReactNode; text: string };
type State = { failed: boolean; forText: string | null };

export class MessageBoundary extends Component<Props, State> {
  state: State = { failed: false, forText: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    /* New text is a new attempt. A half-written fence that threw is valid once
       the rest of it arrives, and staying broken would be the wrong memory. */
    if (state.failed && state.forText !== null && state.forText !== props.text) {
      return { failed: false, forText: props.text };
    }
    if (state.forText === null || (!state.failed && state.forText !== props.text)) {
      return { forText: props.text };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    /* Logged rather than shown in full: the message says what happened, and a
       stack trace in the middle of a conversation is noise to everyone except
       whoever is reading the console. */
    console.error("Navi message failed to render:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div>
        <p className="mb-2 text-[0.8125rem]/[1.125rem] text-tertiary">
          This reply could not be formatted, so it is shown as plain text. The rest of the conversation is unaffected.
        </p>
        <p className="whitespace-pre-wrap break-words">{this.props.text}</p>
      </div>
    );
  }
}
