import React, { useId, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  buildPhenologyBoxPlotSeries,
  type BoxStats,
  type ObservationFilter,
  type PhenologyObservation,
  type WhiskerMode,
} from "./phenologyBoxPlotUtils";

type ViewMode = "boxplot" | "band";

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
  yDomain?: [number, number];
}

interface TooltipState {
  x: number;
  y: number;
  stats: BoxStats;
}

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 420;

function formatDoy(value: number): string {
  return `${Math.round(value)}`;
}

function yScale(value: number, plotTop: number, plotHeight: number, domain: [number, number]): number {
  const [min, max] = domain;
  const ratio = (value - min) / (max - min || 1);
  return plotTop + plotHeight - ratio * plotHeight;
}

function renderYAxisTicks(plotTop: number, plotLeft: number, plotHeight: number, domain: [number, number]) {
  const ticks = [1, 60, 120, 180, 240, 300, 365];

  return ticks.map((tick) => {
    const y = yScale(tick, plotTop, plotHeight, domain);
    return (
      <g key={tick}>
        <line x1={plotLeft} x2={DEFAULT_WIDTH - 24} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
        <text x={plotLeft - 10} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
          {tick}
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
  species,
  phenophase,
  yDomain = [1, 365],
}: PhenologyBoxPlotByDecadeProps) {
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>(defaultViewMode);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartId = useId();

  const resolvedViewMode = viewMode ?? internalViewMode;
  const series = buildPhenologyBoxPlotSeries(data, { species, phenophase }, whiskerMode);

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
          const y = yScale(stats.q3, margin.top, plotHeight, yDomain);
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
          const y = yScale(stats.q1, margin.top, plotHeight, yDomain);
          return `L ${x} ${y}`;
        })
        .join(" ")
    : "";

  const medianLinePath = series
    .map((stats, index) => {
      const x = margin.left + step * index + step / 2;
      const y = yScale(stats.median, margin.top, plotHeight, yDomain);
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
            Day of Year by decade
            {species ? ` • species: ${species}` : ""}
            {phenophase ? ` • phenophase: ${phenophase}` : ""}
          </div>
        </div>
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

        {renderYAxisTicks(margin.top, margin.left, plotHeight, yDomain)}

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
          const q1Y = yScale(stats.q1, margin.top, plotHeight, yDomain);
          const medianY = yScale(stats.median, margin.top, plotHeight, yDomain);
          const q3Y = yScale(stats.q3, margin.top, plotHeight, yDomain);
          const whiskerLowY = yScale(stats.whiskerLow, margin.top, plotHeight, yDomain);
          const whiskerHighY = yScale(stats.whiskerHigh, margin.top, plotHeight, yDomain);

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
                    ? stats.outliers.map((value, outlierIndex) => (
                        <circle
                          key={`${stats.decadeStart}-${outlierIndex}-${value}`}
                          cx={centerX}
                          cy={yScale(value, margin.top, plotHeight, yDomain)}
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
          Day of Year
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
          <div>Median: {formatDoy(tooltip.stats.median)}</div>
          <div>
            IQR: {formatDoy(tooltip.stats.q1)} to {formatDoy(tooltip.stats.q3)}
          </div>
          <div>
            Whiskers: {formatDoy(tooltip.stats.whiskerLow)} to {formatDoy(tooltip.stats.whiskerHigh)}
          </div>
          <div>n: {tooltip.stats.n}</div>
        </div>
      ) : null}
    </div>
  );
}

export default PhenologyBoxPlotByDecade;
