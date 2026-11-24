/* simplex.js — Motor de tablas simplex (primal y dual) con aritmética exacta.
   Cada iteración produce un PASO (datos puros) que la interfaz solo dibuja. Sin DOM. */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};
  const { Fraction, MValue } = LP;

  class Tableau {
    /**
     * sense: 'max' | 'min'
     * cols:  [{ name, kind: 'x'|'H'|'S'|'R', cost: MValue, idx?, con? }]
     * rows:  [{ a: Fraction[], b: Fraction }]
     * basis: índice de columna básica de cada fila
     */
    constructor(sense, cols, rows, basis) {
      this.sense = sense; this.cols = cols; this.rows = rows; this.basis = basis;
    }
    clone() {
      return new Tableau(this.sense, this.cols.map((c) => Object.assign({}, c)),
        this.rows.map((r) => ({ a: r.a.slice(), b: r.b })), this.basis.slice());
    }
    /** zj − cj = Σ Cx·a_ij − cj   y   z = Σ Cx·bi */
    computeZ() {
      const cx = this.basis.map((j) => this.cols[j].cost);
      const zc = this.cols.map((col, j) => {
        let s = MValue.ZERO;
        this.rows.forEach((r, i) => { if (!r.a[j].isZero()) s = s.add(cx[i].mul(r.a[j])); });
        return s.sub(col.cost);
      });
      let z = MValue.ZERO;
      this.rows.forEach((r, i) => { z = z.add(cx[i].mul(r.b)); });
      return { zc, z };
    }
    snapshot(zc, z) {
      return {
        sense: this.sense,
        cols: this.cols.map((c) => ({ name: c.name, kind: c.kind, cost: c.cost })),
        rows: this.rows.map((r, i) => ({
          basis: this.cols[this.basis[i]].name, basisCol: this.basis[i],
          cx: this.cols[this.basis[i]].cost, a: r.a.slice(), b: r.b,
        })),
        zc: zc.slice(), z,
        hasM: this.cols.some((c) => c.cost.hasM()),
      };
    }
    removeCol(j) {
      if (this.basis.includes(j)) throw new Error('No se puede eliminar una columna básica.');
      this.cols.splice(j, 1);
      this.rows.forEach((r) => r.a.splice(j, 1));
      this.basis = this.basis.map((k) => (k > j ? k - 1 : k));
    }
    /** Pivotea en (r, c). Devuelve las operaciones de fila y un chequeo de consistencia del renglón z. */
    pivot(r, c) {
      const before = this.computeZ();
      const zfac = before.zc[c];
      const p = this.rows[r].a[c];
      if (p.isZero()) throw new Error('Pivote cero.');
      const ops = [];
      const pr = { a: this.rows[r].a.map((v) => v.div(p)), b: this.rows[r].b.div(p) };
      this.rows[r] = pr;
      ops.push({ type: 'div', target: r, factor: p });
      this.rows.forEach((row, i) => {
        if (i === r) return;
        const f = row.a[c];
        if (f.isZero()) return;
        this.rows[i] = { a: row.a.map((v, j) => v.sub(f.mul(pr.a[j]))), b: row.b.sub(f.mul(pr.b)) };
        ops.push({ type: 'comb', target: i, factor: f, source: r });
      });
      this.basis[r] = c;
      ops.push({ type: 'zrow', factor: zfac, source: r });
      // Chequeo: el renglón z recalculado con la fórmula debe coincidir con Fz − (zj−cj)·Fr
      const after = this.computeZ();
      let check = after.z.equals(before.z.sub(zfac.mul(pr.b)));
      after.zc.forEach((v, j) => { if (!v.equals(before.zc[j].sub(zfac.mul(pr.a[j])))) check = false; });
      return { ops, check };
    }
    values() {
      const vals = {};
      this.cols.forEach((c) => { vals[c.name] = Fraction.ZERO; });
      this.basis.forEach((j, i) => { vals[this.cols[j].name] = this.rows[i].b; });
      return vals;
    }
  }

  const improves = (sense, v) => (sense === 'max' ? v.sign() < 0 : v.sign() > 0);

  function chooseEntering(T, zc) {
    let best = -1;
    for (let j = 0; j < T.cols.length; j++) {
      if (T.basis.includes(j) || !improves(T.sense, zc[j])) continue;
      if (best < 0) { best = j; continue; }
      const c = zc[j].cmp(zc[best]);
      if (T.sense === 'max' ? c < 0 : c > 0) best = j;   // empate: se queda el de menor índice
    }
    const ties = best < 0 ? [] : T.cols.map((_, j) => j)
      .filter((j) => !T.basis.includes(j) && zc[j].equals(zc[best]));
    return { col: best, ties };
  }

  function ratioTest(T, c) {
    return T.rows.map((r, i) => {
      const a = r.a[c];
      const base = { row: i, basis: T.cols[T.basis[i]].name, b: r.b, a };
      if (a.sign() > 0) return Object.assign(base, { ratio: r.b.div(a) });
      return Object.assign(base, { ratio: null, why: a.isZero() ? 'coeficiente 0' : 'coeficiente negativo' });
    });
  }

  function pickLeaving(ratios) {
    let best = null;
    for (const r of ratios) if (r.ratio && (!best || r.ratio.cmp(best.ratio) < 0)) best = r;
    const ties = best ? ratios.filter((r) => r.ratio && r.ratio.equals(best.ratio)) : [];
    return { best, ties };
  }

  const basicZeroCheck = (T, zc) => T.basis.every((j) => zc[j].isZero());

  /**
   * Simplex primal con las convenciones del curso.
   * opts: { steps, phase, flags, firstComments, removeArtificialOnLeave, maxIter }
   */
  function runSimplex(T, opts) {
    const steps = opts.steps, phase = opts.phase || '', flags = opts.flags || {};
    const maxIter = opts.maxIter || 100;
    let comments = (opts.firstComments || []).slice();
    for (let iter = 0; ; iter++) {
      const { zc, z } = T.computeZ();
      const step = { phase, iter, snapshot: T.snapshot(zc, z), comments, basicCheck: basicZeroCheck(T, zc), kind: 'pivot' };
      comments = [];
      if (T.rows.some((r) => r.b.isZero())) {
        flags.degenerate = true;
        step.comments.push('Hay una variable básica con valor 0: la solución es degenerada.');
      }
      const ent = chooseEntering(T, zc);
      if (ent.col < 0) {
        step.kind = 'optimal';
        step.comments.push(T.sense === 'max'
          ? 'Todos los zj−cj son ≥ 0: la tabla es óptima (maximización).'
          : 'Todos los zj−cj son ≤ 0: la tabla es óptima (minimización).');
        steps.push(step);
        return { status: 'optimal', zc, z, step };
      }
      if (iter >= maxIter) {
        step.kind = 'cycle';
        step.comments.push(`Se alcanzó el límite de ${maxIter} iteraciones (posible ciclaje). Se detiene el método.`);
        steps.push(step);
        return { status: 'cycle', zc, z, step };
      }
      const col = T.cols[ent.col];
      step.entering = { col: ent.col, name: col.name, value: zc[ent.col], sense: T.sense, ties: ent.ties.map((j) => T.cols[j].name) };
      const ratios = ratioTest(T, ent.col);
      step.ratios = ratios;
      const lv = pickLeaving(ratios);
      if (!lv.best) {
        step.kind = 'unbounded';
        step.comments.push(`La variable que entra (${col.name}) no tiene coeficientes positivos en su columna: puede crecer sin límite sin violar ninguna restricción, y z mejora sin parar. El problema es NO ACOTADO.`);
        steps.push(step);
        return { status: 'unbounded', zc, z, step, col: ent.col };
      }
      const r = lv.best.row;
      const leavingCol = T.basis[r];
      const leaving = T.cols[leavingCol];
      step.leaving = { row: r, name: leaving.name, ratio: lv.best.ratio, ties: lv.ties.map((t) => t.basis) };
      if (lv.ties.length > 1) {
        flags.degenerate = true;
        step.comments.push(`Empate en la razón mínima (${lv.ties.map((t) => t.basis).join(', ')}): se elige la de menor índice (fila ${r + 1}). El empate indica degeneración: alguna básica quedará en 0.`);
      }
      step.pivot = { row: r, col: ent.col, value: T.rows[r].a[ent.col] };
      const pv = T.pivot(r, ent.col);
      step.ops = pv.ops; step.check = pv.check;
      if (opts.removeArtificialOnLeave && leaving.kind === 'R') {
        T.removeCol(leavingCol);
        step.comments.push(`La artificial ${leaving.name} salió de la base: se elimina su columna en la siguiente tabla (una artificial que sale ya no vuelve a entrar).`);
      }
      steps.push(step);
    }
  }

  /**
   * Simplex dual (minimización con zj−cj ≤ 0): sale la básica con bi más negativo;
   * entra la no básica con a_rj < 0 de menor |(zj−cj)/a_rj|.
   */
  function runDualSimplex(T, opts) {
    const steps = opts.steps, phase = opts.phase || '', flags = opts.flags || {};
    const maxIter = opts.maxIter || 100;
    let comments = (opts.firstComments || []).slice();
    for (let iter = 0; ; iter++) {
      const { zc, z } = T.computeZ();
      const step = { phase, iter, dual: true, snapshot: T.snapshot(zc, z), comments, basicCheck: basicZeroCheck(T, zc), kind: 'pivot' };
      comments = [];
      let r = -1;
      T.rows.forEach((row, i) => { if (row.b.sign() < 0 && (r < 0 || row.b.cmp(T.rows[r].b) < 0)) r = i; });
      if (r < 0) {
        if (T.rows.some((row) => row.b.isZero())) {
          flags.degenerate = true;
          step.comments.push('Hay una variable básica con valor 0: la solución es degenerada.');
        }
        step.kind = 'optimal';
        step.comments.push('Todos los bi son ≥ 0 (factible) y todos los zj−cj ≤ 0 (óptimo para minimización): la tabla es óptima.');
        steps.push(step);
        return { status: 'optimal', zc, z, step };
      }
      if (iter >= maxIter) {
        step.kind = 'cycle'; step.comments.push('Límite de iteraciones alcanzado.'); steps.push(step);
        return { status: 'cycle', zc, z, step };
      }
      const lvCol = T.basis[r];
      step.leaving = { row: r, name: T.cols[lvCol].name, value: T.rows[r].b, ties: [] };
      const dualRatios = [];
      T.cols.forEach((col, j) => {
        if (T.basis.includes(j)) return;
        const a = T.rows[r].a[j];
        dualRatios.push(a.sign() < 0
          ? { col: j, name: col.name, zc: zc[j], a, ratio: zc[j].c.div(a).abs() }
          : { col: j, name: col.name, zc: zc[j], a, ratio: null, why: a.isZero() ? 'coeficiente 0' : 'coeficiente positivo' });
      });
      step.dualRatios = dualRatios;
      let best = null;
      for (const d of dualRatios) if (d.ratio && (!best || d.ratio.cmp(best.ratio) < 0)) best = d;
      if (!best) {
        step.kind = 'infeasible';
        step.comments.push(`La fila de ${T.cols[lvCol].name} tiene bi < 0 y ningún coeficiente negativo: esa ecuación no puede cumplirse con variables ≥ 0. El problema es INFACTIBLE.`);
        steps.push(step);
        return { status: 'infeasible', zc, z, step };
      }
      const ties = dualRatios.filter((d) => d.ratio && d.ratio.equals(best.ratio));
      if (ties.length > 1) step.comments.push(`Empate en las razones (${ties.map((t) => t.name).join(', ')}): se elige la de menor índice.`);
      step.entering = { col: best.col, name: best.name, value: zc[best.col], ratio: best.ratio, sense: T.sense, ties: ties.map((t) => t.name) };
      step.pivot = { row: r, col: best.col, value: T.rows[r].a[best.col] };
      const pv = T.pivot(r, best.col);
      step.ops = pv.ops; step.check = pv.check;
      steps.push(step);
    }
  }

  /* ---------- Texto de las operaciones de fila (sin DOM; fmt formatea fracciones) ---------- */
  function coefText(s) {
    if (s === '1') return '';
    return /[\s/]/.test(s) ? `(${s})` : s;
  }
  function formatOp(op, fmt) {
    fmt = fmt || ((f) => f.toString());
    if (op.type === 'div') return `F${op.target + 1} ÷ ${fmt(op.factor).includes('/') || op.factor.sign() < 0 ? `(${fmt(op.factor)})` : fmt(op.factor)}`;
    if (op.type === 'comb') {
      const f = op.factor;
      return `F${op.target + 1} ${f.sign() > 0 ? '−' : '+'} ${coefText(fmt(f.abs()))}·F${op.source + 1}`;
    }
    // renglón z: Fz − (zj−cj)·Fr
    const g = op.factor.neg();
    if (g.isZero()) return 'Fz no cambia (zj−cj = 0 en la columna pivote)';
    const pos = g.sign() > 0;
    return `Fz ${pos ? '+' : '−'} ${coefText((pos ? g : g.neg()).format(fmt))}·F${op.source + 1}`;
  }

  LP.Tableau = Tableau;
  LP.runSimplex = runSimplex;
  LP.runDualSimplex = runDualSimplex;
  LP.chooseEntering = chooseEntering;
  LP.ratioTest = ratioTest;
  LP.pickLeaving = pickLeaving;
  LP.formatOp = formatOp;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
