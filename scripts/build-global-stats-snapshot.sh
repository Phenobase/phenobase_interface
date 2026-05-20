#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${OUTPUT_PATH:-$ROOT_DIR/app/global-stats-snapshot.json}"
API_URL="${API_URL:-https://biscicol.org/phenobase/api/v1/query//phenobase2/_search?size=0&from=0}"
MIN_DECADE="${MIN_DECADE:-1970}"
MAX_DECADE="${MAX_DECADE:-2020}"

TMP_REQUEST="$(mktemp)"
TMP_RESPONSE="$(mktemp)"
trap 'rm -f "$TMP_REQUEST" "$TMP_RESPONSE"' EXIT

cat > "$TMP_REQUEST" <<JSON
{
  "size": 0,
  "track_total_hits": false,
  "query": {
    "range": {
      "decadeStart": {
        "gte": ${MIN_DECADE}
      }
    }
  },
  "aggs": {
    "datasource_0": { "terms": { "field": "dataSource", "size": 100 } },
    "decadeDistribution_1": {
      "histogram": {
        "field": "decadeStart",
        "interval": 10,
        "min_doc_count": 0,
        "extended_bounds": { "min": ${MIN_DECADE}, "max": ${MAX_DECADE} }
      }
    },
    "family_2": { "terms": { "field": "family", "size": 50 } },
    "genus_3": { "terms": { "field": "genus", "size": 50 } },
    "phenophasePresenceSummary_4": {
      "filters": {
        "filters": {
          "unfolded_true_leaf_present": { "term": { "mappedTraits": "unfolded true leaf present" } },
          "unfolded_true_leaf_absent": { "term": { "mappedTraits": "unfolded true leaf absent" } },
          "breaking_vegetative_bud_present": { "term": { "mappedTraits": "breaking vegetative bud present" } },
          "breaking_vegetative_bud_absent": { "term": { "mappedTraits": "breaking vegetative bud absent" } },
          "senescing_true_leaf_present": { "term": { "mappedTraits": "senescing true leaf present" } },
          "senescing_true_leaf_absent": { "term": { "mappedTraits": "senescing true leaf absent" } },
          "flower_present": { "term": { "mappedTraits": "flower present" } },
          "flower_absent": { "term": { "mappedTraits": "flower absent" } },
          "open_flower_present": { "term": { "mappedTraits": "open flower present" } },
          "open_flower_absent": { "term": { "mappedTraits": "open flower absent" } },
          "simple_fruit_or_compound_fruit_present": { "term": { "mappedTraits": "simple fruit or compound fruit present" } },
          "simple_fruit_or_compound_fruit_absent": { "term": { "mappedTraits": "simple fruit or compound fruit absent" } },
          "ripe_fruit_present": { "term": { "mappedTraits": "ripe fruit present" } },
          "ripe_fruit_absent": { "term": { "mappedTraits": "ripe fruit absent" } }
        }
      }
    }
  }
}
JSON

echo "Fetching global stats snapshot from:"
echo "  $API_URL"

curl -sS \
  -X POST \
  "$API_URL" \
  -H "Content-Type: application/json" \
  --data @"$TMP_REQUEST" \
  > "$TMP_RESPONSE"

python3 - "$TMP_RESPONSE" "$OUTPUT_PATH" <<'PY'
import datetime
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])

with response_path.open() as f:
    response = json.load(f)

aggregations = response.get("aggregations")
if not isinstance(aggregations, dict):
    raise SystemExit("Snapshot build failed: response did not contain an aggregations object.")

payload = {
    "ready": True,
    "generatedAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    "summaryOnly": True,
    "traitNote": "Showing a lighter high-level phenophase summary for the unfiltered global view.",
    "aggregations": aggregations,
}

output_path.parent.mkdir(parents=True, exist_ok=True)
with output_path.open("w") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")

print(f"Wrote {output_path}")
PY
