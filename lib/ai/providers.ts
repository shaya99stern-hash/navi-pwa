import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { PROVIDER_IDS, PROVIDERS, providerApiKey, type ProviderAdapter } from "./provider-registry";
import type { ModelPreset, ProviderName, ProviderRoute, ToolCallingSupport, ToolPolicy } from "./types";

export type ProviderAvailability = Record<ProviderName, boolean>;

export function getHuggingFaceToken(): string | undefined {
  return providerApiKey(PROVIDERS.huggingface);
}

export function getProviderAvailability(): ProviderAvailability {
  const availability = {} as ProviderAvailability;
  for (const id of PROVIDER_IDS) availability[id] = Boolean(providerApiKey(PROVIDERS[id]));
  return availability;
}

/**
 * The original three carry the app on their own; the rest are upgrades.
 * "Full stack" therefore still means the three the app needs, so an account
 * without the optional tiers is not reported as incomplete.
 */
const CORE_PROVIDERS: ProviderName[] = ["gemini", "groq", "huggingface"];

export function getProviderStackStatus() {
  const providers = getProviderAvailability();
  const core = CORE_PROVIDERS.filter((provider) => providers[provider]);
  const active = Object.values(providers).filter(Boolean).length;
  return {
    providers,
    active,
    total: CORE_PROVIDERS.length,
    fullStack: core.length === CORE_PROVIDERS.length,
    missing: CORE_PROVIDERS.filter((provider) => !providers[provider])
  };
}

/**
 * A minimal authenticated request per provider, for diagnosing credentials.
 *
 * Every provider refusing at once is a different problem from one refusing,
 * and the chat route cannot tell them apart — it reports whatever the last
 * attempt said. Listing models is the cheapest call that still proves the key
 * works and the host is reachable, and it costs no tokens.
 *
 * The key never leaves this module: the caller receives a prepared request, so
 * a diagnostic surface can report a status without ever holding a credential.
 */
export function providerProbes(): Array<{ provider: ProviderName; label: string; url: string; headers: Record<string, string> }> {
  const probes: Array<{ provider: ProviderName; label: string; url: string; headers: Record<string, string> }> = [];
  for (const id of PROVIDER_IDS) {
    const adapter = PROVIDERS[id];
    const key = providerApiKey(adapter);
    if (!key) continue;
    probes.push({ provider: id, label: adapter.label, url: adapter.modelsUrl, headers: { Authorization: `Bearer ${key}` } });
  }
  return probes;
}

/**
 * One factory for every provider, because every provider speaks the same
 * protocol. What differs is a base URL, a credential, and sometimes an
 * attribution header — all three of which are rows in the registry.
 */
export function createProviderModel(route: ProviderRoute, origin: string): any {
  const adapter: ProviderAdapter = PROVIDERS[route.provider];
  const apiKey = providerApiKey(adapter);
  /* Names the provider on purpose: this is a server log and a developer's
     first clue, and the chat route maps every failure to a generic message
     before it can reach anyone. */
  if (!apiKey) throw new Error(`A ${adapter.label} API credential is not configured.`);

  const provider = createOpenAICompatible({
    name: adapter.id,
    apiKey,
    baseURL: adapter.baseURL,
    includeUsage: true,
    ...(adapter.headers ? { headers: adapter.headers(origin) } : {})
  });
  return provider.chatModel(route.model);
}

const hfPolicy = process.env.HF_ROUTING_POLICY === "fastest" ? "fastest" : "cheapest";
const hf = (model: string, label: string, capability: ProviderRoute["capability"]): ProviderRoute => ({
  provider: "huggingface",
  model: `${model}:${hfPolicy}`,
  label,
  capability
});

