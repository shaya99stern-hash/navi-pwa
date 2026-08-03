import { audioGenerationIntent, classifyAudioRequest, requestedDuration, spokenText, audioPrompt } from "@/lib/ai/audio-generation";

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected; ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
};

// The user's own example.
check("'create a ding' is an audio request", audioGenerationIntent("create a ding"), true);
check("'create a ding' classifies as an effect", classifyAudioRequest("create a ding"), "effect");
check("a ding defaults to 3 seconds", requestedDuration("create a ding", "effect"), 3);

// Music.
check("'make me a lofi track' is audio", audioGenerationIntent("make me a lofi track"), true);
check("'make me a lofi track' is music", classifyAudioRequest("make me a lofi track"), "music");
check("music defaults to 12 seconds", requestedDuration("make me a lofi track", "music"), 12);
check("explicit length is honoured", requestedDuration("make a 20 second ambient loop", "music"), 20);
check("absurd length is capped", requestedDuration("make a 90 second track", "music"), 30);

// Voice.
check("quoted speech is a request", audioGenerationIntent('say "your order is ready"'), true);
check("quoted speech classifies as speech", classifyAudioRequest('say "your order is ready"'), "speech");
check("only the quoted words are spoken", spokenText('say "your order is ready" in a calm voice'), "your order is ready");
check("unquoted speech drops the delivery note", spokenText("say hello there in a british accent"), "hello there");
check("voiceover is speech", classifyAudioRequest("generate a voiceover for the intro"), "speech");

// Ordering rules.
check("words beat music", classifyAudioRequest("create a song saying happy birthday"), "speech");
check("a musical ding is still a ding", classifyAudioRequest("generate a short musical ding"), "effect");

// False positives — these must NOT hijack a normal answer.
check("a question about sound is not a request", audioGenerationIntent("what does a theremin sound like"), false);
check("asking about music history is not a request", audioGenerationIntent("who composed the four seasons"), false);
check("plain chat is not a request", audioGenerationIntent("hi"), false);
check("'make me a picture' is not audio", audioGenerationIntent("make me a picture of a bell"), false);
check("code talk is not audio", audioGenerationIntent("create a function that plays a beep"), false);
check("css sound question is not audio", audioGenerationIntent("make a react component that plays a chime"), false);

// Prompt shaping strips the instruction so the model scores music, not speech.
check("creation verb is stripped", audioPrompt("generate me a calm piano melody", "music"), "calm piano melody");
const cue = audioPrompt("create a ding", "effect");
check("cue prompt adds shape guidance", cue.startsWith("ding.") && cue.includes("Short isolated sound cue"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
