import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { TinyHypergraphBfsPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphBfsPortPointPathingSolver"
import { useMemo, useState } from "react"

const GOOGLE_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC05",
  "#4285F4",
  "#34A853",
  "#EA4335",
]

const title = "BFS & Tiny Hypergraph"

const createSolverAtIteration = (
  loadedInput: any,
  targetIterationCount: number,
) => {
  const solver = new TinyHypergraphBfsPortPointPathingSolver(
    (Array.isArray(loadedInput) ? loadedInput[0] : loadedInput) as any,
  )

  while (
    solver.iterations < targetIterationCount &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }

  return solver
}

export default () => {
  const [rawJson, setRawJson] = useState("")
  const [loadedInput, setLoadedInput] = useState<any | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [targetIterationInput, setTargetIterationInput] = useState("0")

  const targetIterationCount = Math.max(
    0,
    Number.parseInt(targetIterationInput, 10) || 0,
  )

  const { solver, solverError } = useMemo(() => {
    if (!loadedInput) {
      return { solver: null, solverError: null }
    }

    try {
      return {
        solver: createSolverAtIteration(loadedInput, targetIterationCount),
        solverError: null,
      }
    } catch (error) {
      return {
        solver: null,
        solverError: error instanceof Error ? error.message : String(error),
      }
    }
  }, [loadedInput, targetIterationCount])

  const submitJson = () => {
    try {
      setLoadedInput(JSON.parse(rawJson))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const uploadJsonFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      setRawJson(text)
      try {
        setLoadedInput(JSON.parse(text))
        setLoadError(null)
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    }
    reader.onerror = () => {
      setLoadError("Failed to read uploaded file")
    }
    reader.readAsText(file)
  }

  if (loadedInput && solver && !solverError) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <button
            onClick={() => {
              setLoadedInput(null)
              setLoadError(null)
            }}
            style={{
              border: "none",
              background: "#f1f3f4",
              borderRadius: 999,
              padding: "10px 16px",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Load another JSON
          </button>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: "#202124",
            }}
          >
            Start at iteration
            <input
              type="number"
              min={0}
              step={1}
              value={targetIterationInput}
              onChange={(e) => setTargetIterationInput(e.target.value)}
              style={{
                width: 120,
                borderRadius: 999,
                border: "1px solid #dadce0",
                padding: "10px 14px",
                fontSize: 14,
              }}
            />
          </label>
        </div>

        <GenericSolverDebugger
          key={`debugger-${targetIterationCount}`}
          solver={solver as any}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at top, rgba(66,133,244,0.08), transparent 32%), #ffffff",
        padding: 24,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ width: "min(920px, 100%)", textAlign: "center" }}>
        <div
          style={{
            fontSize: 72,
            lineHeight: 1,
            letterSpacing: -3,
            marginBottom: 24,
            fontWeight: 500,
          }}
        >
          {title.split("").map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              style={{ color: GOOGLE_COLORS[index % GOOGLE_COLORS.length] }}
            >
              {letter}
            </span>
          ))}
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 28,
            boxShadow: "0 2px 12px rgba(60,64,67,0.15)",
            padding: 24,
            textAlign: "left",
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 10, color: "#202124" }}>
            Port Point Pathing Solver JSON
          </div>
          <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 16 }}>
            Paste any serialized `portPointPathingSolver_input.json` payload,
            then open the step debugger. You can also pre-run the solver to a
            target iteration before the debugger mounts.
          </div>

          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder="Paste JSON here"
            style={{
              width: "100%",
              minHeight: 360,
              borderRadius: 18,
              border: "1px solid #dadce0",
              padding: 16,
              fontSize: 13,
              fontFamily:
                "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />

          {(loadError || solverError) && (
            <div
              style={{
                marginTop: 12,
                color: "#c5221f",
                fontSize: 14,
                whiteSpace: "pre-wrap",
              }}
            >
              {loadError ?? solverError}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginTop: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, color: "#5f6368" }}>
              Example path:
              {` /home/ohmx/Downloads/portPointPathingSolver_input.json`}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid #dadce0",
                  background: "#fff",
                  color: "#202124",
                  borderRadius: 999,
                  padding: "12px 18px",
                  fontSize: 14,
                }}
              >
                Start at iteration
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={targetIterationInput}
                  onChange={(e) => setTargetIterationInput(e.target.value)}
                  style={{
                    width: 96,
                    borderRadius: 999,
                    border: "1px solid #dadce0",
                    padding: "8px 12px",
                    fontSize: 14,
                  }}
                />
              </label>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  border: "1px solid #dadce0",
                  background: "#fff",
                  color: "#1a73e8",
                  borderRadius: 999,
                  padding: "12px 22px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Upload JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => uploadJsonFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
              </label>

              <button
                onClick={submitJson}
                style={{
                  border: "none",
                  background: "#1a73e8",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "12px 22px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Open Debugger
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
