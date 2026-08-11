import { numberEnvironment, timeoutSignal } from "./catalog";
import type { ProviderAvailability } from "./providers";
import { getHuggingFaceToken, ROUTES } from "./providers";
import type { ProviderRoute, ToolPolicy } from "./types";

export type SwarmProfile = "navi-fable" | "navi-sol";
export type SwarmEffort = "normal" | "complex" | "extreme";
export type SwarmTask =
  | "coding"
  | "research"
  | "quantitative"
  | "design"
  | "documents"
  | "security"
  | "planning"
  | "general";

type RouterModel = {
  id: string;
  metadata: string;
  contextLength: number;
  toolCapable: boolean;
  structured: boolean;
};

export type SwarmRoutePlan = {
  profile: SwarmProfile;
  task: SwarmTask;
  routes: ProviderRoute[];
  synthesisRoutes: ProviderRoute[];
  verificationRoute: ProviderRoute;
  catalogSize: number;
  selectedHuggingFaceModels: number;
  maxConcurrentCouncils: number;
};

type CatalogCache = {
  expiresAt: number;
  models: RouterModel[];
};

const globalCatalogState = globalThis as typeof globalThis & {
  __naviHfRouterCatalog?: CatalogCache;
};

const FALLBACK_MODELS = [
  "deepseek-ai/DeepSeek-V4-Pro",
  "zai-org/GLM-5.2",
  "openai/gpt-oss-120b",
  "Qwen/Qwen3-Coder-480B-A35B-Instruct",
  "deepseek-ai/DeepSeek-V3.2",
  "Qwen/Qwen3.6-35B-A3B",
  "moonshotai/Kimi-K2.6",
  "MiniMaxAI/MiniMax-M2.7",
  "thinkingmachines/Inkling"
] as const;

const TASK_TERMS: Record<SwarmTask, RegExp> = {
  coding: /\b(code|coding|repository|repo|typescript|javascript|react|next\.?js|python|sql|api|debug|refactor|migration|implementation|test|deploy|github|vercel)\b/i,
  research: /\b(research|sources?|evidence|compare|market|report|investigate|audit|literature|citation|verify|current|latest)\b/i,
  quantitative: /\b(math|calculate|quantitative|statistics?|probability|finance|equation|proof|physics|science|benchmark|dataset|forecast)\b/i,
  design: /\b(design|ui|ux|visual|layout|brand|typography|image|screenshot|pixel|responsive|accessibility|animation|css)\b/i,
  documents: /\b(pdf|document|spreadsheet|table|chart|diagram|contract|policy|memo|presentation|slides|report)\b/i,
  security: /\b(security|vulnerability|threat|attack|exploit|csp|authentication|authorization|privacy|encryption|xss|csrf)\b/i,
  planning: /\b(plan|project|roadmap|strategy|workflow|multi-step|long-running|schedule|architecture|requirements|prd)\b/i,
  general: /.*/
};

const PROFILE_TERMS: Record<SwarmProfile, Array<[RegExp, number]>> = {
  "navi-sol": [
    [/deepseek|gpt-oss|glm|qwen|kimi|minimax|inkling|reason|r1|math|science|coder|vl|vision/i, 8],
    [/70b|72b|120b|235b|400b|480b|671b|a35b/i, 5],
    [/instruct|chat|thinking|agent/i, 2]
  ],
  "navi-fable": [
    [/coder|code|devstral|qwen|glm|kimi|deepseek|gpt-oss|minimax|agent|long|vision|vl|document/i, 8],
    [/70b|72b|120b|235b|400b|480b|671b|a35b/i, 5],
    [/instruct|chat|thinking|tool/i, 2]
  ]
};

