import { useState } from "react"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"

const DEFAULT_TRACE_WIDTH = 0.15
const DEFAULT_OBSTACLE_MARGIN = 0.15
const CORNER_PORT_POINT_CLEARANCE =
  DEFAULT_TRACE_WIDTH + DEFAULT_OBSTACLE_MARGIN

type CornerName = "topLeft" | "topRight" | "bottomRight" | "bottomLeft"

type SerializedHgPortPointPathingSolverParams = {
  graph: {
    regions: Array<{
      regionId: string
      pointIds: string[]
      d: HgPortPointPathingSolverParams["graph"]["regions"][number]["d"]
    }>
    ports: Array<{
      portId: string
      region1Id: string
      region2Id: string
      d: Omit<
        HgPortPointPathingSolverParams["graph"]["ports"][number]["d"],
        "regions"
      >
    }>
  }
  connections: Array<{
    connectionId: string
    mutuallyConnectedNetworkId?: string
    startRegionId: string
    endRegionId: string
    simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
  }>
  colorMap?: Record<string, string>
  layerCount: number
  effort: number
  flags: HgPortPointPathingSolverParams["flags"]
  weights: HgPortPointPathingSolverParams["weights"]
  opts?: HgPortPointPathingSolverParams["opts"]
}

type CornerPortPointMatch = {
  portId: string
  x: number
  y: number
  z: number
  hits: Array<{
    regionId: string
    corner: CornerName
    distance: number
  }>
}

type TinyHypergraphOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
}

type LoadedFixtureInput = {
  fileName: string
  serializedInput: SerializedHgPortPointPathingSolverParams
}

