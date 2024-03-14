import {
  Direction,
  DirectionCaret,
  DirectionNode,
  PreferredAxis,
  reverseDirection,
  turnPositive,
} from "parsegraph";
import Color from "parsegraph-color";
import { CREASE_ROUNDS, MAX_ROUNDS } from "../settings";

const SIZE = MAX_ROUNDS;

const buildRandom = (steps) => {
  const car = new DirectionCaret();

  for (let i = 0; i < steps; ++i) {
    switch (Math.floor(7 * Math.random())) {
      case 0:
        if (car.has(Direction.FORWARD)) {
          car.pull(Direction.FORWARD);
        } else {
          car.spawnMove(Direction.FORWARD);
        }
        break;
      case 1:
        if (car.has(Direction.BACKWARD)) {
          car.pull(Direction.BACKWARD);
        } else {
          car.spawnMove(Direction.BACKWARD);
        }
        break;
      case 2:
        if (car.has(Direction.DOWNWARD)) {
          car.pull(Direction.DOWNWARD);
        } else {
          car.spawnMove(Direction.DOWNWARD);
        }
        break;
      case 3:
        if (car.has(Direction.UPWARD)) {
          car.pull(Direction.UPWARD);
        } else {
          car.spawnMove(Direction.UPWARD);
        }
        break;
      case 4:
        if (car.has(Direction.INWARD)) {
          car.pull(Direction.INWARD);
        } else {
          car.spawnMove(Direction.INWARD);
        }
        break;
      case 5:
        car.shrink();
        break;
      default:
        if (!car.node().neighbors().isRoot()) {
          car.moveTo(car.node().neighbors().parentNode());
        } else {
          car.node().siblings().setLayoutPreference(PreferredAxis.VERTICAL);
        }
        break;
    }
  }

  return car.root();
};

const buildGrid = (sizeStr) => {
  let size = 5*SIZE;
  if (sizeStr) {
    try {
      if (typeof sizeStr === "string") {
        size = Number.parseInt(sizeStr);
      } else if (typeof sizeStr === "number") {
        size = sizeStr;
      }
    } catch (ex) {
      console.log(ex);
    }
  }
  const car = new DirectionCaret();
  for (let col = 0; col < size; ++col) {
    car.spawnMove("d");
    car.push();
    if (col % CREASE_ROUNDS === 0) {
      car.crease();
    }
    for (let row = 0; row < size; ++row) {
      car.spawnMove("f", row);
      if (row % CREASE_ROUNDS === 0) {
        car.crease();
      }
    }
    car.pop();
  }
  return car.root();
};

const buildAlternatingColumns = () => {
  const styles = {};
  const car = new DirectionCaret();
  for (let col = 0; col < 5 * SIZE; ++col) {
    car.spawnMove("f");
    car.push();
    if (col % CREASE_ROUNDS === 0) {
      car.crease();
    }
    const c = Color.random();
    for (let row = 0; row < 5 * SIZE; ++row) {
      car.spawnMove(col % 2 !== 0 ? "u" : "d", row);
      styles[car.node().id()] = {
        backgroundColor: c.asHex(),
        backgroundAlpha: 1,
      };
    }
    car.pop();
  }
  return [car.root(), null, null, { styles }];
};

const buildPlanner = (inc = 15) => {
  const car = new DirectionCaret();
  for (let hour = 0; hour < 24; ++hour) {
    for (let min = 0; min < 60; min += inc) {
      let str = "";
      if (hour === 0 || hour === 12) {
        str += 12;
      } else if (hour < 12) {
        str += hour;
      } else {
        str += hour - 12;
      }
      str += ":";
      if (min < 10) {
        str += "0" + min;
      } else {
        str += min;
      }
      str += " " + (hour >= 12 ? "PM" : "AM");
      car.spawnMove("d", str);
    }
    car.crease();
  }
  return car.root();
};

const marchSpawn = (car, dir, labels) => {
  if (!labels || labels.length <= 0) {
    throw new Error("No labels to spawn from");
  }
  car.push();
  try {
    car.node().setValue(labels[0]);

    labels = [...labels];
    if (labels.length % CREASE_ROUNDS === 0) {
      car.crease();
    }
    labels.shift();

    if (labels.length === 0) {
      return car.root();
    }

    car.align(dir, "c");
    car.spawnMove(dir);
    car.push();
    try {
      car.pull(dir);
      car.spawnMove(dir);
      car.shrink();
      marchSpawn(car, dir, labels);
    } finally {
      car.pop();
    }
    car.spawnMove(turnPositive(dir));
    car.pull(dir);
    car.spawnMove(dir);
    car.shrink();
    marchSpawn(car, dir, labels);
  } finally {
    car.pop();
  }

  return car.root();
};

