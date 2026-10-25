/*
 * Anteprima dal vivo: disegna il foglio in SVG con unità in millimetri,
 * usando gli stessi elementi che finiscono nel PDF.
 * Nessun innerHTML: i nodi vengono creati con le API del DOM.
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});
  const NS = 'http://www.w3.org/2000/svg';

  const n = (v) => String(Math.round(v * 1000) / 1000);
  const grigio = (g) => 'rgb(' + g + ',' + g + ',' + g + ')';

  function nodo(nome, attributi) {
    const e = document.createElementNS(NS, nome);
    for (const k of Object.keys(attributi)) e.setAttribute(k, attributi[k]);
    return e;
  }

  function disegnaLinee(el) {
    let d = '';
    for (const s of el.segmenti) d += 'M' + n(s[0]) + ' ' + n(s[1]) + 'L' + n(s[2]) + ' ' + n(s[3]);
    const attr = {
      d,
      fill: 'none',
      stroke: grigio(el.grigio),
      'stroke-width': n(el.spessore),
      'stroke-linecap': el.cap
    };
    if (el.dash.length) attr['stroke-dasharray'] = el.dash.map(n).join(' ');
    return nodo('path', attr);
  }

  // Un solo tracciato per tutti i puntini: leggero anche con migliaia di elementi.
  function disegnaPunti(el) {
    let d = '';
    if (el.forma === 'quadrato') {
      const l = el.dimensione;
      for (const c of el.centri) d += 'M' + n(c[0] - l / 2) + ' ' + n(c[1] - l / 2) + 'h' + n(l) + 'v' + n(l) + 'h' + n(-l) + 'z';
    } else {
      const r = el.dimensione / 2;
      for (const c of el.centri) {
        d += 'M' + n(c[0] - r) + ' ' + n(c[1]) + 'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0z';
      }
    }
    return nodo('path', { d, fill: grigio(el.grigio) });
  }

  function creaSvg(foglio) {
    const svg = nodo('svg', {
      viewBox: '0 0 ' + n(foglio.larghezza) + ' ' + n(foglio.altezza),
      'aria-hidden': 'true',
      focusable: 'false'
    });
    svg.appendChild(nodo('rect', { x: 0, y: 0, width: n(foglio.larghezza), height: n(foglio.altezza), fill: '#ffffff' }));
    for (const el of foglio.elementi) {
      svg.appendChild(el.tipo === 'linee' ? disegnaLinee(el) : disegnaPunti(el));
    }
    return svg;
  }

  // Livello interattivo sopra il foglio: serve solo a scegliere zone e divisioni con il mouse
  // o il tocco, evidenzia la selezione e mostra i numeri delle zone. Non finisce nel PDF.
  // Con una sola zona non c'è nulla da scegliere e il livello non viene disegnato.
  function evidenzia(contenitore, foglio, selezione, opzioni) {
    const svg = contenitore.firstElementChild;
    if (!svg || !foglio || foglio.errore) return;
    const vecchio = svg.querySelector('.sovrapposizione');
    if (vecchio) vecchio.remove();
    const dividi = !!(opzioni && opzioni.dividi);
    const molte = foglio.zone && foglio.zone.length > 1;
    if (!foglio.zone || (!molte && !dividi)) return;

    const g = nodo('g', { class: 'sovrapposizione', 'aria-hidden': 'true' });
    const rettangolo = (r, attributi) =>
      nodo('rect', Object.assign({ x: n(r.x), y: n(r.y), width: n(r.w), height: n(r.h) }, attributi));

    for (const z of foglio.zone) {
      const scelta = molte && selezione && selezione.tipo === 'zona' && selezione.id === z.id;
      g.appendChild(rettangolo(z.rettangolo, { class: 'area-zona' + (scelta ? ' scelta' : ''), 'data-nodo': z.id }));
    }
    for (const d of foglio.divisioni) {
      const scelta = selezione && selezione.tipo === 'divisione' && selezione.id === d.id;
      g.appendChild(rettangolo(d.banda, { class: 'area-divisione' + (scelta ? ' scelta' : ''), 'data-nodo': d.id }));
      if (scelta) {
        const l = d.linea;
        g.appendChild(nodo('line', {
          class: 'guida-divisione', x1: n(l[0]), y1: n(l[1]), x2: n(l[2]), y2: n(l[3])
        }));
      }
    }
    // Guida della linea che verrebbe creata cliccando (modo «Dividi con il clic»).
    if (dividi) g.appendChild(nodo('line', { class: 'guida-taglio', x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' }));
    for (const z of molte ? foglio.zone : []) {
      const r = z.rettangolo;
      const lato = Math.min(r.w, r.h);
      if (lato < 6) continue;
      const corpo = Math.max(3, Math.min(9, lato / 5));
      const t = nodo('text', {
        class: 'numero-zona', x: n(r.x + corpo * 0.6), y: n(r.y + corpo * 1.5), 'font-size': n(corpo)
      });
      t.textContent = String(z.numero);
      g.appendChild(t);
    }
    svg.appendChild(g);
  }

  function mostra(contenitore, foglio, selezione, opzioni) {
    contenitore.replaceChildren(creaSvg(foglio));
    evidenzia(contenitore, foglio, selezione, opzioni);
  }

  // Da coordinate dello schermo a millimetri sul foglio (origine in alto a sinistra).
  function punto(contenitore, foglio, clientX, clientY) {
    const svg = contenitore.firstElementChild;
    if (!svg || !foglio) return null;
    const r = svg.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: ((clientX - r.left) / r.width) * foglio.larghezza, y: ((clientY - r.top) / r.height) * foglio.altezza };
  }

  // Mostra la guida su un segmento [x1,y1,x2,y2] in mm, oppure la nasconde (null).
  function guida(contenitore, segmento) {
    const l = contenitore.querySelector('.guida-taglio');
    if (!l) return;
    if (!segmento) {
      l.setAttribute('visibility', 'hidden');
      return;
    }
    l.setAttribute('x1', n(segmento[0]));
    l.setAttribute('y1', n(segmento[1]));
    l.setAttribute('x2', n(segmento[2]));
    l.setAttribute('y2', n(segmento[3]));
    l.setAttribute('visibility', 'visible');
  }

  // Ridimensiona l'SVG in modo che il foglio stia per intero nello spazio disponibile.
  function adatta(spazio, contenitore, foglio) {
    const svg = contenitore.firstElementChild;
    if (!svg || !foglio) return;
    const dispL = spazio.clientWidth;
    const dispA = spazio.clientHeight;
    if (dispL < 10 || dispA < 10) return;
    const scala = Math.min(dispL / foglio.larghezza, dispA / foglio.altezza);
    svg.style.width = Math.floor(foglio.larghezza * scala) + 'px';
    svg.style.height = Math.floor(foglio.altezza * scala) + 'px';
  }

  Fogli.anteprima = { mostra, adatta, creaSvg, evidenzia, punto, guida };
})(typeof window !== 'undefined' ? window : globalThis);
