#!/usr/bin/env bash
set -euo pipefail

SOLVER_NAME="${1:-}"
SCENARIO_LIMIT="${2:-}"

# Install benchmark CLI if not available
if ! command -v autorouting-dataset-runner &> /dev/null; then
  echo "Installing @tscircuit/autorouting-dataset-01..."
  bun add -g @tscircuit/autorouting-dataset-01
fi

# Create solver entry file
cat > benchmark-solver.ts << 'EOF'
export * from "./lib"
EOF

# Build if needed
bun run build

# Discover solvers from lib/autorouter-pipelines/index.ts
if [ -z "$SOLVER_NAME" ] || [ "$SOLVER_NAME" = "_" ]; then
  SOLVERS=$(grep -oP 'export\s*\{\s*\K\w+' lib/autorouter-pipelines/index.ts)
  # Resolve aliases from lib/index.ts
  RESOLVED=""
  for S in $SOLVERS; do
    ALIAS=$(grep -oP "${S}\s+as\s+\K\w+" lib/index.ts 2>/dev/null || true)
    RESOLVED="$RESOLVED ${ALIAS:-$S}"
  done
  SOLVERS="$RESOLVED"
else
  SOLVERS="$SOLVER_NAME"
fi

LIMIT_FLAG=""
if [ -n "$SCENARIO_LIMIT" ]; then
  LIMIT_FLAG="--scenario-limit $SCENARIO_LIMIT"
fi

> benchmark-result.txt
for SOLVER in $SOLVERS; do
  echo "=== Benchmarking $SOLVER ==="
  autorouting-dataset-runner benchmark-solver.ts $SOLVER $LIMIT_FLAG 2>&1 | tee -a benchmark-result.txt || true
  echo "" >> benchmark-result.txt
done

echo ""
echo "Results written to benchmark-result.txt"
