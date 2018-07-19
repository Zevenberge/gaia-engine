import { Command, Faction, Building, Planet, Round, Booster, Resource, Player, Operator, BoardAction, ResearchField, TechTilePos, AdvTechTilePos, Phase, SubPhase } from './enums';
import Engine from './engine';
import * as _ from 'lodash';
import factions from './factions';
import * as assert from "assert";
import { upgradedBuildings } from './buildings';
import Reward from './reward';
import { boardActions, freeActions, freeActionsHadschHallas, freeActionsTerrans, freeActionsItars, freeActionsNevlas } from './actions';
import * as researchTracks from './research-tracks';


const ISOLATED_DISTANCE = 3;
const UPGRADE_RESEARCH_COST = "4k";
const QIC_RANGE_UPGRADE = 2;

export default interface AvailableCommand {
  name: Command;
  data?: any;
  player?: number;
}

export function generate(engine: Engine): AvailableCommand[] {
  const player = engine.currentPlayer;
  switch (engine.phase) {
    case Phase.SetupInit: {
      return [{ name: Command.Init }];
    }
    case Phase.SetupFaction: {
      return [
        {
          name: Command.ChooseFaction,
          player: engine.currentPlayer,
          data: _.difference(
            Object.values(Faction),
            engine.players.map(pl => pl.faction),
            engine.players.map(pl => factions.opposite(pl.faction))
          )
        }
      ];
    }
    case Phase.SetupBuilding: {
      const planet = engine.player(player).planet;
      const buildings = [];

      for (const hex of engine.map.toJSON()) {
        if (hex.data.planet === planet && !hex.data.building) {
          buildings.push({
            building:
              engine.player(player).faction !== Faction.Ivits
                ? Building.Mine
                : Building.PlanetaryInstitute,
            coordinates: hex.toString(),
            cost: '~'
          });
        }
      }

      return [
        {
          name: Command.Build,
          player,
          data: { buildings }
        }
      ];
    }
    case Phase.SetupBooster: {
      return possibleRoundBoosters(engine, player);
    }
    case Phase.RoundIncome: {
      return possibleIncomes(engine, player);
    }
    case Phase.RoundGaia: {
      switch (engine.subPhase) {
        case SubPhase.ChooseTechTile : {
          return possibleTechTiles(engine, player);
        }
        case SubPhase.CoverTechTile : {
          return possibleCoverTechTiles(engine, player);
        }
        case SubPhase.UpgradeResearch : {
          return possibleResearchAreas(engine, player, "");
        }
        default: return possibleGaiaFreeActions(engine, player);
      }
    }
    case Phase.RoundLeech: {
      return possibleLeech(engine, player);
    }
    case Phase.RoundMove : {
      // We are in a regular round
      const commands = [];


      assert(player !== undefined, "Problem with the engine, player to play is unknown");

      if (engine.subPhase === SubPhase.ChooseTechTile) {
        commands.push(...possibleTechTiles(engine, player));
        return commands;
      }

      if (engine.subPhase === SubPhase.CoverTechTile) {
        commands.push(...possibleCoverTechTiles(engine, player));
        return commands;
      }

      if (engine.subPhase === SubPhase.UpgradeResearch) {
        commands.push(...possibleResearchAreas(engine, player, ""));
        return commands;
      }

      if (engine.subPhase === SubPhase.PlaceLostPlanet) {
        commands.push(...possibleSpaceLostPlanet(engine, player));
        return commands;
      }

      if (engine.subPhase === SubPhase.ChooseFederationTile) {
        commands.push(...possibleFederationTiles(engine, player, "pool"));
        return commands;
      }

      if (engine.subPhase === SubPhase.RescoreFederationTile) {
        commands.push(...possibleFederationTiles(engine, player, "player"));
        return commands;
      }

      if (engine.subPhase === SubPhase.BuildMine) {
        commands.push(...possibleMineBuildings(engine, player));
        commands.push(...possibleFreeActions(engine, player));
        return commands;
      }
      if (engine.subPhase === SubPhase.PISwap) {
        commands.push(...possiblePISwaps(engine, player));
        return commands;
      }
      if (engine.subPhase === SubPhase.BeforeMove) {
        //  boosters
        commands.push(...possibleRoundBoosters(engine, player));

        const buildingCommand = possibleBuildings(engine, player);
        if (buildingCommand) {
          commands.push(buildingCommand);
        }

        // Add federations
        commands.push(...possibleFederations(engine, player));

        // Upgrade research
        commands.push(...possibleResearchAreas(engine, player, UPGRADE_RESEARCH_COST));

        // free actions
        commands.push(...possibleFreeActions(engine, player));

        // power actions
        commands.push(...possibleBoardActions(engine, player));

        // special actions
        commands.push(...possibleSpecialActions(engine, player));

        return commands;
      }

      if (engine.subPhase === SubPhase.AfterMove) {
        // free actions
        commands.push(...possibleFreeActions(engine, player));

        commands.push({
          name: Command.EndTurn,
          player
        });

        return commands;
      }

    }
  }
}

