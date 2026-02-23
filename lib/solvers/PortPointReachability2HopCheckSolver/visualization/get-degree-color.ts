import {
  DEGREE_0_COLOR,
  DEGREE_1_COLOR,
  DEGREE_2_COLOR,
} from "../constants/colors"

/** Returns the configured color for a BFS degree. */
export const getDegreeColor = (degree: 0 | 1 | 2): string => {
  switch (degree) {
    case 0:
      return DEGREE_0_COLOR
    case 1:
      return DEGREE_1_COLOR
    case 2:
      return DEGREE_2_COLOR
  }
}
