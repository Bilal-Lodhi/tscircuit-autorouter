import type {
  SerializedGraphPort,
  SerializedHyperGraph,
} from "@tscircuit/hypergraph"

export interface SerializedSolvedRouteLike {
  pathPortIds: string[]
  connectionId: string
}

export type SerializedHyperGraphWithSolvedRoutes = SerializedHyperGraph & {
  solvedRoutes?: SerializedSolvedRouteLike[]
}

export interface HyperGraphSectionSelection {
  regionIds: string[]
}

function portTouchesSection(
  port: SerializedGraphPort,
  selectedRegionIds: Set<string>,
): boolean {
  return (
    selectedRegionIds.has(port.region1Id) || selectedRegionIds.has(port.region2Id)
  )
}

function portsShareSelectedRegion(
  portA: SerializedGraphPort,
  portB: SerializedGraphPort,
  selectedRegionIds: Set<string>,
): boolean {
  const portARegionIds = [portA.region1Id, portA.region2Id]
  const portBRegionIds = new Set([portB.region1Id, portB.region2Id])

  return portARegionIds.some(
    (regionId) =>
      selectedRegionIds.has(regionId) && portBRegionIds.has(regionId),
  )
}

function clipSolvedRouteToSection(params: {
  solvedRoute: SerializedSolvedRouteLike
  keptPortIds: Set<string>
  portById: Map<string, SerializedGraphPort>
  selectedRegionIds: Set<string>
}): SerializedSolvedRouteLike[] {
  const { solvedRoute, keptPortIds, portById, selectedRegionIds } = params
  const clippedRoutes: SerializedSolvedRouteLike[] = []
  let currentPathPortIds: string[] = []

  const flushCurrentPath = () => {
    if (currentPathPortIds.length === 0) return

    clippedRoutes.push({
      connectionId: solvedRoute.connectionId,
      pathPortIds: currentPathPortIds,
    })
    currentPathPortIds = []
  }

  for (const pathPortId of solvedRoute.pathPortIds) {
    const port = portById.get(pathPortId)

    if (!port || !keptPortIds.has(pathPortId)) {
      flushCurrentPath()
      continue
    }

    if (currentPathPortIds.length === 0) {
      currentPathPortIds = [pathPortId]
      continue
    }

    const previousPortId = currentPathPortIds[currentPathPortIds.length - 1]
    const previousPort = previousPortId
      ? portById.get(previousPortId)
      : undefined

    if (
      previousPort &&
      portsShareSelectedRegion(previousPort, port, selectedRegionIds)
    ) {
      currentPathPortIds.push(pathPortId)
      continue
    }

    flushCurrentPath()
    currentPathPortIds = [pathPortId]
  }

  flushCurrentPath()

  return clippedRoutes
}

export function extractSectionOfHyperGraph(
  hyperGraph: SerializedHyperGraphWithSolvedRoutes,
  selection: HyperGraphSectionSelection,
): SerializedHyperGraphWithSolvedRoutes {
  const selectedRegionIds = new Set(selection.regionIds)
  const keptPorts = hyperGraph.ports.filter((port) =>
    portTouchesSection(port, selectedRegionIds),
  )
  const keptPortIds = new Set(keptPorts.map((port) => port.portId))
  const portById = new Map(hyperGraph.ports.map((port) => [port.portId, port]))

  return {
    ...hyperGraph,
    regions: hyperGraph.regions
      .filter((region) => selectedRegionIds.has(region.regionId))
      .map((region) => ({
        ...region,
        pointIds: region.pointIds.filter((pointId) => keptPortIds.has(pointId)),
      })),
    ports: keptPorts,
    solvedRoutes: hyperGraph.solvedRoutes?.flatMap((solvedRoute) =>
      clipSolvedRouteToSection({
        solvedRoute,
        keptPortIds,
        portById,
        selectedRegionIds,
      }),
    ),
  }
}
