/* methods.js — Simplex normal, Gran M, Dos fases, Simplex dual y comparador. Sin DOM. */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};
  const { Fraction, MValue, Tableau } = LP;
  const ZERO = Fraction.ZERO, ONE = Fraction.ONE;
  const exact = (f) => f.toString();

  /* ---------- Construcción de la forma estándar ---------- */
  function buildTableau(p, mode) {
    const cols = [];
    p.c.forEach((c, j) => cols.push({ name: `x${j + 1}`, kind: 'x', idx: j, cost: MValue.of(c) }));
    let h = 0, s = 0, r = 0;
    const slackCol = [], artCol = [];
    p.constraints.forEach((con, i) => {
      if (con.op === '<=') { slackCol[i] = cols.length; cols.push({ name: `H${++h}`, kind: 'H', con: i, cost: MValue.ZERO }); }
      else if (con.op === '>=') { slackCol[i] = cols.length; cols.push({ name: `S${++s}`, kind: 'S', con: i, cost: MValue.ZERO }); }
    });
    if (mode !== 'normal') {
      p.constraints.forEach((con, i) => {
        if (con.op === '<=') return;
        artCol[i] = cols.length;
        const cost = mode === 'phase1' ? MValue.of(ONE) : (p.sense === 'max' ? MValue.M.neg() : MValue.M);
        cols.push({ name: `R${++r}`, kind: 'R', con: i, cost });
      });
    }
    if (mode === 'phase1') cols.forEach((c) => { if (c.kind !== 'R') c.cost = MValue.ZERO; });
    const rows = p.constraints.map((con, i) => {
      const a = cols.map(() => ZERO);
      con.a.forEach((v, j) => { a[j] = v; });
      if (con.op === '<=') a[slackCol[i]] = ONE;
      else {
        if (con.op === '>=') a[slackCol[i]] = ONE.neg();
        a[artCol[i]] = ONE;
      }
      return { a, b: con.b };
    });
    const basis = p.constraints.map((con, i) => (con.op === '<=' ? slackCol[i] : artCol[i]));
    return new Tableau(mode === 'phase1' ? 'min' : p.sense, cols, rows, basis);
  }

  /** Texto "3x1 + 2x2 + 0H1 - MR1" para coeficientes MValue/Fraction. */
  function termsText(terms, fmt) {
    fmt = fmt || exact;
    let out = '';
    terms.forEach(([v, name]) => {
      v = MValue.of(v);
      const neg = v.sign() < 0;
      const s = (neg ? v.neg() : v).format(fmt);
      const coef = s === '1' ? '' : (/[\s/]/.test(s) ? `(${s})` : s);
      out += out === '' ? (neg ? '-' : '') + coef + name : (neg ? ' - ' : ' + ') + coef + name;
    });
    return out || '0';
  }

  function standardForm(T, objLabel, fmt) {
    const obj = `${T.sense} ${objLabel} = ` + termsText(T.cols.map((c) => [c.cost, c.name]), fmt);
    const cons = T.rows.map((r) => termsText(T.cols.map((c, j) => [r.a[j], c.name]).filter(([v]) => !v.isZero()), fmt) + ' = ' + (fmt || exact)(r.b));
    return [obj, ...cons, 'todas las variables ≥ 0'];
  }

  /* ---------- Resultado final ---------- */
  function constraintReport(p, x, vals, T) {
    return p.constraints.map((con, i) => {
      const o = con.orig;
      const lhs = o.a.reduce((s, a, j) => s.add(a.mul(x[j])), ZERO);
      const c = lhs.cmp(o.b);
      const ok = o.op === '<=' ? c <= 0 : o.op === '>=' ? c >= 0 : c === 0;
      const slack = T.cols.find((col) => (col.kind === 'H' || col.kind === 'S') && col.con === i);
      return {
        index: i, text: con.text, a: o.a, op: o.op, b: o.b, lhs, ok,
        active: c === 0,
        slackName: slack ? slack.name : null,
        slackValue: slack ? (vals[slack.name] || ZERO) : null,
      };
    });
  }

  function finalize(p, method, T, status, steps, extra) {
    const res = {
      method, methodName: LP.METHOD_NAMES[method], status, steps,
      standardForm: extra.standardForm || [], notes: extra.notes || [],
      degenerate: !!(extra.flags && extra.flags.degenerate), phase1: extra.phase1 || null,
      artificialCount: extra.artificialCount || 0,
      iterations: steps.filter((s) => s.ops).length,
    };
    if (status !== 'optimal') return res;
    const vals = T.values();
    const x = p.c.map((_, j) => vals[`x${j + 1}`] || ZERO);
    const z = p.c.reduce((s, c, j) => s.add(c.mul(x[j])), ZERO);
    const zt = T.computeZ();
    res.values = vals; res.x = x; res.z = z;
    res.zConsistent = !zt.z.hasM() && zt.z.c.equals(z);
    res.constraints = constraintReport(p, x, vals, T);
    res.allOk = res.constraints.every((c) => c.ok);
    if (T.rows.some((r) => r.b.isZero())) res.degenerate = true;
    // Óptimos múltiples: no básica (no artificial) con zj − cj = 0
    const cand = T.cols.map((_, j) => j).filter((j) => !T.basis.includes(j) && T.cols[j].kind !== 'R' && zt.zc[j].isZero());
    if (cand.length) {
      res.multiple = true;
      res.multipleVars = cand.map((j) => T.cols[j].name);
      for (const j of cand) {
        const T2 = T.clone();
        const lv = LP.pickLeaving(LP.ratioTest(T2, j));
        if (!lv.best) { res.alternativeRay = T.cols[j].name; continue; }
        const leaveName = T2.cols[T2.basis[lv.best.row]].name;
        T2.pivot(lv.best.row, j);
        const v2 = T2.values();
        const x2 = p.c.map((_, k) => v2[`x${k + 1}`] || ZERO);
        if (x2.every((v, k) => v.equals(x[k]))) continue;   // pivote degenerado: mismo punto
        res.alternative = { enter: T.cols[j].name, leave: leaveName, x: x2 };
        break;
      }
    }
    return res;
  }

  function markInfeasible(step, text) {
    step.kind = 'infeasible';
    step.comments.push(text);
  }

  /* ---------- Métodos ---------- */
  function solveSimplexNormal(p) {
    if (p.constraints.some((c) => c.op !== '<=')) throw new Error('El simplex normal requiere que todas las restricciones sean ≤.');
    const T = buildTableau(p, 'normal');
    const steps = [], flags = {};
    const sf = standardForm(T, 'z');
    const out = LP.runSimplex(T, {
      steps, phase: 'Simplex', flags,
      firstComments: ['Tabla inicial: el origen es factible y las holguras forman la base. ' +
        (p.sense === 'max' ? 'Maximización: entra el zj−cj más negativo.' : 'Minimización: entra el zj−cj más positivo.')],
    });
    return finalize(p, 'simplex', T, out.status, steps, { standardForm: sf, flags });
  }

  function solveBigM(p) {
    const T = buildTableau(p, 'bigM');
    const steps = [], flags = {};
    const arts = T.cols.filter((c) => c.kind === 'R').map((c) => c.name);
    const sf = standardForm(T, 'z');
    const out = LP.runSimplex(T, {
      steps, phase: 'Gran M', flags, removeArtificialOnLeave: true,
      firstComments: [
        `Las artificiales (${arts.join(', ') || 'ninguna'}) tienen costo ${p.sense === 'max' ? '−M' : '+M'} (${p.sense === 'max' ? 'maximización' : 'minimización'}). ` +
        'Cada zj−cj se escribe como a·M + b y se compara primero el coeficiente de M (M es "enorme").',
        p.sense === 'max' ? 'Maximización: entra el zj−cj más negativo.' : 'Minimización: entra el zj−cj más positivo.',
      ],
    });
    let status = out.status;
    const notes = [];
    if (status === 'optimal') {
      const bad = T.basis.map((j, i) => ({ col: T.cols[j], b: T.rows[i].b })).filter((e) => e.col.kind === 'R' && e.b.sign() > 0);
      if (bad.length) {
        status = 'infeasible';
        markInfeasible(out.step, `La tabla es óptima, pero la artificial ${bad.map((e) => `${e.col.name} = ${e.b}`).join(', ')} sigue en la base con valor > 0. Como las R no existen en el problema real, ninguna solución cumple las restricciones originales: el problema es INFACTIBLE.`);
      } else if (T.basis.some((j) => T.cols[j].kind === 'R')) {
        out.step.comments.push('Queda alguna artificial en la base con valor 0: no afecta la solución (es degenerada).');
        flags.degenerate = true;
      }
    } else if (status === 'unbounded' && T.basis.some((j, i) => T.cols[j].kind === 'R' && T.rows[i].b.sign() > 0)) {
      notes.push('Atención: aún hay artificiales con valor positivo en la base; el problema podría ser además infactible.');
    }
    return finalize(p, 'bigM', T, status, steps, { standardForm: sf, flags, notes, artificialCount: arts.length });
  }

  function solveTwoPhase(p) {
    const T = buildTableau(p, 'phase1');
    const steps = [], flags = {}, notes = [];
    const arts = T.cols.filter((c) => c.kind === 'R').map((c) => c.name);
    const sfT = buildTableau(p, 'normal');
    const sf = [`Fase I: min r = ${arts.join(' + ') || '0'}`, ...standardForm(T, 'r').slice(1, -1),
      `Fase II: ${p.sense} z = ${termsText(sfT.cols.map((c) => [c.cost, c.name]))}`];
    let phase1 = null;
    if (arts.length) {
      const r1 = LP.runSimplex(T, {
        steps, phase: 'Fase I', flags,
        firstComments: [`Fase I: minimizamos r = ${arts.join(' + ')} (las artificiales tienen costo 1, todas las demás 0). Como es minimización, entra el zj−cj más positivo; termina cuando todos son ≤ 0.`],
      });
      const r = r1.z.c;
      phase1 = { r, values: T.values() };
      if (r1.status !== 'optimal' || r.sign() > 0) {
        markInfeasible(r1.step, `La Fase I terminó con r = ${r} > 0: no hay forma de anular todas las artificiales, es decir, ninguna solución cumple todas las restricciones. El problema es INFACTIBLE (no se hace la Fase II).`);
        return finalize(p, 'twoPhase', T, 'infeasible', steps, { standardForm: sf, flags, notes, phase1, artificialCount: arts.length });
      }
      r1.step.comments.push('r = 0: todas las artificiales valen 0, el problema es FACTIBLE. Pasamos a la Fase II.');
      // Artificiales que quedaron básicas con valor 0
      for (let i = 0; i < T.rows.length; i++) {
        const bj = T.basis[i];
        if (T.cols[bj].kind !== 'R') continue;
        const j = T.cols.findIndex((c, k) => c.kind !== 'R' && !T.basis.includes(k) && !T.rows[i].a[k].isZero());
        const { zc, z } = T.computeZ();
        if (j >= 0) {
          const step = { phase: 'Fase I (ajuste)', iter: 0, snapshot: T.snapshot(zc, z), comments: [`${T.cols[bj].name} quedó en la base con valor 0. Pivoteamos sobre ${T.cols[j].name} para sacarla (el valor de r no cambia).`], basicCheck: true, kind: 'pivot' };
          step.entering = { col: j, name: T.cols[j].name, value: zc[j], sense: 'min', ties: [], forced: true };
          step.leaving = { row: i, name: T.cols[bj].name, ties: [] };
          step.pivot = { row: i, col: j, value: T.rows[i].a[j] };
          const pv = T.pivot(i, j);
          step.ops = pv.ops; step.check = pv.check;
          steps.push(step);
          flags.degenerate = true;
        } else {
          notes.push(`La fila de ${T.cols[bj].name} solo tiene coeficientes en artificiales: es una restricción redundante y se elimina.`);
          T.rows.splice(i, 1); T.basis.splice(i, 1); i--;
        }
      }
      for (let j = T.cols.length - 1; j >= 0; j--) if (T.cols[j].kind === 'R') T.removeCol(j);
    }
    T.sense = p.sense;
    T.cols.forEach((c) => { c.cost = c.kind === 'x' ? MValue.of(p.c[c.idx]) : MValue.ZERO; });
    const r2 = LP.runSimplex(T, {
      steps, phase: 'Fase II', flags,
      firstComments: [
        arts.length ? `Se eliminan las columnas ${arts.join(', ')} y se restauran los costos originales. Se recalculan los zj−cj con la base que dejó la Fase I.` : 'No hay artificiales: la Fase I no es necesaria.',
        p.sense === 'max' ? 'Maximización: entra el zj−cj más negativo.' : 'Minimización: entra el zj−cj más positivo.',
      ],
    });
    return finalize(p, 'twoPhase', T, r2.status, steps, { standardForm: sf, flags, notes, phase1, artificialCount: arts.length });
  }

  function solveDual(p) {
    if (!(p.sense === 'min' && p.c.every((v) => v.sign() >= 0) && p.constraints.every((c) => c.op === '>='))) {
      throw new Error('El simplex dual (en esta versión) requiere min, costos ≥ 0 y todas las restricciones ≥.');
    }
    const cols = p.c.map((c, j) => ({ name: `x${j + 1}`, kind: 'x', idx: j, cost: MValue.of(c) }));
    p.constraints.forEach((_, i) => cols.push({ name: `S${i + 1}`, kind: 'S', con: i, cost: MValue.ZERO }));
    const n = p.n;
    const rows = p.constraints.map((con, i) => {
      const a = cols.map(() => ZERO);
      con.a.forEach((v, j) => { a[j] = v.neg(); });
      a[n + i] = ONE;
      return { a, b: con.b.neg() };
    });
    const T = new Tableau('min', cols, rows, p.constraints.map((_, i) => n + i));
    const steps = [], flags = {};
    const sf = [`min z = ${termsText(cols.map((c) => [c.cost, c.name]))}`,
      ...T.rows.map((r) => termsText(cols.map((c, j) => [r.a[j], c.name]).filter(([v]) => !v.isZero())) + ' = ' + r.b),
      'todas las variables ≥ 0'];
    const out = LP.runDualSimplex(T, {
      steps, phase: 'Simplex dual', flags,
      firstComments: ['Cada restricción ≥ se multiplicó por −1 (−a·x + S = −b) para que las S formen la base. Todos los zj−cj ≤ 0 (óptimo) pero hay bi < 0 (infactible).',
        'Regla dual: sale la básica con el bi más negativo; entra la no básica con coeficiente negativo en esa fila y menor |zj−cj ÷ coeficiente|.'],
    });
    return finalize(p, 'dual', T, out.status, steps, { standardForm: sf, flags });
  }

  function solveProblem(p, method) {
    switch (method) {
      case 'simplex': return solveSimplexNormal(p);
      case 'bigM': return solveBigM(p);
      case 'twoPhase': return solveTwoPhase(p);
      case 'dual': return solveDual(p);
      default: throw new Error('Método desconocido: ' + method);
    }
  }

  /** Resuelve por Gran M y por Dos fases y compara (autoverificación). */
  function compareBigMTwoPhase(p) {
    const a = solveBigM(p), b = solveTwoPhase(p);
    const issues = [];
    if (a.status !== b.status) issues.push(`Estado distinto: Gran M = ${a.status}, Dos fases = ${b.status}.`);
    let sameZ = true, sameX = true;
    if (a.status === 'optimal' && b.status === 'optimal') {
      sameZ = a.z.equals(b.z);
      sameX = a.x.every((v, j) => v.equals(b.x[j]));
      if (!sameZ) issues.push(`Valor de z distinto: Gran M = ${a.z}, Dos fases = ${b.z}.`);
    }
    const agree = issues.length === 0;
    let message;
    if (!agree) message = 'Los métodos NO coinciden. Revisa el planteamiento o reporta el caso.';
    else if (a.status === 'optimal' && sameX) message = 'Ambos métodos llegan exactamente al mismo óptimo (mismas variables y mismo z).';
    else if (a.status === 'optimal') message = 'Ambos llegan al mismo valor óptimo de z, en vértices distintos: hay óptimos múltiples.';
    else message = `Ambos métodos concluyen lo mismo: ${a.status === 'infeasible' ? 'problema infactible' : a.status === 'unbounded' ? 'problema no acotado' : a.status}.`;
    return { bigM: a, twoPhase: b, agree, sameX, sameZ, issues, message };
  }

  LP.buildTableau = buildTableau;
  LP.standardForm = standardForm;
  LP.termsText = termsText;
  LP.solveSimplexNormal = solveSimplexNormal;
  LP.solveBigM = solveBigM;
  LP.solveTwoPhase = solveTwoPhase;
  LP.solveDual = solveDual;
  LP.solveProblem = solveProblem;
  LP.compareBigMTwoPhase = compareBigMTwoPhase;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
