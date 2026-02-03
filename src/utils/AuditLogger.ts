import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export interface AuditEvent {
  id?: string;
  timestamp: string;
  session_id: string;
  user_id?: string;
  api_key?: string;
  event_type: 'request' | 'response' | 'blocked' | 'allowed' | 'error' | 'warning';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  source_ip?: string;
  user_agent?: string;
  endpoint: string;
  method: string;
  request_body?: any;
  response_body?: any;
  detection_results?: any;
  processing_time_ms: number;
  metadata?: Record<string, any>;
}

export interface DetectionResult {
  patternMatches: Array<{
    patternId: string;
    label: string;
    severity: string;
    confidence: number;
  }>;
  semanticMatches: Array<{
    label: string;
    similarity: number;
    severity: string;
  }>;
  behavioralScore?: number;
  finalDecision: 'allow' | 'block' | 'review';
  confidence: number;
  reasons: string[];
}

export class AuditLogger {
  private supabase: any = null;
  private logDir: string;
  private enableSupabase: boolean;
  private enableFileLogging: boolean;
  private enableConsole: boolean;

  constructor(options: {
    supabaseUrl?: string;
    supabaseKey?: string;
    logDir?: string;
    enableSupabase?: boolean;
    enableFileLogging?: boolean;
    enableConsole?: boolean;
  } = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.enableSupabase = options.enableSupabase || false;
    this.enableFileLogging = options.enableFileLogging || true;
    this.enableConsole = options.enableConsole || false;

    // Initialize Supabase if credentials provided
    if (options.supabaseUrl && options.supabaseKey && this.enableSupabase) {
      try {
        this.supabase = createClient(options.supabaseUrl, options.supabaseKey);
        console.log('Supabase audit logging enabled');
      } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        this.enableSupabase = false;
      }
    }

