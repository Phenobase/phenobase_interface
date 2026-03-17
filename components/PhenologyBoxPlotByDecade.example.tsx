import React, { useState } from "react";
import PhenologyBoxPlotByDecade from "./PhenologyBoxPlotByDecade";
import type { PhenologyObservation } from "./phenologyBoxPlotUtils";

const mockData: PhenologyObservation[] = [
  { year: 1951, doy: 133, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1954, doy: 139, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1958, doy: 141, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1962, doy: 130, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1967, doy: 128, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1969, doy: 136, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1972, doy: 127, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1975, doy: 123, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1978, doy: 132, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1981, doy: 118, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1984, doy: 121, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1988, doy: 125, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1991, doy: 115, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1994, doy: 117, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1998, doy: 112, species: "Acer rubrum", phenophase: "flowering" },
  { year: 2001, doy: 109, species: "Acer rubrum", phenophase: "flowering" },
  { year: 2005, doy: 114, species: "Acer rubrum", phenophase: "flowering" },
  { year: 2008, doy: 107, species: "Acer rubrum", phenophase: "flowering" },
  { year: 1980, doy: 171, species: "Acer rubrum", phenophase: "leaf-out" },
  { year: 1990, doy: 165, species: "Acer rubrum", phenophase: "leaf-out" },
  { year: 2000, doy: 161, species: "Acer rubrum", phenophase: "leaf-out" },
  { year: 2010, doy: 156, species: "Acer rubrum", phenophase: "leaf-out" },
  { year: 1963, doy: 149, species: "Prunus serotina", phenophase: "flowering" },
  { year: 1974, doy: 144, species: "Prunus serotina", phenophase: "flowering" },
  { year: 1986, doy: 137, species: "Prunus serotina", phenophase: "flowering" },
  { year: 1997, doy: 131, species: "Prunus serotina", phenophase: "flowering" },
  { year: 2009, doy: 126, species: "Prunus serotina", phenophase: "flowering" },
];

export function PhenologyBoxPlotByDecadeExample() {
  const [species, setSpecies] = useState<string>("Acer rubrum");
  const [phenophase, setPhenophase] = useState<string>("flowering");

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Species</span>
          <select value={species} onChange={(event) => setSpecies(event.target.value)}>
            <option value="">All species</option>
            <option value="Acer rubrum">Acer rubrum</option>
            <option value="Prunus serotina">Prunus serotina</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Phenophase</span>
          <select value={phenophase} onChange={(event) => setPhenophase(event.target.value)}>
            <option value="">All phenophases</option>
            <option value="flowering">flowering</option>
            <option value="leaf-out">leaf-out</option>
          </select>
        </label>
      </div>

      <PhenologyBoxPlotByDecade
        data={mockData}
        species={species || undefined}
        phenophase={phenophase || undefined}
        title="Mock Phenology Timing"
      />
    </div>
  );
}

export default PhenologyBoxPlotByDecadeExample;