const TASK_MODEL_TERMS: Record<SwarmTask, Array<[RegExp, number]>> = {
  coding: [[/coder|code|devstral|qwen|kimi|deepseek|gpt-oss|glm/i, 9]],
  research: [[/deepseek|glm|gpt-oss|qwen|command|inkling|kimi/i, 7]],
  quantitative: [[/reason|r1|deepseek|qwen|math|gpt-oss|glm/i, 9]],
  design: [[/vision|vl|qwen|gemma|llama|glm|kimi/i, 8]],
  documents: [[/vision|vl|qwen|gemma|llama|glm|command/i, 8]],
  security: [[/deepseek|gpt-oss|qwen|glm|coder/i, 8]],
  planning: [[/glm|kimi|minimax|deepseek|gpt-oss|qwen|inkling/i, 8]],
  general: [[/deepseek|gpt-oss|glm|qwen|kimi|minimax|inkling/i, 6]]
};

function routingPolicy(profile: SwarmProfile): "fastest" | "cheapest" | "preferred" {
  const specific = profile === "navi-sol" ? process.env.HF_SOL_ROUTING_POLICY : process.env.HF_FABLE_ROUTING_POLICY;
  const shared = process.env.HF_ROUTING_POLICY;
  const value = specific ?? shared;
  return value === "cheapest" || value === "preferred" || value === "fastest"
    ? value
    : profile === "navi-sol"
      ? "fastest"
      : "preferred";
}

function hfRoute(model: string, profile: SwarmProfile, index: number): ProviderRoute {
  return {
    provider: "huggingface",
    model: `${model}:${routingPolicy(profile)}`,
    /* Surfaces in the status stream, so it carries the product name and
       never a provider or a retired brand. */
    label: `Navi Soul · analysis ${index + 1}`,
    capability: "balanced"
  };
}

function numericMetadata(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeRouterModel(value: unknown): RouterModel | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.includes("/")) return null;
  const metadata = JSON.stringify(record).toLowerCase();
  if (/embedding|rerank|image-generation|text-to-image|speech|audio|video/.test(metadata)) return null;
  const contextLength = numericMetadata(record, ["context_length", "contextLength", "max_model_len", "maxModelLength"]);
  return {
    id: record.id,
    metadata,
    contextLength,
    toolCapable: /tool|function.call|function_call/.test(metadata),
    structured: /structured|json.schema|json_schema/.test(metadata)
  };
}

async function discoverRouterModels(signal: AbortSignal): Promise<RouterModel[]> {
  const cached = globalCatalogState.__naviHfRouterCatalog;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const token = getHuggingFaceToken();
  const fallback = FALLBACK_MODELS.map((id) => ({ id, metadata: id.toLowerCase(), contextLength: 0, toolCapable: false, structured: false }));
  if (!token) return fallback;

  const timed = timeoutSignal(signal, 4_500, "Hugging Face model discovery timed out.");
  try {
    const response = await fetch("https://router.huggingface.co/v1/models", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: timed.signal
    });
    if (!response.ok) throw new Error(`Hugging Face model catalog returned ${response.status}.`);
    const body = await response.json() as { data?: unknown[] };
    const models = Array.isArray(body.data)
      ? body.data.map(normalizeRouterModel).filter((model): model is RouterModel => Boolean(model))
      : [];
    const catalog = models.length ? models : fallback;
    globalCatalogState.__naviHfRouterCatalog = {
      models: catalog,
      expiresAt: Date.now() + numberEnvironment("HF_MODEL_CATALOG_TTL_MS", 15 * 60_000, 60_000, 60 * 60_000)
    };
    return catalog;
  } catch (error) {
    console.warn("Navi could not refresh the Hugging Face model catalog:", error);
    return cached?.models.length ? cached.models : fallback;
  } finally {
    timed.dispose();
  }
}

export function classifySwarmTask(text: string): SwarmTask {
  const ordered: SwarmTask[] = ["security", "coding", "quantitative", "documents", "design", "research", "planning"];
  return ordered.find((task) => TASK_TERMS[task].test(text)) ?? "general";
}

function configuredModels(profile: SwarmProfile): string[] {
  const value = profile === "navi-sol" ? process.env.HF_SOL_MODELS : process.env.HF_FABLE_MODELS;
  return value
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .slice(0, 64) ?? [];
}