export const ROUTES = {
  geminiVision: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    label: "Gemini",
    capability: "multimodal"
  },
  geminiSynthesis: {
    provider: "gemini",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    label: "Gemini",
    capability: "long-context"
  },
  groqReasoning: {
    provider: "groq",
    model: process.env.GROQ_REASONING_MODEL ?? "openai/gpt-oss-120b",
    label: "Groq reasoning",
    capability: "reasoning"
  },
  groqFast: {
    provider: "groq",
    model: process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b",
    label: "Groq fast",
    capability: "fast"
  },
  /* The route chosen when the request needs tools, so it has to be a model
     that accepts a `tools` array. Groq's `compound` systems do their own
     searching and reject one, which failed every tool-enabled request. */
  groqTools: {
    provider: "groq",
    model: process.env.GROQ_TOOL_MODEL ?? "openai/gpt-oss-120b",
    label: "Groq tools",
    capability: "tools"
  },
  /* Cerebras serves very large open weights at unusual speed, which makes it
     the best High-effort brain available on a free tier — the one place the
     app's ceiling actually moves. */
  cerebrasLarge: {
    provider: "cerebras",
    model: process.env.CEREBRAS_MODEL ?? "llama-3.3-70b",
    label: "Cerebras 70B",
    capability: "reasoning"
  },
  cerebrasFast: {
    provider: "cerebras",
    model: process.env.CEREBRAS_FAST_MODEL ?? "llama3.1-8b",
    label: "Cerebras fast",
    capability: "fast"
  },
  /* OpenRouter is breadth rather than depth: one key, many models, and the
     `:free` suffix keeps it on the free tier. */
  /**
   * The frontier escalation.
   *
   * Every other route here is a fast open-weight host, and no amount of
   * prompting turns one of those into a frontier model — the ceiling on answer
   * quality is set by which model answers, not by how much it is told. This is
   * the one route that raises the ceiling rather than using it better.
   *
   * OpenRouter because it is the one configured provider that can reach a
   * frontier model at all, and because the model is a plain string: the
   * deployment names what it wants in `NAVI_FRONTIER_MODEL` and can change it
   * the day something better ships, without a code change.
   *
   * Deliberately unset by default. This is the only route in the table that
   * can cost real money per request, so it stays absent until someone names a
   * model — an app that silently starts billing because it was upgraded is a
   * worse failure than one that answers slightly less well.
   */
  openRouterFrontier: {
    provider: "openrouter",
    model: process.env.NAVI_FRONTIER_MODEL ?? "",
    label: "Navi Soul frontier",
    capability: "reasoning"
  },
  openRouterReasoning: {
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-r1:free",
    label: "OpenRouter reasoning",
    capability: "reasoning"
  },
  openRouterCoding: {
    provider: "openrouter",
    model: process.env.OPENROUTER_CODE_MODEL ?? "qwen/qwen-2.5-coder-32b-instruct:free",
    label: "OpenRouter coding",
    capability: "coding"
  },
  /**
   * The metered quality lane.
   *
   * The provider's `deepseek-chat` and `deepseek-reasoner` aliases are
   * deprecated and point at whatever the vendor decides they point at, which is
   * exactly how a model id turns into a surprise. These name the model
   * explicitly, and an operator can still repoint them without a deploy.
   */
  deepseekFlash: {
    provider: "deepseek",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    label: "Navi Soul quality",
    capability: "reasoning"
  },
  deepseekPro: {
    provider: "deepseek",
    model: process.env.DEEPSEEK_PRO_MODEL ?? "deepseek-v4-pro",
    label: "Navi Soul quality",
    capability: "reasoning"
  },
  mistralBalanced: {
    provider: "mistral",
    model: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
    label: "Mistral Large",
    capability: "balanced"
  },

  hfGptOss: hf("openai/gpt-oss-120b", "HF GPT-OSS 120B", "reasoning"),
  hfDeepSeek: hf("deepseek-ai/DeepSeek-V3.2", "HF DeepSeek V3.2", "reasoning"),
  hfGlm: hf("zai-org/GLM-5.2", "HF GLM 5.2", "long-context"),
  hfQwen: hf("Qwen/Qwen3.6-35B-A3B", "HF Qwen 3.6", "multimodal"),
  hfKimi: hf("moonshotai/Kimi-K2.6", "HF Kimi K2.6", "coding"),
  hfMiniMax: hf("MiniMaxAI/MiniMax-M2.7", "HF MiniMax M2.7", "balanced"),

  /* Long-established weights kept as the tail of the pool. Leading-edge model
     ids are renamed or retired often; a council whose whole pool 404s produces
     nothing, so these broaden capability coverage and act as the fallback. */
  hfDeepSeekR1: hf("deepseek-ai/DeepSeek-R1", "HF DeepSeek R1", "reasoning"),
  hfLlama70b: hf("meta-llama/Llama-3.3-70B-Instruct", "HF Llama 3.3 70B", "balanced"),
  hfQwenCoder: hf("Qwen/Qwen2.5-Coder-32B-Instruct", "HF Qwen2.5 Coder 32B", "coding"),
  hfQwen72b: hf("Qwen/Qwen2.5-72B-Instruct", "HF Qwen2.5 72B", "long-context"),
  hfMistralSmall: hf("mistralai/Mistral-Small-24B-Instruct-2501", "HF Mistral Small 24B", "fast"),
  hfGptOssFast: hf("openai/gpt-oss-20b", "HF GPT-OSS 20B", "fast"),

  /* The added free tiers. Model ids are overridable so an operator can follow
     a provider's catalogue without waiting for a deploy. */
  togetherReasoning: {
    provider: "together",
    model: process.env.TOGETHER_MODEL ?? "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
    label: "Together reasoning",
    capability: "reasoning"
  },
  nvidiaReasoning: {
    provider: "nvidia",
    model: process.env.NVIDIA_MODEL ?? "deepseek-ai/deepseek-r1",
    label: "NVIDIA reasoning",
    capability: "reasoning"
  },
  sambanovaFast: {
    provider: "sambanova",
    model: process.env.SAMBANOVA_MODEL ?? "Meta-Llama-3.3-70B-Instruct",
    label: "SambaNova fast",
    capability: "fast"
  }
} satisfies Record<string, ProviderRoute>;

