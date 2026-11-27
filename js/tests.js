/* tests.js — Pruebas de la lógica. Ejecutar con:  node tests.js  (desde la carpeta del proyecto) */
'use strict';
const path = require('path');
const files = ['fraction.js', 'parser.js', 'analyzer.js', 'simplex.js', 'methods.js', 'graphic.js'];
const fs = require('fs');
for (const f of files) {
  const full = path.join(__dirname, f);
  if (fs.existsSync(full)) require(full);
}
const LP = globalThis.LP;
const { Fraction } = LP;
const F = (x) => Fraction.from(x);

let passed = 0, failed = 0;
let section = '';
function group(name) { section = name; console.log('\n■ ' + name); }
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}
function eqF(a, b, msg) {
  const good = a !== undefined && a !== null && F(a).equals(F(b));
  ok(good, `${msg}  (obtenido ${a}, esperado ${b})`);
}
function throws(fn, msg) {
  try { fn(); ok(false, msg + ' (no lanzó error)'); } catch (e) { ok(true, msg); }
}
const parse = (o, c) => {
  const r = LP.parseProblem(o, c);
  if (!r.ok) throw new Error('No se pudo leer: ' + r.errors.join(' | '));
  return r.problem;
};

/* ---------------- Etapa 1: fracciones, parser, analizador ---------------- */
group('Fracciones');
eqF(F('0.85'), '17/20', '0.85 = 17/20');
eqF(F('1,1'), '11/10', '1,1 = 11/10');
eqF(F('6.9'), '69/10', '6.9 = 69/10');
ok(new Fraction(6, -8).toString() === '-3/4', 'signo normalizado en el numerador (6/-8 = -3/4)');
eqF(F('1/3').add('1/6'), '1/2', '1/3 + 1/6 = 1/2');
eqF(F('2/3').mul('9/4'), '3/2', '2/3 · 9/4 = 3/2');
eqF(F('2/3').div('-4'), '-1/6', '2/3 ÷ -4 = -1/6');
ok(F('414138000/2887').toDecimal(4) === '143449.2553', `decimal de 414138000/2887 = ${F('414138000/2887').toDecimal(4)}`);
ok(F('1/3').toDecimal(4) === '0.3333', '1/3 ≈ 0.3333');
ok(F('-2/3').toDecimal(4) === '-0.6667', '-2/3 ≈ -0.6667');
throws(() => F('1').div(0), 'división entre cero lanza error');
{
  const { MValue } = LP;
  const a = new MValue('69/10', 262), b = new MValue(1, -1000);
  ok(a.cmp(b) > 0, 'a·M + b: se compara primero el coeficiente de M');
  ok(new MValue(0, 5).cmp(new MValue('-1/100', 1e6)) > 0, '5 > -0.01M + 10^6');
  ok(new MValue('-69/10', -262).neg().format((f) => f.toDecimal(4)) === '6.9M + 262', 'formato 6.9M + 262');
}

group('Parser');
{
  const p = parse('max z = 265x1 + 270x2 + 262x3', '0.85x1 + 1,1x2 + 6.9x3 >= 500\n24x1+28x2+25x3<=13000\n22x1 + 24x2 + 20x3 ≤ 12000');
  ok(p.sense === 'max' && p.n === 3 && p.m === 3, 'max, 3 variables, 3 restricciones');
  eqF(p.constraints[0].a[1], '11/10', 'coma decimal 1,1x2');
  ok(p.constraints[2].op === '<=', 'símbolo ≤ aceptado');
  const q = parse('min: 4x1 + x2', 'x2 + 3x1 = 3\n4x1+3x2 ≥ 6\nx1 + 2 x2 <= 4\nx1, x2 >= 0');
  eqF(q.constraints[0].a[0], 3, 'términos en cualquier orden');
  ok(q.m === 3, 'se omite la línea de no negatividad');
  const r = parse('max z = x1 - x2', 'x1 - x2 <= 1\n-x1 + x2 <= -2');
  eqF(r.c[1], -1, 'coeficiente implícito -x2');
  ok(r.constraints[1].op === '>=' && r.constraints[1].b.equals(F(2)) && r.constraints[1].flipped, 'b negativo: se multiplica por -1 y se invierte el signo');
  const s = parse('max z = 2*x1 + 3/4x2', '2x1 + x2 - 1 <= x2 + 5');
  eqF(s.c[1], '3/4', 'coeficiente fraccionario 3/4');
  eqF(s.constraints[0].b, 6, 'constantes movidas al lado derecho');
  ok(!LP.parseProblem('z = 3x1', 'x1 <= 2').ok, 'error si falta max/min');
  ok(!LP.parseProblem('max z = 3x1 + 2y', 'x1 <= 2').ok, 'error con variable desconocida');
  ok(!LP.parseProblem('max z = 3x1', 'x1 + x13 <= 2').ok, 'error con más de 12 variables');
  ok(LP.parseProblem('max z = x1 + x12', 'x1 + x12 <= 2').ok, 'acepta hasta x12');
}

