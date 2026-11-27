/* graphic.js — Método gráfico (2 variables). Vértices y z con fracciones exactas;
   genera un SVG como texto (sin DOM). */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};
  const { Fraction } = LP;
  const ZERO = Fraction.ZERO, ONE = Fraction.ONE;

  function satisfies(lhs, op, b) {
    const c = lhs.cmp(b);
    return op === '<=' ? c <= 0 : op === '>=' ? c >= 0 : c === 0;
  }

  function graphicSolve(p) {
    if (p.n !== 2) return { ok: false, status: 'error', error: 'El método gráfico necesita exactamente 2 variables.' };
    const cons = p.constraints.map((con, i) => ({
      label: `(${i + 1})`, a1: con.a[0], a2: con.a[1], b: con.b, op: con.op,
      text: `${LP.formatLinear(con.a, null)} ${LP.OP_SYMBOL[con.op]} ${con.b}`,
    }));
    const lines = cons.concat([
      { label: 'x1 = 0', a1: ONE, a2: ZERO, b: ZERO, axis: true },
      { label: 'x2 = 0', a1: ZERO, a2: ONE, b: ZERO, axis: true },
    ]);
    const feasible = (x, y) => x.sign() >= 0 && y.sign() >= 0 &&
      cons.every((c) => satisfies(c.a1.mul(x).add(c.a2.mul(y)), c.op, c.b));
    const zOf = (x, y) => p.c[0].mul(x).add(p.c[1].mul(y));

    const vertices = [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const L1 = lines[i], L2 = lines[j];
        const det = L1.a1.mul(L2.a2).sub(L1.a2.mul(L2.a1));
        if (det.isZero()) continue;
        const x = L1.b.mul(L2.a2).sub(L1.a2.mul(L2.b)).div(det);
        const y = L1.a1.mul(L2.b).sub(L1.b.mul(L2.a1)).div(det);
        if (!feasible(x, y)) continue;
        const prev = vertices.find((v) => v.x.equals(x) && v.y.equals(y));
        if (prev) { [L1.label, L2.label].forEach((l) => { if (!prev.from.includes(l)) prev.from.push(l); }); continue; }
        vertices.push({ x, y, z: zOf(x, y), from: [L1.label, L2.label] });
      }
    }
    vertices.sort((u, v) => u.x.cmp(v.x) || u.y.cmp(v.y));
    const res = { ok: true, sense: p.sense, c: p.c, cons, vertices, notes: [] };
    if (!vertices.length) {
      res.status = 'infeasible';
      res.notes.push('Ningún punto cumple todas las restricciones a la vez: la región factible está vacía. El problema es INFACTIBLE.');
      return res;
    }
    // Cono de recesión: direcciones d ≥ 0 en las que la región se extiende sin fin.
    const cand = [[ONE, ZERO], [ZERO, ONE]];
    cons.forEach((c) => { if (!(c.a1.isZero() && c.a2.isZero())) { cand.push([c.a2, c.a1.neg()]); cand.push([c.a2.neg(), c.a1]); } });
    const rays = cand.filter(([d1, d2]) => !(d1.isZero() && d2.isZero()) && d1.sign() >= 0 && d2.sign() >= 0 &&
      cons.every((c) => satisfies(c.a1.mul(d1).add(c.a2.mul(d2)), c.op, ZERO)));
    res.unboundedRegion = rays.length > 0;
    const better = (v) => (p.sense === 'max' ? v.sign() > 0 : v.sign() < 0);
    const cd = (d) => p.c[0].mul(d[0]).add(p.c[1].mul(d[1]));
    if (res.unboundedRegion) res.notes.push('La región factible es NO ACOTADA: en el dibujo se recorta a la ventana visible.');
    if (rays.some((d) => better(cd(d)))) {
      res.status = 'unbounded';
      res.notes.push(`La función objetivo puede ${p.sense === 'max' ? 'crecer' : 'decrecer'} sin límite dentro de la región: el problema es NO ACOTADO (no hay óptimo).`);
      return res;
    }
    let best = vertices[0];
    for (const v of vertices) { const c = v.z.cmp(best.z); if (p.sense === 'max' ? c > 0 : c < 0) best = v; }
    res.optimalVertices = vertices.filter((v) => v.z.equals(best.z));
    res.optimalVertices.forEach((v) => { v.optimal = true; });
    res.optimum = best;
    res.status = 'optimal';
    const optRay = rays.some((d) => cd(d).isZero());
    res.multiple = res.optimalVertices.length > 1 || optRay;
    if (res.optimalVertices.length > 1) {
      res.notes.push(`Óptimos MÚLTIPLES: z = ${best.z} se alcanza en ${res.optimalVertices.length} vértices y en todo el segmento que los une (la recta de nivel es paralela a una restricción).`);
    } else if (optRay) {
      res.notes.push(`Óptimos MÚLTIPLES: z = ${best.z} se alcanza en una semirrecta que parte del vértice óptimo.`);
    }
    return res;
  }

  /* ---------------- Dibujo SVG (usa números de punto flotante solo para pintar) ---------------- */
  function niceStep(range) {
    const raw = range / 8;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / pow;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
  }
  function clipPolygon(poly, a1, a2, b, keepLE) {
    const f = (pt) => a1 * pt[0] + a2 * pt[1] - b;
    const eps = 1e-9 * (Math.abs(b) + Math.abs(a1) + Math.abs(a2) + 1);
    const inside = (pt) => (keepLE ? f(pt) <= eps : f(pt) >= -eps);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const pin = inside(P), qin = inside(Q);
      if (pin) out.push(P);
      if (pin !== qin) {
        const t = f(P) / (f(P) - f(Q));
        out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      }
    }
    return out;
  }
  function clipLine(a1, a2, b, X, Y) {
    const pts = [];
    const add = (x, y) => {
      if (x >= -1e-9 && x <= X + 1e-9 && y >= -1e-9 && y <= Y + 1e-9 && !pts.some((q) => Math.abs(q[0] - x) < 1e-9 && Math.abs(q[1] - y) < 1e-9)) pts.push([x, y]);
    };
    if (a2 !== 0) { add(0, b / a2); add(X, (b - a1 * X) / a2); }
    if (a1 !== 0) { add(b / a1, 0); add((b - a2 * Y) / a1, Y); }
    if (pts.length < 2) return null;
    pts.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    return [pts[0], pts[pts.length - 1]];
  }
  const fmtNum = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(+v.toFixed(2)));
  const escX = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function graphicSVG(g, opts) {
    opts = opts || {};
    const W = opts.width || 640, H = opts.height || 480, ml = 52, mr = 24, mt = 20, mb = 44;
    const xs = [1], ys = [1];
    g.vertices.forEach((v) => { xs.push(v.x.toNumber()); ys.push(v.y.toNumber()); });
    g.cons.forEach((c) => {
      const a1 = c.a1.toNumber(), a2 = c.a2.toNumber(), b = c.b.toNumber();
      if (a1 > 0 && b > 0) xs.push(b / a1);
      if (a2 > 0 && b > 0) ys.push(b / a2);
    });
    const grow = g.unboundedRegion ? 1.6 : 1.2;
    let X = Math.max(...xs) * grow, Y = Math.max(...ys) * grow;
    const sx = niceStep(X), sy = niceStep(Y);
    X = Math.ceil(X / sx) * sx; Y = Math.ceil(Y / sy) * sy;
    const px = (x) => ml + (x / X) * (W - ml - mr);
    const py = (y) => H - mb - (y / Y) * (H - mt - mb);
    const P = (pt) => `${px(pt[0]).toFixed(1)},${py(pt[1]).toFixed(1)}`;
    const parts = [];
    parts.push(`<svg class="graph" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gráfica de la región factible">`);
    parts.push(`<defs><clipPath id="plotArea"><rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}"/></clipPath></defs>`);
    // Cuadrícula y marcas
    for (let x = 0; x <= X + 1e-9; x += sx) {
      parts.push(`<line class="g-grid" x1="${px(x)}" y1="${py(0)}" x2="${px(x)}" y2="${py(Y)}"/>`);
      parts.push(`<text class="g-tick" x="${px(x)}" y="${py(0) + 16}" text-anchor="middle">${fmtNum(x)}</text>`);
    }
    for (let y = 0; y <= Y + 1e-9; y += sy) {
      parts.push(`<line class="g-grid" x1="${px(0)}" y1="${py(y)}" x2="${px(X)}" y2="${py(y)}"/>`);
      if (y > 0) parts.push(`<text class="g-tick" x="${px(0) - 6}" y="${py(y) + 4}" text-anchor="end">${fmtNum(y)}</text>`);
    }
    // Región factible
    if (g.status !== 'infeasible') {
      let poly = [[0, 0], [X, 0], [X, Y], [0, Y]];
      g.cons.forEach((c) => {
        const a1 = c.a1.toNumber(), a2 = c.a2.toNumber(), b = c.b.toNumber();
        if (c.op !== '>=') poly = clipPolygon(poly, a1, a2, b, true);
        if (c.op !== '<=') poly = clipPolygon(poly, a1, a2, b, false);
      });
      if (poly.length >= 2) parts.push(`<polygon class="g-region" points="${poly.map(P).join(' ')}"/>`);
    }
    // Restricciones
    g.cons.forEach((c, i) => {
      const seg = clipLine(c.a1.toNumber(), c.a2.toNumber(), c.b.toNumber(), X, Y);
      if (!seg) return;
      const k = i % 6;
      parts.push(`<line class="g-line g-c${k}" x1="${px(seg[0][0])}" y1="${py(seg[0][1])}" x2="${px(seg[1][0])}" y2="${py(seg[1][1])}"/>`);
      const t = 0.12 + 0.76 * ((i * 0.37) % 1);  // reparte las etiquetas a lo largo de cada recta
      const lx = seg[0][0] + t * (seg[1][0] - seg[0][0]), ly = seg[0][1] + t * (seg[1][1] - seg[0][1]);
      parts.push(`<text class="g-label g-c${k}" x="${px(lx) + 6}" y="${py(ly) - 6}">${escX(c.label + ' ' + c.text)}</text>`);
    });
    // Recta de nivel
    if (g.status === 'optimal') {
      const seg = clipLine(g.c[0].toNumber(), g.c[1].toNumber(), g.optimum.z.toNumber(), X, Y);
      if (seg) {
        parts.push(`<line class="g-level" x1="${px(seg[0][0])}" y1="${py(seg[0][1])}" x2="${px(seg[1][0])}" y2="${py(seg[1][1])}"/>`);
        const e = seg[1];   // extremo derecho: la etiqueta queda fuera de la región, junto a la recta
        parts.push(`<text class="g-label g-levtext" x="${Math.min(px(e[0]) + 8, W - mr - 90)}" y="${Math.min(Math.max(py(e[1]) - 10, mt + 12), H - mb - 8)}">z = ${escX(g.optimum.z.toString())}</text>`);
      }
    }
    // Ejes
    parts.push(`<line class="g-axis" x1="${px(0)}" y1="${py(0)}" x2="${px(X)}" y2="${py(0)}"/>`);
    parts.push(`<line class="g-axis" x1="${px(0)}" y1="${py(0)}" x2="${px(0)}" y2="${py(Y)}"/>`);
    parts.push(`<text class="g-axislabel" x="${px(X) - 4}" y="${py(0) + 32}" text-anchor="end">x1</text>`);
    parts.push(`<text class="g-axislabel" x="${px(0) - 36}" y="${py(Y) + 4}">x2</text>`);
    // Vértices
    g.vertices.forEach((v, i) => {
      const cx = px(v.x.toNumber()), cy = py(v.y.toNumber());
      const label = `V${i + 1} = (${v.x}, ${v.y})  ·  z = ${v.z}`;
      parts.push(`<circle class="g-vtx${v.optimal ? ' g-opt' : ''}" cx="${cx}" cy="${cy}" r="${v.optimal ? 7 : 5}" data-tip="${escX(label)}" data-dec="(${v.x.toDecimal(4)}, ${v.y.toDecimal(4)}) · z ≈ ${v.z.toDecimal(4)}"><title>${escX(label)}</title></circle>`);
      parts.push(`<text class="g-vname" x="${cx + 8}" y="${cy + 16}">V${i + 1}</text>`);
    });
    parts.push('</svg>');
    return parts.join('');
  }

  LP.graphicSolve = graphicSolve;
  LP.graphicSVG = graphicSVG;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