/**
 * Models that reject a `tools` parameter even though their provider accepts
 * one. Groq's compound systems are agentic in their own right — they search
 * and run code internally — and answer an incoming tools array with a hard
 * `tool calling is not supported with this model`, failing the whole request.
 *
 * Matched on the model id rather than the route name so an operator pointing
 * GROQ_TOOL_MODEL at one of them degrades to no-tools instead of to an error.
 */
const TOOL_INCAPABLE_MODELS = [/^groq\/compound/i];

export function routeToolCallingSupport(route: ProviderRoute): ToolCallingSupport {
  /* The provider sets the ceiling; the model still has the final say. */
  if (!PROVIDERS[route.provider].supportsTools) return "none";
  if (TOOL_INCAPABLE_MODELS.some((pattern) => pattern.test(route.model))) return "none";
  return "custom";
}

function configuredHfRoutes(): ProviderRoute[] {
  const custom = process.env.HF_SWARM_MODELS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((model, index) => hf(model, `Navi Soul · analysis ${index + 1}`, "balanced"));
  if (custom?.length) return custom;

  /* Capability-ordered so a council of any size still spans reasoning,
     coding, long context, multimodal, and fast routes rather than stacking
     several models with the same strengths. */
  return [
    ROUTES.hfGptOss,
    ROUTES.hfDeepSeek,
    ROUTES.hfGlm,
    ROUTES.hfKimi,
    ROUTES.hfQwen,
    ROUTES.hfMiniMax,
    ROUTES.hfDeepSeekR1,
    ROUTES.hfQwenCoder,
    ROUTES.hfQwen72b,
    ROUTES.hfLlama70b,
    ROUTES.hfMistralSmall,
    ROUTES.hfGptOssFast
  ];
}