type RegionHg = HgPortPointPathingSolverParams["graph"]["regions"][number]
type RegionPortHg = HgPortPointPathingSolverParams["graph"]["ports"][number]
type ConnectionHg = HgPortPointPathingSolverParams["connections"][number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isString = (value: unknown): value is string => typeof value === "string"

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

const isSerializedHgPortPointPathingSolverParams = (
  value: unknown,
): value is SerializedHgPortPointPathingSolverParams => {
  if (!isRecord(value)) return false
  if (!isFiniteNumber(value.layerCount) || !isFiniteNumber(value.effort)) {
    return false
  }

  const { graph, connections, flags, weights, colorMap } = value
  if (!isRecord(graph) || !Array.isArray(connections)) return false
  if (!isRecord(flags) || !isRecord(weights)) return false
  if (colorMap !== undefined && !isRecord(colorMap)) return false

  if (
    !Array.isArray(graph.regions) ||
    !graph.regions.every((region) => {
      if (!isRecord(region)) return false
      return (
        isString(region.regionId) &&
        isStringArray(region.pointIds) &&
        isRecord(region.d)
      )
    })
  ) {
    return false
  }

  if (
    !Array.isArray(graph.ports) ||
    !graph.ports.every((port) => {
      if (!isRecord(port)) return false
      return (
        isString(port.portId) &&
        isString(port.region1Id) &&
        isString(port.region2Id) &&
        isRecord(port.d)
      )
    })
  ) {
    return false
  }

  return connections.every((connection) => {
    if (!isRecord(connection)) return false
    return (
      isString(connection.connectionId) &&
      isString(connection.startRegionId) &&
      isString(connection.endRegionId) &&
      (connection.mutuallyConnectedNetworkId === undefined ||
        isString(connection.mutuallyConnectedNetworkId))
    )
  })
}

const getSerializedHgPortPointPathingSolverParamsFromUnknown = (
  value: unknown,
): SerializedHgPortPointPathingSolverParams | null => {
  if (isSerializedHgPortPointPathingSolverParams(value)) {
    return value
  }

  if (Array.isArray(value) && value.length > 0) {
    const firstItem = value[0]
    if (isSerializedHgPortPointPathingSolverParams(firstItem)) {
      return firstItem
    }
  }

  return null
}

class FixtureMessageSolver extends BaseSolver {
  constructor(
    private readonly title: string,
    private readonly details: Record<string, unknown>,
  ) {
    super()
    this.solved = true
    this.stats = details
  }

  override visualize(): GraphicsObject {
    return {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
  }

  override getSolverName(): string {
    return this.title
  }

  override getConstructorParams() {
    return [this.details]
  }
}

const deserializeSerializedHgPortPointPathingSolverParams = (
  serialized: SerializedHgPortPointPathingSolverParams,
): HgPortPointPathingSolverParams => {
  const regionById = new Map<string, RegionHg>(
    serialized.graph.regions.map((region) => [
      region.regionId,
      {
        regionId: region.regionId,
        d: region.d,
        ports: [],
      },
    ]),
  )

  const ports: RegionPortHg[] = serialized.graph.ports.map((port) => {
    const region1 = regionById.get(port.region1Id)
    const region2 = regionById.get(port.region2Id)

    if (!region1 || !region2) {
      throw new Error(
        `Missing region reference for port ${port.portId}: ${port.region1Id}, ${port.region2Id}`,
      )
    }

    return {
      portId: port.portId,
      region1,
      region2,
      d: {
        ...port.d,
        regions: [region1, region2],
      },
    }
  })

  const portById = new Map(ports.map((port) => [port.portId, port]))
  for (const region of serialized.graph.regions) {
    const hydratedRegion = regionById.get(region.regionId)
    if (!hydratedRegion) continue

    hydratedRegion.ports = region.pointIds.flatMap((pointId) => {
      const port = portById.get(pointId)
      return port ? [port] : []
    })
  }

  const connections: ConnectionHg[] = serialized.connections.map(
    (connection) => {
      const startRegion = regionById.get(connection.startRegionId)
      const endRegion = regionById.get(connection.endRegionId)

      if (!startRegion || !endRegion) {
        throw new Error(
          `Missing region reference for connection ${connection.connectionId}: ${connection.startRegionId}, ${connection.endRegionId}`,
        )
      }

      return {
        connectionId: connection.connectionId,
        mutuallyConnectedNetworkId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
        startRegion,
        endRegion,
        simpleRouteConnection: connection.simpleRouteConnection,
      }
    },
  )

  return {
    graph: {
      regions: [...regionById.values()],
      ports,
    },
    connections,
    colorMap: serialized.colorMap,
    layerCount: serialized.layerCount,
    effort: serialized.effort,
    flags: serialized.flags,
    weights: serialized.weights,
    opts: serialized.opts,
  }
}

const getCornerPortPointMatches = (
  serializedInput: SerializedHgPortPointPathingSolverParams,
): CornerPortPointMatch[] => {
  const regionById = new Map(
    serializedInput.graph.regions.map((region) => [region.regionId, region]),
  )

  return serializedInput.graph.ports.flatMap((port) => {
    const hits: CornerPortPointMatch["hits"] = []

    for (const regionId of [port.region1Id, port.region2Id]) {
      const region = regionById.get(regionId)
      if (!region) continue

      const halfWidth = region.d.width / 2
      const halfHeight = region.d.height / 2
      const corners: Array<{
        corner: CornerName
        x: number
        y: number
      }> = [
        {
          corner: "topLeft",
          x: region.d.center.x - halfWidth,
          y: region.d.center.y + halfHeight,
        },
        {
          corner: "topRight",
          x: region.d.center.x + halfWidth,
          y: region.d.center.y + halfHeight,
        },
        {
          corner: "bottomRight",
          x: region.d.center.x + halfWidth,
          y: region.d.center.y - halfHeight,
        },
        {
          corner: "bottomLeft",
          x: region.d.center.x - halfWidth,
          y: region.d.center.y - halfHeight,
        },
      ]

      let closestCorner = corners[0]
      let closestDistance = Number.POSITIVE_INFINITY

      if (!closestCorner) {
        return []
      }

      for (const corner of corners) {
        const distance = Math.hypot(port.d.x - corner.x, port.d.y - corner.y)
        if (distance < closestDistance) {
          closestDistance = distance
          closestCorner = corner
        }
      }

      if (closestDistance < CORNER_PORT_POINT_CLEARANCE) {
        hits.push({
          regionId,
          corner: closestCorner.corner,
          distance: closestDistance,
        })
      }
    }

    if (hits.length === 0) {
      return []
    }

    return [
      {
        portId: port.portId,
        x: port.d.x,
        y: port.d.y,
        z: port.d.z,
        hits,
      },
    ]
  })
}

const getUsedPortPointIds = (output: TinyHypergraphOutput) =>
  new Set(
    output.nodesWithPortPoints.flatMap((node) =>
      node.portPoints.map((portPoint) => portPoint.portPointId),
    ),
  )

const buildCornerPortPointVisualization = (
  serializedInput: SerializedHgPortPointPathingSolverParams,
  output: TinyHypergraphOutput,
): GraphicsObject => {
  const usedPortPointIds = getUsedPortPointIds(output)

  return {
    lines: [],
    points: [],
    rects: [],
    circles: getCornerPortPointMatches(serializedInput).map((portPoint) => {
      const isUsed = usedPortPointIds.has(portPoint.portId)

      return {
        center: { x: portPoint.x, y: portPoint.y },
        radius: isUsed ? 0.16 : 0.12,
        fill: isUsed ? "rgba(0, 102, 255, 0.9)" : "rgba(135, 206, 250, 0.7)",
        stroke: isUsed ? "rgba(0, 70, 200, 1)" : "rgba(70, 130, 180, 0.9)",
        layer: `z${portPoint.z}`,
        label: [
          portPoint.portId,
          `corner port point: ${isUsed ? "used" : "unused"}`,
          ...portPoint.hits.map(
            (hit) =>
              `${hit.regionId} ${hit.corner} d=${hit.distance.toFixed(3)} < ${CORNER_PORT_POINT_CLEARANCE.toFixed(3)}`,
          ),
        ].join("\n"),
      }
    }),
  }
}

class TinyHypergraphCornerPortPointFixtureSolver extends TinyHypergraphPortPointPathingSolver {
  constructor(
    params: HgPortPointPathingSolverParams,
    private readonly serializedInput: SerializedHgPortPointPathingSolverParams,
  ) {
    super(params)
  }

  override visualize() {
    const baseVisualization = super.visualize()

    if (!this.solved || this.failed) {
      return baseVisualization
    }

    return combineVisualizations(
      baseVisualization,
      buildCornerPortPointVisualization(this.serializedInput, this.getOutput()),
    )
  }
}

const createFixtureSolver = (loadedInput: LoadedFixtureInput): BaseSolver => {
  const fixtureSolver = new TinyHypergraphCornerPortPointFixtureSolver(
    deserializeSerializedHgPortPointPathingSolverParams(
      loadedInput.serializedInput,
    ),
    loadedInput.serializedInput,
  )

  fixtureSolver.solve()

  const cornerPortPoints = getCornerPortPointMatches(
    loadedInput.serializedInput,
  )
  const usedPortPointIds = getUsedPortPointIds(fixtureSolver.getOutput())
  const usedCornerPortPoints = cornerPortPoints.filter((portPoint) =>
    usedPortPointIds.has(portPoint.portId),
  ).length

  fixtureSolver.stats = {
    ...fixtureSolver.stats,
    selectedInput: loadedInput.fileName,
    cornerPortPointClearance: CORNER_PORT_POINT_CLEARANCE,
    totalCornerPortPoints: cornerPortPoints.length,
    usedCornerPortPoints,
    unusedCornerPortPoints: cornerPortPoints.length - usedCornerPortPoints,
  }

  return fixtureSolver
}

const readFixtureInputFile = async (
  file: File,
): Promise<LoadedFixtureInput> => {
  const parsedJson = JSON.parse(await file.text())
  const serializedInput =
    getSerializedHgPortPointPathingSolverParamsFromUnknown(parsedJson)

  if (!serializedInput) {
    throw new Error(
      "JSON is not a serialized hg port-point-pathing solver input or a single-item array containing one.",
    )
  }

  return {
    fileName: file.name,
    serializedInput,
  }
}

const UploadScreen = (props: {
  errorMessage: string | null
  onFileSelected: (file: File) => void
}) => {
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc_0%,_#e2e8f0_45%,_#cbd5e1_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-10">
        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[32px] border border-white/70 bg-white/80 shadow-[0_40px_120px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="border-b border-slate-200/80 px-8 py-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">
              Find out the corner port points used
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-slate-950">
              Drop a serialized JSON input
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Use this fixture like a focused upload tool: drop any
              port-point-pathing JSON, then move straight into the solver result
              view with the routed paths and corner-port diagnostics.
            </p>
          </div>

          <div className="px-8 py-8">
            <label
              className={[
                "group flex cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed px-8 py-16 text-center transition",
                isDragging
                  ? "border-sky-500 bg-sky-50"
                  : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-white",
              ].join(" ")}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => {
                setIsDragging(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setIsDragging(false)
                const file = event.dataTransfer.files[0]
                if (file) {
                  props.onFileSelected(file)
                }
              }}
            >
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    props.onFileSelected(file)
                    event.currentTarget.value = ""
                  }
                }}
              />

              <div className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white">
                Choose JSON
              </div>
              <div className="mt-6 text-2xl font-medium tracking-[-0.03em] text-slate-900">
                or drag it here
              </div>
              <div className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                Expected shape: serialized hg port-point-pathing input with
                `graph`, `connections`, `layerCount`, `flags`, and `weights`.
              </div>
            </label>

            {props.errorMessage ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {props.errorMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const Portpointpathing03Fixture = () => {
  const [loadedInput, setLoadedInput] = useState<LoadedFixtureInput | null>(
    null,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleFileSelected = (file: File) => {
    void readFixtureInputFile(file)
      .then((nextInput) => {
        setLoadedInput(nextInput)
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to read the dropped JSON file."
        setErrorMessage(message)
      })
  }

  if (!loadedInput) {
    return (
      <UploadScreen
        errorMessage={errorMessage}
        onFileSelected={handleFileSelected}
      />
    )
  }

  return (
    <GenericSolverDebugger solver={createFixtureSolver(loadedInput) as any} />
  )
}

export default Portpointpathing03Fixture
