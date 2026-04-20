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

const title = "BFS & tiny hypergraph"

export default () => {
  const [rawJson, setRawJson] = useState("")
  const [loadedInput, setLoadedInput] = useState<any | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const { solver, solverError } = useMemo(() => {
    if (!loadedInput) return { solver: null, solverError: null }
    try {
      return {
        solver: new TinyHypergraphBfsPortPointPathingSolver(
          (Array.isArray(loadedInput) ? loadedInput[0] : loadedInput) as any,
        ),
        solverError: null,
      }
    } catch (error) {
      return {
        solver: null,
        solverError: error instanceof Error ? error.message : String(error),
      }
    }
  }, [loadedInput])

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

  if (solver) {
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => {
            setLoadedInput(null)
            setLoadError(null)
          }}
          style={{
            marginBottom: 16,
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
        <GenericSolverDebugger solver={solver as any} />
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
            then open the step debugger.
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