export function possibleBuildings(engine: Engine, player: Player) {
  const map = engine.map;
  const pl = engine.player(player);
  const {data} = pl;
  const buildings = [];

  for (const hex of engine.map.toJSON()) {
    // upgrade existing player's building
    if (hex.buildingOf(player)) {
      const building = hex.buildingOf(player);

      if (player !== hex.data.player) {
        // This is a secondary building, so we can't upgrade it
        continue;
      }

      // excluding Transdim planet until transformed into Gaia planets
      if (hex.data.planet === Planet.Transdim) {
        continue;
      }

      // Lost planet can't be upgraded
      if (hex.data.planet === Planet.Lost) {
        continue;
      }

      const isolated = (() => {
        // We only care about mines that can transform into trading stations;
        if (building !== Building.Mine) {
          return true;
        }

        // Check each other player to see if there's a building in range
        for (const _pl of engine.players) {
          if (_pl !== engine.player(player)) {
            for (const loc of _pl.data.occupied) {
              if (map.distance(loc, hex) < ISOLATED_DISTANCE) {
                return false;
              }
            }
          }
        }

        return true;
      })();

      const upgraded = upgradedBuildings(building, engine.player(player).faction);

      for (const upgrade of upgraded) {
        const {cost, possible} = engine.player(player).canBuild(hex.data.planet, upgrade, {isolated, existingBuilding: building});
        if (possible) {
          buildings.push({
            building: upgrade,
            cost: Reward.toString(cost),
            coordinates: hex.toString()
          });
        }
      }
    } else if (pl.canOccupy(hex)) {
      // planet without building
      // Check if the range is enough to access the planet
      const distance = _.min(data.occupied.map(loc => map.distance(hex, loc)));
      const qicNeeded = Math.max(Math.ceil( (distance - data.range - data.temporaryRange) / QIC_RANGE_UPGRADE), 0);

      const building = hex.data.planet === Planet.Transdim ? Building.GaiaFormer : Building.Mine;
      // No need for terra forming if already occupied by another faction
      const planet = (hex.occupied() ? pl.planet : hex.data.planet);
      const {possible, cost, steps} = pl.canBuild(planet, building, {addedCost: [new Reward(qicNeeded, Resource.Qic)]});

      if (possible) {
          buildings.push({
            building,
            coordinates: hex.toString(),
            cost: Reward.toString(cost),
            steps
        });
      }
    }
  } // end for hex

  if (buildings.length > 0) {
    return {
      name: Command.Build,
      player,
      data: { buildings }
    };
  }
}

export function possibleMineBuildings(engine: Engine, player: Player) {
  const commands = [];
  const buildingCommand = possibleBuildings(engine, player);

  if (buildingCommand) {
    // We filter buildings that aren't mines (like gaia-formers) or
    // that already have a building on there (like gaia-formers)
    buildingCommand.data.buildings = buildingCommand.data.buildings.filter(bld => {
      if (bld.building !== Building.Mine && bld.building !== Building.GaiaFormer) {
        return false;
      }
      return engine.map.grid.getS(bld.coordinates).buildingOf(player) === undefined;
    });

    if (buildingCommand.data.buildings.length > 0) {
      commands.push(buildingCommand);
    }
  }
  return commands;
}
export function possibleSpecialActions(engine: Engine, player: Player) {
  const commands = [];
  const specialacts = [];

  for (const event of engine.player(player).events[Operator.Activate]) {
    if (!event.activated) {
      specialacts.push({
        income: event.spec.replace(Operator.Activate, '').trim(), // Reward.toString(event.rewards),
        spec: event.spec
      });
    }
  }

  if (specialacts.length > 0) {
    commands.push({
      name: Command.Special,
      player,
      data: { specialacts }
    });
  }

  return commands;
}

