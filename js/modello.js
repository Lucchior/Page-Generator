/*
 * Modello dei dati: formati, limiti, valori predefiniti e normalizzazione.
 * Nessun accesso al DOM: il file funziona sia nel browser sia in Node (per i test).
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});

  // Formati in millimetri, sempre in verticale (larghezza < altezza).
  const FORMATI = {
    'A3': { larghezza: 297, altezza: 420 },
    'A4': { larghezza: 210, altezza: 297 },
    'A5': { larghezza: 148, altezza: 210 },
    'A6': { larghezza: 105, altezza: 148 },
    'B5': { larghezza: 176, altezza: 250 },
    'B6': { larghezza: 125, altezza: 176 },
    'JIS B5': { larghezza: 182, altezza: 257 },
    'JIS B6': { larghezza: 128, altezza: 182 },
    'Letter': { larghezza: 215.9, altezza: 279.4 },
    'Half Letter': { larghezza: 139.7, altezza: 215.9 }
  };

  const MOTIVI = ['puntini', 'righe-orizzontali', 'quadretti', 'righe-verticali', 'bianco'];
  const MOTIVI_DUE_PASSI = ['puntini', 'quadretti'];
  const STILI_LINEA = ['continua', 'tratteggiata', 'puntini'];

  // Limiti rigidi: valori fuori da questi intervalli vengono riportati al limite.
  const LIMITI = {
    passo: { min: 0.5, max: 100 },
    spessore: { min: 0.01, max: 5 },
    dimPunto: { min: 0.05, max: 10 },
    intensita: { min: 0, max: 100 },
    margine: { min: 0, max: 200 },
    tratto: { min: 0.05, max: 100 },
    spazio: { min: 0.05, max: 100 },
    dimPagina: { min: 20, max: 1000 },
    soglia: { min: 0, max: 50 },
    posizionePerc: { min: 0, max: 100 },
    posizioneMm: { min: 0, max: 2000 },
    spazioZone: { min: 0, max: 100 }
  };

  // Ogni zona deve restare larga almeno così (mm) dopo una divisione.
  const MIN_ZONA = 2;
  // Protezioni per i dati importati: non sono limiti d'uso, nessuno li raggiunge a mano.
  const LIMITE_PROFONDITA = 40;
  const LIMITE_NODI = 1000;

  function impostazioniZonaPredefinite() {
    return {
      motivo: 'puntini',
      passoX: 5,
      passoY: 5,
      passoUguale: true,
      spessore: 0.2,
      intensitaLinee: 40,
      stileLinea: 'continua',
      tratto: 3,
      spazio: 1.5,
      formaPunto: 'tondo',
      dimPunto: 0.5,
      intensitaPunti: 60
    };
  }

  // Una divisione taglia una zona in due parti (a e b).
  //   direzione "verticale": linea verticale, parti affiancate (a a sinistra, b a destra)
  //   direzione "orizzontale": linea orizzontale, parti sovrapposte (a sopra, b sotto)
  // La posizione si misura dal bordo sinistro (o superiore) dell'area che viene divisa.
  function lineaDivisionePredefinita() {
    return { visibile: true, spessore: 0.4, intensita: 70, stile: 'continua', tratto: 3, spazio: 1.5 };
  }

  function divisionePredefinita(direzione) {
    return {
      direzione: direzione === 'orizzontale' ? 'orizzontale' : 'verticale',
      posizione: { valore: 50, unita: '%' },
      spazio: 5,
      linea: lineaDivisionePredefinita()
    };
  }

  function creaStatoIniziale() {
    return {
      pagina: { formato: 'A4', orientamento: 'verticale', larghezza: 210, altezza: 297 },
      margini: { senza: false, diversi: false, tutti: 10, alto: 10, basso: 10, sinistro: 10, destro: 10, modo: 'fisso' },
      layout: { tipo: 'zona', id: 'z1', impostazioni: impostazioniZonaPredefinite() },
      stampa: { sogliaAvviso: 5, nomeFile: '' }
    };
  }

  // ---- Validazione: ogni valore esterno (campi, preset importati) passa da qui ----

  function numero(valore, limiti, predefinito) {
    const n = typeof valore === 'number' ? valore : parseFloat(valore);
    if (!Number.isFinite(n)) return predefinito;
    return Math.min(limiti.max, Math.max(limiti.min, n));
  }

  function scelta(valore, ammessi, predefinito) {
    return ammessi.indexOf(valore) !== -1 ? valore : predefinito;
  }

  function booleano(valore, predefinito) {
    return typeof valore === 'boolean' ? valore : predefinito;
  }

  function oggetto(valore) {
    return valore !== null && typeof valore === 'object' && !Array.isArray(valore) ? valore : {};
  }

  function normalizzaZona(grezza) {
    const p = impostazioniZonaPredefinite();
    const g = oggetto(grezza);
    return {
      motivo: scelta(g.motivo, MOTIVI, p.motivo),
      passoX: numero(g.passoX, LIMITI.passo, p.passoX),
      passoY: numero(g.passoY, LIMITI.passo, p.passoY),
      passoUguale: booleano(g.passoUguale, p.passoUguale),
      spessore: numero(g.spessore, LIMITI.spessore, p.spessore),
      intensitaLinee: numero(g.intensitaLinee, LIMITI.intensita, p.intensitaLinee),
      stileLinea: scelta(g.stileLinea, STILI_LINEA, p.stileLinea),
      tratto: numero(g.tratto, LIMITI.tratto, p.tratto),
      spazio: numero(g.spazio, LIMITI.spazio, p.spazio),
      formaPunto: scelta(g.formaPunto, ['tondo', 'quadrato'], p.formaPunto),
      dimPunto: numero(g.dimPunto, LIMITI.dimPunto, p.dimPunto),
      intensitaPunti: numero(g.intensitaPunti, LIMITI.intensita, p.intensitaPunti)
    };
  }

  function normalizzaLinea(grezza) {
    const p = lineaDivisionePredefinita();
    const g = oggetto(grezza);
    return {
      visibile: booleano(g.visibile, p.visibile),
      spessore: numero(g.spessore, LIMITI.spessore, p.spessore),
      intensita: numero(g.intensita, LIMITI.intensita, p.intensita),
      stile: scelta(g.stile, STILI_LINEA, p.stile),
      tratto: numero(g.tratto, LIMITI.tratto, p.tratto),
      spazio: numero(g.spazio, LIMITI.spazio, p.spazio)
    };
  }

  // Valida l'albero delle zone. I nodi che superano le protezioni diventano semplici zone.
  function normalizzaNodo(grezzo, profondita, contesto) {
    const g = oggetto(grezzo);
    contesto.nodi += 1;
    if (g.tipo === 'divisione' && profondita < LIMITE_PROFONDITA && contesto.nodi < LIMITE_NODI) {
      const pos = oggetto(g.posizione);
      const unita = scelta(pos.unita, ['%', 'mm'], '%');
      return {
        tipo: 'divisione',
        id: '',
        direzione: scelta(g.direzione, ['verticale', 'orizzontale'], 'verticale'),
        posizione: {
          valore: numero(pos.valore, unita === '%' ? LIMITI.posizionePerc : LIMITI.posizioneMm, 50),
          unita
        },
        spazio: numero(g.spazio, LIMITI.spazioZone, 5),
        linea: normalizzaLinea(g.linea),
        a: normalizzaNodo(g.a, profondita + 1, contesto),
        b: normalizzaNodo(g.b, profondita + 1, contesto)
      };
    }
    return { tipo: 'zona', id: '', impostazioni: normalizzaZona(g.impostazioni) };
  }

  // Assegna identificatori univoci (z1, z2... per le zone, d1, d2... per le divisioni) in ordine di lettura.
  function rinumera(radiceAlbero) {
    const contatori = { z: 0, d: 0 };
    (function visita(nodo) {
      if (nodo.tipo === 'divisione') {
        nodo.id = 'd' + ++contatori.d;
        visita(nodo.a);
        visita(nodo.b);
      } else {
        nodo.id = 'z' + ++contatori.z;
      }
    })(radiceAlbero);
    return radiceAlbero;
  }

  function contaZone(nodo) {
    return nodo.tipo === 'divisione' ? contaZone(nodo.a) + contaZone(nodo.b) : 1;
  }

  // Restituisce sempre un nuovo stato valido, a partire da dati non fidati.
  function normalizza(grezzo) {
    const base = creaStatoIniziale();
    const g = oggetto(grezzo);
    const pg = oggetto(g.pagina);
    const mg = oggetto(g.margini);
    const sg = oggetto(g.stampa);
    const nomi = Object.keys(FORMATI).concat(['personalizzato']);
    return {
      pagina: {
        formato: scelta(pg.formato, nomi, base.pagina.formato),
        orientamento: scelta(pg.orientamento, ['verticale', 'orizzontale'], base.pagina.orientamento),
        larghezza: numero(pg.larghezza, LIMITI.dimPagina, base.pagina.larghezza),
        altezza: numero(pg.altezza, LIMITI.dimPagina, base.pagina.altezza)
      },
      margini: {
        senza: booleano(mg.senza, base.margini.senza),
        diversi: booleano(mg.diversi, base.margini.diversi),
        tutti: numero(mg.tutti, LIMITI.margine, base.margini.tutti),
        alto: numero(mg.alto, LIMITI.margine, base.margini.alto),
        basso: numero(mg.basso, LIMITI.margine, base.margini.basso),
        sinistro: numero(mg.sinistro, LIMITI.margine, base.margini.sinistro),
        destro: numero(mg.destro, LIMITI.margine, base.margini.destro),
        modo: scelta(mg.modo, ['fisso', 'adatta'], base.margini.modo)
      },
      layout: rinumera(normalizzaNodo(g.layout, 0, { nodi: 0 })),
      stampa: {
        sogliaAvviso: numero(sg.sogliaAvviso, LIMITI.soglia, base.stampa.sogliaAvviso),
        nomeFile: typeof sg.nomeFile === 'string' ? sg.nomeFile.slice(0, 80) : ''
      }
    };
  }

  // ---- Valori derivati ----

  function dimensioniPagina(pagina) {
    if (pagina.formato === 'personalizzato') {
      return { larghezza: pagina.larghezza, altezza: pagina.altezza };
    }
    const f = FORMATI[pagina.formato] || FORMATI.A4;
    return pagina.orientamento === 'orizzontale'
      ? { larghezza: f.altezza, altezza: f.larghezza }
      : { larghezza: f.larghezza, altezza: f.altezza };
  }

  // Con "puntini" e "quadretti" il passo verticale può seguire quello orizzontale.
  function passiEffettivi(imp) {
    const due = MOTIVI_DUE_PASSI.indexOf(imp.motivo) !== -1;
    return { x: imp.passoX, y: due && imp.passoUguale ? imp.passoX : imp.passoY };
  }

  function margini(m) {
    if (m.senza) return { alto: 0, basso: 0, sinistro: 0, destro: 0 };
    if (!m.diversi) return { alto: m.tutti, basso: m.tutti, sinistro: m.tutti, destro: m.tutti };
    return { alto: m.alto, basso: m.basso, sinistro: m.sinistro, destro: m.destro };
  }

  function formatta(n) {
    return String(Math.round(n * 100) / 100);
  }

  // Per i testi mostrati all'utente: virgola decimale all'italiana.
  function formattaIt(n) {
    return formatta(n).replace('.', ',');
  }

  function nomeFileAutomatico(stato) {
    const dim = dimensioniPagina(stato.pagina);
    const formato =
      stato.pagina.formato === 'personalizzato'
        ? formatta(dim.larghezza) + 'x' + formatta(dim.altezza) + 'mm'
        : stato.pagina.formato.replace(/\s+/g, '-') +
          (stato.pagina.orientamento === 'orizzontale' ? '-orizzontale' : '');
    const zone = contaZone(stato.layout);
    if (zone > 1) return 'foglio-' + formato + '-' + zone + '-zone.pdf';
    const imp = stato.layout.impostazioni;
    let nome = 'foglio-' + formato + '-' + imp.motivo;
    if (imp.motivo !== 'bianco') {
      const p = passiEffettivi(imp);
      let passo;
      if (imp.motivo === 'righe-orizzontali') passo = formatta(p.y);
      else if (imp.motivo === 'righe-verticali') passo = formatta(p.x);
      else passo = p.x === p.y ? formatta(p.x) : formatta(p.x) + 'x' + formatta(p.y);
      nome += '-' + passo + 'mm';
    }
    return nome + '.pdf';
  }

  Fogli.modello = {
    FORMATI,
    MOTIVI,
    MOTIVI_DUE_PASSI,
    STILI_LINEA,
    LIMITI,
    MIN_ZONA,
    creaStatoIniziale,
    impostazioniZonaPredefinite,
    lineaDivisionePredefinita,
    divisionePredefinita,
    normalizza,
    normalizzaZona,
    contaZone,
    dimensioniPagina,
    passiEffettivi,
    margini,
    formatta,
    formattaIt,
    nomeFileAutomatico
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.modello;
})(typeof window !== 'undefined' ? window : globalThis);
