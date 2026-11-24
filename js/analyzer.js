/* analyzer.js — Resume el problema y decide qué métodos aplican y cuál conviene. Sin DOM. */
(function (G) {
  'use strict';
  const LP = G.LP = G.LP || {};

  const METHOD_NAMES = {
    graphic: 'Método gráfico',
    simplex: 'Simplex normal',
    bigM: 'Gran M',
    twoPhase: 'Dos fases',
    dual: 'Simplex dual',
  };

  /** Nombres de las variables extra según las convenciones del curso (H, S, R numeradas por tipo). */
  function extraVariables(p) {
    const H = [], S = [], R = [];
    p.constraints.forEach((con, i) => {
      if (con.op === '<=') H.push({ name: `H${H.length + 1}`, con: i });
      else if (con.op === '>=') S.push({ name: `S${S.length + 1}`, con: i });
    });
    p.constraints.forEach((con, i) => {
      if (con.op !== '<=') R.push({ name: `R${R.length + 1}`, con: i });
    });
    return { H, S, R };
  }

  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;

  function analyze(p) {
    const le = p.constraints.filter((c) => c.op === '<=').length;
    const ge = p.constraints.filter((c) => c.op === '>=').length;
    const eq = p.constraints.filter((c) => c.op === '=').length;
    const extras = extraVariables(p);
    const hasArt = ge + eq > 0;
    const allLE = !hasArt;
    const costsNonNeg = p.c.every((v) => v.sign() >= 0);

    const methods = [];
    methods.push({
      id: 'graphic', name: METHOD_NAMES.graphic, applicable: p.n === 2,
      reason: p.n === 2
        ? 'Hay exactamente 2 variables: cada restricción es una recta en el plano x1–x2 y se puede dibujar la región factible.'
        : `Hay ${plural(p.n, 'variable', 'variables')}; el método gráfico solo sirve con exactamente 2.`,
      note: 'Ideal para ver la geometría (vértices, región, recta de nivel). No produce tablas.',
    });
    methods.push({
      id: 'simplex', name: METHOD_NAMES.simplex, applicable: allLE,
      reason: allLE
        ? 'Todas las restricciones son ≤ con b ≥ 0: el origen (todas las x = 0) es factible y las holguras H forman la base inicial.'
        : `Hay ${ge} restricción(es) ≥ y ${eq} de igualdad: el origen no sirve como solución inicial (o no hay holgura para la base), así que hacen falta variables artificiales R.`,
      note: 'El más corto cuando aplica.',
    });
    methods.push({
      id: 'bigM', name: METHOD_NAMES.bigM, applicable: hasArt,
      reason: hasArt
        ? 'Hay restricciones ≥ o =: se agregan artificiales R con costo ' + (p.sense === 'max' ? '−M' : '+M') + ' y se resuelve todo en una sola tabla continua con M simbólica.'
        : 'Todas las restricciones son ≤: no hacen falta artificiales (usa el simplex normal).',
      note: 'Equivalente a dos fases y más compacto a mano, pero hay que arrastrar la M.',
    });
    methods.push({
      id: 'twoPhase', name: METHOD_NAMES.twoPhase, applicable: hasArt,
      reason: hasArt
        ? 'Hay restricciones ≥ o =: la Fase I (min r = suma de las R) busca una solución factible sin usar M; la Fase II optimiza la z original.'
        : 'Todas las restricciones son ≤: no hacen falta artificiales (usa el simplex normal).',
      note: 'Evita la M y la Fase I diagnostica la factibilidad por separado.',
    });
    const dualOK = p.sense === 'min' && costsNonNeg && ge === p.m;
    let dualReason;
    if (dualOK) dualReason = 'Es minimización, todos los costos son ≥ 0 y todas las restricciones son ≥: al multiplicarlas por −1 las S forman una base óptima (zj−cj ≤ 0) pero infactible, que el dual simplex corrige sin artificiales.';
    else if (p.sense !== 'min') dualReason = 'Requiere un problema de minimización (en esta versión).';
    else if (!costsNonNeg) dualReason = 'Requiere que todos los costos de la función objetivo sean ≥ 0.';
    else dualReason = 'Requiere que todas las restricciones sean ≥.';
    methods.push({ id: 'dual', name: METHOD_NAMES.dual, applicable: dualOK, reason: dualReason, note: 'Etapa opcional: no usa artificiales.' });

    let recommended, justification;
    if (hasArt) {
      recommended = 'twoPhase';
      justification = 'Dos fases: con restricciones ≥ o = hacen falta artificiales. La Fase I te dice de forma separada y clara si el problema es factible (r = 0) y todo se maneja con números exactos, sin M. Gran M es equivalente y más compacto (una sola tabla), puedes compararlos con el botón "Comparar".';
      if (dualOK) justification += ' Como además es min con costos ≥ 0 y todas ≥, el simplex dual también es una buena opción (sin artificiales).';
    } else {
      recommended = 'simplex';
      justification = 'Simplex normal: todas las restricciones son ≤ con b ≥ 0, así que se arranca directamente desde el origen con las holguras como base; no hacen falta artificiales.';
    }
    if (p.n === 2) justification += ' Con 2 variables, mira también el método gráfico para ver la geometría.';
    methods.forEach((m) => { m.recommended = m.id === recommended; });

    return {
      summary: {
        sense: p.sense, n: p.n, m: p.m, le, ge, eq,
        extras,
        extraText: [
          extras.H.length ? `Holguras (≤): ${extras.H.map((v) => v.name).join(', ')}` : null,
          extras.S.length ? `Excesos (≥): ${extras.S.map((v) => v.name).join(', ')}` : null,
          extras.R.length ? `Artificiales (≥ y =): ${extras.R.map((v) => v.name).join(', ')}` : null,
        ].filter(Boolean),
      },
      methods, recommended, justification,
      canCompare: hasArt,
    };
  }

  LP.analyze = analyze;
  LP.extraVariables = extraVariables;
  LP.METHOD_NAMES = METHOD_NAMES;
  if (typeof module !== 'undefined' && module.exports) module.exports = LP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