export function possibleBoardActions(engine: Engine, player: Player) {
  const commands = [];

  const poweracts = Object.values(BoardAction).filter(pwract => engine.boardActions[pwract] && engine.player(player).canPay(Reward.parse(boardActions[pwract].cost)));
  if (poweracts.length > 0) {
    commands.push({
      name: Command.Action,
      player,
      data: { poweracts: poweracts.map(act => ({
        name: act,
        cost: boardActions[act].cost,
        income: boardActions[act].income
      }))}
    });
  }

  return commands;

}

export function possibleFreeActions(engine: Engine, player: Player) {
  // free action - spend
  const pl = engine.player(player);
  const acts = [];
  const commands = [];

  let pool = freeActions;
  if (pl.faction === Faction.HadschHallas && pl.data.hasPlanetaryInstitute()) {
    pool = [].concat(pool, freeActionsHadschHallas);
  }

  if (pl.faction === Faction.Nevlas) {
    pool = [].concat(pool, freeActionsNevlas);
  }

  // freeActions for Terrans during gaiaPhase
  if ( engine.phase === Phase.RoundGaia && pl.canGaiaTerrans() ) {
    pool = freeActionsTerrans;
  }

  // freeActions for Itars during gaiaPhase
  if ( engine.phase === Phase.RoundGaia && pl.canGaiaItars() ) {
    pool = freeActionsItars;
  }

  for (const freeAction of pool) {
    if (pl.canPay(Reward.parse(freeAction.cost))) {
      acts.push({
        cost: freeAction.cost,
        income: freeAction.income
      });
    }
  }

  if (acts.length > 0) {
    commands.push({
      name: Command.Spend,
      player,
      data: { acts }
    });
  }

  // free action - burn
  // TODO generate burn actions based on  Math.ceil( engine.player(player).data.power.area2 / 2)
  if (engine.player(player).data.power.area2 >= 2) {
    commands.push({
      name: Command.BurnPower,
      player,
      data: _.range(1, engine.player(player).data.burnablePower() + 1)
    });
  }

  return commands;
}

export function possibleResearchAreas(engine: Engine, player: Player, cost: string) {
  const commands = [];
  const tracks = [];
  const data = engine.players[player].data;

  if (engine.players[player].canPay(Reward.parse(cost))) {
    for (const field of Object.values(ResearchField)) {

      // already on top
      if (data.research[field] === researchTracks.lastTile(field)) {
        continue;
      }

      // end of the track reached
      const destTile = data.research[field] + 1;

      // To go from 4 to 5, we need to flip a federation and nobody inside
      if (researchTracks.keyNeeded(field, destTile) && data.greenFederations === 0) {
        continue;
      }

      if (engine.playersInOrder().some(pl => pl.data.research[field] === researchTracks.lastTile(field))) {
        continue;
      }

      tracks.push({
        field,
        to: destTile,
        cost
      });

    }
  }

  if (tracks.length > 0) {
    commands.push({
      name: Command.UpgradeResearch,
      player,
      data: { tracks }
    });
  }

  return commands;
}

export function possibleSpaceLostPlanet(engine: Engine, player: Player) {
  const commands = [];
  const data = engine.player(player).data;
  const spaces = [];

  for (const hex of engine.map.toJSON()) {
    // exclude existing planets, satellites and space stations
    if (hex.data.planet !== Planet.Empty || hex.data.federations || hex.data.building) {
      continue;
    }
    const distance = _.min(data.occupied.map(loc => engine.map.distance(hex, loc)));
    // TODO posible to extened? check rules const qicNeeded = Math.max(Math.ceil( (distance - data.range) / QIC_RANGE_UPGRADE), 0);
    if (distance > data.range) {
      continue;
    }

    spaces.push({
      building: Building.Mine,
      coordinates: hex.toString(),
    });
  }

  if (spaces.length > 0) {
    commands.push({
      name: Command.PlaceLostPlanet,
      player,
      data: { spaces }
    });
  }

  return commands;
}

export function possibleRoundBoosters(engine: Engine, player: Player) {
  const commands = [];
  const boosters = Object.values(Booster).filter(booster => engine.roundBoosters[booster]);

  commands.push(
    {
      name: engine.phase === Phase.SetupBooster ? Command.ChooseRoundBooster : Command.Pass,
      player,
      data: { boosters }
    }
  );

  return commands;
}