export function availableSwarmRoutes(availability: ProviderAvailability, tools: ToolPolicy): ProviderRoute[] {
  const hfRoutes = availability.huggingface ? configuredHfRoutes() : [];
  const routes: ProviderRoute[] = [];

  /* A council is only as good as the spread of models in it, so the strongest
     optional routes are interleaved near the front rather than appended. */
  if (availability.cerebras) routes.push(ROUTES.cerebrasLarge);
  if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
  if (hfRoutes[0]) routes.push(hfRoutes[0]);
  if (availability.openrouter) routes.push(ROUTES.openRouterReasoning);
  if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
  if (hfRoutes[1]) routes.push(hfRoutes[1]);
  if (availability.together) routes.push(ROUTES.togetherReasoning);
  if (availability.mistral) routes.push(ROUTES.mistralBalanced);
  if (availability.nvidia) routes.push(ROUTES.nvidiaReasoning);
  if (availability.groq) routes.push(ROUTES.groqFast);
  if (availability.openrouter) routes.push(ROUTES.openRouterCoding);
  if (hfRoutes[2]) routes.push(hfRoutes[2]);
  if (availability.sambanova) routes.push(ROUTES.sambanovaFast);
  if (availability.cerebras) routes.push(ROUTES.cerebrasFast);
  routes.push(...hfRoutes.slice(3));
  return routes;
}

/**
 * Lane selection: which tier of engine a request deserves.
 *
 * Lane 3 is the only rationed one, so it is the only lane that has to earn its
 * turn. It is spent on requests where a stronger model changes the answer —
 * high effort, or genuinely hard code — and never on a follow-up that a fast
 * route answers just as well.
 */
export type Lane = 1 | 2 | 3 | 4;

/**
 * Whether this deployment has named a frontier model to escalate to.
 *
 * A separate predicate rather than a truthiness check at each call site,
 * because "is escalation available" is a question three different places ask —
 * the router, the diagnostics, and the settings screen — and they must not
 * drift apart in what they consider configured.
 */
/**
 * What *kind* of work this is, as distinct from how hard it is.
 *
 * The lane table routes by difficulty, which is the right axis for most
 * decisions and the wrong one for a few. Hard-and-mathematical,
 * hard-and-mechanical and hard-and-open-ended want different machines, and
 * "lane 3" cannot express that: it sends everything difficult to the same
 * place. The clearest waste is mechanical work arriving at high effort —
 * reshaping text, extracting fields, converting a format — where reasoning
 * depth buys nothing and tokens per second is the entire experience. Under the
 * old table that request could reach the frontier route and be billed for
 * thinking about a transformation that has one right answer.
 *
 * Deliberately narrow. Only shapes that are unmistakably mechanical are
 * classified; everything else returns null and the lane decides as before. A
 * misclassification here sends real reasoning work to a fast shallow model,
 * which is a far worse outcome than missing an optimisation — so the patterns
 * are anchored to an explicit instruction verb, the same discipline the prose
 * routes use.
 */
export type TaskKind = "mechanical";

const MECHANICAL = /^\s*(?:please\s+)?(?:re)?(?:format|indent|minify|prettify|escape|unescape|encode|decode|transliterate|capitali[sz]e|lowercase|uppercase|slugify|sort|dedupe|de-duplicate|deduplicate|reverse|transpose|rename|renumber)\b/i;
const CONVERSION = /^\s*(?:please\s+)?convert\s+(?:this\s+)?\S+\s+(?:to|into)\s+\S+/i;

export function classifyTask(request: string | undefined): TaskKind | null {
  if (!request) return null;
  const text = request.trim();
  /* A long message that opens with "format" is usually a paste to transform;
     a short one may still be a question about formatting. Both are handled by
     requiring the verb to lead, which a question almost never does. */
  if (MECHANICAL.test(text) || CONVERSION.test(text)) return "mechanical";
  return null;
}

export function frontierConfigured(): boolean {
  return Boolean((process.env.NAVI_FRONTIER_MODEL ?? "").trim());
}

export function selectLane(options: {
  mode: "chat" | "code";
  effort: "low" | "medium" | "high";
  complex: boolean;
  hasFiles: boolean;
  longContext: boolean;
}): Lane {
  const { mode, effort, complex, hasFiles, longContext } = options;
  // Attachments need the multimodal route regardless of how hard the ask is.
  if (hasFiles) return 2;
  // Whole-repository reading is a context problem, not a reasoning one.
  if (longContext) return 4;
  if (effort === "high") return 3;
  if (mode === "code") return complex ? 3 : 4;
  if (effort === "low") return 1;
  return complex ? 3 : 2;
}

