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
  // "budget" tiene il conto di quanti elementi restano per l'intero foglio (tutte le zone insieme).
  function generaZona(r, imp, adatta, budget) {
    const out = { elementi: [], estensione: null, colonne: 0, righe: 0, avvisi: [], errore: null };
    if (imp.motivo === 'bianco' || r.w <= 0 || r.h <= 0) return out;
    const resto = budget || { punti: MAX_PUNTI, segmenti: MAX_SEGMENTI };

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
      if (totale > resto.punti) {
        out.errore = 'Troppi puntini (' + (MAX_PUNTI - resto.punti + totale) + '): aumenta il passo o riduci il formato.';
        return out;
      }
      resto.punti -= totale;
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
    if (totale > resto.segmenti) {
      out.errore = 'Troppe linee (' + (MAX_SEGMENTI - resto.segmenti + totale) + '): aumenta il passo o riduci il formato.';
      return out;
    }
    resto.segmenti -= totale;

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

  // Scende lungo l'albero delle zone assegnando a ogni zona il suo rettangolo.
  // Una divisione taglia il rettangolo in due parti separate da "spazio" mm; la linea passa al centro dello spazio.
  // Raccoglie in "ris" zone, divisioni (con la linea da disegnare) e avvisi.
  function risolviLayout(nodo, r, ris) {
    if (nodo.tipo !== 'divisione') {
      ris.zone.push({ id: nodo.id, numero: ++ris.nZone, rettangolo: r, impostazioni: nodo.impostazioni });
      return;
    }
    const numero = ++ris.nDiv;
    const verticale = nodo.direzione === 'verticale'; // linea verticale: zone affiancate
    const lunghezza = verticale ? r.w : r.h;
    const spazio = nodo.spazio;
    const richiesta =
      nodo.posizione.unita === '%' ? (lunghezza * nodo.posizione.valore) / 100 : nodo.posizione.valore;

    const minimo = M.MIN_ZONA + spazio / 2;
    const massimo = lunghezza - M.MIN_ZONA - spazio / 2;
    let p;
    if (massimo < minimo) {
      p = lunghezza / 2;
      ris.avvisi.push('Divisione ' + numero + ': la zona è troppo piccola per essere divisa con questo spazio.');
    } else {
      p = Math.min(massimo, Math.max(minimo, richiesta));
      if (Math.abs(p - richiesta) > 1e-6) {
        ris.avvisi.push(
          'Divisione ' + numero + ': la linea è stata spostata a ' + M.formattaIt(p) +
            ' mm perché ogni zona deve restare larga almeno ' + M.MIN_ZONA + ' mm.'
        );
      }
    }

    const meta = spazio / 2;
    const dimA = Math.max(0, p - meta);
    const dimB = Math.max(0, lunghezza - p - meta);
    const rettA = verticale ? { x: r.x, y: r.y, w: dimA, h: r.h } : { x: r.x, y: r.y, w: r.w, h: dimA };
    const rettB = verticale
      ? { x: r.x + p + meta, y: r.y, w: dimB, h: r.h }
      : { x: r.x, y: r.y + p + meta, w: r.w, h: dimB };
    const segmento = verticale
      ? [arrotonda(r.x + p), arrotonda(r.y), arrotonda(r.x + p), arrotonda(r.y + r.h)]
      : [arrotonda(r.x), arrotonda(r.y + p), arrotonda(r.x + r.w), arrotonda(r.y + p)];
    // Fascia cliccabile nell'anteprima: almeno 4 mm, così anche una linea sottile si può selezionare.
    const spessoreBanda = Math.max(spazio, 4);
    const banda = verticale
      ? { x: r.x + p - spessoreBanda / 2, y: r.y, w: spessoreBanda, h: r.h }
      : { x: r.x, y: r.y + p - spessoreBanda / 2, w: r.w, h: spessoreBanda };

    ris.divisioni.push({
      id: nodo.id,
      numero,
      direzione: nodo.direzione,
      rettangolo: r,
      lunghezza,
      posizioneMm: arrotonda(p),
      linea: segmento,
      banda
    });

    const l = nodo.linea;
    if (l.visibile) {
      ris.linee.push(
        elementoLinee(
          { spessore: l.spessore, intensitaLinee: l.intensita, stileLinea: l.stile, tratto: l.tratto, spazio: l.spazio },
          [segmento]
        )
      );
    }

    risolviLayout(nodo.a, rettA, ris);
    risolviLayout(nodo.b, rettB, ris);
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
      zone: [],
      divisioni: [],
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

    const ris = { zone: [], divisioni: [], linee: [], avvisi: [], nZone: 0, nDiv: 0 };
    risolviLayout(stato.layout, area, ris);
    const molte = ris.zone.length > 1;
    const resto = { punti: MAX_PUNTI, segmenti: MAX_SEGMENTI };
    foglio.avvisi.push(...ris.avvisi);

    for (const z of ris.zone) {
      const g = generaZona(z.rettangolo, z.impostazioni, stato.margini.modo === 'adatta', resto);
      if (g.errore) {
        foglio.errore = g.errore;
        return foglio;
      }
      foglio.elementi.push(...g.elementi);
      foglio.estensione = unisci(foglio.estensione, g.estensione);
      for (const a of g.avvisi) foglio.avvisi.push(molte ? 'Zona ' + z.numero + ': ' + a : a);
      if (!molte) {
        foglio.colonne = g.colonne;
        foglio.righe = g.righe;
      }
    }

    // Le linee di divisione si disegnano per ultime, sopra le griglie.
    for (const el of ris.linee) {
      foglio.elementi.push(el);
      const s = el.segmenti[0];
      foglio.estensione = unisci(foglio.estensione, {
        x0: Math.min(s[0], s[2]),
        y0: Math.min(s[1], s[3]),
        x1: Math.max(s[0], s[2]),
        y1: Math.max(s[1], s[3])
      });
    }
    foglio.zone = ris.zone.map((z) => ({
      id: z.id,
      numero: z.numero,
      rettangolo: z.rettangolo,
      motivo: z.impostazioni.motivo
    }));
    foglio.divisioni = ris.divisioni;

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
