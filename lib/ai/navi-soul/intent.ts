/* PATH: lib/ai/navi-soul/intent.ts  — NEW FILE, copy verbatim. */

/**
 * What kind of turn this is, decided before any model is chosen.
 *
 * The router (`providers.ts`) decides how much engine a request deserves; it
 * cannot decide what *pipeline* the request belongs to. That gap is where the
 * worst failures live: an image request answered by a text model describes the
 * picture instead of making one, and a component request sent to the image
 * pipeline paints a screenshot of an app instead of building one. Both look
 * like the app working hard at the wrong job.
 *
 * The same discipline as every classifier in this codebase: patterns anchor to
 * an explicit instruction verb, a false match is treated as worse than a miss,
 * and anything ambiguous returns "conversation" so the model — which reads
 * intent far better than a regex — makes the call. `confidence` exists so the
 * chat route can auto-route only on "certain" and treat "likely" as a hint.
 */

export type TurnIntent = "image-create" | "image-edit" | "artifact" | "code" | "conversation";

export type IntentDecision = {
  intent: TurnIntent;
  confidence: "certain" | "likely";
  /** One line for the diagnostics stream, never shown to the user. */
  reason: string;
};

export type IntentSignals = {
  /** The composer attached at least one raster image this turn. */
  hasImageAttachments: boolean;
  /** The product mode the user has selected. */
  mode: "chat" | "code";
};

/** Verbs that open an instruction to make something. */
const MAKE = String.raw`(?:please\s+)?(?:generate|create|make|draw|render|paint|design|produce|give me)`;

/** The wider verb set for built things — build/code/write mean software, never pictures. */
const BUILD = String.raw`(?:please\s+)?(?:build|generate|create|make|code|write|design|develop|produce)`;

/**
 * Interactive things the artifact pipeline builds. Checked BEFORE the image
 * patterns because "make an image gallery component" contains the word image
 * and is not an image request — the noun that follows the verb is the subject.
 */
const UI_OBJECT = /\b(component|widget|app|application|game|calculator|dashboard|form|quiz|timer|tracker|visuali[sz]er|simulation|simulator|prototype|landing page|web ?page|web ?site|screen|interface|ui|tool that|converter)\b/i;
const ARTIFACT_ASK = new RegExp(String.raw`^\s*${BUILD}\b[^.!?\n]{0,80}?${UI_OBJECT.source}`, "i");
const EXPLICIT_ARTIFACT = /\bartifact\b/i;

/** Nouns that mean a picture, when they are the object of the instruction. */
const IMAGE_OBJECT = /\b(image|picture|photo(?:graph)?|illustration|wallpaper|logo|poster|flyer|banner|portrait|painting|drawing|sketch|artwork|art of|icon set|album cover|book cover|meme|sticker|avatar)\b/i;
const IMAGE_ASK = new RegExp(String.raw`^\s*${MAKE}\b[^.!?\n]{0,60}?${IMAGE_OBJECT.source}`, "i");

/**
 * Edits are only classified when the language is unambiguously about the
 * picture itself. "Fix this bug" with a screenshot attached is a code turn
 * that happens to carry an image, and sending it to the image pipeline would
 * repaint the screenshot — so plain fix/change/edit verbs are NOT enough; the
 * sentence must name an image-domain object or use a purely visual verb.
 */
const VISUAL_EDIT_VERB = /\b(retouch|crop|upscale|colori[sz]e|recolou?r|restyle|blur|sharpen|inpaint|remove the background|erase the|make it black and white|make this black and white)\b/i;
const IMAGE_EDIT_ASK = new RegExp(
  String.raw`\b(edit|change|remove|erase|replace|add|fix|clean up|brighten|darken)\b[^.!?\n]{0,60}?\b(image|photo|picture|background|watermark|lighting|sky|face|hair|colou?rs?)\b`,
  "i"
);

/** Code turns announced by their own shape rather than by mode. */
const CODE_FENCE = /```/;
const STACK_TRACE = /\bat\s+\S+\s+\(.+:\d+:\d+\)|Traceback \(most recent call last\)/;
const CODE_ASK = /^\s*(?:please\s+)?(?:fix|debug|refactor|implement|write|review|optimi[sz]e)\b[^.!?\n]{0,60}?\b(code|function|test|tests|bug|error|script|query|regex|endpoint|migration|component)\b/i;

export function classifyIntent(request: string, signals: IntentSignals): IntentDecision {
  const text = request.trim();
  if (!text) return { intent: "conversation", confidence: "certain", reason: "empty request" };

  if (signals.hasImageAttachments && (VISUAL_EDIT_VERB.test(text) || IMAGE_EDIT_ASK.test(text))) {
    return { intent: "image-edit", confidence: "certain", reason: "attachment plus image-domain edit language" };
  }

  /* Artifact before image: the noun after the verb decides, and UI nouns win
     ties because a wrongly-painted screenshot is the worse failure. */
  if (ARTIFACT_ASK.test(text) || (EXPLICIT_ARTIFACT.test(text) && new RegExp(`^\\s*${BUILD}`, "i").test(text))) {
    return { intent: "artifact", confidence: "certain", reason: "make-verb with an interactive object" };
  }

  if (IMAGE_ASK.test(text)) {
    /* "…of my app's dashboard" after an image noun is still a picture; the
       artifact check above already claimed the genuinely interactive asks. */
    return { intent: "image-create", confidence: "certain", reason: "make-verb with an image object" };
  }

  if (CODE_FENCE.test(text) || STACK_TRACE.test(text) || CODE_ASK.test(text)) {
    return { intent: "code", confidence: "certain", reason: "code fence, stack trace, or code-verb instruction" };
  }
  if (signals.mode === "code") {
    return { intent: "code", confidence: "likely", reason: "code mode with no overriding shape" };
  }

  return { intent: "conversation", confidence: "likely", reason: "no anchored shape matched" };
}

/**
 * Whether the answer depends on the world as it is right now.
 *
 * A hint, not a router: it switches the web-search prompt block and tool
 * emphasis on, subject to the user's own research toggle. Kept apart from the
 * intent union because freshness is orthogonal — a code question and a
 * conversation can both need today's facts.
 */
const FRESHNESS = /\b(latest|newest|today|tonight|yesterday|this (?:week|month|year)|right now|currently|as of|news|headline|price of|stock|share price|exchange rate|weather|forecast|score|schedule|release date|just (?:released|announced|launched))\b/i;

export function wantsFreshInformation(request: string): boolean {
  return FRESHNESS.test(request);
}