/**
 * The route a lane resolves to, or null when nothing configured can serve it.
 *
 * Null is the useful answer here: the caller falls back to the general route
 * selector, so a lane with no provider degrades to the old behaviour instead of
 * failing. Lanes describe *intent* — how much engine this request deserves —
 * and the general selector remains the authority on hard constraints like
 * attachments, pinned diagnostic routes, and tool support.
 *
 * Lane 0 (the local skills) never reaches here: it is answered on-device with
 * no model and no network, which is the whole point of it.
 */
export function routeForLane(options: {
  lane: Lane;
  availability: ProviderAvailability;
  tools: ToolPolicy;
  hasFiles: boolean;
  /** The best free coding model discovery found, if the cache was warm. */
  discovered?: ProviderRoute | null;
  /**
   * Whether the metered lane may spend right now. Resolved by the caller from
   * the spend ledger, because this function is synchronous and reading a
   * budget is not — and because a routing table is the wrong place to decide
   * whether the account can afford something.
   */
  meteredAllowed?: boolean;
  /** What kind of work this is, when it is unmistakable. See `classifyTask`. */
  taskKind?: TaskKind | null;
}): ProviderRoute | null {
  const { lane, availability, tools, hasFiles, discovered, meteredAllowed, taskKind } = options;

  /* Mechanical work takes the fastest capable model, whatever the lane thought.
     This sits with the capability checks rather than inside the lane switch
     because it is the same kind of rule: a property of the work that outranks
     how difficult the request looked. Reasoning depth cannot improve a
     transformation with one right answer; it can only cost latency and, on the
     metered lane, money. */
  if (taskKind === "mechanical" && !hasFiles) {
    if (availability.groq) return ROUTES.groqFast;
    if (availability.cerebras) return ROUTES.cerebrasFast;
  }

  /* A request that needs tools needs a model that accepts them, whatever the
     lane would have preferred. Capability beats tier. */
  if (tools.web || tools.code) {
    if (availability.groq) return ROUTES.groqTools;
    if (availability.gemini) return ROUTES.geminiSynthesis;
    if (availability.cerebras) return ROUTES.cerebrasLarge;
  }

  if (hasFiles) return availability.gemini ? ROUTES.geminiVision : availability.huggingface ? ROUTES.hfQwen : null;

  if (lane === 1) {
    if (availability.groq) return ROUTES.groqFast;
    if (availability.cerebras) return ROUTES.cerebrasFast;
    return null;
  }

  if (lane === 2) {
    if (availability.gemini) return ROUTES.geminiSynthesis;
    if (availability.mistral) return ROUTES.mistralBalanced;
    return null;
  }

  /* Lane 3 is the only lane that may spend, and only when the ledger says so.
     When the budget is exhausted it falls through to the free routes below
     without a word — the user asked for a good answer, not for a lecture about
     billing, and the free routes still give them one. */
  if (lane === 3) {
    /* Frontier first, when there is one and the ledger allows it.
       Lane 3 is where "this is hard" lands — high effort, or complex work in
       either mode — so it is the only lane worth spending frontier money on.
       Everything below is unchanged and still the answer when no frontier
       model is named or the budget is spent: the request degrades to a good
       free answer rather than to an apology. */
    if (frontierConfigured() && availability.openrouter && meteredAllowed) return ROUTES.openRouterFrontier;
    if (availability.deepseek && meteredAllowed) return ROUTES.deepseekFlash;
    if (availability.cerebras) return ROUTES.cerebrasLarge;
    if (availability.openrouter) return ROUTES.openRouterReasoning;
    if (availability.huggingface) return ROUTES.hfGptOss;
    if (availability.groq) return ROUTES.groqReasoning;
    return null;
  }

  /* Lane 4 is the one discovery serves: whole-repository reads want the best
     free coding model currently offered, not the best one offered whenever
     this list was last edited. */
  if (discovered && availability.openrouter) return discovered;
  if (availability.openrouter) return ROUTES.openRouterCoding;
  if (availability.huggingface) return ROUTES.hfKimi;
  if (availability.cerebras) return ROUTES.cerebrasLarge;
  return null;
}