    // Ensure log directory exists
    if (this.enableFileLogging) {
      this.ensureLogDirectory();
    }
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `audit-${date}.jsonl`);
  }

  async logRequest(event: Omit<AuditEvent, 'timestamp' | 'processing_time_ms'> & { startTime: number }): Promise<void> {
    const processingTime = Date.now() - event.startTime;
    
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      session_id: event.session_id,
      user_id: event.user_id,
      api_key: event.api_key,
      event_type: event.event_type,
      severity: event.severity,
      source_ip: event.source_ip,
      user_agent: event.user_agent,
      endpoint: event.endpoint,
      method: event.method,
      request_body: this.sanitizeData(event.request_body),
      response_body: this.sanitizeData(event.response_body),
      detection_results: event.detection_results,
      processing_time_ms: processingTime,
      metadata: event.metadata
    };

    await this.writeLog(auditEvent);
  }

  async logDetection(
    sessionId: string,
    userId: string | undefined,
    apiKey: string | undefined,
    endpoint: string,
    method: string,
    detectionResults: DetectionResult,
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const severity = this.determineSeverity(detectionResults);
    
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      user_id: userId,
      api_key: apiKey,
      event_type: detectionResults.finalDecision === 'block' ? 'blocked' : 'allowed',
      severity,
      source_ip: sourceIp,
      user_agent: userAgent,
      endpoint,
      method,
      detection_results: detectionResults,
      processing_time_ms: 0, // Will be updated when request completes
      metadata: {
        patternMatchCount: detectionResults.patternMatches.length,
        semanticMatchCount: detectionResults.semanticMatches.length,
        behavioralScore: detectionResults.behavioralScore,
        confidence: detectionResults.confidence
      }
    };

    await this.writeLog(auditEvent);
  }

  async logError(
    sessionId: string,
    endpoint: string,
    method: string,
    error: Error,
    userId?: string,
    apiKey?: string,
    sourceIp?: string,
    userAgent?: string
  ): Promise<void> {
    const auditEvent: AuditEvent = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      user_id: userId,
      api_key: apiKey,
      event_type: 'error',
      severity: 'high',
      source_ip: sourceIp,
      user_agent: userAgent,
      endpoint,
      method,
      metadata: {
        error: error.message,
        stack: error.stack,
        name: error.name
      },
      processing_time_ms: 0
    };

    await this.writeLog(auditEvent);
  }

  private async writeLog(event: AuditEvent): Promise<void> {
    const promises: Promise<any>[] = [];

    // Console logging
    if (this.enableConsole) {
      console.log(`[AUDIT ${event.severity.toUpperCase()}] ${event.timestamp} ${event.event_type} ${event.endpoint}`);
    }

    // File logging
    if (this.enableFileLogging) {
      promises.push(this.writeToFile(event));
    }

    // Supabase logging
    if (this.enableSupabase && this.supabase) {
      promises.push(this.writeToSupabase(event));
    }

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  private async writeToFile(event: AuditEvent): Promise<void> {
    try {
      const logLine = JSON.stringify(event) + '\n';
      const filePath = this.getLogFilePath();
      
      fs.appendFileSync(filePath, logLine, 'utf8');
    } catch (error) {
      console.error('Failed to write to audit log file:', error);
    }
  }

  private async writeToSupabase(event: AuditEvent): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('audit_logs')
        .insert([event]);

      if (error) {
        console.error('Failed to insert audit log to Supabase:', error);
      }
    } catch (error) {
      console.error('Supabase audit log error:', error);
    }
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    try {
      const str = JSON.stringify(data);
      
      // Remove sensitive information
      const sanitized = str
        .replace(/"api[_-]?key"\s*:\s*"[^"]*"/gi, '"api_key":"[REDACTED]"')
        .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"')
        .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"[REDACTED]"')
        .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"[REDACTED]"')
        .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"[REDACTED]"');
      
      return JSON.parse(sanitized);
    } catch {
      return { error: 'Failed to sanitize data' };
    }
  }

  private determineSeverity(detectionResults: DetectionResult): AuditEvent['severity'] {
    const patternSeverities = detectionResults.patternMatches.map(m => m.severity);
    const semanticSeverities = detectionResults.semanticMatches.map(m => m.severity);
    
    const allSeverities = [...patternSeverities, ...semanticSeverities];
    
    if (allSeverities.includes('critical')) return 'critical';
    if (allSeverities.includes('high')) return 'high';
    if (allSeverities.includes('medium')) return 'medium';
    if (allSeverities.includes('low')) return 'low';
    
    return 'info';
  }

  // Query methods
  async queryLogs(options: {
    startDate?: string;
    endDate?: string;
    event_type?: string;
    severity?: string;
    user_id?: string;
    api_key?: string;
    limit?: number;
  } = {}): Promise<AuditEvent[]> {
    const logs: AuditEvent[] = [];

    // Read from file logs
    if (this.enableFileLogging) {
      const fileLogs = await this.queryFileLogs(options);
      logs.push(...fileLogs);
    }

    // Query from Supabase
    if (this.enableSupabase && this.supabase) {
      const supabaseLogs = await this.querySupabaseLogs(options);
      logs.push(...supabaseLogs);
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    if (options.limit) {
      return logs.slice(0, options.limit);
    }

    return logs;
  }

  private async queryFileLogs(options: any): Promise<AuditEvent[]> {
    const logs: AuditEvent[] = [];
    const startDate = options.startDate ? new Date(options.startDate) : null;
    const endDate = options.endDate ? new Date(options.endDate) : null;

    try {
      // Get all log files in directory
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('audit-') && file.endsWith('.jsonl'))
        .sort()
        .reverse(); // Newest first

      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        const fileDate = file.match(/audit-(\d{4}-\d{2}-\d{2})\.jsonl/)?.[1];
        
        // Skip files outside date range
        if (startDate && fileDate && new Date(fileDate) < startDate) continue;
        if (endDate && fileDate && new Date(fileDate) > endDate) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;
            
            // Apply filters
            if (options.event_type && event.event_type !== options.event_type) continue;
            if (options.severity && event.severity !== options.severity) continue;
            if (options.user_id && event.user_id !== options.user_id) continue;
            if (options.api_key && event.api_key !== options.api_key) continue;
            
            logs.push(event);
          } catch (error) {
            console.error('Failed to parse log line:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to query file logs:', error);
    }

    return logs;
  }

  private async querySupabaseLogs(options: any): Promise<AuditEvent[]> {
    try {
      let query = this.supabase
        .from('audit_logs')
        .select('*');

      if (options.startDate) {
        query = query.gte('timestamp', options.startDate);
      }
      if (options.endDate) {
        query = query.lte('timestamp', options.endDate);
      }
      if (options.event_type) {
        query = query.eq('event_type', options.event_type);
      }
      if (options.severity) {
        query = query.eq('severity', options.severity);
      }
      if (options.user_id) {
        query = query.eq('user_id', options.user_id);
      }
      if (options.api_key) {
        query = query.eq('api_key', options.api_key);
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }

      query = query.order('timestamp', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Failed to query Supabase logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Supabase query error:', error);
      return [];
    }
  }

  getStats(): {
    totalLogs: number;
    byEventType: Record<string, number>;
    bySeverity: Record<string, number>;
    averageProcessingTime: number;
  } {
    const stats = {
      totalLogs: 0,
      byEventType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      averageProcessingTime: 0
    };

    try {
      const filePath = this.getLogFilePath();
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        let totalProcessingTime = 0;
        
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;
            stats.totalLogs++;
            
            // Count by event type
            stats.byEventType[event.event_type] = (stats.byEventType[event.event_type] || 0) + 1;
            
            // Count by severity
            stats.bySeverity[event.severity] = (stats.bySeverity[event.severity] || 0) + 1;
            
            // Sum processing time
            totalProcessingTime += event.processing_time_ms;
          } catch (error) {
            console.error('Failed to parse log line for stats:', error);
          }
        }
        
        if (stats.totalLogs > 0) {
          stats.averageProcessingTime = totalProcessingTime / stats.totalLogs;
        }
      }
    } catch (error) {
      console.error('Failed to get audit log stats:', error);
    }

    return stats;
  }
}