group('Constructor por casillas');
{
  const t = LP.builderToText({ sense: 'min', nvars: 4, c: ['4', '', '-1', '0'],
    rows: [{ a: ['0.85', '1,1', '', ''], op: '>=', b: '500' }, { a: ['', '', '', ''], op: '<=', b: '' }, { a: ['3/4', '-1', '', ''], op: '=', b: '2' }] });
  ok(t.errors.length === 0, 'formulario válido sin errores');
  ok(t.objective === 'min z = 4x1 - x3', 'objetivo: casillas vacías y 0 se omiten → ' + t.objective);
  ok(t.constraints === '17/20x1 + 11/10x2 >= 500\n3/4x1 - x2 = 2', 'restricciones (fila vacía ignorada) → ' + JSON.stringify(t.constraints));
  const p = LP.parseProblem(t.objective, t.constraints);
  ok(p.ok && p.problem.n === 3 && p.problem.m === 2, 'el texto generado lo lee el parser (3 variables, 2 restricciones)');
  ok(LP.builderToText({ sense: 'max', nvars: 2, c: ['abc', '1'], rows: [{ a: ['1', ''], op: '<=', b: '4' }] }).errors.length === 1, 'error si una casilla no es número');
  ok(/falta el lado derecho/.test(LP.builderToText({ sense: 'max', nvars: 2, c: ['1', '1'], rows: [{ a: ['1', '1'], op: '<=', b: '' }] }).errors[0]), 'error si falta el lado derecho');
  ok(LP.builderToText({ sense: 'max', nvars: 1, c: ['1', '5'], rows: [{ a: ['1', '9'], op: '<=', b: '4' }] }).objective === 'max z = x1', 'ignora casillas de variables ocultas');
  const big = LP.builderToText({ sense: 'max', nvars: 12, c: Array(12).fill('1'), rows: [{ a: Array(12).fill('1'), op: '<=', b: '10' }] });
  const pb = LP.parseProblem(big.objective, big.constraints);
  ok(pb.ok && pb.problem.n === 12 && LP.solveSimplexNormal(pb.problem).z.equals(F(10)), '12 variables: se resuelve (z = 10)');
  ok(!LP.parseProblem('max z = 3x1', 'x1 + x2 4').ok, 'error si falta el signo de relación');
  ok(!LP.parseProblem('max z = 3x1', '2x1 3x2 <= 4').ok, 'error si falta + entre términos');
  const e = LP.parseProblem('max z = 3x1', 'x1 <= 2 <= 3');
  ok(!e.ok && /un signo/.test(e.errors[0]), 'mensaje en español: ' + (e.errors || [])[0]);
}

group('Analizador');
{
  const a1 = LP.analyze(parse('min z = 4x1 + x2', '3x1 + x2 = 3\n4x1 + 3x2 >= 6\nx1 + 2x2 <= 4'));
  ok(a1.recommended === 'twoPhase', 'caso 1: recomienda dos fases');
  ok(a1.summary.extras.H.map((v) => v.name).join() === 'H1' && a1.summary.extras.S.map((v) => v.name).join() === 'S1' &&
     a1.summary.extras.R.map((v) => v.name).join() === 'R1,R2', 'caso 1: variables extra H1, S1, R1, R2');
  const m1 = Object.fromEntries(a1.methods.map((m) => [m.id, m.applicable]));
  ok(m1.graphic && !m1.simplex && m1.bigM && m1.twoPhase && !m1.dual, 'caso 1: gráfico, Gran M y dos fases aplicables; simplex y dual no');
  const a5 = LP.analyze(parse('max z = 5x1 + 4x2', '6x1 + 4x2 <= 24\nx1 + 2x2 <= 6\nx2 <= 2\n-x1 + x2 <= 1'));
  ok(a5.recommended === 'simplex', 'caso 5: recomienda simplex normal');
  const a6 = LP.analyze(parse('min z = 24x1 + 6x2 + 2x3 + x4', '6x1 + x2 - x4 >= 5\n4x1 + 2x2 + x3 + x4 >= 4'));
  const m6 = Object.fromEntries(a6.methods.map((m) => [m.id, m.applicable]));
  ok(m6.dual && !m6.graphic, 'caso 6: simplex dual aplicable, gráfico no (4 variables)');
}

