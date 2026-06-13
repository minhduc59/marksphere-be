/**
 * Response shape for `GET /v1/admin/overview`.
 *
 * The frontend mirrors these types in `frontend/src/lib/api/types.ts`.
 */

export type HealthStatus = 'ok' | 'error' | 'unknown';

export interface Kpi {
  label: string;
  /** All-time count; the frontend formats it (k / decimals). */
  value: number;
  /** % change vs the prior 7-day window; null when the prior window had 0 (frontend renders "—"). */
  deltaPct: number | null;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface EfficiencyPoint {
  label: string;
  generated: number;
  published: number;
}

export interface ServiceHealth {
  label: string;
  status: HealthStatus;
}

export interface OverviewResponseDto {
  /** 5 KPIs in fixed order: Users, Scans, Posts Generated, Posts Published, Video Clips. */
  kpis: Kpi[];
  trendScanVolume: {
    '24h': SeriesPoint[];
    '7d': SeriesPoint[];
  };
  contentPipeline: {
    generated: number;
    autoApproved: number;
    flagged: number;
    published: number;
  };
  outputEfficiency: EfficiencyPoint[];
  systemHealth: {
    internal: ServiceHealth[];
    external: ServiceHealth[];
  };
}
