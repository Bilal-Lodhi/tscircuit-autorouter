import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../examples/bug-reports/bugreport18-1b2d06/bugreport18-1b2d06.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport18-1b2d06.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

test("bugreport18 tracks via count with MLCP optimization", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  // Debug: Check MLCP nodes
  const mlcpNodes = solver.capacityNodes?.filter(n => n._isMultiLayerConnectionPoint) ?? []
  console.log("MLCP nodes count:", mlcpNodes.length)

  // Debug: Check capacity paths
  const capacityPaths = solver.pathingOptimizer?.getCapacityPaths() ?? []
  console.log("Capacity paths with layer info:", capacityPaths.filter(p => p.startZ !== undefined).map(p => ({
    name: p.connectionName,
    startZ: p.startZ,
    endZ: p.endZ,
  })))

  // Debug: Check segment solver output for problematic connections
  const segmentSolver = solver.segmentToPointSolver
  const nodesWithPortPoints = segmentSolver?.getNodesWithPortPoints() ?? []
  const problematicConnections = ["source_net_0", "source_net_1", "source_net_3", "source_net_5", "source_net_6"]
  for (const conn of problematicConnections) {
    const points = nodesWithPortPoints.flatMap(n => n.portPoints.filter(p => p.connectionName === conn))
    console.log(`${conn} port points:`, points.map(p => ({ x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z, availableZ: (p as any).availableZ })))
  }

  // Check MLCP nodes and their availableZ
  const mlcpNodesWithAvailableZ = nodesWithPortPoints.filter(n => n.availableZ && n.availableZ.length > 1)
  console.log("MLCP nodes with availableZ:", mlcpNodesWithAvailableZ.length, mlcpNodesWithAvailableZ.map(n => ({ nodeId: n.capacityMeshNodeId, availableZ: n.availableZ })))

  // Debug: Check port point z values for each connection
  const connectionZValues: Record<string, number[]> = {}
  for (const node of nodesWithPortPoints) {
    for (const pt of node.portPoints) {
      if (!connectionZValues[pt.connectionName]) {
        connectionZValues[pt.connectionName] = []
      }
      connectionZValues[pt.connectionName].push(pt.z)
    }
  }
  console.log("Port point z values per connection:", Object.fromEntries(
    Object.entries(connectionZValues).map(([name, zs]) => [name, [...new Set(zs)].sort()])
  ))

  const output = solver.getOutputSimpleRouteJson()
  const traces = output.traces ?? []

  // Count all vias across all traces and identify which connections have vias
  let viaCount = 0
  const connectionsWithVias: string[] = []
  for (const trace of traces) {
    if (trace.type === "pcb_trace") {
      let traceVias = 0
      const layerTransitions: string[] = []
      let prevLayer: string | null = null
      for (const segment of trace.route) {
        if (segment.route_type === "via") {
          viaCount++
          traceVias++
        }
        if (segment.route_type === "wire") {
          if (prevLayer && prevLayer !== segment.layer) {
            layerTransitions.push(`${prevLayer}->${segment.layer}`)
          }
          prevLayer = segment.layer
        }
      }
      if (traceVias > 0 || layerTransitions.length > 0) {
        connectionsWithVias.push(`${trace.connection_name}: ${traceVias} vias, transitions: ${layerTransitions.join(", ")}`)
      }
    }
  }

  console.log("Connections with vias/transitions:", connectionsWithVias)
  console.log("Total via count:", viaCount)

  // With initial MLCP layer optimization in A*, via count should be reduced
  // Note: Achieving 0 vias requires changes to MultiHeadPolyLine solver to respect assigned layers
  // Current state: Layer assignment based on geometric crossings, via neighbors skipped when A.z === B.z
  expect(viaCount).toBeLessThanOrEqual(7)
})