/* ---------------- Etapas 2–3: simplex, Gran M, dos fases, dual ---------------- */
const CASES = {
  1: ['min z = 4x1 + x2', '3x1 + x2 = 3\n4x1 + 3x2 >= 6\nx1 + 2x2 <= 4'],
  2: ['max z = 3x1 + 2x2', 'x1 + x2 = 6\nx1 <= 4\nx1 + 3x2 >= 6'],
  3: ['max z = 2x1 + 3x2', 'x1 + x2 <= 10\n3x1 - x2 >= 6\n2x1 + x2 <= 16'],
  4: ['max z = 265x1 + 270x2 + 262x3', '0.85x1 + 1.1x2 + 6.9x3 >= 500\n24x1 + 28x2 + 25x3 <= 13000\n22x1 + 24x2 + 20x3 <= 12000'],
  5: ['max z = 5x1 + 4x2', '6x1 + 4x2 <= 24\nx1 + 2x2 <= 6\nx2 <= 2\n-x1 + x2 <= 1'],
  6: ['min z = 24x1 + 6x2 + 2x3 + x4', '6x1 + x2 - x4 >= 5\n4x1 + 2x2 + x3 + x4 >= 4'],
  7: ['max z = x1 + x2', 'x1 + x2 <= 2\nx1 + x2 >= 5'],
  8: ['max z = x1 + x2', 'x1 - x2 <= 1'],
  9: ['max z = x1 + x2', 'x1 + x2 <= 4\nx1 <= 3'],
};
const P = (k) => parse(...CASES[k]);

/** Chequeos internos de todos los pasos: zj−cj = 0 en básicas y renglón z consistente. */
function stepsHealthy(res) {
  return res.steps.every((s) => s.basicCheck && (s.check === undefined || s.check));
}
function expectOptimal(res, x, z, label) {
  ok(res.status === 'optimal', `${label}: estado óptimo (obtenido ${res.status})`);
  if (res.status !== 'optimal') return;
  x.forEach((v, j) => eqF(res.x[j], v, `${label}: x${j + 1}`));
  eqF(res.z, z, `${label}: z`);
  ok(res.zConsistent, `${label}: z de la tabla = Σ c·x`);
  ok(res.allOk, `${label}: la solución cumple todas las restricciones originales`);
  ok(stepsHealthy(res), `${label}: chequeos internos de cada tabla (zj−cj básicas = 0, Fz consistente)`);
}

group('Caso 1 — min, igualdad + ≥ + ≤');
{
  const p = P(1);
  const tp = LP.solveTwoPhase(p);
  expectOptimal(tp, ['2/5', '9/5'], '17/5', 'Dos fases');
  ok(tp.phase1 && tp.phase1.r.isZero(), 'Fase I termina con r = 0');
  if (tp.phase1) {
    eqF(tp.phase1.values.x1, '3/5', 'Fase I: x1 = 3/5');
    eqF(tp.phase1.values.x2, '6/5', 'Fase I: x2 = 6/5');
    eqF(tp.phase1.values.H1, 1, 'Fase I: H1 = 1');
  }
  expectOptimal(LP.solveBigM(p), ['2/5', '9/5'], '17/5', 'Gran M');
  const op = LP.formatOp(LP.solveBigM(p).steps[0].ops.find((o) => o.type === 'zrow'));
  ok(/^Fz [+−] /.test(op), 'texto de operación del renglón z: ' + op);
}

group('Caso 2 — max, Gran M con dos artificiales');
{
  const bm = LP.solveBigM(P(2));
  ok(bm.artificialCount === 2, 'usa dos artificiales');
  expectOptimal(bm, [4, 2], 16, 'Gran M');
  ok(bm.steps.some((s) => s.comments.some((c) => /se elimina su columna/.test(c))), 'avisa cuando una artificial sale y se elimina su columna');
  expectOptimal(LP.solveTwoPhase(P(2)), [4, 2], 16, 'Dos fases');
}

group('Caso 3 — max con una ≥');
expectOptimal(LP.solveBigM(P(3)), [4, 6], 26, 'Gran M');
expectOptimal(LP.solveTwoPhase(P(3)), [4, 6], 26, 'Dos fases');

