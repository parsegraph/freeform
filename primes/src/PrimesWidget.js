import { DirectionCaret, DirectionNode } from "parsegraph";
import PrimesModulo from "./PrimesModulo";

export default class PrimesWidget {
  constructor() {
    this.knownPrimes = [];
    this.position = 1;
  }

  isPaused() {
    return this._paused;
  }

  step() {
    // console.log("Stepping primes widget");
    if (this.position === 1) {
      this.position++;
      return new DirectionNode(1);
    }
    const car = new DirectionCaret(this.position);
    car.push();
    car.pull("u");
    car.crease();

    let isPrime = true;

    // Check if any known prime is a multiple of the current position.
    for (let i = 0; i < this.knownPrimes.length; ++i) {
      const prime = this.knownPrimes[i];
      const modulus = prime.calculate(this.position);
      if (modulus == 0) {
        // It's a multiple, so there's no chance for primality.
        car.spawnMove("u", prime.frequency);
        isPrime = false;
      } else {
        car.spawnMove("u", " ");
      }
      car.node().setId(`${this.position}:${prime.frequency}`);
      if (i === 0) {
        car.crease();
      }
    }
    if (isPrime) {
      // The position is prime, so output it and add it to the list.
      car.spawnMove("u", this.position);
      this.knownPrimes.push(new PrimesModulo(this.position));
    }
    car.pop();

    // Advance.
    ++this.position;
    
    return car.root();
  }
}