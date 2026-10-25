/*
 * Geometria: trasforma lo stato (formato, margini, impostazioni della zona) in
 * elementi da disegnare, tutti in millimetri con origine in alto a sinistra.
 * Anteprima e PDF leggono lo stesso risultato, quindi ciò che si vede è ciò che si stampa.
 * Nessun accesso al DOM: funziona anche in Node (per i test).
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});
  const M = Fogli.modello || (typeof require === 'function' ? require('./modello.js') : null);

  const EPS = 1e-9;
  const MAX_PUNTI = 80000; // oltre questo numero anteprima e PDF diventano pesanti
  const MAX_SEGMENTI = 6000;
  const arrotonda = (v) => Math.round(v * 1000) / 1000;

  const USA_X = ['puntini', 'quadretti', 'righe-verticali'];
  const USA_Y = ['puntini', 'quadretti', 'righe-orizzontali'];

  // Quante celle entrano in "lunghezza" con il passo dato, e dove parte la griglia.
  // adatta = true: la griglia viene centrata e il resto si distribuisce ai due lati.
  function asse(lunghezza, passo, adatta) {
    const n = Math.floor(lunghezza / passo + EPS);
    const estensione = n * passo;
    return { n, estensione, offset: adatta ? (lunghezza - estensione) / 2 : 0 };
  }

  // Intensità 0-100 (100 = nero) -> livello di grigio 0-255 (0 = nero).
  function livelloGrigio(intensita) {
    return Math.round(255 * (1 - intensita / 100));
  }

  // Tratteggio in mm. I puntini sono tratti molto corti con estremità arrotondate.
  function schemaLinea(imp) {
    if (imp.stileLinea === 'tratteggiata') return { dash: [imp.tratto, imp.spazio], cap: 'butt' };
    if (imp.stileLinea === 'puntini') {
      const periodo = Math.max(imp.spazio, 0.02);
      return { dash: [0.01, arrotonda(periodo - 0.01)], cap: 'round' };
    }
    return { dash: [], cap: 'butt' };
  }

  function elementoLinee(imp, segmenti) {
    const s = schemaLinea(imp);
    return {
      tipo: 'linee',
      spessore: imp.spessore,
      grigio: livelloGrigio(imp.intensitaLinee),
      dash: s.dash,
      cap: s.cap,
      segmenti
    };
  }

  // Genera gli elementi di una zona rettangolare { x, y, w, h }.
  function generaZona(r, imp, adatta) {
    const out = { elementi: [], estensione: null, colonne: 0, righe: 0, avvisi: [], errore: null };
    if (imp.motivo === 'bianco') return out;

    const passi = M.passiEffettivi(imp);
    const usaX = USA_X.indexOf(imp.motivo) !== -1;
    const usaY = USA_Y.indexOf(imp.motivo) !== -1;
    const ax = asse(r.w, passi.x, adatta && usaX);
    const ay = asse(r.h, passi.y, adatta && usaY);
    out.colonne = ax.n;
    out.righe = ay.n;

    if (usaX && ax.n === 0) out.avvisi.push('Il passo orizzontale è maggiore della larghezza disponibile: la griglia ha una sola colonna.');
    if (usaY && ay.n === 0) out.avvisi.push('Il passo verticale è maggiore dell’altezza disponibile: la griglia ha una sola riga.');

    const x0 = r.x + ax.offset;
    const y0 = r.y + ay.offset;

    if (imp.motivo === 'puntini') {
      const totale = (ax.n + 1) * (ay.n + 1);
      if (totale > MAX_PUNTI) {
        out.errore = 'Troppi puntini (' + totale + '): aumenta il passo o riduci il formato.';
        return out;
      }
      const centri = [];
      for (let j = 0; j <= ay.n; j++) {
        for (let i = 0; i <= ax.n; i++) centri.push([arrotonda(x0 + i * passi.x), arrotonda(y0 + j * passi.y)]);
      }
      out.elementi.push({
        tipo: 'punti',
        forma: imp.formaPunto,
        dimensione: imp.dimPunto,
        grigio: livelloGrigio(imp.intensitaPunti),
        centri
      });
      out.estensione = { x0, y0, x1: x0 + ax.n * passi.x, y1: y0 + ay.n * passi.y };
      return out;
    }

    const segmenti = [];
    let totale = 0;
    if (imp.motivo === 'righe-orizzontali') totale = ay.n + 1;
    else if (imp.motivo === 'righe-verticali') totale = ax.n + 1;
    else totale = ax.n + 1 + (ay.n + 1);
    if (totale > MAX_SEGMENTI) {
      out.errore = 'Troppe linee (' + totale + '): aumenta il passo o riduci il formato.';
      return out;
    }

    if (imp.motivo === 'righe-orizzontali') {
      for (let j = 0; j <= ay.n; j++) {
        const y = arrotonda(y0 + j * passi.y);
        segmenti.push([arrotonda(r.x), y, arrotonda(r.x + r.w), y]);
      }
      out.estensione = { x0: r.x, y0, x1: r.x + r.w, y1: y0 + ay.n * passi.y };
    } else if (imp.motivo === 'righe-verticali') {
      for (let i = 0; i <= ax.n; i++) {
        const x = arrotonda(x0 + i * passi.x);
        segmenti.push([x, arrotonda(r.y), x, arrotonda(r.y + r.h)]);
      }
      out.estensione = { x0, y0: r.y, x1: x0 + ax.n * passi.x, y1: r.y + r.h };
    } else {
      // quadretti: le linee coprono esattamente l'estensione della griglia
      const xf = x0 + ax.n * passi.x;
      const yf = y0 + ay.n * passi.y;
      for (let i = 0; i <= ax.n; i++) {
        const x = arrotonda(x0 + i * passi.x);
        segmenti.push([x, arrotonda(y0), x, arrotonda(yf)]);
      }
      for (let j = 0; j <= ay.n; j++) {
        const y = arrotonda(y0 + j * passi.y);
        segmenti.push([arrotonda(x0), y, arrotonda(xf), y]);
      }
      out.estensione = { x0, y0, x1: xf, y1: yf };
    }
    out.elementi.push(elementoLinee(imp, segmenti));
    return out;
  }

  // Per ora il layout è una sola zona; la divisione in più zone si aggiunge qui.
  function risolviLayout(nodo, rettangolo) {
    return [{ rettangolo, impostazioni: nodo.impostazioni }];
  }

  function unisci(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
  }

  function generaFoglio(stato) {
    const dim = M.dimensioniPagina(stato.pagina);
    const m = M.margini(stato.margini);
    const foglio = {
      larghezza: dim.larghezza,
      altezza: dim.altezza,
      elementi: [],
      estensione: null,
      colonne: null,
      righe: null,
      margineMinimo: null,
      avvisi: [],
      errore: null
    };

    const area = {
      x: m.sinistro,
      y: m.alto,
      w: dim.larghezza - m.sinistro - m.destro,
      h: dim.altezza - m.alto - m.basso
    };
    if (area.w <= 0 || area.h <= 0) {
      foglio.errore = 'I margini sono troppo grandi: non resta spazio per la griglia.';
      return foglio;
    }

    const zone = risolviLayout(stato.layout, area);
    for (const z of zone) {
      const g = generaZona(z.rettangolo, z.impostazioni, stato.margini.modo === 'adatta');
      if (g.errore) {
        foglio.errore = g.errore;
        return foglio;
      }
      foglio.elementi.push(...g.elementi);
      foglio.estensione = unisci(foglio.estensione, g.estensione);
      foglio.avvisi.push(...g.avvisi);
      if (zone.length === 1) {
        foglio.colonne = g.colonne;
        foglio.righe = g.righe;
      }
    }

    if (foglio.estensione) {
      const e = foglio.estensione;
      const distanze = [
        ['sinistro', e.x0],
        ['superiore', e.y0],
        ['destro', dim.larghezza - e.x1],
        ['inferiore', dim.altezza - e.y1]
      ];
      let minima = distanze[0];
      for (const d of distanze) if (d[1] < minima[1]) minima = d;
      foglio.margineMinimo = { lato: minima[0], mm: arrotonda(minima[1]) };
      const soglia = stato.stampa.sogliaAvviso;
      if (soglia > 0 && minima[1] < soglia - EPS) {
        foglio.avvisi.push(
          'Il disegno arriva a ' + M.formattaIt(minima[1]) + ' mm dal bordo ' + minima[0] +
            ': molte stampanti non stampano così vicino al bordo, e la parte esterna potrebbe mancare.'
        );
      }
    }
    return foglio;
  }

  Fogli.geometria = { generaFoglio, generaZona, asse, livelloGrigio, schemaLinea, MAX_PUNTI, MAX_SEGMENTI };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.geometria;
})(typeof window !== 'undefined' ? window : globalThis);