group('Caso 4 — fracciones feas (exactitud)');
{
  const bm = LP.solveBigM(P(4)), tp = LP.solveTwoPhase(P(4));
  expectOptimal(bm, ['1544000/2887', 0, '19000/2887'], '414138000/2887', 'Gran M');
  expectOptimal(tp, ['1544000/2887', 0, '19000/2887'], '414138000/2887', 'Dos fases');
  const cmp = LP.compareBigMTwoPhase(P(4));
  ok(cmp.agree && cmp.sameX, 'comparador: Gran M y Dos fases dan exactamente lo mismo');
  const op = LP.formatOp(bm.steps[0].ops.find((o) => o.type === 'zrow'), (f) => f.toDecimal(4));
  ok(op === 'Fz + (6.9M + 262)·F1', 'operación "Fz + (6.9M + 262)·F1" → ' + op);
  ok(LP.formatOp(bm.steps[0].ops[0], (f) => f.toDecimal(4)) === 'F1 ÷ 6.9', 'operación "F1 ÷ 6.9"');
}

group('Caso 5 — simplex normal');
expectOptimal(LP.solveSimplexNormal(P(5)), [3, '3/2'], 21, 'Simplex normal');

group('Caso 6 — min con 4 variables');
expectOptimal(LP.solveBigM(P(6)), ['3/4', '1/2', 0, 0], 21, 'Gran M');
expectOptimal(LP.solveTwoPhase(P(6)), ['3/4', '1/2', 0, 0], 21, 'Dos fases');
expectOptimal(LP.solveDual(P(6)), ['3/4', '1/2', 0, 0], 21, 'Simplex dual');

group('Caso 7 — infactible');
{
  const tp = LP.solveTwoPhase(P(7)), bm = LP.solveBigM(P(7));
  ok(tp.status === 'infeasible', 'Dos fases: infactible');
  ok(tp.phase1 && tp.phase1.r.sign() > 0, `Fase I termina con r > 0 (r = ${tp.phase1 && tp.phase1.r})`);
  ok(bm.status === 'infeasible', 'Gran M: infactible (artificial > 0 al final)');
  ok(LP.compareBigMTwoPhase(P(7)).agree, 'comparador: ambos concluyen infactible');
}

group('Caso 8 — no acotado');
{
  const r = LP.solveSimplexNormal(P(8));
  ok(r.status === 'unbounded', 'Simplex normal: no acotado');
  ok(r.steps[r.steps.length - 1].kind === 'unbounded', 'el último paso explica la falta de coeficientes positivos');
}

group('Caso 9 — óptimos múltiples');
{
  const r = LP.solveSimplexNormal(P(9));
  eqF(r.z, 4, 'z = 4');
  ok(r.multiple, `detecta óptimos múltiples (no básicas con zj−cj = 0: ${(r.multipleVars || []).join(', ')})`);
  const pts = [r.x.map(String).join(','), r.alternative && r.alternative.x.map(String).join(',')];
  ok(pts.includes('0,4') && pts.includes('3,1'), `encuentra los vértices (0,4) y (3,1): ${pts.join(' y ')}`);
}

/* ---------------- Etapa 5: método gráfico ---------------- */
if (LP.graphicSolve) {
  group('Método gráfico');
  const g5 = LP.graphicSolve(P(5));
  ok(g5.status === 'optimal', 'caso 5: óptimo');
  eqF(g5.optimum.x, 3, 'caso 5: x1 = 3'); eqF(g5.optimum.y, '3/2', 'caso 5: x2 = 3/2'); eqF(g5.optimum.z, 21, 'caso 5: z = 21');
  ok(g5.vertices.length === 6, `caso 5: 6 vértices factibles (obtenidos ${g5.vertices.length})`);
  const g1 = LP.graphicSolve(P(1));
  eqF(g1.optimum.z, '17/5', 'caso 1 (min): z = 17/5');
  const g3 = LP.graphicSolve(P(3));
  eqF(g3.optimum.z, 26, 'caso 3: z = 26');
  ok(LP.graphicSolve(P(7)).status === 'infeasible', 'caso 7: región vacía (infactible)');
  const g8 = LP.graphicSolve(P(8));
  ok(g8.status === 'unbounded' && g8.unboundedRegion, 'caso 8: región y objetivo no acotados');
  const g9 = LP.graphicSolve(P(9));
  ok(g9.status === 'optimal' && g9.multiple && g9.optimalVertices.length === 2, 'caso 9: óptimos múltiples en 2 vértices');
  const svg = LP.graphicSVG(g5);
  ok(typeof svg === 'string' && svg.startsWith('<svg') && svg.includes('polygon'), 'genera el SVG con la región sombreada');
}

console.log(`\n${failed === 0 ? '✔ TODAS LAS PRUEBAS PASARON' : '✘ HAY PRUEBAS FALLIDAS'}: ${passed} correctas, ${failed} fallidas.`);
process.exitCode = failed === 0 ? 0 : 1;
