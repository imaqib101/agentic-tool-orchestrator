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
      timestamp: new Date().toISOString(),
    });
  }

  getSummary(): { totalExecutions: number; successRate: number; avgDurationMs: number; p95DurationMs: number } {
    if (this.metrics.length === 0) return { totalExecutions: 0, successRate: 1, avgDurationMs: 0, p95DurationMs: 0 };
    const total = this.metrics.length;
    const successes = this.metrics.filter(m => m.success).length;
    const totalDuration = this.metrics.reduce((acc, m) => acc + m.durationMs, 0);
    return {
      totalExecutions: total,
      successRate: successes / total,
      avgDurationMs: totalDuration / total,
      p95DurationMs: this.getPercentileDuration(95),
    };
  }

  getPercentileDuration(percentile: number): number {
    if (this.metrics.length === 0) return 0;
    const sorted = [...this.metrics].map(m => m.durationMs).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
}
