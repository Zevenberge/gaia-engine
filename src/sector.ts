import { Grid } from "hexagrid";
import { Planet } from "./enums";

import { GaiaHex } from "./gaia-hex";

export default class Sector {
  /**
   * Generates a new sector
   *
   * @param definition The contents of the sector
   * @param id The id of the sector
   */
  public static create(definition: Planet[] | string, name: string, center = { q: 0, r: 0, s: 0 }): Grid<GaiaHex> {
    // Converts a string like eee,dsee,eeere,eeem,ove into an array of array of planets
    if (typeof definition === "string") {
      definition = definition.split("") as Planet[];
    }

    // flatten the array
    const planetArray: Planet[] = [].concat(...definition);
    const dataArray = planetArray.map((planet) => ({ planet, sector: name }));
    const grid = new Grid<GaiaHex>(...(GaiaHex.hexagon(2, { center, data: dataArray }) as GaiaHex[]));

    return grid;
  }
}
