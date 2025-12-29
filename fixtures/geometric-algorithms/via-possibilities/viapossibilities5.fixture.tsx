import cn8724 from "fixtures/legacy/assets/cn8724-nodeWithPortPoints.json" with {
  type: "json",
}
import React from "react"
import { ViaPossibilitiesDebugger } from "./ViaPossibilitiesDebugger"
import { NodeWithPortPoints } from "lib/types/high-density-types"

export default () => {
  // Cast is needed because the imported JSON doesn't perfectly match the type
  const nodeWithPortPoints = cn8724.nodeWithPortPoints as NodeWithPortPoints

  return <ViaPossibilitiesDebugger nodeWithPortPoints={nodeWithPortPoints} />
}
