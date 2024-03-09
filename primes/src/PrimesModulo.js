export default class PrimesModulo {
  constructor(frequency) {
    this.frequency = frequency;
    this.target = 0;
  }

  calculate(num) {
    while (num > this.target) {
      this.target += this.frequency;
    }
    return this.target - num;
  }

  value() {
    return this.frequency;
  }
}