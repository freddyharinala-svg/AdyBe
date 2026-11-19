const MASK64 = (1n << 64n) - 1n;
const MULTIPLIER = 6364136223846793005n;

export class GodotRandom {
  constructor(seed = 12047754176567800795n) {
    this.state = 0n;
    this.inc = 0n;
    this.seed(seed);
  }

  seed(seed) {
    const value = BigInt(seed) & MASK64;
    this.state = 0n;
    this.inc = ((value << 1n) | 1n) & MASK64;
    this.nextUint32();
    this.state = (this.state + value) & MASK64;
    this.nextUint32();
  }

  nextUint32() {
    const old = this.state;
    this.state = (old * MULTIPLIER + this.inc) & MASK64;
    const shifted = Number(((old >> 18n) ^ old) >> 27n) >>> 0;
    const rotation = Number(old >> 59n);
    return ((shifted >>> rotation) | (shifted << ((32 - rotation) & 31))) >>> 0;
  }

  randf() {
    const offset = this.nextUint32();
    if (offset === 0) return 0;
    const significand = Math.fround((this.nextUint32() | 0x80000001) >>> 0);
    return significand * Math.pow(2, -32 - Math.clz32(offset));
  }

  randfRange(from, to) {
    return from + (to - from) * this.randf();
  }

  randi() {
    return this.nextUint32() >>> 0;
  }

  randiRange(from, to) {
    return from + (this.nextUint32() % (to - from + 1));
  }
}
