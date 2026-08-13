export class LocalProcessor {
    static isBasicMath(query) {
        return /^[0-9\s\+\-\*\/\(\)\.]+$/.test(query);
    }
    static calculate(query) {
        try {
            const result = Function('"use strict";return (' + query + ')')();
            return { handledLocally: true, response: "NaviSoul Local Compute: " + result };
        } catch (e) {
            return { handledLocally: false };
        }
    }
    static isSystemCommand(query) {
        const localCommands = ['/ping', '/status', '/models', '/clear'];
        return localCommands.includes(query.trim().toLowerCase());
    }
    static executeSystemCommand(query) {
        switch(query.trim().toLowerCase()) {
            case '/ping': return { handledLocally: true, response: "NaviSoul is online and monitoring environment." };
            case '/models': return { handledLocally: true, response: "NaviSoul Routing Active: 5.6 Ultra, Hugging Face endpoints standing by." };
            default: return { handledLocally: false };
        }
    }
}
