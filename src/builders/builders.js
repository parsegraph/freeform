import { Direction, DirectionCaret, PreferredAxis } from 'parsegraph';

const SIZE = 25;

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

const buildGrid = () => {
  const car = new DirectionCaret();
  for(let col = 0; col < SIZE; ++col) {
    car.spawnMove('d', col);
    car.push();
    for(let row = 0; row < SIZE; ++row) {
      car.spawnMove('f', row);
    }
    car.pop();
  }
  return car.root();
};

const buildAlternatingColumns = () => {
  const car = new DirectionCaret();
  for(let col = 0; col < SIZE; ++col) {
    car.spawnMove('f');
    car.push();
    for(let row = 0; row < SIZE; ++row) {
      car.spawnMove(col % 2 !== 0 ? 'u' : 'd', row);
    }
    car.pop();
  }
  return car.root();
}

const buildPlanner = (inc = 15) => {
  const car = new DirectionCaret();
  for(let hour = 0; hour < 24; ++hour) {
    for(let min = 0; min < 60; min += inc) {
      let str = "";
      if (hour === 0 || hour === 12) {
        str += 12;
      } else if (hour < 12) {
        str += (hour);
      } else {
        str += (hour - 12);
      }
      str += ":";
      if (min < 10) {
        str += "0" + min;
      } else {
        str += min;
      }
      str += " " + (hour >= 12 ? "PM" : "AM");
      car.spawnMove('d', str);
    }
  }
  return car.root();
}

export {
    buildAlternatingColumns,
    buildGrid,
    buildPlanner,
    buildRandom
}
