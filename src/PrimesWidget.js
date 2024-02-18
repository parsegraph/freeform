import { DirectionCaret } from "parsegraph";
import PrimesModulo from "./PrimesModulo";

export default class PrimesWidget {
  constructor() {
    this.knownPrimes = [];
    this.position = 2;

    this.caret = new DirectionCaret("1");
  }

  isPaused() {
    return this._paused;
  }

  step() {
    // console.log("Stepping primes widget");
    // Check if any known prime is a multiple of the current position.
    this.caret.spawnMove("f", this.position);
    this.caret.push();
    this.caret.pull("u");
    this.caret.crease();
    let isPrime = true;

    for (let i = 0; i < this.knownPrimes.length; ++i) {
      const prime = this.knownPrimes[i];
      const modulus = prime.calculate(this.position);
      if (modulus == 0) {
        // It's a multiple, so there's no chance for primality.
        this.caret.spawnMove("u", prime.frequency);
        isPrime = false;
      } else {
        this.caret.spawnMove("u", "s");
      }
      this.caret
        .node()
        .setId(this.position + ":" + prime.frequency);
      if (i === 0) {
        this.caret.crease();
      }
    }
    if (isPrime) {
      // The position is prime, so output it and add it to the list.
      this.caret.spawnMove("u", this.position);
      this.knownPrimes.push(new PrimesModulo(this.position));
    }
    this.caret.pop();

    // Advance.
    ++this.position;
  }

  node() {
    return this.caret.root();
  }
}