import { LocalProcessor } from './local-processor.js';
import { injectNaviSoulContext } from './knowledge-base.js';

export async function processWithNaviSoul(userQuery, externalAIHandler) {
    if (LocalProcessor.isSystemCommand(userQuery)) {
        return LocalProcessor.executeSystemCommand(userQuery).response;
    }
    
    if (LocalProcessor.isBasicMath(userQuery)) {
        const mathResult = LocalProcessor.calculate(userQuery);
        if (mathResult.handledLocally) return mathResult.response;
    }

    const enrichedPrompt = injectNaviSoulContext(userQuery);

    try {
        const aiResponse = await externalAIHandler(enrichedPrompt);
        return aiResponse;
    } catch (error) {
        console.error("NaviSoul routing error:", error);
        return "NaviSoul encountered a routing error communicating with the external model.";
    }
}
