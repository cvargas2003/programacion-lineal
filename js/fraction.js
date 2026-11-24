/* fraction.js — Fracciones exactas (BigInt) y valores simbólicos a·M + b.
   Sin DOM: funciona en el navegador (script normal) y en Node (require). */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};

  const babs = (a) => (a < 0n ? -a : a);
  function gcd(a, b) {
    a = babs(a); b = babs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  class Fraction {
    constructor(n, d) {
      let N = typeof n === 'bigint' ? n : BigInt(n);
      let D = d === undefined ? 1n : (typeof d === 'bigint' ? d : BigInt(d));
      if (D === 0n) throw new Error('División entre cero en una fracción.');
      if (D < 0n) { N = -N; D = -D; }           // el signo siempre en el numerador
      const g = gcd(N, D);
      if (g > 1n) { N /= g; D /= g; }
      this.n = N; this.d = D;
      Object.freeze(this);
    }

    static from(x) {
      if (x instanceof Fraction) return x;
      if (typeof x === 'bigint') return new Fraction(x, 1n);
      if (typeof x === 'number') {
        if (!Number.isFinite(x)) throw new Error('Número no finito.');
        if (Number.isInteger(x)) return new Fraction(BigInt(x), 1n);
        return Fraction.parse(String(x));
      }
      if (typeof x === 'string') return Fraction.parse(x);
      throw new Error('No se puede convertir a fracción: ' + x);
    }

    /** Convierte "0.85", "1,1", "-3/4", "2.5e-3", "7" en fracción exacta. */
    static parse(str) {
      const s = String(str).trim().replace(/\s+/g, '').replace(',', '.');
      const slash = s.indexOf('/');
      if (slash >= 0) {
        const den = Fraction.parse(s.slice(slash + 1));
        if (den.isZero()) throw new Error(`Denominador cero en "${str}".`);
        return Fraction.parse(s.slice(0, slash)).div(den);
      }
      const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
      if (!m || (m[2] === '' && !m[3])) throw new Error(`Número no válido: "${str}".`);
      const ip = m[2] || '0', fp = m[3] || '';
      let n = BigInt(ip + fp);
      let d = 10n ** BigInt(fp.length);
      if (m[1] === '-') n = -n;
      if (m[4]) {
        const e = BigInt(m[4]);
        if (e >= 0n) n *= 10n ** e; else d *= 10n ** (-e);
      }
      return new Fraction(n, d);
    }

    add(o) { o = Fraction.from(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Fraction.from(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Fraction.from(o); return new Fraction(this.n * o.n, this.d * o.d); }
    div(o) {
      o = Fraction.from(o);
      if (o.n === 0n) throw new Error('División entre cero.');
      return new Fraction(this.n * o.d, this.d * o.n);
    }
    neg() { return new Fraction(-this.n, this.d); }
    abs() { return this.n < 0n ? this.neg() : this; }
    cmp(o) { o = Fraction.from(o); const v = this.n * o.d - o.n * this.d; return v > 0n ? 1 : v < 0n ? -1 : 0; }
    equals(o) { return this.cmp(o) === 0; }
    sign() { return this.n > 0n ? 1 : this.n < 0n ? -1 : 0; }
    isZero() { return this.n === 0n; }
    isInteger() { return this.d === 1n; }

    toString() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
    toNumber() { return Number(this.n) / Number(this.d); }

    /** Decimal redondeado a k cifras decimales (sin ceros finales). */
    toDecimal(k = 4) {
      const neg = this.n < 0n;
      const N = babs(this.n);
      const scale = 10n ** BigInt(k);
      const q = (N * scale * 2n + this.d) / (2n * this.d);   // redondeo a la mitad hacia afuera
      const s = q.toString().padStart(k + 1, '0');
      const ip = s.slice(0, s.length - k);
      const fp = s.slice(s.length - k).replace(/0+$/, '');
      let out = ip + (fp ? '.' + fp : '');
      if (neg && q !== 0n) out = '-' + out;
      return out;
    }
  }
  Fraction.ZERO = new Fraction(0n);
  Fraction.ONE = new Fraction(1n);

  /** Valor simbólico a·M + b (a, b fracciones). Se compara primero a y luego b. */
  class MValue {
    constructor(m, c) {
      this.m = Fraction.from(m === undefined ? 0 : m);
      this.c = Fraction.from(c === undefined ? 0 : c);
      Object.freeze(this);
    }
    static of(x) { return x instanceof MValue ? x : new MValue(0, Fraction.from(x)); }
    add(o) { o = MValue.of(o); return new MValue(this.m.add(o.m), this.c.add(o.c)); }
    sub(o) { o = MValue.of(o); return new MValue(this.m.sub(o.m), this.c.sub(o.c)); }
    mul(f) { f = Fraction.from(f); return new MValue(this.m.mul(f), this.c.mul(f)); }
    neg() { return new MValue(this.m.neg(), this.c.neg()); }
    cmp(o) { o = MValue.of(o); const a = this.m.cmp(o.m); return a !== 0 ? a : this.c.cmp(o.c); }
    equals(o) { return this.cmp(o) === 0; }
    sign() { const s = this.m.sign(); return s !== 0 ? s : this.c.sign(); }
    isZero() { return this.m.isZero() && this.c.isZero(); }
    hasM() { return !this.m.isZero(); }
    isExactInteger() { return this.m.isInteger() && this.c.isInteger(); }

    /** Texto como "69/10M + 262", "-M", "M - 5"; fmt formatea cada fracción. */
    format(fmt) {
      fmt = fmt || ((f) => f.toString());
      if (this.m.isZero()) return fmt(this.c);
      const am = this.m.abs();
      let coef = '';
      if (!am.equals(Fraction.ONE)) {
        const s = fmt(am);
        coef = s.includes('/') ? `(${s})` : s;
      }
      const mp = (this.m.sign() < 0 ? '-' : '') + coef + 'M';
      if (this.c.isZero()) return mp;
      return mp + (this.c.sign() > 0 ? ' + ' : ' - ') + fmt(this.c.abs());
    }
    toString() { return this.format(); }
  }
  MValue.ZERO = new MValue(0, 0);
  MValue.M = new MValue(1, 0);

  LP.Fraction = Fraction;
  LP.MValue = MValue;
  LP.gcd = gcd;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
