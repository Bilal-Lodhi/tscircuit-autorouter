import { expect, test, describe } from "bun:test"
import { getIntraNodeCrossings } from "../../lib/utils/getIntraNodeCrossings"

describe("getIntraNodeCrossings", () => {
  test("detects crossing with floating point coordinates", () => {
    const nodeWithPortPoints = {
      capacityMeshNodeId: "cmn_10",
      center: {
        x: -26.29498410000002,
        y: 16.500028749999984,
      },
      width: 6.190031799999957,
      height: 6.999942500000035,
      portPoints: [
        {
          x: -29.389999999999997,
          y: 13.724999999999996,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -23.19996820000004,
          y: 16.86391444444443,
          z: 0,
          connectionName: "source_net_3",
          rootConnectionName: "source_net_3",
        },
        {
          x: -29.389999999999997,
          y: 13.250028749999984,
          z: 0,
          connectionName: "source_net_2",
          rootConnectionName: "source_net_2",
        },
        {
          x: -29.39,
          y: 19.128333333333334,
          z: 0,
          connectionName: "source_net_2",
          rootConnectionName: "source_net_2",
        },
      ],
      availableZ: [0],
    }

    // source_net_3: segment from (-29.39, 13.72) to (-23.2, 16.86)
    // source_net_2: vertical segment from (-29.39, 13.25) to (-29.39, 19.13)
    // These segments should cross because source_net_3 starts on source_net_2
    const result = getIntraNodeCrossings(nodeWithPortPoints)

    expect(result.numSameLayerCrossings).toBe(1)
  })
})