const buildTournament = (vertical, ...rounds) => {
  const root = new DirectionNode(rounds[0]);

  const dir = vertical ? Direction.DOWNWARD : Direction.FORWARD;
  const revdir = reverseDirection(dir);

  if (rounds.length > 0) {
    root.connect(dir, marchSpawn(new DirectionCaret(), dir, rounds));
    root.connect(revdir, marchSpawn(new DirectionCaret(), revdir, rounds));
  }
  root.neighbors().nodeAt(dir).setValue();
  root.neighbors().nodeAt(revdir).setValue();
  return root;
};

const buildMarchMadness = (vertical) => {
  return buildTournament(
    vertical,
    "Finals",
    "Conference Finals",
    "Conference Semifinals",
    "First Round"
  );
};
const buildFootballPlayoffs = (vertical) => {
  return buildTournament(
    vertical,
    "Championship",
    "Conference Championship",
    "Divisional Round",
    "Wild Card"
  );
};

const buildRandomRainbow = () => {
  const car = new DirectionCaret();
  const styles = {};

  const size = 50;
  for (let col = 0; col < 2 * size; ++col) {
    car.spawnMove("d");
    car.push();
    if (col % CREASE_ROUNDS === 0) {
      car.crease();
    }

    const a = Color.random();
    const b = Color.random();
    for (let row = 0; row < size; ++row) {
      styles[car.node().id()] = {
        backgroundColor: a.interpolate(b, row / (size - 1)).asHex(),
        backgroundAlpha: 1,
      };
      car.spawnMove("f");
    }
    car.pop();
  }

  return [
    car.root(),
    null,
    null,
    { styles, pageBackgroundColor: Color.random().asRGBA() },
  ];
};

const buildRainbow = (vert) => {
  const car = new DirectionCaret();
  const styles = {};

  const size = 20;
  for (let l = 0; l < size; ++l) {
    car.spawnMove(vert ? "d" : "f");
    car.push();
    if (l % CREASE_ROUNDS === 0) {
      car.crease();
    }

    const llerp = l / (size - 1);
    for (let col = 0; col < size; ++col) {
      car.spawnMove(vert ? "f" : "d");
      car.push();
      const collerp = col / (size - 1);
      const a = Color.fromLCH(100 * 0, 360 * collerp, llerp * 360);
      const b = Color.fromLCH(100 * 1, 360 * collerp, llerp * 360);
      for (let row = 0; row < size; ++row) {
        styles[car.node().id()] = {
          backgroundColor: a.interpolate(b, row / (size - 1)).asHex(),
          backgroundAlpha: 1,
        };
        car.spawnMove(vert ? "d" : "f");
      }
      car.pop();
    }
    car.pop();
  }

  return [
    car.root(),
    null,
    null,
    {
      styles,
      pageBackgroundColor: new Color(56 / 255, 56 / 255, 56 / 255, 1).asRGBA(),
    },
  ];
};

const buildCross = (numRounds) => {
  const car = new DirectionCaret();

  const cross = (car, dir, numRounds) => {
    car.push();
    if (numRounds % CREASE_ROUNDS === 0) {
      car.crease();
    }
    car.spawnMove(dir);
    if (numRounds % 2 === 0) {
      car.shrink();
    }
    car.push();
    if (numRounds >= 0) {
      cross(car, turnLeft(dir), numRounds - 1);
    }
    car.pop();
    car.push();
    if (numRounds >= 0) {
      cross(car, turnRight(dir), numRounds - 1);
    }
    car.pop();
    car.pop();
  };

  forEachCardinalDirection((dir) => {
    cross(car, dir, numRounds);
  });

  return car.root();
};

export {
  buildMarchMadness,
  buildFootballPlayoffs,
  buildTournament,
  buildAlternatingColumns,
  buildGrid,
  buildPlanner,
  buildRandom,
  buildRandomRainbow,
  buildRainbow,
  buildCross
};