export function selectDirectRoute(options: {
  preset: ModelPreset;
  availability: ProviderAvailability;
  hasFiles: boolean;
  tools: ToolPolicy;
  complex: boolean;
}): ProviderRoute {
  const { preset, availability, hasFiles, tools, complex } = options;

  if (hasFiles) {
    if (availability.gemini) return ROUTES.geminiVision;
    if (availability.huggingface) return ROUTES.hfQwen;
    throw new Error("File and image input requires Gemini or a Hugging Face vision route.");
  }

  /* Code mode prefers models that lead code benchmarks over generalists.
     Effort (arriving here as `complex`) decides between the strongest coding
     route and the everyday one; tool use still needs a tool-capable provider. */
  if (preset === "navi-code") {
    if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;
    if (complex && availability.openrouter) return ROUTES.openRouterCoding;
    if (complex && availability.cerebras) return ROUTES.cerebrasLarge;
    if (availability.huggingface) return complex ? ROUTES.hfDeepSeek : ROUTES.hfKimi;
    if (availability.cerebras) return ROUTES.cerebrasFast;
    if (availability.groq) return complex ? ROUTES.groqReasoning : ROUTES.groqFast;
    if (availability.gemini) return ROUTES.geminiSynthesis;
    throw new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in your Vercel project settings, then redeploy.");
  }

  if (preset === "huggingface-direct") {
    if (!availability.huggingface) throw new Error("Hugging Face is not configured. Add HF_TOKEN in Vercel, or pick a different model.");
    return complex ? ROUTES.hfGptOss : ROUTES.hfQwen;
  }
  if (preset === "gemini-direct") {
    if (!availability.gemini) throw new Error("Gemini is not configured. Add GEMINI_API_KEY in Vercel, or pick a different model.");
    return ROUTES.geminiSynthesis;
  }
  if (preset === "groq-direct") {
    if (!availability.groq) throw new Error("Groq is not configured. Add GROQ_API_KEY in Vercel, or pick a different model.");
    return tools.web || tools.code ? ROUTES.groqTools : complex ? ROUTES.groqReasoning : ROUTES.groqFast;
  }

  if ((tools.web || tools.code) && availability.groq) return ROUTES.groqTools;
  /* High effort promises the strongest brain available. Cerebras leads that
     order because it serves the largest weights on a free tier fast enough to
     stay inside the request budget. */
  if (complex && availability.cerebras) return ROUTES.cerebrasLarge;
  if (complex && availability.openrouter) return ROUTES.openRouterReasoning;
  if (complex && availability.huggingface) return ROUTES.hfGptOss;
  if (complex && availability.groq) return ROUTES.groqReasoning;
  if (complex && availability.mistral) return ROUTES.mistralBalanced;
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (availability.huggingface) return ROUTES.hfQwen;
  if (availability.cerebras) return ROUTES.cerebrasFast;
  if (availability.groq) return ROUTES.groqFast;
  if (availability.mistral) return ROUTES.mistralBalanced;
  if (availability.openrouter) return ROUTES.openRouterReasoning;
  throw new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or HF_TOKEN in your Vercel project settings, then redeploy.");
}

/**
 * Alternates to try when the chosen route fails outright.
 *
 * A provider returning 403 — a key with referrer or IP restrictions, a
 * disabled API, a revoked token — took the whole app down while four other
 * configured providers sat idle. Selecting one route and betting the request
 * on it is the wrong shape for a system whose whole premise is several free
 * tiers.
 *
 * Ordered to change provider first: retrying a different model on the same
 * provider repeats whatever went wrong at the account level, which is where
 * these failures actually live.
 */