export function possibleFederations(engine: Engine, player: Player) {
  const commands = [];
  const possibleTiles = Object.keys(engine.federations).filter(key => engine.federations[key] > 0);

  if (possibleTiles.length > 0) {
    const possibleFeds = engine.player(player).availableFederations(engine.map);

    if (possibleFeds.length > 0) {
      commands.push({
        name: Command.FormFederation,
        player,
        data: {
          tiles: possibleTiles,
          federations: possibleFeds.map(fed => ({
            planets: fed.planets,
            satellites: fed.satellites,
            hexes: fed.hexes.map(hex => hex.toString()).sort().join(',')
          }))
        }
      });
    }
  }
  return commands;
}

export function possibleIncomes(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);

  const { descs, needed } = pl.needIncomeSelection();

  if (needed) {
    commands.push({
      name: Command.ChooseIncome,
      player,
      data: descs
    });
  }
  return commands;
}

export function possibleGaiaFreeActions(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);

  if (pl.canGaiaTerrans() || pl.canGaiaItars()) {
    commands.push(...possibleFreeActions(engine, player));
  }
  return commands;
}

export function possibleLeech(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);
  if ( pl.data.leechPossible > 0) {
    commands.push({
      name: Command.Leech,
      player,
      data: {
        leech: pl.data.leechPossible + Resource.ChargePower,
        freeIncome : pl.faction === Faction.Taklons && pl.data.hasPlanetaryInstitute() ? "1t" : ""
      }
    });
    commands.push({
      name: Command.DeclineLeech,
      player,
      data: {
        leech: pl.data.leechPossible + Resource.ChargePower,
        freeIncome : pl.faction === Faction.Taklons && pl.data.hasPlanetaryInstitute() ? "1t" : ""
      }
    });

  }
  return commands;
}

export function possibleCoverTechTiles(engine: Engine, player: Player) {
  const commands = [];

  const tiles = engine.player(player).data.techTiles.filter(tl => tl.enabled);
  commands.push({
    name: Command.ChooseCoverTechTile,
    player,
    data: {tiles: tiles.map(tech => ({
      tile: tech.tile,
      tilePos: Object.values(TechTilePos).find(pos => engine.techTiles[pos].tile === tech.tile)
    }))}
  });

  return commands;
}

export function possibleFederationTiles(engine: Engine, player: Player, from: "pool" | "player") {
  const commands = [];

  const possibleTiles = Object.keys(engine.federations).filter(key => engine.federations[key] > 0);
  const playerTiles = Object.keys(engine.player(player).data.federations);

  commands.push({
    name: Command.ChooseFederationTile,
    player,
    data: {
      tiles: from === "player" ? playerTiles : possibleTiles,
      // Tiles that are rescored just add the rewards, but don't take the token
      rescore: from === "player"
    }
  });

  return commands;
}

export function possibleTechTiles(engine: Engine, player: Player) {
  const commands = [];
  const tiles = [];
  const data = engine.players[player].data;

  //  tech tiles that player doesn't already have
  for (const tilePos of Object.values(TechTilePos)) {
    if (!_.find(data.techTiles, {tile: engine.techTiles[tilePos].tile})) {
      tiles.push({
        tile: engine.techTiles[tilePos].tile,
        tilePos,
        type: "std"
      });
    }
  }

  // adv tech tiles where player has lev 4/5, free federation tokens,
  // and available std tech tiles to cover
  for (const tilePos of Object.values(AdvTechTilePos)) {
    if (engine.advTechTiles[tilePos].numTiles > 0  &&
        data.greenFederations > 0 &&
        data.research[tilePos.slice("adv-".length)] >= 4 &&
        data.techTiles.filter(tech => tech.enabled).length > 0 ) {
          tiles.push({
            tile: engine.advTechTiles[tilePos].tile,
            tilePos,
            type: "adv"
          });
    }
  }
  if (tiles.length > 0) {
    commands.push({
      name: Command.ChooseTechTile,
      player,
      data: { tiles }
  });
  }
  return commands;
}

export function possiblePISwaps(engine: Engine, player: Player) {
  const commands = [];
  const data = engine.player(player).data;
  const buildings = [];

  for (const hex of data.occupied) {
    // exclude existing planets, satellites and space stations
    if (hex.buildingOf(player) === Building.Mine) {
      buildings.push({
        building: Building.Mine,
        coordinates: hex.toString(),
      });
    }
  }

  if (buildings.length > 0) {
    commands.push({
      name: Command.PISwap,
      player,
      data: { buildings }
    });
  }

  return commands;
}
