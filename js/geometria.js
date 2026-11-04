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
    if (imp.motivo === 'bianco' || imp.motivo === 'immagine' || r.w <= 0 || r.h <= 0) return out;
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

  // Posizioni di un reticolo ancorato in "ancora", con passo "passo", comprese tra lo e hi.
  // indietro = true: il reticolo continua anche prima dell'ancora (verso "lo"), come nell'abbondanza.
  function posizioni(ancora, passo, lo, hi, indietro) {
    const fine = Math.floor((hi - ancora) / passo + EPS);
    const inizio = indietro ? -Math.floor((ancora - lo) / passo + EPS) : 0;
    const out = [];
    for (let i = inizio; i <= fine; i++) out.push(ancora + i * passo);
    return out;
  }

  // Zona con foglio finito (Fase 5). Il foglio aperto (larghezza x altezza prima del rifilo) sta al centro
  // della zona; il rifilo toglie i bordi; il reticolo parte dal bordo del foglio finito (più la distanza scelta)
  // e, se c'è la piega, dalla piega verso l'esterno: le due metà risultano speculari rispetto alla piega.
  // Posizione di un'immagine in un'area: rettangolo visibile e parte dell'immagine usata (frazioni 0-1).
  function posizionaImmagine(area, iw, ih, adatta) {
    const intero = { x: 0, y: 0, w: 1, h: 1 };
    if (adatta === 'estendi') return { vis: area, ritaglio: intero };
    if (adatta === 'riempi') {
      const s = Math.max(area.w / iw, area.h / ih);
      const pw = iw * s;
      const ph = ih * s;
      return {
        vis: area,
        ritaglio: { x: (pw - area.w) / 2 / pw, y: (ph - area.h) / 2 / ph, w: area.w / pw, h: area.h / ph }
      };
    }
    const s = Math.min(area.w / iw, area.h / ih);
    const w = iw * s;
    const h = ih * s;
    return { vis: { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h }, ritaglio: intero };
  }

  // "trasposto": il calcolo è fatto con assi scambiati (piega verticale); serve solo ai testi degli avvisi.
  function generaZonaFinitaInterna(r, imp, budget, trasposto) {
    const f = imp.foglio;
    const out = { elementi: [], estensione: null, colonne: 0, righe: 0, avvisi: [], errore: null, foglio: null };
    const W = f.larghezza;
    const H = f.altezza;
    const bx = r.x + (r.w - W) / 2;
    const by = r.y + (r.h - H) / 2;
    const fx = bx + f.rifilo.sinistra;
    const fy = by + f.rifilo.alto;
    const fw = W - f.rifilo.sinistra - f.rifilo.destra;
    const fh = H - f.rifilo.alto - f.rifilo.basso;
    const dist = f.distanza.uguale
      ? { alto: f.distanza.tutti, basso: f.distanza.tutti, sinistra: f.distanza.tutti, destra: f.distanza.tutti }
      : f.distanza;
    const foldY = f.piega.modo !== 'nessuna' ? by + H / 2 : null; // qui la piega è sempre orizzontale (con i vincoli di sopra gli assi sono già scambiati se serve)
    out.foglio = {
      aperto: { x: arrotonda(bx), y: arrotonda(by), w: W, h: H },
      finito: { x: arrotonda(fx), y: arrotonda(fy), w: arrotonda(fw), h: arrotonda(fh) },
      piega: foldY === null ? null : { y: arrotonda(foldY), x0: arrotonda(bx), x1: arrotonda(bx + W) },
      distanze: { alto: null, basso: null, sinistra: null, destra: null }
    };
    if (W > r.w + 1e-6 || H > r.h + 1e-6) {
      const [mw, mh] = trasposto ? [H, W] : [W, H];
      out.avvisi.push('Il foglio aperto (' + M.formattaIt(mw) + ' × ' + M.formattaIt(mh) + ' mm) è più grande della zona: è centrato ed esce dai suoi bordi.');
    }
    if (fw <= 0 || fh <= 0) {
      out.avvisi.push('Il rifilo è troppo grande: del foglio non resta nulla.');
      return out;
    }
    const aX = fx + dist.sinistra;
    const aY = fy + dist.alto;
    const aW = fw - dist.sinistra - dist.destra;
    const aH = fh - dist.alto - dist.basso;
    if (aW <= 0 || aH <= 0) {
      out.avvisi.push('Le distanze dal bordo sono troppo grandi: non resta spazio per la griglia.');
      return out;
    }
    if (imp.motivo === 'bianco' || imp.motivo === 'immagine') return out;

    const abb = f.disegno === 'abbondanza';
    const xLo = abb ? Math.max(bx, r.x) : aX;
    const xHi = abb ? Math.min(bx + W, r.x + r.w) : aX + aW;
    const yLo = abb ? Math.max(by, r.y) : aY;
    const yHi = abb ? Math.min(by + H, r.y + r.h) : aY + aH;

    const passi = M.passiEffettivi(imp);
    const usaX = USA_X.indexOf(imp.motivo) !== -1;
    const usaY = USA_Y.indexOf(imp.motivo) !== -1;
    const xs = usaX ? posizioni(aX, passi.x, xLo, xHi, abb) : [];

    // Metà del foglio: ognuna con le sue righe e il tratto verticale [da, a] su cui corrono le linee verticali.
    const meta = [];
    if (foldY === null) {
      meta.push({ ys: usaY ? posizioni(aY, passi.y, yLo, yHi, abb) : [], da: yLo, a: yHi });
    } else {
      const dp = f.piega.distanza;
      const sSu = usaY ? posizioni(dp, passi.y, dp, foldY - yLo, false) : [];
      const sGiu = usaY ? posizioni(dp, passi.y, dp, yHi - foldY, false) : [];
      if (foldY - dp > yLo) meta.push({ ys: sSu.map((s) => foldY - s), da: yLo, a: foldY - dp });
      if (yHi > foldY + dp) meta.push({ ys: sGiu.map((s) => foldY + s), da: foldY + dp, a: yHi });
    }

    const resto = budget || { punti: MAX_PUNTI, segmenti: MAX_SEGMENTI };
    const nY = meta.reduce((s, m) => s + m.ys.length, 0);
    const segmenti = [];

    if (imp.motivo === 'puntini') {
      const totale = xs.length * nY;
      if (totale > resto.punti) {
        out.errore = 'Troppi puntini (' + (MAX_PUNTI - resto.punti + totale) + '): aumenta il passo o riduci il formato.';
        return out;
      }
      resto.punti -= totale;
      const centri = [];
      for (const m of meta) for (const y of m.ys) for (const x of xs) centri.push([arrotonda(x), arrotonda(y)]);
      if (centri.length) {
        out.elementi.push({ tipo: 'punti', forma: imp.formaPunto, dimensione: imp.dimPunto, grigio: livelloGrigio(imp.intensitaPunti), centri });
      }
    } else {
      let totale = 0;
      if (imp.motivo === 'righe-orizzontali') totale = nY;
      else if (imp.motivo === 'righe-verticali') totale = xs.length * meta.length;
      else totale = xs.length * meta.length + nY;
      if (totale > resto.segmenti) {
        out.errore = 'Troppe linee (' + (MAX_SEGMENTI - resto.segmenti + totale) + '): aumenta il passo o riduci il formato.';
        return out;
      }
      resto.segmenti -= totale;
      for (const m of meta) {
        if (imp.motivo === 'righe-orizzontali') {
          for (const y of m.ys) segmenti.push([arrotonda(xLo), arrotonda(y), arrotonda(xHi), arrotonda(y)]);
        } else if (imp.motivo === 'righe-verticali') {
          for (const x of xs) segmenti.push([arrotonda(x), arrotonda(m.da), arrotonda(x), arrotonda(m.a)]);
        } else {
          const ymin = Math.min(...m.ys);
          const ymax = Math.max(...m.ys);
          if (m.ys.length >= 2) for (const x of xs) segmenti.push([arrotonda(x), arrotonda(ymin), arrotonda(x), arrotonda(ymax)]);
          if (xs.length >= 2) {
            const xmin = Math.min(...xs);
            const xmax = Math.max(...xs);
            for (const y of m.ys) segmenti.push([arrotonda(xmin), arrotonda(y), arrotonda(xmax), arrotonda(y)]);
          }
        }
      }
      if (segmenti.length) out.elementi.push(elementoLinee(imp, segmenti));
    }

    // Parte che resta dopo il rifilo: serve per distanze, estensione e avviso sul bordo della stampante.
    const dentroX = (v) => v >= fx - EPS && v <= fx + fw + EPS;
    const dentroY = (v) => v >= fy - EPS && v <= fy + fh + EPS;
    const xsIn = xs.filter(dentroX);
    const ysIn = [].concat(...meta.map((m) => m.ys)).filter(dentroY);
    const d = out.foglio.distanze;
    if (usaX && xsIn.length) {
      d.sinistra = arrotonda(Math.min(...xsIn) - fx);
      d.destra = arrotonda(fx + fw - Math.max(...xsIn));
    }
    if (usaY && ysIn.length) {
      d.alto = arrotonda(Math.min(...ysIn) - fy);
      d.basso = arrotonda(fy + fh - Math.max(...ysIn));
    }
    const ex0 = usaX ? (xsIn.length ? Math.min(...xsIn) : null) : Math.max(xLo, fx);
    const ex1 = usaX ? (xsIn.length ? Math.max(...xsIn) : null) : Math.min(xHi, fx + fw);
    const ey0 = usaY ? (ysIn.length ? Math.min(...ysIn) : null) : Math.max(yLo, fy);
    const ey1 = usaY ? (ysIn.length ? Math.max(...ysIn) : null) : Math.min(yHi, fy + fh);
    if (ex0 !== null && ey0 !== null && segmenti.length + (out.elementi.length && imp.motivo === 'puntini' ? 1 : 0) > 0) {
      out.estensione = { x0: ex0, y0: ey0, x1: ex1, y1: ey1 };
    }
    out.colonne = Math.max(0, xsIn.length - 1);
    out.righe = Math.max(0, new Set(ysIn.map(arrotonda)).size - 1);
    const [nomeX, nomeY] = trasposto ? ['riga', 'colonna'] : ['colonna', 'riga'];
    if (usaX && xsIn.length === 0) out.avvisi.push('Nessuna ' + nomeX + ' entra nel foglio finito con questo passo e queste distanze.');
    if (usaY && ysIn.length === 0) out.avvisi.push('Nessuna ' + nomeY + ' entra nel foglio finito con questo passo e queste distanze.');
    return out;
  }

  const scambia = (r) => ({ x: r.y, y: r.x, w: r.h, h: r.w });

  // Zona con foglio finito. Con la piega orizzontale si calcola direttamente; con la piega verticale
  // (il caso normale: foglio aperto 203 × 145 piegato a metà nel senso della larghezza) si calcola con gli assi
  // scambiati e poi si rimettono a posto coordinate, rettangoli e distanze.
  function generaZonaFinita(r, imp, budget) {
    const f = imp.foglio;
    if (f.piega.modo !== 'verticale') {
      const out = generaZonaFinitaInterna(r, imp, budget, false);
      if (out.foglio && out.foglio.piega) {
        const p = out.foglio.piega;
        out.foglio.piega = { x0: p.x0, y0: p.y, x1: p.x1, y1: p.y, y: p.y };
      }
      return out;
    }
    const passi = M.passiEffettivi(imp);
    const tImp = Object.assign({}, imp, {
      passoX: passi.y,
      passoY: passi.x,
      passoUguale: false,
      motivo: imp.motivo === 'righe-orizzontali' ? 'righe-verticali' : imp.motivo === 'righe-verticali' ? 'righe-orizzontali' : imp.motivo,
      foglio: Object.assign({}, f, {
        larghezza: f.altezza,
        altezza: f.larghezza,
        rifilo: { sinistra: f.rifilo.alto, destra: f.rifilo.basso, alto: f.rifilo.sinistra, basso: f.rifilo.destra },
        distanza: {
          uguale: f.distanza.uguale,
          tutti: f.distanza.tutti,
          alto: f.distanza.sinistra,
          basso: f.distanza.destra,
          sinistra: f.distanza.alto,
          destra: f.distanza.basso
        },
        piega: { modo: 'orizzontale', distanza: f.piega.distanza }
      })
    });
    const out = generaZonaFinitaInterna(scambia(r), tImp, budget, true);
    for (const el of out.elementi) {
      if (el.tipo === 'punti') el.centri = el.centri.map((c) => [c[1], c[0]]);
      else if (el.tipo === 'linee') el.segmenti = el.segmenti.map((s) => [s[1], s[0], s[3], s[2]]);
    }
    if (out.estensione) {
      const e = out.estensione;
      out.estensione = { x0: e.y0, y0: e.x0, x1: e.y1, y1: e.x1 };
    }
    [out.colonne, out.righe] = [out.righe, out.colonne];
    if (out.foglio) {
      const g = out.foglio;
      g.aperto = scambia(g.aperto);
      g.finito = scambia(g.finito);
      const d = g.distanze;
      g.distanze = { alto: d.sinistra, basso: d.destra, sinistra: d.alto, destra: d.basso };
      if (g.piega) {
        const p = g.piega;
        g.piega = { x0: p.y, y0: p.x0, x1: p.y, y1: p.x1, x: p.y };
      }
    }
    return out;
  }

  // Immagine di una zona con motivo "immagine": copre tutta la zona (o il foglio aperto / finito, se attivo).
  // "info" = { w, h } in pixel, oppure assente se l'immagine non è ancora stata caricata.
  function generaImmagineZona(zona, g, info) {
    const imp = zona.impostazioni;
    const out = { elementi: [], informazioni: [], avvisi: [], estensione: null };
    if (imp.motivo !== 'immagine' || !info || !(info.w > 0) || !(info.h > 0)) return out;
    const opz = imp.immagine;
    const finita = !!(g && g.foglio);
    let area = zona.rettangolo;
    let visibile = zona.rettangolo; // parte che resta dopo il rifilo
    if (finita) {
      area = opz.area === 'finito' ? g.foglio.finito : g.foglio.aperto;
      visibile = g.foglio.finito;
    }
    if (area.w <= 0 || area.h <= 0) {
      out.avvisi.push('Immagine: nel foglio finito non resta spazio per l’immagine.');
      return out;
    }
    const p = posizionaImmagine(area, info.w, info.h, opz.adatta);
    const dpi = Math.min((info.w * p.ritaglio.w) / (p.vis.w / 25.4), (info.h * p.ritaglio.h) / (p.vis.h / 25.4));
    const vis = { x: arrotonda(p.vis.x), y: arrotonda(p.vis.y), w: arrotonda(p.vis.w), h: arrotonda(p.vis.h) };
    out.elementi.push({ tipo: 'immagine', zona: zona.id, x: vis.x, y: vis.y, w: vis.w, h: vis.h, ritaglio: p.ritaglio, ruota: !!opz.ruota, dpi: Math.round(dpi) });
    out.informazioni.push({ zona: zona.id, numero: zona.numero, rettangolo: vis, dpi: Math.round(dpi) });
    if (dpi < 300) {
      out.avvisi.push('Immagine: risoluzione di circa ' + Math.round(dpi) + ' dpi, sotto i 300 consigliati per la stampa.');
    }
    // Per l'avviso sul bordo della stampante conta solo la parte che resta dopo il rifilo.
    const x0 = Math.max(vis.x, visibile.x);
    const y0 = Math.max(vis.y, visibile.y);
    const x1 = Math.min(vis.x + vis.w, visibile.x + visibile.w);
    const y1 = Math.min(vis.y + vis.h, visibile.y + visibile.h);
    if (x1 > x0 && y1 > y0) out.estensione = { x0, y0, x1, y1 };
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
      stampata: !!nodo.linea.visibile,
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

  function generaFoglio(stato, immagini) {
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
      immagini: [],
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
    let soloZone = null; // estensione delle sole griglie, senza le linee di divisione
    let haFinito = false;
    foglio.avvisi.push(...ris.avvisi);

    for (const z of ris.zone) {
      const finita = z.impostazioni.foglio && z.impostazioni.foglio.attivo;
      const g = finita
        ? generaZonaFinita(z.rettangolo, z.impostazioni, resto)
        : generaZona(z.rettangolo, z.impostazioni, stato.margini.modo === 'adatta', resto);
      z.finito = g.foglio || null;
      haFinito = haFinito || !!finita;
      if (g.errore) {
        foglio.errore = g.errore;
        return foglio;
      }
      foglio.elementi.push(...g.elementi);
      const im = generaImmagineZona(z, g, immagini && immagini[z.id]);
      foglio.elementi.push(...im.elementi);
      foglio.immagini.push(...im.informazioni);
      for (const a of im.avvisi) foglio.avvisi.push(molte ? 'Zona ' + z.numero + ': ' + a : a);
      g.estensione = unisci(g.estensione, im.estensione);
      soloZone = unisci(soloZone, g.estensione);
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
      motivo: z.impostazioni.motivo,
      finito: z.finito || null
    }));
    foglio.divisioni = ris.divisioni;

    // Con i fogli finiti la linea di divisione è una guida di taglio voluta, anche a filo del bordo:
    // l'avviso sul bordo della stampante guarda solo la griglia che resta dopo il rifilo.
    const estAvviso = haFinito ? soloZone : foglio.estensione;
    if (estAvviso) {
      const e = estAvviso;
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

  Fogli.geometria = { generaFoglio, generaZona, generaZonaFinita, asse, livelloGrigio, schemaLinea, MAX_PUNTI, MAX_SEGMENTI };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.geometria;
})(typeof window !== 'undefined' ? window : globalThis);
