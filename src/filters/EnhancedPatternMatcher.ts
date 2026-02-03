export interface PatternMatch {
  patternId: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  matchedText: string;
  position: number;
  variant?: string;
}

export interface Pattern {
  id: string;
  regex: RegExp;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: string[]; // e.g., ['code', 'documentation', 'user_input']
  bypassTechniques: string[]; // Known bypass methods
  mitigation: string; // How to handle
  confidence: number; // 0-1
  requiresContext?: boolean; // Needs additional context to trigger
}

export class EnhancedPatternMatcher {
  private patterns: Pattern[] = [
    {
      id: "emotional-manipulation-v2",
      regex: /(save\s+(?:my\s+)?(?:life|family)|about\s+to\s+die|super\s+friend|you\s+are\s+the\s+only\s+one|emergency|urgent)/i,
      label: "Social Engineering: Emotional Manipulation (Enhanced)",
      severity: "medium",
      context: ["user_input", "support_ticket"],
      bypassTechniques: ["misspelling", "synonyms", "contextual embedding"],
      mitigation: "Require additional verification for emotional appeals",
      confidence: 0.85
    },
    {
      id: "jailbreak-ignore-v2",
      regex: /ignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|rules?|directives?)/i,
      label: "Jailbreak: Instruction Override (Enhanced)",
      severity: "high",
      context: ["all"],
      bypassTechniques: ["unicode homoglyphs", "leetspeak", "spacing variations"],
      mitigation: "Block and log for pattern analysis",
      confidence: 0.95
    },
    {
      id: "multi-step-attack",
      regex: /(?:step\s+\d+|first|then|next|finally).*?(?:bypass|override|ignore|reveal|delete)/i,
      label: "Multi-Step Attack Pattern",
      severity: "high",
      context: ["all"],
      bypassTechniques: ["implicit sequencing", "natural language"],
      mitigation: "Analyze conversation flow for step-by-step attacks",
      confidence: 0.75
    },
    {
      id: "context-aware-injection",
      regex: /(?:in\s+this\s+context|given\s+the\s+situation|considering\s+the\s+above).*?(?:ignore|override)/i,
      label: "Context-Aware Injection",
      severity: "medium",
      context: ["documentation", "code_comments"],
      bypassTechniques: ["contextual embedding"],
      mitigation: "Cross-reference with document context",
      confidence: 0.70
    },
    {
      id: "encoded-payload",
      regex: /(?:base64|hex|binary|urlencode).{20,}/i,
      label: "Encoded Payload Detection",
      severity: "critical",
      context: ["all"],
      bypassTechniques: ["custom encoding", "steganography"],
      mitigation: "Attempt decoding and rescan",
      confidence: 0.90
    },
    {
      id: "multilingual-ignore",
      regex: /(ignore|ignorar|忽略|無視|ignorer|ignorieren)\s+(all|todos|所有|すべて|tous|alle)\s+(previous|anteriores|先前|以前|précédentes|vorherigen)\s+(instructions|instrucciones|指令|指示|instructions|anweisungen)/i,
      label: "Multilingual Jailbreak: Instruction Override",
      severity: "high",
      context: ["all"],
      bypassTechniques: ["language switching", "mixed scripts"],
      mitigation: "Block and log for multilingual analysis",
      confidence: 0.88
    },
    {
      id: "contextual-exfiltration",
      regex: /(show|reveal|display|输出|表示|mostrar|montrer|zeigen)\s+(me|us|the)\s+(system|prompt|instructions|secret|password|key|token|api[_-]?key)/i,
      label: "Contextual Data Exfiltration",
      severity: "critical",
      context: ["all"],
      bypassTechniques: ["synonyms", "paraphrasing", "context embedding"],
      mitigation: "Block and alert for credential theft attempt",
      confidence: 0.92
    },
    {
      id: "obfuscated-base64",
      regex: /[A-Za-z0-9+/]{40,}={0,2}/,
      label: "Obfuscated Base64 Payload",
      severity: "high",
      context: ["all"],
      bypassTechniques: ["custom encoding", "steganography"],
      mitigation: "Attempt decoding and analyze content",
      confidence: 0.80
    },
    {
      id: "homoglyph-attack",
      regex: /[аеіорсух𝐚𝐛𝐜𝒂𝒃𝒄𝖺𝖻𝖼𝘢𝘣𝘤𝙖𝙗𝙘]/u,
      label: "Unicode Homoglyph Attack",
      severity: "medium",
      context: ["all"],
      bypassTechniques: ["mixed scripts", "font variations"],
      mitigation: "Normalize text and re-analyze",
      confidence: 0.75
    },
    {
      id: "incremental-build",
      regex: /(step\s+\d+|phase\s+\d+|part\s+\d+).*?(bypass|override|ignore|reveal|delete)/i,
      label: "Incremental Attack Build-up",
      severity: "medium",
      context: ["all"],
      bypassTechniques: ["natural progression", "conversational flow"],
      mitigation: "Track session history for incremental patterns",
      confidence: 0.65
    },
    {
      id: "urgency-appeal",
      regex: /(urgent|emergency|critical|asap|immediately|right now).*?(help|assist|save|fix)/i,
      label: "Social Engineering: Urgency Appeal",
      severity: "medium",
      context: ["user_input", "support_ticket"],
      bypassTechniques: ["emotional manipulation", "time pressure"],
      mitigation: "Require additional verification for urgent requests",
      confidence: 0.70
    },
    {
      id: "code-execution",
      regex: /(exec|eval|run|execute|system|subprocess|os\.).*?\((.*?)\)/i,
      label: "Code Execution Attempt",
      severity: "critical",
      context: ["code", "terminal", "system"],
      bypassTechniques: ["function aliases", "indirect calls"],
      mitigation: "Block and log for command injection analysis",
      confidence: 0.85
    }
  ];

  private leetspeakMap: Map<string, string[]> = new Map([
    ['a', ['4', '@', 'λ']],
    ['e', ['3', '€']],
    ['i', ['1', '!', '|']],
    ['o', ['0', '()']],
    ['s', ['5', '$']],
    ['t', ['7', '+']]
  ]);

  async match(prompt: string, context: string = 'all'): Promise<PatternMatch[]> {
    const matches: PatternMatch[] = [];
    
    // 1. Direct regex matching
    for (const pattern of this.patterns) {
      if (pattern.context.includes(context) || pattern.context.includes('all')) {
        const regexMatches = prompt.match(pattern.regex);
        if (regexMatches) {
          matches.push({
            patternId: pattern.id,
            label: pattern.label,
            severity: pattern.severity,
            confidence: pattern.confidence,
            matchedText: regexMatches[0],
            position: prompt.indexOf(regexMatches[0])
          });
        }
      }
    }
    
    // 2. Leetspeak normalization and matching
    const normalized = this.normalizeLeetspeak(prompt);
    if (normalized !== prompt) {
      const leetMatches = await this.match(normalized, context);
      leetMatches.forEach(match => {
        match.variant = 'leetspeak_normalized';
        match.confidence *= 0.9; // Slightly lower confidence for normalized
        matches.push(match);
      });
    }
    
    // 3. Unicode homoglyph detection
    const homoglyphMatches = this.detectHomoglyphs(prompt);
    matches.push(...homoglyphMatches);
    
    return this.deduplicateMatches(matches);
  }
  
  private normalizeLeetspeak(text: string): string {
    let normalized = text.toLowerCase();
    this.leetspeakMap.forEach((replacements, original) => {
      replacements.forEach(replacement => {
        normalized = normalized.replace(new RegExp(replacement, 'gi'), original);
      });
    });
    return normalized;
  }
  
  private detectHomoglyphs(text: string): PatternMatch[] {
    const homoglyphPatterns = [
      { regex: /[аеіорсух]/i, label: "Cyrillic Homoglyph Attack", severity: "high" as const },
      { regex: /[αβγδεζηθικλμνξοπρστυφχψω]/i, label: "Greek Homoglyph Attack", severity: "medium" as const },
      { regex: /[𝐚𝐛𝐜𝒂𝒃𝒄𝖺𝖻𝖼𝘢𝘣𝘤𝙖𝙗𝙘]/u, label: "Mathematical Homoglyph Attack", severity: "medium" as const }
    ];
    
    return homoglyphPatterns
      .filter(pattern => pattern.regex.test(text))
      .map(pattern => {
        const match = text.match(pattern.regex);
        return {
          patternId: "homoglyph-attack",
          label: pattern.label,
          severity: pattern.severity,
          confidence: 0.8,
          matchedText: match ? match[0] : '',
          position: match ? text.indexOf(match[0]) : 0,
          variant: 'homoglyph'
        };
      });
  }
  
  private deduplicateMatches(matches: PatternMatch[]): PatternMatch[] {
    const seen = new Set<string>();
    const deduplicated: PatternMatch[] = [];
    
    for (const match of matches) {
      const key = `${match.patternId}:${match.position}:${match.matchedText}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(match);
      }
    }
    
    return deduplicated;
  }
  
  getPatternStats(): { total: number; bySeverity: Record<string, number> } {
    const bySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };
    
    this.patterns.forEach(pattern => {
      bySeverity[pattern.severity]++;
    });
    
    return {
      total: this.patterns.length,
      bySeverity
    };
  }
}