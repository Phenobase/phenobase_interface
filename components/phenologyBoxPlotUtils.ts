export interface PhenologyObservation {
  year: number;
  doy: number;
  species?: string;
  phenophase?: string;
}

export type WhiskerMode = "tukey" | "percentile";

export interface GroupedDecade {
  decadeStart: number;
  label: string;
  observations: PhenologyObservation[];
}

export interface BoxStats {
  decadeStart: number;
  label: string;
  n: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowerFence: number;
  upperFence: number;
  whiskerLow: number;
  whiskerHigh: number;
  percentile5: number;
  percentile95: number;
  outliers: number[];
}

export interface ObservationFilter {
  species?: string;
  phenophase?: string;
}

function clampDoy(value: number): number {
  return Math.max(1, Math.min(365, value));
}

function numericAscending(a: number, b: number): number {
  return a - b;
}

function quantile(sortedValues: number[], percentile: number): number {
  if (!sortedValues.length) {
    throw new Error("Cannot compute a quantile for an empty array.");
  }

  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];

  const weight = index - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

export function getDecade(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function filterObservations(
  data: PhenologyObservation[],
  filters: ObservationFilter = {},
): PhenologyObservation[] {
  return data.filter((record) => {
    if (!Number.isFinite(record.year) || !Number.isFinite(record.doy)) return false;
    if (filters.species && record.species !== filters.species) return false;
    if (filters.phenophase && record.phenophase !== filters.phenophase) return false;
    return true;
  });
}

export function groupByDecade(data: PhenologyObservation[]): GroupedDecade[] {
  const grouped = new Map<number, PhenologyObservation[]>();

  data.forEach((record) => {
    const decadeStart = getDecade(record.year);
    const bucket = grouped.get(decadeStart) || [];
    bucket.push(record);
    grouped.set(decadeStart, bucket);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([decadeStart, observations]) => ({
      decadeStart,
      label: `${decadeStart}s`,
      observations,
    }));
}

export function computeBoxStats(
  values: number[],
  whiskerMode: WhiskerMode = "tukey",
): Omit<BoxStats, "decadeStart" | "label"> | null {
  const sortedValues = values
    .filter((value) => Number.isFinite(value))
    .map((value) => clampDoy(Math.round(value)))
    .sort(numericAscending);

  if (!sortedValues.length) return null;

  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];
  const q1 = quantile(sortedValues, 0.25);
  const median = quantile(sortedValues, 0.5);
  const q3 = quantile(sortedValues, 0.75);
  const percentile5 = quantile(sortedValues, 0.05);
  const percentile95 = quantile(sortedValues, 0.95);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  let whiskerLow = min;
  let whiskerHigh = max;

  if (whiskerMode === "percentile") {
    whiskerLow = percentile5;
    whiskerHigh = percentile95;
  } else {
    const lowerCandidate = sortedValues.find((value) => value >= lowerFence);
    const upperCandidate = [...sortedValues].reverse().find((value) => value <= upperFence);
    whiskerLow = lowerCandidate ?? min;
    whiskerHigh = upperCandidate ?? max;
  }

  const outliers = sortedValues.filter((value) => value < whiskerLow || value > whiskerHigh);

  return {
    n: sortedValues.length,
    min,
    max,
    q1,
    median,
    q3,
    iqr,
    lowerFence,
    upperFence,
    whiskerLow,
    whiskerHigh,
    percentile5,
    percentile95,
    outliers,
  };
}

export function buildPhenologyBoxPlotSeries(
  data: PhenologyObservation[],
  filters: ObservationFilter = {},
  whiskerMode: WhiskerMode = "tukey",
): BoxStats[] {
  const filtered = filterObservations(data, filters);

  return groupByDecade(filtered)
    .map(({ decadeStart, label, observations }) => {
      const stats = computeBoxStats(
        observations.map((observation) => observation.doy),
        whiskerMode,
      );

      if (!stats) return null;

      return {
        decadeStart,
        label,
        ...stats,
      };
    })
    .filter((stats): stats is BoxStats => stats !== null);
}
