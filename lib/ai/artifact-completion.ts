import { assessArtifact } from "./navi-soul/artifact-quality";

export type ArtifactCompletion = { ok: true; count: number } | { ok: false; error: string };

export function artifactAcceptanceInstruction(request: string): string {
  const base = "Build the requested experience, not a list of placeholder controls. Initialize visible content on load and connect every control to real state. Use addEventListener, never inline onclick attributes. Reserve output for the full implementation; concise exhibit text is better than unfinished scripts. Verify historical dates and attributions; do not invent people, quotations, or citations.";
  if (!/walkable|walk\s+(?:around|through)|first.person|immersive|3d\s+(?:museum|world|scene)/i.test(request)) return base;
  return `${base} This request requires spatial exploration. Use the built-in NaviScene renderer: output <div id="scene"></div><script>NaviScene.mount("#scene", {title:"Museum", rooms:[{title:"Room name",period:"Date range",exhibits:[{title:"Scholar or exhibit",dates:"Life dates",description:"Accurate narrative",work:"Key contribution",source:"Source name if known"}]}]});</script> inside the HTML artifact. NaviScene supplies a Canvas perspective gallery, camera position, keyboard and touch movement, exhibit detail panels, room selection and reset. Supply substantive exhibits for every requested era, at most 12 rooms and 12 exhibits per room. Keep each description concise; place scholars in the period they lived, distinguish later influence, and avoid duplicate people under different names. Do not rewrite the scene engine or invent its API. A previous/next slideshow alone does not satisfy walking around.`;
}

/** Completion is checked before an interactive answer becomes visible. */
export function checkArtifactCompletion(answer: string): ArtifactCompletion {
  const opening = /```(?:[a-z0-9_-]*artifact[a-z0-9_-]*|react-component|react_component|navi-html)[ \t]*\r?\n/gi;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(answer))) {
    const end = answer.indexOf("```", opening.lastIndex);
    if (end === -1) return { ok: false, error: "The artifact fence never finished. Return a complete, shorter implementation." };
    const verdict = assessArtifact(answer.slice(opening.lastIndex, end).trim());
    if (!verdict.ok) return { ok: false, error: verdict.error };
    count++;
    opening.lastIndex = end + 3;
  }
  return count ? { ok: true, count } : { ok: false, error: "The response did not contain a working artifact. Return the requested interactive result in a navi-artifact fence." };
}
