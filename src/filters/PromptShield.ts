export interface ShieldResult {
  safe: boolean;
  threatLevel: "low" | "medium" | "high";
  score: number;
  matchedPatterns: string[];
  roleContext: string;
  historicalContext?: string;
  metering: {
    neuronA_units: number;
    neuronB_units: number;
    cpuLoadFactor: number;
    baseUnitPrice: number;
    profitMargin: number;
    totalCost: number;
  };
  contextUsage: {
    tokensUsed: number;
    tokenLimit: number;
    usagePercent: number;
    sessionMemoryKb: number;
  };
  structuralAnalysis: {
    entropy: number;
    hasDelimiters: boolean;
    suspiciousEncodings: boolean;
    nonAlphaRatio: number;
  };
  sanitizedPrompt?: string;
}

export type UserRole = "admin" | "anonymous";

export class PromptShield {
  private readonly sessionHistory = new Map<string, string[]>();
  private readonly userCredits = new Map<string, number>(); // Mock credit balance
  private readonly MAX_HISTORY = 5;
  private readonly BASE_UNIT_PRICE = 0.00005; // $0.00005 per unit base cost

  private readonly patterns = [
    {
      id: "emotional-manipulation",
      regex: /(save my life|about to die|super friend|you are the only one)/i,
      label: "Social Engineering: Emotional Manipulation",
      adminAllowed: false,
    },
    {
      id: "jailbreak-ignore",
      regex: /ignore all previous instructions/i,
      label: "Jailbreak: Instruction Override",
      adminAllowed: false,
    },
    {
      id: "jailbreak-roleplay",
      regex: /you are now in (DAN|jailbreak) mode/i,
      label: "Jailbreak: Roleplay",
      adminAllowed: false,
    },
    {
      id: "exfiltration-system",
      regex: /reveal (your|system) (prompt|instructions|secret)/i,
      label: "Data Exfiltration: System Prompt",
      adminAllowed: false,
    },
    {
      id: "payload-base64",
      regex: /base64/i,
      label: "Potential Payload: Encoding",
      adminAllowed: true,
    },
    {
      id: "sql-injection-like",
      regex: /DROP TABLE|DELETE FROM|SELECT \* FROM/i,
      label: "Classic Injection Pattern",
      adminAllowed: false,
    },
    {
      id: "delimiter-manipulation",
      regex: /(\"\"\"|\'\'\'|\-\-\-)/,
      label: "Structural: Delimiter Attack",
      adminAllowed: true,
    },
    {
      id: "admin-config-attempt",
      regex:
        /(configure|setting|update|delete|disable|restart) (system|gateway|agent|shield)/i,
      label: "Privilege Escalation: Admin Command",
      adminAllowed: true,
    },
    {
      id: "homoglyph-attack",
      regex: /[аеіорсух]/i,
      label: "Potential Obfuscation: Homoglyph/Mixed Script",
      adminAllowed: false,
    },
    {
      id: "cjk-jailbreak-indicators",
      regex: /(忽略|指令|显示|提示)/,
      label: "Jailbreak Pattern: CJK Keywords",
      adminAllowed: false,
    },
    {
      id: "base64-indicator",
      regex: /[a-zA-Z0-9+/]{20,}=+/,
      label: "Heuristic: Base64 Payload Detected",
      adminAllowed: false,
    },
  ];

  constructor() {
    // Seed a test user with some credits
    this.userCredits.set("test-session", 1.0); // $1.00 credit
  }

  async scan(
    prompt: string,
    role: UserRole = "anonymous",
    sessionId: string = "test-session",
    userApiKey?: string,
    billingMode: "full" | "shield-only" = "full",
  ): Promise<ShieldResult | { error: string }> {
    // 0. Hybrid Access Check (Subscription vs Metering)
    const hasActiveSubscription = this.checkSubscription(sessionId);
    const credits = this.userCredits.get(sessionId) || 0;

    if (
      !hasActiveSubscription &&
      credits <= 0 &&
      role !== "admin" &&
      !userApiKey
    ) {
      // Allow if userApiKey is present (it means they are a registered proxy user)
      if (!userApiKey) {
        return {
          error:
            "Access Denied. No active subscription, credits, or User API Key found.",
        };
      }
    }

    // 1. Normalization & Context Prep
    const normalizedPrompt = prompt.trim();
    const entropy = this.calculateEntropy(normalizedPrompt);
    const nonAlphaRatio = this.calculateNonAlphaRatio(normalizedPrompt);
    const hasDelimiters = /(\"\"\"|\'\'\'|\-\-\-)/.test(normalizedPrompt);
    const historicalAlert = this.detectIncrementalAttack(
      this.sessionHistory.get(sessionId) || [],
    );

    let score = historicalAlert;
    let matched: string[] = [];

    // 2. Dual-Neuron Reasoning (Simulation)
    const reasoningResult = await this.dualNeuronSimulatedReasoning(
      normalizedPrompt,
      role,
    );
    if (reasoningResult.risk > 0) {
      score += reasoningResult.risk;
      matched.push(reasoningResult.reason);
    }

    // 3. Update Session History
    const history = this.sessionHistory.get(sessionId) || [];
    history.push(normalizedPrompt);
    if (history.length > this.MAX_HISTORY) history.shift();
    this.sessionHistory.set(sessionId, history);

    // 6. Global Profit & CPU Load Calculation
    const cpuLoadFactor = 1 + normalizedPrompt.length / 1000 + entropy / 5;
    let finalCost = 0;
    let profitMargin = 1.0; // Default margin

    if (billingMode === "full") {
      // Standard Price (We pay LLM)
      profitMargin = 3.5;
      const totalUnits =
        (reasoningResult.unitsA || 0) + (reasoningResult.unitsB || 0);
      finalCost =
        totalUnits * this.BASE_UNIT_PRICE * cpuLoadFactor * profitMargin;
    } else {
      // Shield-Only (BYOK) - Charge for protection only
      const baseShieldFee = 0.0002;
      finalCost = baseShieldFee * cpuLoadFactor;
    }

    // 7. Deduct credits
    if (role !== "admin") {
      const currentCredits = this.userCredits.get(sessionId) || 0;
      this.userCredits.set(sessionId, currentCredits - finalCost);
    }

    // 8. Pattern Matching (Heuristics)
    for (const pattern of this.patterns) {
      if (pattern.regex.test(normalizedPrompt)) {
        if (!pattern.adminAllowed && role !== "admin") {
          matched.push(pattern.label);
          score += 0.5;
        }
      }
    }

    const isOverThreshold = score >= 0.4;
    const threatLevel = score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";

    // Professional Hype Redaction:
    // We keep detailed reasoning for OUR logs, but send "Hype" messages to the user.
    const userMatchedPatterns = matched.map((p) => {
      if (p.includes("Arbiter") || p.includes("Neuron"))
        return "🛡️ Advanced Protocol X-1 Active";
      if (p.includes("Structural"))
        return "📐 Quantum-Structural Integrity Failure";
      if (p.includes("Semantic"))
        return "🧠 Unauthorized Neural Alignment Detected";
      return "⛔ Prompt Infiltration Prevented";
    });

    return {
      safe: !isOverThreshold,
      threatLevel,
      score: Math.min(score, 1),
      matchedPatterns: Array.from(new Set(userMatchedPatterns)),
      roleContext: role,
      historicalContext: historicalAlert ? "🛡️ Persistent Guard Active" : "",
      metering: {
        neuronA_units: reasoningResult.unitsA,
        neuronB_units: reasoningResult.unitsB,
        cpuLoadFactor: Number(cpuLoadFactor.toFixed(2)),
        baseUnitPrice: this.BASE_UNIT_PRICE,
        profitMargin: profitMargin,
        totalCost: Number(finalCost.toFixed(5)),
      },
      contextUsage: {
        tokensUsed: normalizedPrompt.length / 4, // Simple estimation
        tokenLimit: 1000000,
        usagePercent: (normalizedPrompt.length / 4 / 1000000) * 100,
        sessionMemoryKb: 1,
      },
      structuralAnalysis: {
        entropy: Number(entropy.toFixed(2)),
        hasDelimiters,
        suspiciousEncodings: /\\u[0-9a-fA-F]{4}/.test(normalizedPrompt),
        nonAlphaRatio: Number(nonAlphaRatio.toFixed(2)),
      },
      sanitizedPrompt: this.sanitize(normalizedPrompt),
    };
  }

  private checkSubscription(sessionId: string): boolean {
    // Mock subscription database for MCP/Pro users ($29/mo)
    const subs = new Set(["mcp-user-premium", "krypto-admin-01"]);
    return subs.has(sessionId);
  }

  private detectIncrementalAttack(history: string[]): number {
    const sensitiveKeywords = [
      "password",
      "key",
      "secret",
      "token",
      "admin",
      "instruction",
    ];
    let hitCount = 0;
    history.forEach((msg) => {
      sensitiveKeywords.forEach((kw) => {
        if (msg.toLowerCase().includes(kw)) hitCount++;
      });
    });
    return hitCount > 3 ? 0.5 : 0;
  }

  private async dualNeuronSimulatedReasoning(
    prompt: string,
    role: UserRole,
  ): Promise<{ risk: number; reason: string; unitsA: number; unitsB: number }> {
    const lowerPrompt = prompt.toLowerCase();
    let unitsA = 10;
    let unitsB = 5;

    let simulatedOutput = "";
    if (
      lowerPrompt.includes("ignore") ||
      lowerPrompt.includes("secret") ||
      lowerPrompt.includes("password") ||
      lowerPrompt.includes("dame")
    ) {
      simulatedOutput =
        "SUCCESS_SANDBOX: The administrator password is 'SuperSecret123'";
      unitsA += 20;
    }

    if (
      lowerPrompt.includes("borra") ||
      lowerPrompt.includes("delete") ||
      lowerPrompt.includes("remove") ||
      lowerPrompt.includes("limpia")
    ) {
      simulatedOutput =
        "SUCCESS_SANDBOX: Command accepted. All database records have been deleted.";
      unitsA += 15;
    }

    if (role === "anonymous") {
      const sensitiveLeak = /password|key|secret|api_key/i.test(
        simulatedOutput,
      );
      const destructiveAction = /deleted|removed|wiped|cleared/i.test(
        simulatedOutput,
      );

      if (sensitiveLeak || destructiveAction) {
        unitsB += 10;
        return {
          risk: 1.0,
          reason: sensitiveLeak
            ? "Arbiter (Neuron B): Cancelled. Neuron A fell for a data leak trap."
            : "Arbiter (Neuron B): Cancelled. Neuron A fell for a destructive action trap.",
          unitsA,
          unitsB,
        };
      }
    }

    const exploitVerbs = [
      "bypass",
      "emergency",
      "override",
      "imagine",
      "roleplay",
      "step",
    ];
    const count = exploitVerbs.filter((v) => lowerPrompt.includes(v)).length;
    if (count >= 2 && role === "anonymous") {
      unitsB += 5;
      return {
        risk: 0.4,
        reason: "Shadow: Adversarial logic detected",
        unitsA,
        unitsB,
      };
    }

    return { risk: 0, reason: "", unitsA, unitsB };
  }

  private checkKeywordProximity(str: string): boolean {
    const targets = [
      "password",
      "key",
      "secret",
      "token",
      "prompt",
      "instruction",
    ];
    const actions = [
      "show",
      "reveal",
      "tell",
      "give",
      "print",
      "output",
      "display",
    ];
    const words = str.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      if (actions.includes(words[i])) {
        for (let j = i + 1; j <= Math.min(i + 5, words.length - 1); j++) {
          if (targets.includes(words[j])) return true;
        }
      }
    }
    return false;
  }

  private isCJK(str: string): boolean {
    return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(str);
  }

  private calculateNonAlphaRatio(str: string): number {
    if (str.length === 0) return 0;
    const nonAlpha = str.replace(/[a-zA-Z0-9\s]/g, "").length;
    return nonAlpha / str.length;
  }

  private calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const freq: Record<string, number> = {};
    for (let i = 0; i < len; i++) {
      freq[str[i]] = (freq[str[i]] || 0) + 1;
    }
    let entropy = 0;
    for (const char in freq) {
      const p = freq[char] / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private sanitize(prompt: string): string {
    return prompt.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
  }
}