export function fallbackRoutes(options: {
  primary: ProviderRoute;
  availability: ProviderAvailability;
  complex: boolean;
}): ProviderRoute[] {
  const { primary, availability, complex } = options;
  const candidates: ProviderRoute[] = [];
  if (availability.gemini) candidates.push(ROUTES.geminiSynthesis);
  if (availability.groq) candidates.push(complex ? ROUTES.groqReasoning : ROUTES.groqFast);
  if (availability.cerebras) candidates.push(complex ? ROUTES.cerebrasLarge : ROUTES.cerebrasFast);
  if (availability.mistral) candidates.push(ROUTES.mistralBalanced);
  if (availability.openrouter) candidates.push(ROUTES.openRouterReasoning);
  if (availability.together) candidates.push(ROUTES.togetherReasoning);
  if (availability.nvidia) candidates.push(ROUTES.nvidiaReasoning);
  if (availability.sambanova) candidates.push(ROUTES.sambanovaFast);
  if (availability.huggingface) candidates.push(complex ? ROUTES.hfGptOss : ROUTES.hfQwen);

  const seen = new Set<ProviderName>([primary.provider]);
  const ordered: ProviderRoute[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.provider)) continue;
    seen.add(candidate.provider);
    ordered.push(candidate);
  }
  // Two alternates is enough: a third costs more latency than it recovers.
  return ordered.slice(0, 2);
}

/**
 * The route that answers when nothing else did.
 *
 * The cascade had no floor. A request that failed on every configured provider
 * — Groq refusing it for size, Gemini rate-limited, a dead Cerebras key —
 * ended at "Navi Soul has no working credential to answer with", which is both
 * unhelpful and untrue: a frontier model was configured and reachable the whole
 * time. Returning nothing is the one outcome worse than an expensive answer.
 *
 * Deliberately *not* gated on the spend ledger, and that is the one place in
 * this file where the budget is overruled. The ledger's job is to stop routine
 * escalation from quietly running up a bill, and it still does — `routeForLane`
 * checks it before every lane 3 call. This is not routine: by the time it runs,
 * every free route has already failed and the alternative is an app that cannot
 * answer at all. The owner named this model in `NAVI_FRONTIER_MODEL`, so the
 * charge is one they chose, not one the app invented.
 *
 * Null when no model is named, which is the default. An empty model id sent to
 * a provider fails for a reason nobody can read, so an unconfigured frontier
 * stays unreachable rather than becoming a confusing last request.
 */
export function lastResortRoute(availability: ProviderAvailability): ProviderRoute | null {
  if (!frontierConfigured() || !availability.openrouter) return null;
  return ROUTES.openRouterFrontier;
}

export function selectSynthesisRoute(availability: ProviderAvailability, profile: "navi-5" | "navi-soul-direct-5-6"): ProviderRoute {
  if (availability.gemini) return ROUTES.geminiSynthesis;
  if (profile === "navi-soul-direct-5-6" && availability.huggingface) return ROUTES.hfGptOss;
  if (profile === "navi-5" && availability.huggingface) return ROUTES.hfGlm;
  // Synthesis reads every specialist answer, so it wants headroom.
  if (availability.cerebras) return ROUTES.cerebrasLarge;
  if (availability.openrouter) return ROUTES.openRouterReasoning;
  if (availability.groq) return ROUTES.groqReasoning;
  if (availability.mistral) return ROUTES.mistralBalanced;
  throw new Error("No synthesis provider is configured.");
}

export function selectVerificationRoute(
  availability: ProviderAvailability,
  synthesisProvider: ProviderName,
  profile: "navi-5" | "navi-soul-direct-5-6"
): ProviderRoute {
  if (synthesisProvider !== "groq" && availability.groq) return ROUTES.groqReasoning;
  if (synthesisProvider !== "huggingface" && availability.huggingface) {
    return profile === "navi-soul-direct-5-6" ? ROUTES.hfDeepSeek : ROUTES.hfGptOss;
  }
  if (synthesisProvider !== "gemini" && availability.gemini) return ROUTES.geminiSynthesis;
  // A checker that shares the writer's provider shares its blind spots.
  if (synthesisProvider !== "cerebras" && availability.cerebras) return ROUTES.cerebrasLarge;
  if (synthesisProvider !== "openrouter" && availability.openrouter) return ROUTES.openRouterReasoning;
  if (synthesisProvider !== "mistral" && availability.mistral) return ROUTES.mistralBalanced;
  if (availability.huggingface) return ROUTES.hfGptOss;
  if (availability.groq) return ROUTES.groqReasoning;
  return ROUTES.geminiSynthesis;
}
