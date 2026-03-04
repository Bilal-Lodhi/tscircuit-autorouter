# P95 Max Iterations Tuning Process

## Overview

Solvers have a `MAX_ITERATIONS` limit that determines when they give up. Too low
and we fail problems we could solve; too high and we waste time on unsolvable
problems. P99 tuning sets `MAX_ITERATIONS` to the value needed to solve 99% of
successful problems, then lets users increase it via an `effort` multiplier.

## How It Works

1. Run the benchmark dataset through the full pipeline.
2. Record iteration counts for every solver instance that completes (solved or
   failed).
3. Filter to only **successful** solves for the target solver.
4. Compute the **99th percentile** of those iteration counts.
5. Set `MAX_ITERATIONS = P99_VALUE` in the solver source code.
6. When a user wants more effort, they pass `effort: N` which sets
   `MAX_ITERATIONS = P99_VALUE * N`.

This means:
- `effort: 1` (default) — solves 99% of sub-problems at normal speed
- `effort: 2` — doubles the iteration budget, solving harder problems
- `effort: 0.5` — halves the budget for faster-but-less-complete routing

## Running the Tuning Script

```bash
# Full run against all benchmark scenarios (slow, ~30+ minutes)
bun scripts/p95-iteration-tuning.ts

# Quick test with limited scenarios
bun scripts/p95-iteration-tuning.ts --scenario-limit 10

# Only show stats for a specific solver
bun scripts/p95-iteration-tuning.ts --target-solver HyperSingleIntraNodeSolver

# Use a different pipeline solver
bun scripts/p95-iteration-tuning.ts --solver AutoroutingPipelineSolver
```

## Reading the Output

The script outputs per-solver statistics:

```
--- HyperSingleIntraNodeSolver ---
  Instances: 8437
  Solved: 8357, Failed: 80
  Solved iteration stats:
    Min:   1
    P50:   1
    P90:   94
    P95:   113
    P99:   15,704  <-- recommended MAX_ITERATIONS
    P99.9: 109,555
    Max:   112,807
```

The **P99** line is the value to use as `MAX_ITERATIONS` in the solver.

## Applying the Results

1. Open the solver file (e.g.,
   `lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver.ts`).
2. Update the `P99_MAX_ITERATIONS` constant with the P99 value from the script.
3. The constructor already applies the effort multiplier:
   ```ts
   const P99_MAX_ITERATIONS = 15_704  // Update this value
   // ...
   this.MAX_ITERATIONS = Math.round(P99_MAX_ITERATIONS * effort)
   ```

## Important: Pipeline-Level Impact

Note that P95 is computed over **individual solver instances** (one per
capacity mesh node). A single failed node causes the entire `HighDensitySolver`
to fail, which can cascade to pipeline-level failure. Use a higher effort
multiplier (e.g., `effort: 2` or `effort: 5`) in production contexts where
maximizing pipeline success rate is more important than speed.

## How the Recording Works

`BaseSolver` has a static `onSolverCompleted` callback that fires whenever any
solver instance transitions to solved or failed. The tuning script sets this
callback before running scenarios to collect iteration data. Since solvers like
`HyperSingleIntraNodeSolver` are created hundreds of times within a single
pipeline run, this captures all instances automatically.

```ts
BaseSolver.onSolverCompleted = (solver) => {
  records.push({
    solverName: solver.getSolverName(),
    iterations: solver.iterations,
    solved: solver.solved,
  })
}
```

The callback is `null` by default, so there is zero overhead in normal usage.

## Applying to Other Solvers

To tune a different solver's `MAX_ITERATIONS`:

1. Run the tuning script and find the solver in the output.
2. Add a `P99_MAX_ITERATIONS` constant to the solver file.
3. Use `Math.round(P99_MAX_ITERATIONS * effort)` in the constructor.
4. Thread the `effort` parameter from the pipeline if it isn't already available.

## When to Re-tune

Re-run tuning after:
- Adding new solver strategies or hyperparameter combinations
- Changing the benchmark dataset
- Modifying solver algorithms that affect convergence speed
