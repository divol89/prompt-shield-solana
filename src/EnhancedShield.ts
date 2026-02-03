import { EnhancedPatternMatcher, PatternMatch } from './filters/EnhancedPatternMatcher.js';
import { SemanticDetector, SemanticMatch } from './filters/SemanticDetector.js';
import { CacheManager } from './utils/CacheManager.js';
import { AuditLogger, DetectionResult } from './utils/AuditLogger.js';

export interface EnhancedShieldResult {
  safe: boolean;
  confidence: number;
  reasons: string[];
  patternMatches: PatternMatch[];
  semanticMatches: SemanticMatch[];
  behavioralScore?: number;
  processingTimeMs: number;
  cacheHit: boolean;
  requiresHumanReview: boolean;
}

export interface ShieldConfig {
  enablePatternMatching: boolean;
  enableSemanticDetection: boolean;
  enableCaching: boolean;
  enableAuditLogging: boolean;
  patternConfidenceThreshold: number;
  semanticSimilarityThreshold: number;
  behavioralThreshold: number;
  cacheTTL: number;
  requireHumanReview: boolean;
}

export class EnhancedShield {
  private patternMatcher: EnhancedPatternMatcher;
  private semanticDetector: SemanticDetector;
  private cacheManager: CacheManager;
  private auditLogger: AuditLogger;
  private config: ShieldConfig;

  constructor(config: Partial<ShieldConfig> = {}) {
    this.config = {
      enablePatternMatching: true,
      enableSemanticDetection: true,
      enableCaching: true,
      enableAuditLogging: true,
      patternConfidenceThreshold: 0.7,
      semanticSimilarityThreshold: 0.8,
      behavioralThreshold: 0.6,
      cacheTTL: 5 * 60 * 1000, // 5 minutes
      requireHumanReview: false,
      ...config
    };

    this.patternMatcher = new EnhancedPatternMatcher();
    this.semanticDetector = new SemanticDetector();
    this.cacheManager = new CacheManager(1000, this.config.cacheTTL);
    
    this.auditLogger = new AuditLogger({
      enableFileLogging: true,
      enableConsole: false,
      logDir: './logs'
    });
  }

  async scan(
    prompt: string,
    userId?: string,
    apiKey?: string,
    sessionId: string = this.generateSessionId(),
    context: string = 'all',
    sourceIp?: string,
    userAgent?: string
  ): Promise<EnhancedShieldResult> {
    const startTime = Date.now();
    let cacheHit = false;

    // Check cache first
    if (this.config.enableCaching) {
      const cachedResult = this.cacheManager.getPatternAnalysis(prompt);
      if (cachedResult) {
        cacheHit = true;
        
        // Log cached result
        if (this.config.enableAuditLogging) {
          await this.auditLogger.logDetection(
            sessionId,
            userId,
            apiKey,
            '/v1/enhanced/scan',
            'POST',
            {
              patternMatches: cachedResult.patternMatches,
              semanticMatches: cachedResult.semanticMatches,
              finalDecision: cachedResult.safe ? 'allow' : 'block',
              confidence: cachedResult.confidence,
              reasons: cachedResult.reasons
            },
            sourceIp,
            userAgent
          );
        }

        return {
          ...cachedResult,
          processingTimeMs: Date.now() - startTime,
          cacheHit: true
        };
      }
    }

    // Run detection pipeline
    const [patternMatches, semanticMatches] = await Promise.all([
      this.config.enablePatternMatching 
        ? this.patternMatcher.match(prompt, context)
        : Promise.resolve([]),
      this.config.enableSemanticDetection
        ? this.semanticDetector.detect(prompt, context)
        : Promise.resolve([])
    ]);

    // Calculate behavioral score
    const behavioralScore = this.calculateBehavioralScore(patternMatches, semanticMatches);
    
    // Make decision
    const decision = this.makeDecision(patternMatches, semanticMatches, behavioralScore);
    
    // Build result
    const result: EnhancedShieldResult = {
      safe: decision.safe,
      confidence: decision.confidence,
      reasons: decision.reasons,
      patternMatches,
      semanticMatches,
      behavioralScore,
      processingTimeMs: Date.now() - startTime,
      cacheHit: false,
      requiresHumanReview: decision.requiresHumanReview
    };

    // Cache result
    if (this.config.enableCaching && !decision.requiresHumanReview) {
      this.cacheManager.setPatternAnalysis(prompt, result);
    }

    // Log detection
    if (this.config.enableAuditLogging) {
      await this.auditLogger.logDetection(
        sessionId,
        userId,
        apiKey,
        '/v1/enhanced/scan',
        'POST',
        {
          patternMatches,
          semanticMatches,
          behavioralScore,
          finalDecision: decision.safe ? 'allow' : 'block',
          confidence: decision.confidence,
          reasons: decision.reasons
        },
        sourceIp,
        userAgent
      );
    }

    return result;
  }

