#!/usr/bin/env bash
# Run all coral_scenarios_data scenarios end-to-end through real Coral.
# For each scenario: wipe Coral sources, regenerate manifests, re-register,
# run the bake. Aggregate results at the end.

set -euo pipefail

CORAL="/Users/akshmnd/Dev Projects/coral/target/release/coral"
AGENT_DIR="/Users/akshmnd/Dev Projects/manthanv2/agent"
cd "$AGENT_DIR"

MODEL="${MODEL:-x-ai/grok-build-0.1}"
SCENARIOS=(
  "S01C-acme-real-coral"
  "S02C-northwind-sla-real"
  "S03C-globex-ae-real"
  "S04C-bottega-vat-real"
  "S05C-saga-migration-real"
)

ALL_SOURCES="stripe salesforce intercom zendesk slack notion posthog gmail sentry hubspot pagerduty datadog"

mkdir -p .manthan/runs
RUN_DIR=".manthan/runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"

echo "Coral battery starting → $RUN_DIR"
echo "Model: $MODEL"
echo

for scenario_id in "${SCENARIOS[@]}"; do
  echo "================================================================"
  echo "  $scenario_id"
  echo "================================================================"

  # Wipe all sources
  for src in $ALL_SOURCES; do
    "$CORAL" source remove "$src" >/dev/null 2>&1 || true
  done

  # Regenerate world + manifests
  .venv/bin/python scripts/setup_coral_bridge.py --scenario "$scenario_id" \
    > "$RUN_DIR/${scenario_id}.setup.log" 2>&1

  # Register fresh sources
  for f in .manthan/coral_sources/*.yaml; do
    "$CORAL" source add --file "$f" >/dev/null 2>&1
  done

  # Run the bake
  .venv/bin/python scripts/scenario_bake.py \
    --model "$MODEL" --only "$scenario_id" --coral \
    2>&1 | tee "$RUN_DIR/${scenario_id}.run.log"

  echo
done

echo "================================================================"
echo "  Battery complete. Logs in $RUN_DIR"
echo "================================================================"
ls -la "$RUN_DIR"