function modelScore(model: RouterModel, profile: SwarmProfile, task: SwarmTask, tools: ToolPolicy): number {
  let score = 0;
  for (const [pattern, points] of PROFILE_TERMS[profile]) if (pattern.test(model.metadata)) score += points;
  for (const [pattern, points] of TASK_MODEL_TERMS[task]) if (pattern.test(model.metadata)) score += points;
  if (model.contextLength >= 1_000_000) score += profile === "navi-fable" ? 8 : 5;
  else if (model.contextLength >= 250_000) score += 4;
  else if (model.contextLength >= 100_000) score += 2;
  if ((tools.code || tools.web) && model.toolCapable) score += 5;
  if (model.structured) score += 2;
  if (/\b(?:0\.5b|1b|1\.5b|2b|3b|4b|7b|8b|9b|12b|14b)\b/i.test(model.id)) score -= 10;
  if (/preview|experimental|demo|test/i.test(model.id)) score -= 2;
  return score;
}

function organization(modelId: string): string {
  return modelId.split("/")[0]?.toLowerCase() || modelId.toLowerCase();
}

function selectDiverseModels(models: RouterModel[], profile: SwarmProfile, task: SwarmTask, tools: ToolPolicy, count: number): string[] {
  const configured = configuredModels(profile);
  const availableIds = new Set(models.map((model) => model.id));
  const selected: string[] = [];
  const organizationCounts = new Map<string, number>();

  for (const model of configured) {
    if (availableIds.has(model) && !selected.includes(model)) selected.push(model);
    if (selected.length >= count) return selected;
  }

  const ranked = [...models].sort((left, right) => modelScore(right, profile, task, tools) - modelScore(left, profile, task, tools));
  for (const model of ranked) {
    if (modelScore(model, profile, task, tools) <= 0 || selected.includes(model.id)) continue;
    const owner = organization(model.id);
    if ((organizationCounts.get(owner) ?? 0) >= 2) continue;
    selected.push(model.id);
    organizationCounts.set(owner, (organizationCounts.get(owner) ?? 0) + 1);
    if (selected.length >= count) break;
  }

  for (const fallback of FALLBACK_MODELS) {
    if (!selected.includes(fallback)) selected.push(fallback);
    if (selected.length >= count) break;
  }
  return selected.slice(0, count);
}

function desiredCouncils(profile: SwarmProfile, effort: SwarmEffort): number {
  const base = profile === "navi-sol"
    ? effort === "extreme" ? 10 : effort === "complex" ? 8 : 5
    : effort === "extreme" ? 8 : effort === "complex" ? 6 : 4;
  const key = profile === "navi-sol" ? "NAVI_SOL_MAX_COUNCILS" : "NAVI_FABLE_MAX_COUNCILS";
  return Math.min(base, numberEnvironment(key, profile === "navi-sol" ? 10 : 8, 3, 14));
}

