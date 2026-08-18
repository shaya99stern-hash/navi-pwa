import type { ModelMessage } from "ai";

/**
 * Reasoning traces removed at the last point before a provider sees them.
 *
 * `redactGeneratedMedia` already drops `reasoning` parts from the incoming
 * UI messages, and it was not enough: production kept rejecting turn two with
 *
 *     'messages.2' : for 'role:assistant' the following must be satisfied
 *     [('messages.2' : property 'reasoning_content' is unsupported)]
 *
 * — one reasoning reply turning the rest of a conversation into an error, which
 * in a spoken conversation is fatal, because a spoken conversation *is* turn
 * two onwards.
 *
 * This runs one layer lower, on the model messages, which is where the failure
 * actually originates. `@ai-sdk/openai-compatible` builds each assistant
 * message by walking its content parts, accumulating every `reasoning` part
 * into one string, and emitting `reasoning_content` whenever that string is
 * non-empty. So a single surviving reasoning part anywhere in the history is
 * enough, and the only place that can be checked with certainty is here —
 * after every conversion and transformation, immediately before dispatch.
 *
 * Filtering at the UI layer was not wrong, it was upstream of two things it
 * could not see: `reasoning-file` is a second reasoning part type with its own
 * predicate, and any later step is free to reintroduce content of either kind.
 * A guard placed where the value is *read* cannot be bypassed by a path nobody
 * has written yet.
 *
 * Nothing of value is lost. The traces are intermediate work, the constitution
 * forbids showing them, and replaying them buys the model nothing — while
 * cross-provider fallback makes replaying them actively dangerous, since the
 * entire point is that turn two may land somewhere turn one did not.
 */
export function withoutReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return [message];
    const content = message.content.filter(
      (part) => part.type !== "reasoning" && part.type !== "reasoning-file"
    );
    if (content.length === message.content.length) return [message];
    /* An assistant turn that was nothing but reasoning has nothing left to
       send. Keeping it as an empty message is its own rejection on several
       providers, so it is dropped rather than emptied. */
    return content.length ? [{ ...message, content }] : [];
  });
}
