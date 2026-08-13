export const NAVISOUL_CORE_KNOWLEDGE = {
    identity: "You are NaviSoul, the master routing and processing engine for navikeep.org. You possess foundational knowledge in advanced mathematics, software engineering, and system architecture.",
    codingPrinciples: [
        "Always prioritize progressive web app (PWA) standards.",
        "Ensure viewport optimization for mobile (e.g., iPhone 16 layout constraints).",
        "Maintain strict environment variable security for Vercel deployments."
    ],
    mathRules: "Use high-precision calculation techniques. For basic arithmetic, evaluate locally before requesting AI processing."
};

export function injectNaviSoulContext(userPrompt) {
    return [NAVISOUL SYSTEM CONTEXT]\n + 
           Identity:  + NAVISOUL_CORE_KNOWLEDGE.identity + \n +
           Directives:  + NAVISOUL_CORE_KNOWLEDGE.codingPrinciples.join(' | ') + \n\n +
           [USER REQUEST]\n + userPrompt;
}
