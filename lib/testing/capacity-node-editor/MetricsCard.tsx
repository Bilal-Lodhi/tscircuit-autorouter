import type { HighDensitySolvabilityDiagnostics } from "lib/utils/isHighDensityNodeSolvable"

interface MetricsCardProps {
  totalConnections: number
  layerChanges: number
  capacity: string
  probabilityOfFailure: string
  diagnostics: HighDensitySolvabilityDiagnostics
}

export function MetricsCard(props: MetricsCardProps) {
  const {
    totalConnections,
    layerChanges,
    capacity,
    probabilityOfFailure,
    diagnostics,
  } = props

  return (
    <foreignObject x="20" y="20" width="260" height="400">
      <div
        style={{
          backgroundColor: "rgba(30, 41, 59, 0.95)",
          border: "1px solid #60a5fa",
          borderRadius: "8px",
          padding: "12px",
          color: "white",
          fontFamily: "monospace",
          fontSize: "12px",
        }}
      >
        <div
          style={{
            fontWeight: "bold",
            marginBottom: "8px",
            color: "#60a5fa",
          }}
        >
          Node Metrics
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <span style={{ color: "#94a3b8" }}>Connections:</span>{" "}
            <span style={{ fontWeight: "bold" }}>{totalConnections}</span>
          </div>
          <div>
            <span style={{ color: "#94a3b8" }}>Layer Changes:</span>{" "}
            <span style={{ fontWeight: "bold" }}>{layerChanges}</span>
          </div>
          <div>
            <span style={{ color: "#94a3b8" }}>Capacity:</span>{" "}
            <span style={{ fontWeight: "bold" }}>{capacity}</span>
          </div>
          <div>
            <span style={{ color: "#94a3b8" }}>Fail Prob:</span>{" "}
            <span
              style={{
                fontWeight: "bold",
                color:
                  Number(probabilityOfFailure) > 80
                    ? "#ef4444"
                    : Number(probabilityOfFailure) > 50
                      ? "#f97316"
                      : "#22c55e",
              }}
            >
              {probabilityOfFailure}%
            </span>
          </div>
          <div>
            <span style={{ color: "#94a3b8" }}>Solvable:</span>{" "}
            <span
              style={{
                fontWeight: "bold",
                color: diagnostics.isSolvable ? "#22c55e" : "#ef4444",
              }}
            >
              {diagnostics.isSolvable ? "YES" : "NO"}
            </span>
          </div>

          {/* Show detailed diagnostics when not solvable */}
          {!diagnostics.isSolvable && (
            <div
              style={{
                borderTop: "1px solid #475569",
                marginTop: "8px",
                paddingTop: "8px",
                maxHeight: "120px",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  marginBottom: "6px",
                  color: "#ef4444",
                }}
              >
                Why Not Solvable:
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <div>
                  <span style={{ color: "#94a3b8" }}>Port Overlaps:</span>{" "}
                  <span
                    style={{
                      fontWeight: "bold",
                      color:
                        diagnostics.numOverlaps > 0 ? "#ef4444" : "#22c55e",
                    }}
                  >
                    {diagnostics.numOverlaps}
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Crossings:</span>{" "}
                  <span style={{ fontWeight: "bold" }}>
                    {diagnostics.totalCrossings} (
                    {diagnostics.numConnectionsWithCrossings} conn)
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Vias Needed:</span>{" "}
                  <span style={{ fontWeight: "bold" }}>
                    {diagnostics.totalViasNeeded}
                    {diagnostics.effectiveViasUsed <
                      diagnostics.totalViasNeeded &&
                      ` (capped at ${diagnostics.effectiveViasUsed})`}
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Span Needed:</span>{" "}
                  <span style={{ fontWeight: "bold" }}>
                    {diagnostics.requiredSpan.toFixed(2)} mm
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Width:</span>{" "}
                  <span
                    style={{
                      fontWeight: "bold",
                      color:
                        diagnostics.nodeWidth >= diagnostics.requiredSpan
                          ? "#22c55e"
                          : "#ef4444",
                    }}
                  >
                    {diagnostics.nodeWidth.toFixed(2)} mm
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Height:</span>{" "}
                  <span
                    style={{
                      fontWeight: "bold",
                      color:
                        diagnostics.nodeHeight >= diagnostics.requiredSpan
                          ? "#22c55e"
                          : "#ef4444",
                    }}
                  >
                    {diagnostics.nodeHeight.toFixed(2)} mm
                  </span>
                </div>
                <div>
                  <span style={{ color: "#94a3b8" }}>Best Fit:</span>{" "}
                  <span style={{ fontWeight: "bold" }}>
                    {(
                      (diagnostics.requiredSpan /
                        Math.max(
                          diagnostics.nodeWidth,
                          diagnostics.nodeHeight,
                        )) *
                      100
                    ).toFixed(0)}
                    %
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </foreignObject>
  )
}
