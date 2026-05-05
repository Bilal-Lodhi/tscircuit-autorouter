import sample001 from "../datasets/dataset-srj15/sample01-region-reroute.srj.json" with {
  type: "json",
}
import sample002 from "../datasets/dataset-srj15/sample02-region-reroute.srj.json" with {
  type: "json",
}
import sample003 from "../datasets/dataset-srj15/sample03-region-reroute.srj.json" with {
  type: "json",
}
import sample004 from "../datasets/dataset-srj15/sample04-region-reroute.srj.json" with {
  type: "json",
}
import sample005 from "../datasets/dataset-srj15/sample05-region-reroute.srj.json" with {
  type: "json",
}
import sample006 from "../datasets/dataset-srj15/sample06-region-reroute.srj.json" with {
  type: "json",
}
import sample007 from "../datasets/dataset-srj15/sample07-region-reroute.srj.json" with {
  type: "json",
}
import sample008 from "../datasets/dataset-srj15/sample08-region-reroute.srj.json" with {
  type: "json",
}
import sample009 from "../datasets/dataset-srj15/sample09-region-reroute.srj.json" with {
  type: "json",
}
import sample010 from "../datasets/dataset-srj15/sample10-region-reroute.srj.json" with {
  type: "json",
}
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuits = [
  { id: "001", srj: sample001 },
  { id: "002", srj: sample002 },
  { id: "003", srj: sample003 },
  { id: "004", srj: sample004 },
  { id: "005", srj: sample005 },
  { id: "006", srj: sample006 },
  { id: "007", srj: sample007 },
  { id: "008", srj: sample008 },
  { id: "009", srj: sample009 },
  { id: "010", srj: sample010 },
] satisfies DatasetCircuit[]

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj15" circuits={circuits} />
)
