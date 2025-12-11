import type { PortPoint } from "lib/types/high-density-types"

export const getNamedPortPoints = (
  portPoints: PortPoint[],
): Array<PortPoint & { connectionName: string }> =>
  portPoints.filter(
    (pp): pp is PortPoint & { connectionName: string } =>
      typeof pp.connectionName === "string",
  )