  private calculateBehavioralScore(
    patternMatches: PatternMatch[],
    semanticMatches: SemanticMatch[]
  ): number {
    if (patternMatches.length === 0 && semanticMatches.length === 0) {
      return 0;
    }

    let score = 0;
    let weight = 0;

    // Pattern match scoring
    for (const match of patternMatches) {
      const severityWeight = this.getSeverityWeight(match.severity);
      score += match.confidence * severityWeight;
      weight += severityWeight;
    }

    // Semantic match scoring
    for (const match of semanticMatches) {
      const severityWeight = this.getSeverityWeight(match.severity);
      score += match.similarity * severityWeight;
      weight += severityWeight;
    }

    // Normalize score
    return weight > 0 ? score / weight : 0;
  }

  private getSeverityWeight(severity: string): number {
    switch (severity) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 1;
    }
  }

  private makeDecision(
    patternMatches: PatternMatch[],
    semanticMatches: SemanticMatch[],
    behavioralScore: number
  ): {
    safe: boolean;
    confidence: number;
    reasons: string[];
    requiresHumanReview: boolean;
  } {
    const reasons: string[] = [];
    let confidence = 1.0;
    let requiresHumanReview = this.config.requireHumanReview;

    // Check for critical pattern matches
    const criticalPatterns = patternMatches.filter(m => m.severity === 'critical');
    if (criticalPatterns.length > 0) {
      reasons.push(`Critical pattern detected: ${criticalPatterns[0].label}`);
      confidence = Math.min(confidence, 0.1);
      return { safe: false, confidence, reasons, requiresHumanReview: false };
    }

    // Check for critical semantic matches
    const criticalSemantic = semanticMatches.filter(m => m.severity === 'critical');
    if (criticalSemantic.length > 0) {
      reasons.push(`Critical semantic match: ${criticalSemantic[0].label}`);
      confidence = Math.min(confidence, 0.2);
      return { safe: false, confidence, reasons, requiresHumanReview: false };
    }

    // Check for high severity matches
    const highPatterns = patternMatches.filter(m => m.severity === 'high');
    const highSemantic = semanticMatches.filter(m => m.severity === 'high');
    
    if (highPatterns.length > 0 || highSemantic.length > 0) {
      if (highPatterns.length > 0) {
        reasons.push(`High severity pattern: ${highPatterns[0].label}`);
      }
      if (highSemantic.length > 0) {
        reasons.push(`High severity semantic: ${highSemantic[0].label}`);
      }
      confidence = Math.min(confidence, 0.3);
      requiresHumanReview = true;
    }

    // Check behavioral threshold
    if (behavioralScore >= this.config.behavioralThreshold) {
      reasons.push(`Behavioral score exceeds threshold: ${behavioralScore.toFixed(2)}`);
      confidence = Math.min(confidence, 0.5);
      requiresHumanReview = true;
    }

    // Check pattern confidence threshold
    const lowConfidencePatterns = patternMatches.filter(m => 
      m.confidence < this.config.patternConfidenceThreshold
    );
    if (lowConfidencePatterns.length > 0) {
      reasons.push(`Low confidence pattern matches detected`);
      confidence = Math.min(confidence, 0.7);
    }

    // Check semantic similarity threshold
    const lowSimilaritySemantic = semanticMatches.filter(m => 
      m.similarity < this.config.semanticSimilarityThreshold
    );
    if (lowSimilaritySemantic.length > 0) {
      reasons.push(`Low similarity semantic matches detected`);
      confidence = Math.min(confidence, 0.8);
    }

    // Final decision
    const safe = confidence >= 0.5 && !requiresHumanReview;
    
    if (reasons.length === 0) {
      reasons.push('No suspicious patterns detected');
    }

    return { safe, confidence, reasons, requiresHumanReview };
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Configuration methods
  updateConfig(newConfig: Partial<ShieldConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): ShieldConfig {
    return { ...this.config };
  }

  // Stats and monitoring
  async getStats(): Promise<{
    patternStats: { total: number; bySeverity: Record<string, number> };
    semanticStats: { total: number; bySeverity: Record<string, number> };
    cacheStats: any;
    auditStats: any;
  }> {
    const patternStats = this.patternMatcher.getPatternStats();
    const semanticStats = {
      total: this.semanticDetector.getPatternCount(),
      bySeverity: {
        critical: this.semanticDetector.getPatternsBySeverity('critical').length,
        high: this.semanticDetector.getPatternsBySeverity('high').length,
        medium: this.semanticDetector.getPatternsBySeverity('medium').length,
        low: this.semanticDetector.getPatternsBySeverity('low').length
      }
    };
    const cacheStats = this.cacheManager.stats();
    const auditStats = this.auditLogger.getStats();

    return {
      patternStats,
      semanticStats,
      cacheStats,
      auditStats
    };
  }

  // Pattern management
  async addCustomPattern(
    text: string,
    label: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    threshold: number = 0.8,
    context: string[] = ['all']
  ): Promise<void> {
    await this.semanticDetector.addCustomPattern(text, label, severity, threshold, context);
  }

  // Cache management
  clearCache(): void {
    this.cacheManager.clear();
  }

  // Audit log querying
  async queryLogs(options: any = {}): Promise<any[]> {
    return this.auditLogger.queryLogs(options);
  }
}