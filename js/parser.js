/* parser.js — Lee la función objetivo y las restricciones escritas a mano.
   Devuelve { ok, problem, warnings } o { ok:false, errors }. Sin DOM. */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};
  const Fraction = LP.Fraction;
  const MAX_VARS = 6;

  class ParseError extends Error {}

  function normalizeText(s) {
    return String(s)
      .replace(/ /g, ' ')
      .replace(/[≥⩾]/g, '>=').replace(/[≤⩽]/g, '<=')
      .replace(/=>/g, '>=').replace(/=</g, '<=')
      .replace(/[−–—]/g, '-')
      .replace(/[·×]/g, '*');
  }

  /** Expresión lineal: términos con signo, coeficiente opcional, variable x1..x6 o constante. */
  function parseExpression(raw, where) {
    const s = raw.replace(/\s+/g, '');
    if (s === '') throw new ParseError(`${where}: falta una expresión a un lado del signo.`);
    const coefs = {};
    let constant = Fraction.ZERO;
    let i = 0, first = true, maxIdx = 0;
    while (i < s.length) {
      let sign = 1, hadSign = false;
      while (s[i] === '+' || s[i] === '-') { if (s[i] === '-') sign = -sign; i++; hadSign = true; }
      if (i >= s.length) throw new ParseError(`${where}: la expresión termina en un signo.`);
      if (!hadSign && !first) {
        throw new ParseError(`${where}: falta un signo + o − antes de "${s.slice(i, i + 8)}".`);
      }
      const rest = s.slice(i);
      const numM = /^(\d+(?:[.,]\d+)?|[.,]\d+)(?:\/(\d+(?:[.,]\d+)?))?/.exec(rest);
      let coef = null;
      if (numM) {
        coef = Fraction.parse(numM[1]);
        if (numM[2] !== undefined) {
          const den = Fraction.parse(numM[2]);
          if (den.isZero()) throw new ParseError(`${where}: hay una división entre cero en "${numM[0]}".`);
          coef = coef.div(den);
        }
        i += numM[0].length;
      }
      if (s[i] === '*') {
        if (!coef) throw new ParseError(`${where}: hay un "*" sin número antes.`);
        i++;
      }
      const varM = /^[xX]_?(\d+)/.exec(s.slice(i));
      if (varM) {
        const idx = parseInt(varM[1], 10);
        if (idx < 1) throw new ParseError(`${where}: las variables empiezan en x1 (encontré "${varM[0]}").`);
        if (idx > MAX_VARS) throw new ParseError(`${where}: encontré "${varM[0]}", pero el máximo es x${MAX_VARS}.`);
        i += varM[0].length;
        let c = coef || Fraction.ONE;
        if (sign < 0) c = c.neg();
        coefs[idx] = (coefs[idx] || Fraction.ZERO).add(c);
        if (idx > maxIdx) maxIdx = idx;
      } else {
        const after = s.slice(i);
        const word = /^[a-zA-Z]\w*/.exec(after);
        if (word) throw new ParseError(`${where}: no reconozco "${word[0]}". Usa variables x1, x2, …, x${MAX_VARS}.`);
        if (!coef) throw new ParseError(`${where}: no entiendo "${after.slice(0, 10)}".`);
        constant = constant.add(sign < 0 ? coef.neg() : coef);
      }
      first = false;
    }
    return { coefs, constant, maxIdx };
  }

  function parseObjective(text) {
    const s = normalizeText(text).trim();
    if (!s) throw new ParseError('Escribe la función objetivo, por ejemplo: max z = 3x1 + 2x2');
    const m = /^(maximizar|maximize|max|minimizar|minimize|min)\s*[.:]?\s*(?:[a-wyzA-WYZ]\w*\s*=\s*)?(.*)$/i.exec(s);
    if (!m) throw new ParseError('La función objetivo debe empezar con "max" o "min", por ejemplo: max z = 3x1 + 2x2');
    const sense = m[1].toLowerCase().startsWith('max') ? 'max' : 'min';
    if (/[<>=]/.test(m[2])) throw new ParseError('Función objetivo: sobra un signo "=", "<" o ">". Escribe por ejemplo: min z = 4x1 + x2');
    const e = parseExpression(m[2], 'Función objetivo');
    if (!e.constant.isZero()) throw new ParseError('Función objetivo: no debe tener término constante (solo términos con x1, x2, …).');
    if (e.maxIdx === 0) throw new ParseError('Función objetivo: no tiene variables.');
    return { sense, coefs: e.coefs, maxIdx: e.maxIdx };
  }

  function isNonNegativity(line) {
    const t = line.replace(/\s+/g, '');
    return /^([xX]_?\d+,?)+>=0$/.test(t) || /^[xX]_?[ijk](,[xX]_?[ijk])*>=0$/.test(t) || /^(todas?|todos)/i.test(t);
  }

  const SWAP = { '<=': '>=', '>=': '<=', '=': '=' };

  function parseConstraint(lineText, k, warnings) {
    const where = `Restricción ${k}`;
    const s = normalizeText(lineText);
    const ops = s.match(/<=|>=|<|>|=/g) || [];
    if (ops.length === 0) throw new ParseError(`${where}: falta el signo (<=, >= o =) en "${lineText.trim()}".`);
    if (ops.length > 1) throw new ParseError(`${where}: solo se permite un signo de relación por línea.`);
    let op = ops[0];
    const pos = s.search(/<=|>=|<|>|=/);
    const left = s.slice(0, pos), right = s.slice(pos + op.length);
    if (op === '<' || op === '>') {
      warnings.push(`${where}: se interpretó "${op}" como "${op}=" (en PL se usan desigualdades no estrictas).`);
      op += '=';
    }
    const L = parseExpression(left, where);
    const R = parseExpression(right, where);
    const coefs = {};
    for (const [j, v] of Object.entries(L.coefs)) coefs[j] = (coefs[j] || Fraction.ZERO).add(v);
    for (const [j, v] of Object.entries(R.coefs)) coefs[j] = (coefs[j] || Fraction.ZERO).sub(v);
    const b = R.constant.sub(L.constant);
    const maxIdx = Math.max(L.maxIdx, R.maxIdx);
    if (!Object.values(coefs).some((v) => !v.isZero())) {
      throw new ParseError(`${where}: no tiene variables (o se cancelan todas).`);
    }
    return { coefs, op, b, maxIdx, text: lineText.trim() };
  }

  function toArray(coefs, n) {
    const a = [];
    for (let j = 1; j <= n; j++) a.push(coefs[j] || Fraction.ZERO);
    return a;
  }

  /** Punto de entrada. */
  function parseProblem(objectiveText, constraintsText) {
    const errors = [], warnings = [];
    let obj = null;
    try { obj = parseObjective(objectiveText); } catch (e) { if (e instanceof ParseError) errors.push(e.message); else throw e; }

    const raw = String(constraintsText || '').split(/\r?\n|;/);
    const parsed = [];
    let k = 0;
    for (let line of raw) {
      line = line.replace(/(#|\/\/).*$/, '');
      if (!line.trim()) continue;
      if (isNonNegativity(normalizeText(line))) {
        warnings.push(`Se omitió "${line.trim()}": la no negatividad (xi ≥ 0) ya se asume.`);
        continue;
      }
      k++;
      try { parsed.push(parseConstraint(line, k, warnings)); } catch (e) { if (e instanceof ParseError) errors.push(e.message); else throw e; }
    }
    if (k === 0) errors.push('Escribe al menos una restricción (una por línea), por ejemplo: x1 + x2 <= 4');
    if (errors.length) return { ok: false, errors, warnings };

    const n = Math.max(obj.maxIdx, ...parsed.map((p) => p.maxIdx));
    const c = toArray(obj.coefs, n);
    for (let j = 1; j <= n; j++) {
      const used = obj.coefs[j] !== undefined || parsed.some((p) => p.coefs[j] !== undefined);
      if (!used) warnings.push(`La variable x${j} no aparece en ningún lado; se toma con coeficiente 0.`);
    }
    const constraints = parsed.map((p, i) => {
      const a0 = toArray(p.coefs, n);
      const orig = { a: a0, op: p.op, b: p.b };
      if (p.b.sign() < 0) {
        const op2 = SWAP[p.op];
        warnings.push(`Restricción ${i + 1}: el lado derecho era negativo (${p.b}); se multiplicó por −1` +
          (op2 !== p.op ? ` y el signo cambió de ${p.op} a ${op2}.` : ' (sigue siendo igualdad).'));
        return { a: a0.map((v) => v.neg()), op: op2, b: p.b.neg(), orig, text: p.text, flipped: true };
      }
      return { a: a0, op: p.op, b: p.b, orig, text: p.text, flipped: false };
    });
    return { ok: true, problem: { sense: obj.sense, n, m: constraints.length, c, constraints }, warnings };
  }

  /** "3x1 - x2 + (3/4)x3" a partir de coeficientes. */
  function formatLinear(a, names, fmt, keepZero) {
    fmt = fmt || ((f) => f.toString());
    let out = '';
    a.forEach((v, j) => {
      if (v.isZero() && !keepZero) return;
      const neg = v.sign() < 0;
      const s = fmt(v.abs());
      const coef = s === '1' ? '' : (s.includes('/') ? `(${s})` : s);
      const name = names ? names[j] : `x${j + 1}`;
      out += out === '' ? (neg ? '-' : '') + coef + name : (neg ? ' - ' : ' + ') + coef + name;
    });
    return out || '0';
  }

  const OP_SYMBOL = { '<=': '≤', '>=': '≥', '=': '=' };

  LP.parseProblem = parseProblem;
  LP.parseExpression = parseExpression;
  LP.formatLinear = formatLinear;
  LP.OP_SYMBOL = OP_SYMBOL;
  LP.MAX_VARS = MAX_VARS;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
