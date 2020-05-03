import axios from 'axios';
import Engine from './index';
import crypto from "crypto";
import { EngineOptions } from './src/engine';
import { Round } from './src/enums';

export async function init (nbPlayers: number, expansions: string[], options: EngineOptions & {balancedGeneration: boolean}, seed?: string): Promise<Engine> {
  if (!seed) {
    seed = crypto.randomBytes(8).toString('base64');
  }

  let numberSeed: number;
  // If the seed is a number, use it directly, otherwise use a number generated from its hash
  if ('' + parseInt(seed, 10) === seed) {
    numberSeed = parseInt(seed, 10);
  } else {
    const md5sum = crypto.createHash("md5");
    md5sum.update(seed);
    numberSeed = ('' + parseInt(seed, 10)) === seed ? parseInt(seed, 10) : parseInt(md5sum.digest("hex").slice(-10), 16);
  }

  if (expansions.includes("spaceships")) {
    options.spaceShips = true;
  }

  if (options.balancedGeneration) {
    delete options.balancedGeneration;

    const resp = await axios.post('http://gaia-project.hol.es', {seed: numberSeed, player: this.options.setup.nbPlayers}).then(r => r.data);

    options.map = {sectors: resp.map};

    // We use different standards for sides A & B of sectors than the online generator
    if (nbPlayers === 2) {
      options.map.sectors.forEach(val => val.sector = val.sector.replace(/A/, 'B'));
    } else {
      options.map.sectors.forEach(val => val.sector = val.sector.replace(/B/, 'A'));
    }
  }

  return new Engine([`init ${nbPlayers} ${seed}`], options);
}

export function setPlayerMetaData(engine: Engine, player: number, metaData: {name: string}) {
  engine.players[player].name = metaData.name;

  return engine;
}

export async function move(engine: Engine, move: string, player: number) {
  if (!move) {
    // Don't save
    engine.newTurn = false;
    return engine;
  }

  if (!(engine instanceof Engine)) {
    engine = Engine.fromData(engine);
  }

  const round = engine.round;
  engine.move(move);
  engine.generateAvailableCommandsIfNeeded();

  if (engine.newTurn) {
    afterMove(engine, round);

    automove(engine);
  }

  return engine;
}

function afterMove(engine: Engine, oldRound: number) {
  if (engine.round > oldRound && engine.round > 0) {
    (engine as any).messages = [...((engine as any).messages || []), `Round ${engine.round}`];
  }
}

function automove(engine: Engine) {
  let modified: boolean;
  do {
    modified = false;
    let oldRound = engine.round;

    while (!cancelled(engine) && !ended(engine) && engine.player(engine.playerToMove).dropped) {
      engine.autoPass();

      afterMove(engine, oldRound);
      modified = true;
      oldRound = engine.round;
    }

    oldRound = engine.round;

    while (engine.autoChargePower()) {
      afterMove(engine, oldRound);
      modified = true;
      oldRound = engine.round;
    }
  } while (modified);
}

export function ended (engine: Engine) {
  return engine.ended;
}

export function cancelled (engine: Engine) {
  return engine.ended && engine.round < Round.LastRound;
}

export function scores (engine: Engine) {
  return engine.players.map(pl => pl.data.victoryPoints);
}

export async function dropPlayer (engine: Engine, player: number) {
  engine = engine instanceof Engine ? engine : Engine.fromData(engine);

  engine.players[player].dropped = true;

  if (engine.round <= 0) {
    engine.ended = true;
  } else {
    automove(engine);
  }

  return engine;
}

export function currentPlayer (engine: Engine) {
  return engine.playerToMove;
}

export function toSave (engine: Engine) {
  if (!engine.newTurn) {
    return undefined;
  }
  return engine;
}

export function messages (engine: Engine) {
  const messages = (engine as any).messages || [];
  delete (engine as any).messages;

  return {
    messages,
    engine
  };
}
