import React, { useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  buildPhenologyBoxPlotSeries,
  type BoxStats,
  type BuildSeriesOptions,
  type ObservationFilter,
  type PhenologyObservation,
  type WhiskerMode,
} from "./phenologyBoxPlotUtils";

export type ViewMode = "boxplot" | "band";
export type MetricMode = "absolute" | "shift";

export interface PhenologyBoxPlotByDecadeProps extends ObservationFilter {
  data: PhenologyObservation[];
  title?: string;
  width?: number | string;
  height?: number;
  whiskerMode?: WhiskerMode;
  showOutliers?: boolean;
  allowViewToggle?: boolean;
  viewMode?: ViewMode;
  defaultViewMode?: ViewMode;
  onViewModeChange?: (viewMode: ViewMode) => void;
  allowMetricToggle?: boolean;
  metricMode?: MetricMode;
  defaultMetricMode?: MetricMode;
  onMetricModeChange?: (metricMode: MetricMode) => void;
  baselineDecadeStart?: number;
  yDomain?: [number, number];
}

interface TooltipState {
  x: number;
  y: number;
  stats: BoxStats;
}

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 420;
const DEFAULT_ABSOLUTE_DOMAIN: [number, number] = [1, 365];
const DEFAULT_SHIFT_DOMAIN: [number, number] = [-60, 60];

function formatDoy(value: number): string {
  return `${Math.round(value)}`;
}

