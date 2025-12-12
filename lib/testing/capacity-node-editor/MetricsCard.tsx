interface MetricsCardProps {
  totalConnections: number
  layerChanges: number
  capacity: string
  probabilityOfFailure: string
}

export function MetricsCard(props: MetricsCardProps) {
  const { totalConnections, layerChanges, capacity, probabilityOfFailure } =
    props

  return (
    <foreignObject x="20" y="20" width="220" height="140">
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
        </div>
      </div>
    </foreignObject>
  )
}
