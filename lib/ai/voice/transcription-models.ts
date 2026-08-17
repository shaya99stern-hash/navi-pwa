/**
 * Which models may transcribe speech, in the order they are tried.
 *
 * Shared between the route that calls them and the diagnostic that checks
 * them, because a diagnostic reading a different list from the code is worse
 * than no diagnostic at all: it reports on models nobody uses and stays silent
 * about the ones that are failing. That is exactly the state this file was
 * created to end — `checkTranscription` listed the provider's catalogue,
 * concluded "the token is valid and the router answered", and said voice
 * transcription was fine while every one of these was being refused.
 *
 * The first entry is the deployment's own choice. The rest are a ladder, not a
 * preference: `large-v3-turbo` is the fastest good option, `large-v3` the most
 * widely served, and `small` the one most likely to be available on a
 * constrained account. A list that ends in something modest is what keeps
 * dictation working on a token that cannot reach the leading model.
 */
export function transcriptionModels(): string[] {
  const configured = process.env.NAVI_TRANSCRIBE_MODEL?.trim();
  return [
    configured || "openai/whisper-large-v3-turbo",
    "openai/whisper-large-v3",
    "openai/whisper-small"
  ].filter((model, index, all) => model && all.indexOf(model) === index);
}
