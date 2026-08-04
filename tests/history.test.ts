/* Mirrors redactGeneratedMedia in app/api/chat/route.ts. Kept in lockstep. */
type Part = { type: string; text?: string };
type Msg = { role: string; parts: Part[] };

function redactGeneratedMedia(messages: Msg[]): Msg[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts
      .filter((part) => part.type !== "reasoning")
      .map((part) => part.type === "text"
        ? {
          ...part,
          text: (part.text ?? "")
            .replace(/```navi-image\s*[\s\S]*?```/gi, "[A raster image was generated in this earlier turn.]")
            .replace(/```navi-audio\s*[\s\S]*?```/gi, "[An audio clip was generated in this earlier turn.]")
        }
        : part)
  }));
}

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

/* The live failure: a reasoning turn recorded with one provider was replayed
   to another, which answered "property 'reasoning_content' is unsupported"
   and broke the conversation permanently. */
const withReasoning: Msg[] = [
  { role: "user", parts: [{ type: "text", text: "hi" }] },
  { role: "assistant", parts: [{ type: "reasoning", text: "internal deliberation" }, { type: "text", text: "Hello." }] },
  { role: "user", parts: [{ type: "text", text: "again" }] }
];
const cleaned = redactGeneratedMedia(withReasoning);
check("reasoning parts are removed", cleaned[1].parts.some((p) => p.type === "reasoning"), false);
check("the answer text survives", cleaned[1].parts[0].text, "Hello.");
check("message count is unchanged", cleaned.length, 3);
check("user turns are untouched", cleaned[0].parts, [{ type: "text", text: "hi" }]);

// An assistant turn that was ONLY reasoning must not vanish into a malformed message.
const onlyReasoning: Msg[] = [{ role: "assistant", parts: [{ type: "reasoning", text: "thinking" }] }];
check("a reasoning-only turn keeps its message", redactGeneratedMedia(onlyReasoning).length, 1);
check("a reasoning-only turn has no parts left", redactGeneratedMedia(onlyReasoning)[0].parts, []);

// Media redaction still works alongside it.
const withMedia: Msg[] = [{ role: "assistant", parts: [
  { type: "reasoning", text: "thinking" },
  { type: "text", text: "Here:\n```navi-image\n{\"data\":\"AAAA\"}\n```" }
] }];
const media = redactGeneratedMedia(withMedia);
check("image payload is replaced", media[0].parts[0].text, "Here:\n[A raster image was generated in this earlier turn.]");
check("reasoning removed alongside media", media[0].parts.length, 1);

const withAudio: Msg[] = [{ role: "assistant", parts: [{ type: "text", text: "```navi-audio\n{\"data\":\"BBBB\"}\n```" }] }];
check("audio payload is replaced", redactGeneratedMedia(withAudio)[0].parts[0].text, "[An audio clip was generated in this earlier turn.]");

// A capability block must survive, or the card stops rendering on reload.
const withCapability: Msg[] = [{ role: "assistant", parts: [{ type: "text", text: "```navi-capability\n---\nname: X\n---\nbody\n```" }] }];
check("capability blocks are preserved", redactGeneratedMedia(withCapability)[0].parts[0].text?.includes("navi-capability"), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

export {};
