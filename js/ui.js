/* ui.js — Interfaz: lee el formulario, muestra el análisis y DIBUJA los pasos que devuelven los solvers. */
(function () {
  'use strict';
  const LP = window.LP;
  const $ = (s) => document.querySelector(s);
  const state = { problem: null, analysis: null, view: null, stepIdx: 0, showAll: false, decimals: false };

  const EXAMPLES = [
    { t: '1 · Min con =, ≥ y ≤', d: 'Dos fases / Gran M', obj: 'min z = 4x1 + x2', cons: '3x1 + x2 = 3\n4x1 + 3x2 >= 6\nx1 + 2x2 <= 4' },
    { t: '2 · Max con dos artificiales', d: 'Gran M', obj: 'max z = 3x1 + 2x2', cons: 'x1 + x2 = 6\nx1 <= 4\nx1 + 3x2 >= 6' },
    { t: '3 · Max con una ≥', d: 'Gran M / Dos fases', obj: 'max z = 2x1 + 3x2', cons: 'x1 + x2 <= 10\n3x1 - x2 >= 6\n2x1 + x2 <= 16' },
    { t: '4 · Fracciones feas', d: '3 variables, decimales', obj: 'max z = 265x1 + 270x2 + 262x3', cons: '0.85x1 + 1.1x2 + 6.9x3 >= 500\n24x1 + 28x2 + 25x3 <= 13000\n22x1 + 24x2 + 20x3 <= 12000' },
    { t: '5 · Todas ≤', d: 'Simplex normal y gráfico', obj: 'max z = 5x1 + 4x2', cons: '6x1 + 4x2 <= 24\nx1 + 2x2 <= 6\nx2 <= 2\n-x1 + x2 <= 1' },
    { t: '6 · Min con 4 variables', d: 'Dos fases / dual', obj: 'min z = 24x1 + 6x2 + 2x3 + x4', cons: '6x1 + x2 - x4 >= 5\n4x1 + 2x2 + x3 + x4 >= 4' },
    { t: '7 · Infactible', d: 'Caso especial', obj: 'max z = x1 + x2', cons: 'x1 + x2 <= 2\nx1 + x2 >= 5' },
    { t: '8 · No acotado', d: 'Caso especial', obj: 'max z = x1 + x2', cons: 'x1 - x2 <= 1' },
    { t: '9 · Óptimos múltiples', d: 'Caso especial', obj: 'max z = x1 + x2', cons: 'x1 + x2 <= 4\nx1 <= 3' },
  ];

  /* ---------- Formato ---------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const exact = (f) => f.toString();
  const dec = (f) => f.toDecimal(4);
  /** Formateador para textos (operaciones): decimal si el interruptor está activo. */
  const fmtText = (f) => (state.decimals ? dec(f) : exact(f));
  /** Fracción en celda: a/b y, si se pide, el decimal debajo. */
  function cellF(f) {
    let h = `<span class="frac">${esc(exact(f))}</span>`;
    if (state.decimals && !f.isInteger()) h += `<span class="dec">≈ ${esc(dec(f))}</span>`;
    return h;
  }
  function cellM(v) {
    v = LP.MValue.of(v);
    let h = `<span class="frac">${esc(v.format(exact))}</span>`;
    if (state.decimals && !v.isExactInteger()) h += `<span class="dec">≈ ${esc(v.format(dec))}</span>`;
    return h;
  }
  /** Número dentro de una frase: fracción y, si se pide, (≈ decimal). */
  function inlineF(f) {
    const s = esc(exact(f));
    return state.decimals && !f.isInteger() ? `${s} <span class="muted">(≈ ${esc(dec(f))})</span>` : s;
  }
  function inlineM(v) {
    v = LP.MValue.of(v);
    const s = esc(v.format(exact));
    return state.decimals && !v.isExactInteger() ? `${s} <span class="muted">(≈ ${esc(v.format(dec))})</span>` : s;
  }
  const opSym = (op) => LP.OP_SYMBOL[op] || op;
  const statusText = { optimal: 'Solución óptima', infeasible: 'Problema INFACTIBLE', unbounded: 'Problema NO ACOTADO', cycle: 'Se detuvo (posible ciclaje)' };

  /* ---------- Entrada ---------- */
  function renderExamples() {
    $('#ejemplos').innerHTML = EXAMPLES.map((e, i) => `<button type="button" data-ex="${i}"><b>${esc(e.t)}</b><span>${esc(e.d)}</span></button>`).join('');
    $('#ejemplos').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-ex]');
      if (!b) return;
      const e = EXAMPLES[+b.dataset.ex];
      $('#objetivo').value = e.obj;
      $('#restricciones').value = e.cons;
      analyze();
    });
  }

  function showMessages(errors, warnings) {
    let h = '';
    if (errors && errors.length) h += `<div class="msg error"><b>Hay que corregir:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    if (warnings && warnings.length) h += `<div class="msg warn"><b>Avisos:</b><ul>${warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    $('#mensajes').innerHTML = h;
  }

  function analyze() {
    let r;
    try { r = LP.parseProblem($('#objetivo').value, $('#restricciones').value); }
    catch (e) { r = { ok: false, errors: ['Error inesperado al leer: ' + e.message] }; }
    showMessages(r.errors, r.warnings);
    $('#solucion').classList.add('hidden');
    if (!r.ok) { $('#analisis').classList.add('hidden'); state.problem = null; return; }
    state.problem = r.problem;
    state.analysis = LP.analyze(r.problem);
    renderAnalysis();
    $('#analisis').classList.remove('hidden');
    $('#analisis').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Análisis ---------- */
  function renderAnalysis() {
    const p = state.problem, a = state.analysis, s = a.summary;
    const names = p.c.map((_, j) => `x${j + 1}`);
    const readBack = [`${p.sense} z = ${LP.formatLinear(p.c, names)}`,
      ...p.constraints.map((c, i) => `(${i + 1})  ${LP.formatLinear(c.a, names)} ${opSym(c.op)} ${c.b}${c.flipped ? '    ← multiplicada por −1' : ''}`),
      `${names.join(', ')} ≥ 0`].join('\n');
    let h = `<div class="summary">
      <div class="stat"><div class="k">Tipo</div><div class="v">${p.sense === 'max' ? 'Maximización' : 'Minimización'}</div></div>
      <div class="stat"><div class="k">Variables</div><div class="v">${p.n}</div></div>
      <div class="stat"><div class="k">Restricciones</div><div class="v">${p.m}</div></div>
      <div class="stat"><div class="k">≤ / ≥ / =</div><div class="v">${s.le} / ${s.ge} / ${s.eq}</div></div>
    </div>
    <p class="label">Así se leyó el problema</p>
    <pre class="read-back">${esc(readBack)}</pre>
    <p><b>Variables extra necesarias:</b> ${s.extraText.length ? s.extraText.map(esc).join(' · ') : 'ninguna'}</p>
    <div class="table-wrap"><table class="methods"><thead><tr><th>Método</th><th>Estado</th><th>Por qué</th><th></th></tr></thead><tbody>`;
    a.methods.forEach((m) => {
      h += `<tr class="${m.recommended ? 'rec' : ''}">
        <td><b>${esc(m.name)}</b> ${m.recommended ? '<span class="badge rec">RECOMENDADO</span>' : ''}</td>
        <td>${m.applicable ? '<span class="badge ok">aplicable</span>' : '<span class="badge no">no aplicable</span>'}</td>
        <td>${esc(m.reason)}<span class="note">${esc(m.note)}</span></td>
        <td><button type="button" class="small ${m.recommended ? 'primary' : ''}" data-solve="${m.id}" ${m.applicable ? '' : 'disabled'}>Resolver</button></td>
      </tr>`;
    });
    h += `</tbody></table></div>
      <div class="reco"><b>Recomendación:</b> ${esc(a.justification)}</div>
      <div class="actions"><button type="button" id="btnComparar" ${a.canCompare ? '' : 'disabled title="Solo aplica si hay restricciones ≥ o ="'}>Comparar Gran M vs Dos fases</button></div>`;
    $('#analisisContenido').innerHTML = h;
  }

  /* ---------- Resolver ---------- */
  function solve(method) {
    const p = state.problem;
    if (!p) return;
    try {
      if (method === 'graphic') state.view = { type: 'graphic', g: LP.graphicSolve(p) };
      else if (method === 'compare') state.view = { type: 'compare', cmp: LP.compareBigMTwoPhase(p) };
      else state.view = { type: 'steps', res: LP.solveProblem(p, method) };
    } catch (e) {
      showMessages(['No se pudo resolver: ' + e.message], []);
      return;
    }
    state.stepIdx = 0; state.showAll = false;
    renderSolution();
    $('#solucion').classList.remove('hidden');
    $('#solucion').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSolution() {
    const v = state.view;
    if (!v) return;
    if (v.type === 'graphic') { $('#solucionTitulo').textContent = 'Método gráfico'; $('#solucionContenido').innerHTML = renderGraphic(v.g); return; }
    if (v.type === 'compare') { $('#solucionTitulo').textContent = 'Comparación: Gran M vs Dos fases'; $('#solucionContenido').innerHTML = renderCompare(v.cmp); return; }
    const r = v.res;
    $('#solucionTitulo').textContent = r.methodName;
    $('#solucionContenido').innerHTML = (v.back ? `<div class="actions"><button type="button" id="btnVolverComp">← Volver a la comparación</button></div>` : '') + renderStepsView(r);
  }

  /* ---------- Tabla simplex ---------- */
  function renderTableau(snap, step) {
    const pc = step && step.pivot ? step.pivot.col : (step && step.entering ? step.entering.col : -1);
    const pr = step && step.pivot ? step.pivot.row : (step && step.leaving ? step.leaving.row : -1);
    const c = (j, extra) => `${j === pc ? 'pc' : ''} ${extra || ''}`.trim();
    let h = '<div class="table-wrap"><table class="tableau"><thead>';
    h += `<tr class="cj"><th></th><th>Cj</th>${snap.cols.map((col, j) => `<th class="${c(j)}">${cellM(col.cost)}</th>`).join('')}<th class="bi"></th></tr>`;
    h += `<tr><th>Cx</th><th>Base</th>${snap.cols.map((col, j) => `<th class="${c(j)}">${esc(col.name)}</th>`).join('')}<th class="bi">bi</th></tr>`;
    h += '</thead><tbody>';
    snap.rows.forEach((row, i) => {
      h += `<tr class="${i === pr ? 'pr' : ''}"><td>${cellM(row.cx)}</td><td class="basis">${esc(row.basis)}</td>`;
      row.a.forEach((v, j) => {
        const pv = i === pr && j === pc && step && step.pivot ? ' pv' : '';
        h += `<td class="${c(j)}${pv}">${cellF(v)}</td>`;
      });
      h += `<td class="bi">${cellF(row.b)}</td></tr>`;
    });
    h += `<tr class="zrow"><td></td><td>zj−cj</td>${snap.zc.map((v, j) => `<td class="${c(j)}">${cellM(v)}</td>`).join('')}<td class="bi">${cellM(snap.z)}</td></tr>`;
    h += '</tbody></table></div>';
    if (pc >= 0 || pr >= 0) h += '<p class="legend"><span><i style="background:var(--pc)"></i>columna pivote</span><span><i style="background:var(--pr)"></i>fila pivote</span><span><i style="background:var(--pv)"></i>pivote</span></p>';
    return h;
  }

  function renderStep(step, i, total) {
    const s = step.snapshot;
    let title = step.kind === 'optimal' ? 'Tabla óptima' : step.kind === 'unbounded' ? 'Tabla final (no acotado)' :
      step.kind === 'infeasible' ? 'Tabla final (infactible)' : (step.iter === 0 && step.phase !== 'Fase I (ajuste)' ? 'Tabla inicial' : `Iteración ${step.iter}`);
    if (step.iter === 0 && step.kind !== 'pivot' && step.kind !== 'cycle') title = 'Tabla inicial · ' + title.toLowerCase();
    let h = `<div class="step"><div class="step-head"><span class="phase">${esc(step.phase)}</span><h3>${esc(title)}</h3><span class="muted">Paso ${i + 1} de ${total}</span></div>`;
    h += renderTableau(s, step);
    h += '<div class="explain">';
    if (step.dual && step.leaving) {
      h += `<p><span class="k">Sale:</span> ${esc(step.leaving.name)} porque tiene el bi más negativo (${inlineF(step.leaving.value)}).</p>`;
      if (step.dualRatios) {
        h += '<p><span class="k">Razones |zj−cj ÷ a| (solo coeficientes negativos de la fila pivote):</span></p><ol class="ratios">';
        step.dualRatios.forEach((d) => {
          const isMin = step.entering && d.name === step.entering.name;
          h += d.ratio ? `<li class="${isMin ? 'min' : ''}">${esc(d.name)}: |${esc(d.zc.format(fmtText))} ÷ ${esc(fmtText(d.a))}| = ${inlineF(d.ratio)}${isMin ? '  ← mínima' : ''}</li>`
            : `<li class="skip">${esc(d.name)}: ${esc(d.why)} (${esc(fmtText(d.a))}) → no se considera</li>`;
        });
        h += '</ol>';
      }
      if (step.entering) h += `<p><span class="k">Entra:</span> ${esc(step.entering.name)} (razón mínima ${inlineF(step.entering.ratio)}).</p>`;
    } else if (step.entering) {
      const e = step.entering;
      let why;
      if (e.forced) why = 'para sacar de la base a la artificial que quedó con valor 0.';
      else why = `su zj−cj = ${inlineM(e.value)} es el ${e.sense === 'max' ? 'más negativo (maximización)' : 'más positivo (minimización)'}.`;
      if (e.ties && e.ties.length > 1) why += ` Hay empate con ${esc(e.ties.filter((n) => n !== e.name).join(', '))}: se elige el de menor índice.`;
      h += `<p><span class="k">Entra:</span> ${esc(e.name)} porque ${why}</p>`;
      if (step.ratios) {
        h += '<p><span class="k">Razones bi ÷ coeficiente (solo coeficientes &gt; 0):</span></p><ol class="ratios">';
        step.ratios.forEach((r) => {
          const isMin = step.leaving && r.row === step.leaving.row;
          h += r.ratio ? `<li class="${isMin ? 'min' : ''}">F${r.row + 1} (${esc(r.basis)}): ${esc(fmtText(r.b))} ÷ ${esc(fmtText(r.a))} = ${inlineF(r.ratio)}${isMin ? '  ← mínima' : ''}</li>`
            : `<li class="skip">F${r.row + 1} (${esc(r.basis)}): ${esc(r.why)} (${esc(fmtText(r.a))}) → no se considera</li>`;
        });
        h += '</ol>';
      }
      if (step.leaving) h += `<p><span class="k">Sale:</span> ${esc(step.leaving.name)}${step.leaving.ratio ? ` (razón mínima ${inlineF(step.leaving.ratio)})` : ''}.</p>`;
    }
    if (step.pivot) {
      h += `<p><span class="k">Pivote:</span> ${inlineF(step.pivot.value)} (fila F${step.pivot.row + 1}, columna ${esc(s.cols[step.pivot.col].name)}).</p>`;
      h += '<p><span class="k">Operaciones entre filas</span> <span class="muted">(Fi = fila i; se usa la fila pivote ya dividida)</span>:</p><ol class="ops">';
      step.ops.forEach((op) => { h += `<li>${esc(LP.formatOp(op, fmtText))}</li>`; });
      h += '</ol>';
    }
    h += '</div>';
    if (step.comments.length) {
      h += '<ul class="comments">' + step.comments.map((c) => {
        const k = /INFACTIBLE|NO ACOTADO/.test(c) ? 'k-bad' : /óptima|FACTIBLE\./.test(c) ? 'k-optimal' : '';
        return `<li class="${k}">${esc(c)}</li>`;
      }).join('') + '</ul>';
    }
    h += step.basicCheck ? '<p class="check">✓ Chequeo interno: zj−cj = 0 en todas las columnas básicas.</p>' : '<p class="check fail">✗ Chequeo interno: alguna columna básica no tiene zj−cj = 0.</p>';
    if (step.check === false) h += '<p class="check fail">✗ El renglón z por operaciones no coincide con la fórmula.</p>';
    return h + '</div>';
  }

  function renderStepsView(r) {
    const steps = r.steps, n = steps.length;
    state.stepIdx = Math.min(state.stepIdx, n - 1);
    let h = '<h3 style="margin-top:0">Forma estándar</h3><div class="stdform">' + r.standardForm.map((l) => `<div>${esc(l)}</div>`).join('') + '</div>';
    h += `<div class="nav">
      <button type="button" data-nav="first" ${state.showAll || state.stepIdx === 0 ? 'disabled' : ''}>⏮</button>
      <button type="button" data-nav="prev" ${state.showAll || state.stepIdx === 0 ? 'disabled' : ''}>← Anterior</button>
      <span class="count">${state.showAll ? `${n} pasos` : `Paso ${state.stepIdx + 1} / ${n}`}</span>
      <button type="button" data-nav="next" class="primary" ${state.showAll || state.stepIdx === n - 1 ? 'disabled' : ''}>Siguiente →</button>
      <button type="button" data-nav="last" ${state.showAll || state.stepIdx === n - 1 ? 'disabled' : ''}>⏭</button>
      <span class="spacer"></span>
      <button type="button" data-nav="all">${state.showAll ? 'Ver de uno en uno' : 'Ver todos los pasos'}</button>
    </div>`;
    h += state.showAll ? steps.map((s, i) => renderStep(s, i, n)).join('') : renderStep(steps[state.stepIdx], state.stepIdx, n);
    h += renderFinal(r);
    return h;
  }

  /* ---------- Resultado final ---------- */
  function renderFinal(r) {
    const p = state.problem;
    let h = '<h3>Resultado</h3>';
    const cls = r.status === 'optimal' ? 'ok' : 'error';
    h += `<div class="msg ${cls} banner">${esc(statusText[r.status] || r.status)}</div>`;
    if (r.status === 'infeasible') h += '<div class="msg info">Ninguna combinación de valores ≥ 0 cumple todas las restricciones a la vez. ' + (r.phase1 ? `La Fase I terminó con r = ${inlineF(r.phase1.r)} &gt; 0.` : 'Al final queda una artificial con valor positivo.') + '</div>';
    if (r.status === 'unbounded') h += '<div class="msg info">La función objetivo puede mejorar indefinidamente: hay una dirección dentro de la región factible en la que z ' + (p.sense === 'max' ? 'crece' : 'decrece') + ' sin límite.</div>';
    r.notes.forEach((nt) => { h += `<div class="msg warn">${esc(nt)}</div>`; });
    if (r.status !== 'optimal') return h;

    h += '<div class="result-grid"><div>';
    h += `<p class="label">Valor óptimo</p><div class="zbig">z = ${esc(exact(r.z))}</div>${r.z.isInteger() ? '' : `<div class="muted mono">≈ ${esc(dec(r.z))}</div>`}`;
    h += '<p class="label">Variables de decisión</p><div class="table-wrap"><table><thead><tr><th>Variable</th><th class="num">Fracción</th><th class="num">Decimal</th></tr></thead><tbody>';
    r.x.forEach((v, j) => { h += `<tr><td>x${j + 1}</td><td class="num">${esc(exact(v))}</td><td class="num">${esc(dec(v))}</td></tr>`; });
    h += '</tbody></table></div></div><div>';
    h += '<p class="label">Holguras y excesos</p><div class="table-wrap"><table><thead><tr><th>Restricción</th><th>Variable</th><th class="num">Valor</th><th>Estado</th></tr></thead><tbody>';
    r.constraints.forEach((c) => {
      h += `<tr><td>(${c.index + 1})</td><td>${c.slackName ? esc(c.slackName) : '— (igualdad)'}</td><td class="num">${c.slackValue ? esc(exact(c.slackValue)) : '—'}</td><td>${c.active ? '<b>activa</b>' : 'no activa'}</td></tr>`;
    });
    h += '</tbody></table></div><p class="hint">Activa = se cumple con igualdad (su holgura/exceso vale 0).</p></div></div>';

    h += '<h3>Verificación en las restricciones originales</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>Restricción</th><th class="num">Lado izquierdo</th><th></th><th class="num">Lado derecho</th><th>¿Cumple?</th></tr></thead><tbody>';
    const names = p.c.map((_, j) => `x${j + 1}`);
    r.constraints.forEach((c) => {
      const sub = c.a.map((a, j) => (a.isZero() ? null : `${exact(a)}·(${exact(r.x[j])})`)).filter(Boolean).join(' + ');
      h += `<tr><td>(${c.index + 1})</td><td class="mono">${esc(LP.formatLinear(c.a, names))} ${opSym(c.op)} ${esc(exact(c.b))}<br><span class="muted">${esc(sub)}</span></td>
        <td class="num">${inlineF(c.lhs)}</td><td>${opSym(c.op)}</td><td class="num">${inlineF(c.b)}</td>
        <td>${c.ok ? '<span class="okmark">✓</span>' : '<span class="badmark">✗</span>'}</td></tr>`;
    });
    h += '</tbody></table></div>';
    const zcalc = p.c.map((c, j) => `${exact(c)}·(${exact(r.x[j])})`).join(' + ');
    h += `<p class="mono" style="font-size:.88rem">z = ${esc(zcalc)} = ${inlineF(r.z)} ${r.zConsistent ? '<span class="okmark">✓ coincide con la tabla</span>' : '<span class="badmark">✗ no coincide con la tabla</span>'}</p>`;

    if (r.multiple) {
      let t = `Hay ÓPTIMOS MÚLTIPLES: en la tabla óptima, la variable no básica ${r.multipleVars.join(', ')} tiene zj−cj = 0, así que puede entrar sin cambiar z.`;
      if (r.alternative) t += ` Haciéndola entrar (${r.alternative.enter} entra, ${r.alternative.leave} sale) se obtiene otro óptimo: (${r.alternative.x.map(exact).join(', ')}) con el mismo z = ${exact(r.z)}. Todo el segmento entre ambos puntos es óptimo.`;
      else if (r.alternativeRay) t += ` Su columna no tiene coeficientes positivos: el conjunto de óptimos es una semirrecta.`;
      h += `<div class="msg warn">${esc(t)}</div>`;
    }
    if (r.degenerate) h += '<div class="msg warn">Solución DEGENERADA: en algún momento una variable básica valió 0 (o hubo empate en la razón mínima). El método igual llega al óptimo, pero puede haber iteraciones que no mejoran z.</div>';
    if (r.phase1) h += `<div class="msg info">Fase I: terminó con r = ${inlineF(r.phase1.r)} en x = (${r.x.map((_, j) => exact(r.phase1.values[`x${j + 1}`] || LP.Fraction.ZERO)).join(', ')}).</div>`;
    return h;
  }

  /* ---------- Comparación ---------- */
  function summaryBox(r) {
    let h = `<div class="box"><h3 style="margin-top:0">${esc(r.methodName)}</h3><p><b>${esc(statusText[r.status] || r.status)}</b> · ${r.iterations} pivoteos · ${r.steps.length} tablas</p>`;
    if (r.status === 'optimal') {
      h += `<p class="mono">${r.x.map((v, j) => `x${j + 1} = ${esc(exact(v))}`).join('<br>')}</p><p class="zbig">z = ${esc(exact(r.z))}</p>${r.z.isInteger() ? '' : `<p class="muted mono">≈ ${esc(dec(r.z))}</p>`}`;
    }
    h += `<button type="button" data-see="${r.method}">Ver los pasos</button></div>`;
    return h;
  }
  function renderCompare(c) {
    let h = `<div class="alert-big msg ${c.agree ? 'ok' : 'error'}">${c.agree ? '✓ ' : '⚠ ALERTA: '}${esc(c.message)}</div>`;
    if (c.issues.length) h += `<div class="msg error"><ul>${c.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
    h += `<div class="compare">${summaryBox(c.bigM)}${summaryBox(c.twoPhase)}</div>`;
    h += '<p class="hint">Gran M arrastra la M simbólica en una sola tabla continua; Dos fases separa la búsqueda de factibilidad (Fase I) de la optimización (Fase II). Deben llegar al mismo óptimo: si no, algo está mal.</p>';
    return h;
  }

  /* ---------- Gráfico ---------- */
  function renderGraphic(g) {
    if (!g.ok) return `<div class="msg error">${esc(g.error)}</div>`;
    const p = state.problem;
    let h = '<div class="graph-wrap"><div>' + LP.graphicSVG(g) + '<p class="hint">Pasa el cursor sobre los vértices para ver sus coordenadas. Línea punteada: recta de nivel z = óptimo.</p></div><div>';
    const cls = g.status === 'optimal' ? 'ok' : 'error';
    h += `<div class="msg ${cls} banner">${esc(statusText[g.status] || g.status)}</div>`;
    g.notes.forEach((n) => { h += `<div class="msg warn">${esc(n)}</div>`; });
    if (g.status === 'optimal') {
      h += `<p class="label">Óptimo (${p.sense === 'max' ? 'máximo' : 'mínimo'})</p><div class="zbig">z = ${esc(exact(g.optimum.z))}</div>${g.optimum.z.isInteger() ? '' : `<div class="muted mono">≈ ${esc(dec(g.optimum.z))}</div>`}`;
      h += `<p class="mono">x1 = ${inlineF(g.optimum.x)}<br>x2 = ${inlineF(g.optimum.y)}</p>`;
    }
    if (g.vertices.length) {
      h += '<p class="label">Vértices factibles</p><div class="table-wrap"><table><thead><tr><th>V</th><th class="num">x1</th><th class="num">x2</th><th class="num">z</th><th>Rectas</th></tr></thead><tbody>';
      g.vertices.forEach((v, i) => {
        h += `<tr class="${v.optimal ? 'opt' : ''}"><td>V${i + 1}${v.optimal ? ' ★' : ''}</td><td class="num">${cellF(v.x)}</td><td class="num">${cellF(v.y)}</td><td class="num">${cellF(v.z)}</td><td class="muted">${esc(v.from.join(' ∩ '))}</td></tr>`;
      });
      h += '</tbody></table></div>';
      h += `<p class="hint">Se calcularon las intersecciones de cada par de rectas (incluidos los ejes) y se conservaron solo las que cumplen todas las restricciones. ${g.status === 'optimal' ? `Se evaluó z = ${esc(LP.formatLinear(p.c, ['x1', 'x2']))} en cada vértice y se eligió el ${p.sense === 'max' ? 'mayor' : 'menor'}.` : ''}</p>`;
    }
    h += '<p class="label">Restricciones</p><ul class="mono" style="font-size:.88rem;padding-left:18px;margin:0">' + g.cons.map((c) => `<li>${esc(c.label)} ${esc(c.text)}</li>`).join('') + '</ul>';
    return h + '</div></div>';
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#btnAnalizar').addEventListener('click', analyze);
    $('#btnLimpiar').addEventListener('click', () => {
      $('#objetivo').value = ''; $('#restricciones').value = '';
      $('#mensajes').innerHTML = ''; $('#analisis').classList.add('hidden'); $('#solucion').classList.add('hidden');
      $('#objetivo').focus();
    });
    $('#objetivo').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
    $('#restricciones').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze(); });

    $('#analisisContenido').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-solve]');
      if (b) solve(b.dataset.solve);
      if (e.target.closest('#btnComparar')) solve('compare');
    });

    $('#solucionContenido').addEventListener('click', (e) => {
      const nav = e.target.closest('button[data-nav]');
      if (nav) {
        const n = state.view.res.steps.length;
        const a = nav.dataset.nav;
        if (a === 'prev') state.stepIdx = Math.max(0, state.stepIdx - 1);
        if (a === 'next') state.stepIdx = Math.min(n - 1, state.stepIdx + 1);
        if (a === 'first') state.stepIdx = 0;
        if (a === 'last') state.stepIdx = n - 1;
        if (a === 'all') state.showAll = !state.showAll;
        renderSolution();
        return;
      }
      const see = e.target.closest('button[data-see]');
      if (see && state.view.type === 'compare') {
        const cmp = state.view.cmp;
        state.view = { type: 'steps', res: see.dataset.see === 'bigM' ? cmp.bigM : cmp.twoPhase, back: cmp };
        state.stepIdx = 0; state.showAll = false;
        renderSolution();
        return;
      }
      if (e.target.closest('#btnVolverComp')) { state.view = { type: 'compare', cmp: state.view.back }; renderSolution(); }
    });

    document.addEventListener('keydown', (e) => {
      if (!state.view || state.view.type !== 'steps' || state.showAll) return;
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      const n = state.view.res.steps.length;
      if (e.key === 'ArrowRight' && state.stepIdx < n - 1) { state.stepIdx++; renderSolution(); }
      if (e.key === 'ArrowLeft' && state.stepIdx > 0) { state.stepIdx--; renderSolution(); }
    });

    $('#chkDecimales').addEventListener('change', (e) => {
      state.decimals = e.target.checked;
      if (state.view) renderSolution();
    });

    // Tooltip de vértices del gráfico
    const tip = $('#tooltip');
    $('#solucionContenido').addEventListener('mouseover', (e) => {
      const c = e.target.closest('circle[data-tip]');
      if (!c) return;
      tip.innerHTML = esc(c.dataset.tip) + `<br><span style="opacity:.75">≈ ${esc(c.dataset.dec)}</span>`;
      tip.classList.remove('hidden');
    });
    $('#solucionContenido').addEventListener('mousemove', (e) => {
      if (tip.classList.contains('hidden')) return;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 330) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    $('#solucionContenido').addEventListener('mouseout', (e) => { if (e.target.closest('circle[data-tip]')) tip.classList.add('hidden'); });

    // Tema: automático → claro → oscuro
    const modes = ['auto', 'light', 'dark'], label = { auto: 'automático', light: 'claro', dark: 'oscuro' };
    let mode = 'auto';
    try { mode = localStorage.getItem('pl-tema') || 'auto'; } catch (_) { /* file:// puede bloquear */ }
    const apply = () => {
      if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
      $('#btnTema').textContent = 'Tema: ' + label[mode];
    };
    apply();
    $('#btnTema').addEventListener('click', () => {
      mode = modes[(modes.indexOf(mode) + 1) % 3];
      try { localStorage.setItem('pl-tema', mode); } catch (_) { /* sin almacenamiento */ }
      apply();
    });
  }

  renderExamples();
  bind();
  // Arranca con un ejemplo cargado para que la página no esté vacía.
  $('#objetivo').value = EXAMPLES[0].obj;
  $('#restricciones').value = EXAMPLES[0].cons;
})();