function uniqueRoutes(routes: ProviderRoute[]): ProviderRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.provider}:${route.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chooseSynthesisRoutes(profile: SwarmProfile, availability: ProviderAvailability, hfRoutes: ProviderRoute[]): ProviderRoute[] {
  if (profile === "navi-fable") {
    if (availability.gemini) return [ROUTES.geminiSynthesis];
    if (hfRoutes[0]) return [hfRoutes[0]];
    return [ROUTES.groqReasoning];
  }

  const candidates: ProviderRoute[] = [];
  if (availability.gemini) candidates.push(ROUTES.geminiSynthesis);
  if (hfRoutes[0]) candidates.push(hfRoutes[0]);
  if (availability.groq) candidates.push(ROUTES.groqReasoning);
  return uniqueRoutes(candidates).slice(0, 2);
}

function chooseVerificationRoute(profile: SwarmProfile, availability: ProviderAvailability, hfRoutes: ProviderRoute[], synthesisRoutes: ProviderRoute[]): ProviderRoute {
  const synthesisProviders = new Set(synthesisRoutes.map((route) => route.provider));
  if (availability.groq && !synthesisProviders.has("groq")) return ROUTES.groqReasoning;
  if (hfRoutes[1] && !synthesisRoutes.some((route) => route.model === hfRoutes[1].model)) return hfRoutes[1];
  if (availability.gemini && !synthesisProviders.has("gemini")) return ROUTES.geminiSynthesis;
  if (availability.groq) return ROUTES.groqReasoning;
  if (hfRoutes[0]) return hfRoutes[0];
  return profile === "navi-sol" ? ROUTES.geminiSynthesis : ROUTES.geminiSynthesis;
}

export async function buildSwarmRoutePlan(options: {
  profile: SwarmProfile;
  prompt: string;
  effort: SwarmEffort;
  availability: ProviderAvailability;
  tools: ToolPolicy;
  abortSignal: AbortSignal;
}): Promise<SwarmRoutePlan> {
  const { profile, prompt, effort, availability, tools, abortSignal } = options;
  const task = classifySwarmTask(prompt);
  const maxConcurrentCouncils = desiredCouncils(profile, effort);
  const catalog = availability.huggingface ? await discoverRouterModels(abortSignal) : [];
  const baseRouteCount = Number(availability.gemini) + Number(availability.groq);
  const desiredHfModels = availability.huggingface ? Math.max(2, maxConcurrentCouncils - baseRouteCount) : 0;
  const selectedModels = selectDiverseModels(catalog, profile, task, tools, desiredHfModels);
  const hfRoutes = selectedModels.map((model, index) => hfRoute(model, profile, index));

  const routes: ProviderRoute[] = [];
  if (profile === "navi-sol") {
    if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
    if (hfRoutes[0]) routes.push(hfRoutes[0]);
    if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
    routes.push(...hfRoutes.slice(1));
    if (availability.groq) routes.push(ROUTES.groqFast);
  } else {
    if (hfRoutes[0]) routes.push(hfRoutes[0]);
    if (availability.gemini) routes.push(ROUTES.geminiSynthesis);
    if (hfRoutes[1]) routes.push(hfRoutes[1]);
    if (availability.groq) routes.push(tools.web || tools.code ? ROUTES.groqTools : ROUTES.groqReasoning);
    routes.push(...hfRoutes.slice(2));
  }

  const councilRoutes = uniqueRoutes(routes).slice(0, maxConcurrentCouncils);
  if (!councilRoutes.length) throw new Error("No Gemini, Groq, or Hugging Face route is available for this Navi swarm.");
  const synthesisRoutes = chooseSynthesisRoutes(profile, availability, hfRoutes);
  const verificationRoute = chooseVerificationRoute(profile, availability, hfRoutes, synthesisRoutes);

  return {
    profile,
    task,
    routes: councilRoutes,
    synthesisRoutes,
    verificationRoute,
    catalogSize: catalog.length,
    selectedHuggingFaceModels: hfRoutes.length,
    maxConcurrentCouncils
  };
}

export async function getSwarmCatalogStatus(signal: AbortSignal): Promise<{
  dynamicCatalog: boolean;
  routerModels: number;
  fableCatalogCandidates: number;
  solCatalogCandidates: number;
}> {
  const token = getHuggingFaceToken();
  if (!token) return { dynamicCatalog: false, routerModels: 0, fableCatalogCandidates: 0, solCatalogCandidates: 0 };
  const models = await discoverRouterModels(signal);
  const neutralTools: ToolPolicy = { web: false, code: false, artifacts: true };
  return {
    dynamicCatalog: true,
    routerModels: models.length,
    fableCatalogCandidates: models.filter((model) => modelScore(model, "navi-fable", "general", neutralTools) > 0).length,
    solCatalogCandidates: models.filter((model) => modelScore(model, "navi-sol", "general", neutralTools) > 0).length
  };
}
