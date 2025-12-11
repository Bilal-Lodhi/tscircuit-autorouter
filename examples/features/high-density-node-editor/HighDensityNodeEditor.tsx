import { useMemo, useState } from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/CapacityPathingSectionSolver/computeSectionScore"

const createDefaultNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "capacity-node",
  center: { x: 0, y: 0 },
  width: 4,
  height: 3,
  availableZ: [0, 1],
  portPoints: [
    { x: -1.4, y: 1, z: 0, connectionName: "entry-1" },
    { x: 1.4, y: -1, z: 1, connectionName: "exit-1" },
  ],
})

const clampWithinNode = (
  value: number,
  min: number,
  max: number,
  padding = 0.1,
) => {
  const paddedMin = min + padding
  const paddedMax = max - padding
  return Math.min(Math.max(value, paddedMin), paddedMax)
}

export const HighDensityNodeEditor = () => {
  const [node, setNode] = useState<NodeWithPortPoints>(createDefaultNode())
  const availableZ = node.availableZ ?? [0, 1]

  const colorMap = useMemo(
    () => generateColorMapFromNodeWithPortPoints(node),
    [node],
  )

  const usedCapacity = useMemo(
    () => new Set(node.portPoints.map((pt) => pt.connectionName)).size,
    [node.portPoints],
  )

  const totalCapacity = useMemo(
    () => getTunedTotalCapacity1({ width: node.width, availableZ }),
    [node.width, availableZ],
  )

  const probabilityOfFailure = useMemo(
    () =>
      calculateNodeProbabilityOfFailure(
        usedCapacity,
        totalCapacity,
        availableZ.length,
      ),
    [usedCapacity, totalCapacity, availableZ.length],
  )

  const bounds = useMemo(
    () => ({
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }),
    [node.center.x, node.center.y, node.width, node.height],
  )

  const updatePortPoint = (index: number, updated: Partial<PortPoint>) => {
    setNode((prev) => {
      const nextPortPoints = [...prev.portPoints]
      nextPortPoints[index] = { ...nextPortPoints[index], ...updated }
      return { ...prev, portPoints: nextPortPoints }
    })
  }

  const removePortPoint = (index: number) => {
    setNode((prev) => ({
      ...prev,
      portPoints: prev.portPoints.filter((_, idx) => idx !== index),
    }))
  }

  const addPortPoint = (type: "entry" | "exit") => {
    const edgeX =
      type === "entry"
        ? bounds.minX + node.width * 0.05
        : bounds.maxX - node.width * 0.05
    const randomY =
      bounds.minY + ((node.portPoints.length + 1) % 5) * (node.height / 5)

    const nextIndex =
      node.portPoints.filter((pt) => pt.connectionName.startsWith(type)).length +
      1

    const point: PortPoint = {
      x: clampWithinNode(edgeX, bounds.minX, bounds.maxX),
      y: clampWithinNode(randomY, bounds.minY, bounds.maxY),
      z: availableZ[0] ?? 0,
      connectionName: `${type}-${nextIndex}`,
    }

    setNode((prev) => ({ ...prev, portPoints: [...prev.portPoints, point] }))
  }

  const toggleLayer = (layer: number) => {
    setNode((prev) => {
      const existing = new Set(prev.availableZ ?? [])
      if (existing.has(layer)) {
        existing.delete(layer)
      } else {
        existing.add(layer)
      }
      const nextAvailableZ = Array.from(existing).sort()
      return { ...prev, availableZ: nextAvailableZ.length ? nextAvailableZ : [0] }
    })
  }

  const graphics = useMemo(() => {
    const g = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "High Density Node",
      coordinateSystem: "cartesian",
    } as const

    g.lines.push({
      points: [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ],
      strokeColor: "#555",
      strokeWidth: 0.05,
      label: `Node ${node.width.toFixed(2)} x ${node.height.toFixed(2)}`,
    })

    for (const pt of node.portPoints) {
      g.points.push({
        x: pt.x,
        y: pt.y,
        color: colorMap[pt.connectionName] ?? "#1677ff",
        label: `${pt.connectionName} (z=${pt.z})`,
      })
    }

    g.rects.push({
      x: bounds.minX,
      y: bounds.minY,
      width: node.width,
      height: node.height,
      strokeColor: "transparent",
      fill: "rgba(22, 119, 255, 0.04)",
      label: `Capacity ${totalCapacity.toFixed(2)} | Pf ${probabilityOfFailure.toFixed(3)}`,
    })

    return g
  }, [
    bounds.maxX,
    bounds.maxY,
    bounds.minX,
    bounds.minY,
    colorMap,
    node.height,
    node.portPoints,
    node.width,
    probabilityOfFailure,
    totalCapacity,
  ])

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Capacity Node</h2>
            <p className="text-sm text-gray-600">
              Adjust width/height, add entry/exit port points, and review the
              computed capacity plus probability of failure before launching the
              hyper high density solver.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-sm font-medium">
              Width (mm)
              <input
                type="number"
                step="0.1"
                value={node.width}
                onChange={(e) =>
                  setNode((prev) => ({ ...prev, width: Number(e.target.value) }))
                }
                className="border rounded px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm font-medium">
              Height (mm)
              <input
                type="number"
                step="0.1"
                value={node.height}
                onChange={(e) =>
                  setNode((prev) => ({ ...prev, height: Number(e.target.value) }))
                }
                className="border rounded px-2 py-1"
              />
            </label>
          </div>

          <div className="flex gap-3 items-center">
            <button
              className="bg-blue-600 text-white px-3 py-1 rounded"
              onClick={() => addPortPoint("entry")}
            >
              Add entry port
            </button>
            <button
              className="bg-green-600 text-white px-3 py-1 rounded"
              onClick={() => addPortPoint("exit")}
            >
              Add exit port
            </button>
            <div className="flex gap-2 text-sm">
              {[0, 1].map((layer) => (
                <label key={layer} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={availableZ.includes(layer)}
                    onChange={() => toggleLayer(layer)}
                  />
                  z{layer}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-semibold">Capacity</div>
              <div className="text-lg font-mono">{totalCapacity.toFixed(2)}</div>
              <div className="text-gray-600">
                Unique nets consuming capacity: {usedCapacity}
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-semibold">Probability of Failure</div>
              <div
                className="text-lg font-mono"
                title="Based on used capacity, computed capacity, and layer count"
              >
                {probabilityOfFailure.toFixed(3)}
              </div>
              <div className="text-gray-600">
                Layers considered: {availableZ.length}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-semibold">Port Points</div>
            {node.portPoints.map((pt, idx) => (
              <div
                key={`${pt.connectionName}-${idx}`}
                className="grid grid-cols-7 gap-2 items-center text-sm"
              >
                <input
                  value={pt.connectionName}
                  onChange={(e) =>
                    updatePortPoint(idx, { connectionName: e.target.value })
                  }
                  className="border rounded px-2 py-1 col-span-2"
                />
                <input
                  type="number"
                  step="0.1"
                  value={pt.x}
                  onChange={(e) =>
                    updatePortPoint(idx, { x: Number(e.target.value) })
                  }
                  className="border rounded px-2 py-1"
                />
                <input
                  type="number"
                  step="0.1"
                  value={pt.y}
                  onChange={(e) =>
                    updatePortPoint(idx, { y: Number(e.target.value) })
                  }
                  className="border rounded px-2 py-1"
                />
                <input
                  type="number"
                  value={pt.z}
                  onChange={(e) =>
                    updatePortPoint(idx, { z: Number(e.target.value) })
                  }
                  className="border rounded px-2 py-1"
                />
                <button
                  className="text-red-600 border px-2 py-1 rounded"
                  onClick={() => removePortPoint(idx)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white border rounded p-2">
            <InteractiveGraphics graphics={graphics} />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold">Hyper High Density Debugger</h2>
            <p className="text-sm text-gray-600">
              Run the solver directly against the edited node to visualize how
              tall or wide configurations influence routing and Pf.
            </p>
          </div>
          <div className="border rounded">
            <HyperHighDensityDebugger nodeWithPortPoints={node} />
          </div>
        </div>
      </div>
    </div>
  )
}
