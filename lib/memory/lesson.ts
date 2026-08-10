/**
 * The naming convention that separates a lesson from a skill.
 *
 * Both live in the same table, so what tells them apart is a prefix on the
 * name. Three places depend on that: the tool that writes lessons, the block
 * that renders them into the prompt, and the settings screen that lists what is
 * stored. Two of those cannot import the store — it is `server-only`, and one
 * of them runs in the browser — so the convention lives in this module, which
 * holds nothing but the convention and can be imported from anywhere.
 *
 * Copying the string instead would compile, work, and then silently stop
 * matching the first time one copy changed.
 */

/** Marks a stored row as something NaviSoul worked out, not something it was told. */
export const LESSON_PREFIX = "Lesson:";

/** Was this row self-learned? Tolerant of case and leading space, since the name round-trips through a database and a prompt. */
export function isLessonName(name: string): boolean {
  return name.trimStart().toLowerCase().startsWith(LESSON_PREFIX.toLowerCase());
}