function formatShift(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function yScale(value: number, plotTop: number, plotHeight: number, domain: [number, number]): number {
  const [min, max] = domain;
  const ratio = (value - min) / (max - min || 1);
  return plotTop + plotHeight - ratio * plotHeight;
}

function getRenderedValue(stats: BoxStats, key: "min" | "max" | "q1" | "median" | "q3" | "whiskerLow" | "whiskerHigh", metricMode: MetricMode): number {
  if (metricMode === "absolute") return stats[key];

  switch (key) {
    case "min":
      return stats.deltaMin ?? 0;
    case "max":
      return stats.deltaMax ?? 0;
    case "q1":
      return stats.deltaQ1 ?? 0;
    case "median":
      return stats.deltaMedian ?? 0;
    case "q3":
      return stats.deltaQ3 ?? 0;
    case "whiskerLow":
      return stats.deltaWhiskerLow ?? 0;
    case "whiskerHigh":
      return stats.deltaWhiskerHigh ?? 0;
    default:
      return 0;
  }
}

function getRenderedOutliers(stats: BoxStats, metricMode: MetricMode): number[] {
  return metricMode === "absolute" ? stats.outliers : (stats.deltaOutliers ?? []);
}

function getResolvedYDomain(series: BoxStats[], metricMode: MetricMode, explicitDomain?: [number, number]): [number, number] {
  if (explicitDomain) return explicitDomain;
  if (!series.length) return metricMode === "absolute" ? DEFAULT_ABSOLUTE_DOMAIN : DEFAULT_SHIFT_DOMAIN;

  if (metricMode === "absolute") return DEFAULT_ABSOLUTE_DOMAIN;

  const values = series.flatMap((stats) => [
    getRenderedValue(stats, "whiskerLow", metricMode),
    getRenderedValue(stats, "whiskerHigh", metricMode),
    ...getRenderedOutliers(stats, metricMode),
  ]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const padding = Math.max(5, Math.ceil((max - min) * 0.08));
  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

function getYAxisTicks(domain: [number, number], metricMode: MetricMode): number[] {
  if (metricMode === "absolute") return [1, 60, 120, 180, 240, 300, 365];

  const [min, max] = domain;
  const step = 10;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) {
    ticks.push(tick);
  }
  return ticks;
}

function renderYAxisTicks(plotTop: number, plotLeft: number, plotHeight: number, domain: [number, number], metricMode: MetricMode) {
  const ticks = getYAxisTicks(domain, metricMode);

  return ticks.map((tick) => {
    const y = yScale(tick, plotTop, plotHeight, domain);
    return (
      <g key={tick}>
        <line x1={plotLeft} x2={DEFAULT_WIDTH - 24} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
        <text x={plotLeft - 10} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
          {metricMode === "absolute" ? tick : formatShift(tick)}
        </text>
      </g>
    );
  });
}

export function PhenologyBoxPlotByDecade({
  data,
  title = "Phenology Timing by Decade",
  width = "100%",
  height = DEFAULT_HEIGHT,
  whiskerMode = "tukey",
  showOutliers = true,
  allowViewToggle = true,
  viewMode,
  defaultViewMode = "boxplot",
  onViewModeChange,
  allowMetricToggle = true,
  metricMode,
  defaultMetricMode = "absolute",
  onMetricModeChange,
  baselineDecadeStart = 1980,
  species,
  phenophase,
  yDomain,
}: PhenologyBoxPlotByDecadeProps) {
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>(defaultViewMode);
  const [internalMetricMode, setInternalMetricMode] = useState<MetricMode>(defaultMetricMode);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartId = useId();

  const resolvedViewMode = viewMode ?? internalViewMode;
  const resolvedMetricMode = metricMode ?? internalMetricMode;
  const seriesOptions: BuildSeriesOptions = useMemo(() => ({
    filters: { species, phenophase },
    whiskerMode,
    baselineDecadeStart,
  }), [species, phenophase, whiskerMode, baselineDecadeStart]);
  const series = useMemo(() => buildPhenologyBoxPlotSeries(data, seriesOptions), [data, seriesOptions]);
  const resolvedYDomain = useMemo(() => getResolvedYDomain(series, resolvedMetricMode, yDomain), [series, resolvedMetricMode, yDomain]);

  const margin = { top: 28, right: 24, bottom: 64, left: 56 };
  const plotWidth = DEFAULT_WIDTH - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const step = series.length > 0 ? plotWidth / series.length : plotWidth;
  const bandWidth = Math.min(44, step * 0.58);

  function setViewMode(nextViewMode: ViewMode) {
    if (viewMode == null) {
      setInternalViewMode(nextViewMode);
    }
    onViewModeChange?.(nextViewMode);
  }

  function setMetricMode(nextMetricMode: MetricMode) {
    if (metricMode == null) {
      setInternalMetricMode(nextMetricMode);
    }
    onMetricModeChange?.(nextMetricMode);
  }

  function updateTooltip(event: ReactMouseEvent<SVGGElement>, stats: BoxStats) {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;

    setTooltip({
      x: event.clientX - bounds.left + 12,
      y: event.clientY - bounds.top + 12,
      stats,
    });
  }

  if (!series.length) {
    return (
      <div
        style={{
          border: "1px solid #dbe3ec",
          borderRadius: 12,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{title}</div>
          <div style={{ color: "#64748b", fontSize: 14 }}>
            No observations are available for the current species / phenophase filter.
          </div>
      </div>
    );
  }

  const bandPath = resolvedViewMode === "band"
    ? series
        .map((stats, index) => {
          const x = margin.left + step * index + step / 2;
          const y = yScale(getRenderedValue(stats, "q3", resolvedMetricMode), margin.top, plotHeight, resolvedYDomain);
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ")
    : "";

  const bandLowerPath = resolvedViewMode === "band"
    ? series
        .slice()
        .reverse()
        .map((stats, reverseIndex) => {
          const index = series.length - 1 - reverseIndex;
          const x = margin.left + step * index + step / 2;
          const y = yScale(getRenderedValue(stats, "q1", resolvedMetricMode), margin.top, plotHeight, resolvedYDomain);
          return `L ${x} ${y}`;
        })
        .join(" ")
    : "";

  const medianLinePath = series
    .map((stats, index) => {
      const x = margin.left + step * index + step / 2;
      const y = yScale(getRenderedValue(stats, "median", resolvedMetricMode), margin.top, plotHeight, resolvedYDomain);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        width,
        border: "1px solid #dbe3ec",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            {resolvedMetricMode === "absolute" ? "Day of Year by decade" : `Shift in Day of Year relative to ${series[0]?.baselineLabel ?? `${baselineDecadeStart}s`}`}
            {species ? ` • species: ${species}` : ""}
            {phenophase ? ` • phenophase: ${phenophase}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {allowMetricToggle ? (
            <div style={{ display: "inline-flex", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setMetricMode("absolute")}
                style={{
                  border: 0,
                  padding: "6px 10px",
                  background: resolvedMetricMode === "absolute" ? "#dbeafe" : "#fff",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                Absolute DOY
              </button>
              <button
                type="button"
                onClick={() => setMetricMode("shift")}
                style={{
                  border: 0,
                  padding: "6px 10px",
                  background: resolvedMetricMode === "shift" ? "#dbeafe" : "#fff",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                ΔDOY
              </button>
            </div>
          ) : null}
          {allowViewToggle ? (
            <div style={{ display: "inline-flex", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setViewMode("boxplot")}
                style={{
                  border: 0,
                  padding: "6px 10px",
                  background: resolvedViewMode === "boxplot" ? "#dbeafe" : "#fff",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                Box plot
              </button>
              <button
                type="button"
                onClick={() => setViewMode("band")}
                style={{
                  border: 0,
                  padding: "6px 10px",
                  background: resolvedViewMode === "band" ? "#dbeafe" : "#fff",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                Median + IQR
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${DEFAULT_WIDTH} ${height}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-desc`}
      >
        <title id={`${chartId}-title`}>{title}</title>
        <desc id={`${chartId}-desc`}>
          Box plot of phenology day-of-year values grouped by decade, with chronological decades on the x-axis and day of year on the y-axis.
        </desc>

        {renderYAxisTicks(margin.top, margin.left, plotHeight, resolvedYDomain, resolvedMetricMode)}

        <line
          x1={margin.left}
          x2={DEFAULT_WIDTH - margin.right}
          y1={margin.top + plotHeight}
          y2={margin.top + plotHeight}
          stroke="#94a3b8"
          strokeWidth={1}
        />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="#94a3b8" strokeWidth={1} />

        {resolvedViewMode === "band" ? (
          <>
            <path d={`${bandPath} ${bandLowerPath} Z`} fill="rgba(147, 197, 253, 0.35)" stroke="none" />
            <path d={medianLinePath} fill="none" stroke="#1d4ed8" strokeWidth={2.5} />
          </>
        ) : null}

        {series.map((stats, index) => {
          const centerX = margin.left + step * index + step / 2;
          const boxLeft = centerX - bandWidth / 2;
          const boxRight = centerX + bandWidth / 2;
          const q1 = getRenderedValue(stats, "q1", resolvedMetricMode);
          const median = getRenderedValue(stats, "median", resolvedMetricMode);
          const q3 = getRenderedValue(stats, "q3", resolvedMetricMode);
          const whiskerLow = getRenderedValue(stats, "whiskerLow", resolvedMetricMode);
          const whiskerHigh = getRenderedValue(stats, "whiskerHigh", resolvedMetricMode);
          const q1Y = yScale(q1, margin.top, plotHeight, resolvedYDomain);
          const medianY = yScale(median, margin.top, plotHeight, resolvedYDomain);
          const q3Y = yScale(q3, margin.top, plotHeight, resolvedYDomain);
          const whiskerLowY = yScale(whiskerLow, margin.top, plotHeight, resolvedYDomain);
          const whiskerHighY = yScale(whiskerHigh, margin.top, plotHeight, resolvedYDomain);
          const renderedOutliers = getRenderedOutliers(stats, resolvedMetricMode);

          return (
            <g
              key={stats.decadeStart}
              onMouseMove={(event) => updateTooltip(event, stats)}
              onMouseLeave={() => setTooltip(null)}
            >
              {resolvedViewMode === "boxplot" ? (
                <>
                  <line x1={centerX} x2={centerX} y1={q3Y} y2={whiskerHighY} stroke="#0f172a" strokeWidth={1.5} />
                  <line x1={centerX} x2={centerX} y1={q1Y} y2={whiskerLowY} stroke="#0f172a" strokeWidth={1.5} />
                  <line x1={boxLeft + 8} x2={boxRight - 8} y1={whiskerHighY} y2={whiskerHighY} stroke="#0f172a" strokeWidth={1.5} />
                  <line x1={boxLeft + 8} x2={boxRight - 8} y1={whiskerLowY} y2={whiskerLowY} stroke="#0f172a" strokeWidth={1.5} />
                  <rect
                    x={boxLeft}
                    y={q3Y}
                    width={bandWidth}
                    height={Math.max(2, q1Y - q3Y)}
                    fill="rgba(147, 197, 253, 0.55)"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    rx={5}
                  />
                  <line x1={boxLeft} x2={boxRight} y1={medianY} y2={medianY} stroke="#1d4ed8" strokeWidth={2.5} />
                  {showOutliers
                    ? renderedOutliers.map((value, outlierIndex) => (
                        <circle
                          key={`${stats.decadeStart}-${outlierIndex}-${value}`}
                          cx={centerX}
                          cy={yScale(value, margin.top, plotHeight, resolvedYDomain)}
                          r={3.2}
                          fill="#1d4ed8"
                          opacity={0.8}
                        />
                      ))
                    : null}
                </>
              ) : (
                <>
                  <circle cx={centerX} cy={medianY} r={4} fill="#1d4ed8" />
                  <line x1={centerX} x2={centerX} y1={q3Y} y2={q1Y} stroke="#60a5fa" strokeWidth={4} strokeLinecap="round" />
                </>
              )}

              <rect
                x={centerX - step / 2 + 2}
                y={margin.top}
                width={Math.max(8, step - 4)}
                height={plotHeight}
                fill="transparent"
              />

              <text
                x={centerX}
                y={margin.top + plotHeight + 22}
                textAnchor="middle"
                fontSize={11}
                fill="#334155"
              >
                {stats.label}
              </text>
              <text
                x={centerX}
                y={margin.top + plotHeight + 38}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                n={stats.n}
              </text>
            </g>
          );
        })}

        <text
          x={18}
          y={margin.top + plotHeight / 2}
          transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`}
          fontSize={12}
          fill="#334155"
          textAnchor="middle"
        >
          {resolvedMetricMode === "absolute" ? "Day of Year" : "ΔDOY vs baseline"}
        </text>
      </svg>

      {tooltip ? (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            pointerEvents: "none",
            background: "rgba(15, 23, 42, 0.96)",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 12px",
            minWidth: 160,
            boxShadow: "0 8px 20px rgba(15, 23, 42, 0.18)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tooltip.stats.label}</div>
          {resolvedMetricMode === "absolute" ? (
            <>
              <div>Median: {formatDoy(tooltip.stats.median)}</div>
              <div>
                IQR: {formatDoy(tooltip.stats.q1)} to {formatDoy(tooltip.stats.q3)}
              </div>
              <div>
                Whiskers: {formatDoy(tooltip.stats.whiskerLow)} to {formatDoy(tooltip.stats.whiskerHigh)}
              </div>
            </>
          ) : (
            <>
              <div>Baseline: {tooltip.stats.baselineLabel ?? `${baselineDecadeStart}s`}</div>
              <div>ΔMedian: {formatShift(tooltip.stats.deltaMedian ?? 0)}</div>
              <div>
                ΔIQR: {formatShift(tooltip.stats.deltaQ1 ?? 0)} to {formatShift(tooltip.stats.deltaQ3 ?? 0)}
              </div>
              <div>
                ΔWhiskers: {formatShift(tooltip.stats.deltaWhiskerLow ?? 0)} to {formatShift(tooltip.stats.deltaWhiskerHigh ?? 0)}
              </div>
            </>
          )}
          <div>n: {tooltip.stats.n}</div>
        </div>
      ) : null}
    </div>
  );
}

export default PhenologyBoxPlotByDecade;
