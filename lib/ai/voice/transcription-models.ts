import { PROVIDERS, providerApiKey } from "../provider-registry";

/**
 * Who may transcribe speech, in the order they are asked.
 *
 * This was a list of three Hugging Face model ids, and the live diagnostic on
 * the owner's own deployment answered plainly: the token works, and not one of
 * them is served to the account. Dictation had been failing on the *model* for
 * as long as anyone could remember, and every symptom reached the user as a
 * microphone that did not work.
 *
 * The shape was the real defect rather than the ids. Chat ladders across ten
 * providers and survives any one of them changing its catalogue; transcription
 * was pinned to a single host, so a routing change there took voice input
 * offline with no path around it. Ladders belong on both.
 *
 * Groq leads because it is the strongest option this app already has a working
 * credential for — an OpenAI-compatible `/audio/transcriptions` endpoint, a
 * genuine free tier, and the fastest speech-to-text of anything configured
 * here. Hugging Face stays behind it: it is the token most deployments have,
 * and it costs nothing to try second.
 *
 * Every candidate speaks the same multipart dialect, so adding a host is a row
 * in this table rather than a branch in the route.
 */

export type TranscriptionCandidate = {
  /** The provider whose credential and endpoint this uses. */
  provider: "groq" | "huggingface";
  /** Human-readable, for diagnostics. Never shown to a user mid-answer. */
  label: string;
  model: string;
  /** Full URL of the OpenAI-compatible transcription endpoint. */
  endpoint: string;
  token: string;
};

const GROQ_ENDPOINT = `${PROVIDERS.groq.baseURL}/audio/transcriptions`;
const HF_ENDPOINT = "https://router.huggingface.co/v1/audio/transcriptions";

/**
 * The candidates this deployment can actually attempt.
 *
 * A provider with no credential is omitted rather than attempted and failed,
 * so the failure list a user or a log ever sees contains only real refusals.
 */
export function transcriptionCandidates(): TranscriptionCandidate[] {
  const candidates: TranscriptionCandidate[] = [];
  const configured = process.env.NAVI_TRANSCRIBE_MODEL?.trim();

  const groqToken = providerApiKey(PROVIDERS.groq);
  if (groqToken) {
    /* An operator naming a model gets it tried first, on the fastest host that
       can serve one, before any default. */
    for (const model of dedupe([configured, "whisper-large-v3-turbo", "whisper-large-v3"])) {
      candidates.push({ provider: "groq", label: `Groq ${model}`, model, endpoint: GROQ_ENDPOINT, token: groqToken });
    }
  }

  const hfToken = providerApiKey(PROVIDERS.huggingface);
  if (hfToken) {
    for (const model of dedupe([configured, "openai/whisper-large-v3-turbo", "openai/whisper-large-v3", "openai/whisper-small"])) {
      candidates.push({ provider: "huggingface", label: `Hugging Face ${model}`, model, endpoint: HF_ENDPOINT, token: hfToken });
    }
  }

  return candidates;
}

/**
 * Groq names whisper bare, Hugging Face namespaces it under `openai/`, and a
 * configured id written for one is meaningless to the other. Rather than
 * rewrite someone's setting, each host is offered the id as given and its own
 * defaults after it — a wrong id costs one failed attempt, where translating it
 * would silently send a model nobody asked for.
 */
function dedupe(models: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of models) {
    const value = model?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Just the model ids, for surfaces that report what was configured. */
export function transcriptionModels(): string[] {
  return dedupe(transcriptionCandidates().map((candidate) => candidate.model));
}
