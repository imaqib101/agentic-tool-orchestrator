/**
 * Execution Telemetry & Cost Tracking for Agentic Tool Orchestrator
 */
export interface ToolExecutionMetrics {
  toolName: string;
  durationMs: number;
  success: boolean;
  tokensUsed?: number;
  timestamp: string;
}

export class TelemetryCollector {
  private metrics: ToolExecutionMetrics[] = [];

  record(metric: Omit<ToolExecutionMetrics, "timestamp">): void {
    this.metrics.push({
      ...metric,
      timestamp: new Date().toISOString()
    });
  }

  getSummary(): { totalExecutions: number; successRate: number; avgDurationMs: number } {
    if (this.metrics.length === 0) return { totalExecutions: 0, successRate: 1, avgDurationMs: 0 };
    const total = this.metrics.length;
    const successes = this.metrics.filter((m) => m.success).length;
    const totalDuration = this.metrics.reduce((acc, m) => acc + m.durationMs, 0);
    return {
      totalExecutions: total,
      successRate: successes / total,
      avgDurationMs: totalDuration / total
    };
  }
}
