/*
 * Test della divisione del foglio in zone (Fase 2).
 * Esecuzione dalla cartella del progetto:   node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require('../js/modello.js');
const L = require('../js/layout.js');
const G = require('../js/geometria.js');
const P = require('../js/pdf.js');
const { jsPDF } = require(path.join(__dirname, '..', 'vendor', 'jspdf.umd.min.js'));

const vicino = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function stato(modifiche) {
  const s = M.creaStatoIniziale();
  if (modifiche) modifiche(s);
  return s;
}

// A4 con margine 10: area utile 190 x 277 che parte da (10, 10).
function divisoIn2(direzione, modifiche) {
  const s = stato();
  const r = L.dividiZona(s, 'z1', direzione);
  if (modifiche) modifiche(s, r);
  return { s, r };
}

function rettangoli(foglio) {
  return foglio.zone.map((z) => ({
    x: z.rettangolo.x, y: z.rettangolo.y, w: z.rettangolo.w, h: z.rettangolo.h
  }));
}

// ---------------------------------------------------------------- operazioni sull'albero

test('dividiZona: la seconda zona è una copia indipendente della prima', () => {
  const s = stato((x) => { x.layout.impostazioni.passoX = 8; });
  const r = L.dividiZona(s, 'z1', 'verticale');
  assert.equal(s.layout.tipo, 'divisione');
  assert.equal(s.layout.id, 'd1');
  assert.equal(s.layout.a.id, 'z1');
  assert.equal(s.layout.b.id, 'z2');
  assert.equal(r.zonaNuova.impostazioni.passoX, 8);
  assert.notEqual(s.layout.a.impostazioni, s.layout.b.impostazioni);
  s.layout.b.impostazioni.passoX = 3;
  assert.equal(s.layout.a.impostazioni.passoX, 8);
  assert.equal(s.layout.direzione, 'verticale');
  assert.deepEqual(s.layout.posizione, { valore: 50, unita: '%' });
});

test('dividiZona: dividere una divisione o una zona inesistente non fa nulla', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  assert.equal(L.dividiZona(s, 'd1', 'orizzontale'), null);
  assert.equal(L.dividiZona(s, 'z99', 'orizzontale'), null);
  assert.equal(M.contaZone(s.layout), 2);
});

test('elencaNodi: ordine di lettura, numerazione e profondità', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale');
  const e = L.elencaNodi(s.layout);
  assert.deepEqual(e.map((v) => v.etichetta), ['Divisione 1', 'Zona 1', 'Divisione 2', 'Zona 2', 'Zona 3']);
  assert.deepEqual(e.map((v) => v.profondita), [0, 1, 1, 2, 2]);
  assert.deepEqual(e.map((v) => v.id), ['d1', 'z1', 'd2', 'z2', 'z3']);
});

test('ricerca di nodi e genitori', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale');
  assert.equal(L.trovaNodo(s.layout, 'z3').tipo, 'zona');
  assert.equal(L.trovaNodo(s.layout, 'd2').tipo, 'divisione');
  assert.equal(L.trovaNodo(s.layout, 'x'), null);
  assert.equal(L.trovaGenitore(s.layout, 'z3').id, 'd2');
  assert.equal(L.trovaGenitore(s.layout, 'd2').id, 'd1');
  assert.equal(L.trovaGenitore(s.layout, 'd1'), null);
});

test('unisciDivisione: resta la prima zona con le sue impostazioni', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.a.impostazioni.passoX = 7;
  s.layout.b.impostazioni.passoX = 3;
  const z = L.unisciDivisione(s, 'd1');
  assert.equal(s.layout, z);
  assert.equal(z.tipo, 'zona');
  assert.equal(z.impostazioni.passoX, 7);
  assert.equal(M.contaZone(s.layout), 1);
});

test('unisciDivisione annidata: elimina tutta la parte unita', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale'); // d2 dentro la parte b
  L.dividiZona(s, 'z1', 'orizzontale'); // d3 dentro la parte a
  assert.equal(M.contaZone(s.layout), 4);
  const z = L.unisciDivisione(s, 'd1');
  assert.equal(M.contaZone(s.layout), 1);
  assert.equal(z.id, 'z1');
  assert.equal(s.layout.tipo, 'zona');
});

test('unisciDivisione di una divisione interna lascia intatto il resto', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale');
  L.unisciDivisione(s, 'd2');
  assert.equal(s.layout.id, 'd1');
  assert.equal(s.layout.b.tipo, 'zona');
  assert.equal(M.contaZone(s.layout), 2);
});

test('nuovi identificatori non si ripetono dopo unioni e divisioni', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'verticale');
  L.unisciDivisione(s, 'd1');
  const r = L.dividiZona(s, 'z1', 'orizzontale');
  const id = L.elencaNodi(s.layout).map((v) => v.id);
  assert.equal(new Set(id).size, id.length);
  assert.ok(r.zonaNuova.id.startsWith('z'));
});

// ---------------------------------------------------------------- geometria

test('divisione verticale al 50% senza spazio: due zone affiancate e la linea al centro', () => {
  const { s } = divisoIn2('verticale', (x) => { x.layout.spazio = 0; });
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  assert.deepEqual(rettangoli(f), [
    { x: 10, y: 10, w: 95, h: 277 },
    { x: 105, y: 10, w: 95, h: 277 }
  ]);
  assert.deepEqual(f.divisioni[0].linea, [105, 10, 105, 287]);
  assert.equal(f.divisioni[0].lunghezza, 190);
});

test('lo spazio tra le zone è diviso a metà ai lati della linea', () => {
  const { s } = divisoIn2('verticale'); // spazio predefinito 5 mm
  const f = G.generaFoglio(s);
  const [a, b] = rettangoli(f);
  assert.ok(vicino(a.w, 92.5));
  assert.ok(vicino(b.x, 107.5));
  assert.ok(vicino(b.w, 92.5));
  assert.deepEqual(f.divisioni[0].linea, [105, 10, 105, 287]);
});

test('divisione orizzontale: zone una sopra l\'altra', () => {
  const { s } = divisoIn2('orizzontale', (x) => { x.layout.spazio = 0; });
  const f = G.generaFoglio(s);
  assert.deepEqual(rettangoli(f), [
    { x: 10, y: 10, w: 190, h: 138.5 },
    { x: 10, y: 148.5, w: 190, h: 138.5 }
  ]);
  assert.deepEqual(f.divisioni[0].linea, [10, 148.5, 200, 148.5]);
});

test('posizione in millimetri dal bordo sinistro della zona', () => {
  const { s } = divisoIn2('verticale', (x) => {
    x.layout.spazio = 0;
    x.layout.posizione = { valore: 60, unita: 'mm' };
  });
  const f = G.generaFoglio(s);
  assert.deepEqual(f.divisioni[0].linea, [70, 10, 70, 287]);
  assert.equal(f.zone[0].rettangolo.w, 60);
  assert.equal(f.zone[1].rettangolo.w, 130);
});

test('posizione in percentuale diversa dal 50%', () => {
  const { s } = divisoIn2('verticale', (x) => {
    x.layout.spazio = 0;
    x.layout.posizione = { valore: 25, unita: '%' };
  });
  const f = G.generaFoglio(s);
  assert.ok(vicino(f.zone[0].rettangolo.w, 47.5));
  assert.ok(vicino(f.zone[1].rettangolo.w, 142.5));
});

test('croce: quattro zone con una divisione per lato', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z1', 'orizzontale');
  L.dividiZona(s, 'z2', 'orizzontale');
  s.layout.spazio = 0;
  for (const v of L.elencaNodi(s.layout)) if (v.tipo === 'divisione') v.nodo.spazio = 0;
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  assert.equal(f.zone.length, 4);
  assert.equal(f.divisioni.length, 3);
  assert.deepEqual(f.zone.map((z) => z.numero), [1, 2, 3, 4]);
  const r = rettangoli(f);
  // ordine: alto-sinistra, basso-sinistra, alto-destra, basso-destra
  assert.deepEqual(r[0], { x: 10, y: 10, w: 95, h: 138.5 });
  assert.deepEqual(r[1], { x: 10, y: 148.5, w: 95, h: 138.5 });
  assert.deepEqual(r[2], { x: 105, y: 10, w: 95, h: 138.5 });
  assert.deepEqual(r[3], { x: 105, y: 148.5, w: 95, h: 138.5 });
  // le zone riempiono l'area utile senza sovrapporsi
  const area = r.reduce((t, z) => t + z.w * z.h, 0);
  assert.ok(vicino(area, 190 * 277, 1e-6));
});

test('ogni zona ha il proprio motivo e le proprie misure', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.b.impostazioni.motivo = 'righe-orizzontali';
  s.layout.b.impostazioni.passoY = 8;
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  assert.deepEqual(f.zone.map((z) => z.motivo), ['puntini', 'righe-orizzontali']);
  const punti = f.elementi.filter((e) => e.tipo === 'punti');
  const linee = f.elementi.filter((e) => e.tipo === 'linee');
  assert.equal(punti.length, 1);
  // una griglia di righe e la linea di divisione
  assert.equal(linee.length, 2);
  const righe = linee.find((l) => l.segmenti.length > 1);
  assert.equal(righe.segmenti.length, Math.floor(277 / 8) + 1);
  // le righe stanno dentro la zona di destra
  const destra = f.zone[1].rettangolo;
  for (const seg of righe.segmenti) {
    assert.ok(seg[0] >= destra.x - 1e-6 && seg[2] <= destra.x + destra.w + 1e-6);
  }
});

test('la griglia di ogni zona parte dal bordo della zona', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  const f = G.generaFoglio(s);
  const punti = f.elementi.filter((e) => e.tipo === 'punti');
  assert.deepEqual(punti[0].centri[0], [10, 10]);
  assert.deepEqual(punti[1].centri[0], [107.5, 10]);
});

test('modo "adatta": ogni zona centra la propria griglia', () => {
  const s = stato((x) => { x.margini.modo = 'adatta'; });
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.spazio = 0;
  s.layout.a.impostazioni.passoX = 7;
  s.layout.b.impostazioni.passoX = 7;
  const f = G.generaFoglio(s);
  const punti = f.elementi.filter((e) => e.tipo === 'punti');
  // zona di 95 mm, passo 7 -> 13 celle = 91 mm, resto 4 mm diviso a metà
  assert.ok(vicino(punti[0].centri[0][0], 12));
  assert.ok(vicino(punti[1].centri[0][0], 107));
});

test('linea di divisione: spessore, grigio e stile propri', () => {
  const { s } = divisoIn2('verticale', (x) => {
    x.layout.linea = { visibile: true, spessore: 0.6, intensita: 100, stile: 'tratteggiata', tratto: 4, spazio: 2 };
  });
  const f = G.generaFoglio(s);
  const linea = f.elementi.find((e) => e.tipo === 'linee' && e.segmenti.length === 1);
  assert.equal(linea.spessore, 0.6);
  assert.equal(linea.grigio, 0);
  assert.deepEqual(linea.dash, [4, 2]);
  assert.equal(linea.cap, 'butt');
});

test('linea di divisione nascosta: nessun elemento, la divisione resta', () => {
  const { s } = divisoIn2('verticale', (x) => { x.layout.linea.visibile = false; });
  const f = G.generaFoglio(s);
  assert.equal(f.elementi.filter((e) => e.tipo === 'linee').length, 0);
  assert.equal(f.zone.length, 2);
  assert.equal(f.divisioni.length, 1);
});

test('la linea è l\'ultimo elemento, sopra le griglie', () => {
  const { s } = divisoIn2('verticale');
  const f = G.generaFoglio(s);
  const ultimo = f.elementi[f.elementi.length - 1];
  assert.equal(ultimo.tipo, 'linee');
  assert.equal(ultimo.segmenti.length, 1);
});

test('posizione troppo vicina al bordo: portata al minimo con avviso', () => {
  const { s } = divisoIn2('verticale', (x) => {
    x.layout.spazio = 4;
    x.layout.posizione = { valore: 0, unita: '%' };
  });
  const f = G.generaFoglio(s);
  assert.ok(vicino(f.divisioni[0].posizioneMm, 4)); // 2 mm minimi + metà dello spazio
  assert.ok(f.avvisi.some((a) => /Divisione 1: la linea è stata spostata/.test(a)));
  const [a] = rettangoli(f);
  assert.ok(vicino(a.w, 2));
  const g = G.generaFoglio(divisoIn2('verticale', (x) => { x.layout.posizione = { valore: 100, unita: '%' }; }).s);
  assert.ok(g.zone[1].rettangolo.w >= M.MIN_ZONA - 1e-6);
});

test('spazio più grande della zona: avviso e nessun errore', () => {
  const { s } = divisoIn2('verticale', (x) => { x.layout.spazio = 100; x.pagina = undefined; });
  s.pagina = { formato: 'A6', orientamento: 'verticale', larghezza: 105, altezza: 148 };
  s.layout.spazio = 100;
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  assert.ok(f.avvisi.some((a) => /troppo piccola/.test(a)));
});

test('avvisi delle zone indicano la zona quando sono più di una', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.b.impostazioni.passoX = 99;
  s.layout.b.impostazioni.passoUguale = false;
  const f = G.generaFoglio(s);
  assert.ok(f.avvisi.some((a) => /^Zona 2: Il passo orizzontale/.test(a)), JSON.stringify(f.avvisi));
});

test('una sola zona: avvisi senza prefisso e valori colonne/righe come nella Fase 1', () => {
  const f = G.generaFoglio(stato());
  assert.equal(f.zone.length, 1);
  assert.equal(f.divisioni.length, 0);
  assert.equal(f.colonne, 38);
  assert.equal(f.righe, 55);
});

test('con più zone colonne e righe non sono definite', () => {
  const f = G.generaFoglio(divisoIn2('verticale').s);
  assert.equal(f.colonne, null);
  assert.equal(f.righe, null);
});

test('il limite di elementi vale per l\'intero foglio, non per ogni zona', () => {
  const base = (x) => {
    x.pagina.formato = 'A3';
    x.margini.senza = true;
    x.layout.impostazioni.passoX = 1.2;
  };
  const intero = G.generaFoglio(stato(base));
  assert.match(intero.errore, /Troppi puntini/);
  // diviso a metà, ogni zona da sola resterebbe sotto il limite (circa 43.000 puntini)
  const s = stato(base);
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.spazio = 0;
  const f = G.generaFoglio(s);
  assert.match(f.errore, /Troppi puntini/);
  // con un passo più largo il totale rientra e il foglio si genera
  s.layout.a.impostazioni.passoX = 1.5;
  s.layout.b.impostazioni.passoX = 1.5;
  assert.equal(G.generaFoglio(s).errore, null);
});

test('una zona piccola o vuota non produce elementi né errori', () => {
  const s = stato((x) => { x.layout.impostazioni.motivo = 'quadretti'; });
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.spazio = 0;
  s.layout.posizione = { valore: 0.5, unita: '%' };
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  assert.ok(f.zone[0].rettangolo.w >= M.MIN_ZONA - 1e-6);
});

// ---------------------------------------------------------------- validazione

test('un albero valido resta identico dopo la normalizzazione', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale');
  s.layout.posizione = { valore: 40, unita: 'mm' };
  s.layout.b.spazio = 12;
  s.layout.b.b.impostazioni.motivo = 'quadretti';
  const copia = JSON.parse(JSON.stringify(s));
  assert.deepEqual(M.normalizza(copia), s);
});

test('normalizza: nodi, direzioni e valori non validi tornano a valori sicuri', () => {
  const n = M.normalizza({
    layout: {
      tipo: 'divisione',
      direzione: 'diagonale',
      posizione: { valore: 9999, unita: 'km' },
      spazio: -5,
      linea: { visibile: 'si', spessore: 1e9, stile: 'onda' },
      a: { tipo: 'sconosciuto', impostazioni: { motivo: 'stelle' } },
      b: null
    }
  });
  assert.equal(n.layout.tipo, 'divisione');
  assert.equal(n.layout.direzione, 'verticale');
  assert.deepEqual(n.layout.posizione, { valore: 100, unita: '%' });
  assert.equal(n.layout.spazio, 0);
  assert.equal(n.layout.linea.visibile, true);
  assert.equal(n.layout.linea.spessore, M.LIMITI.spessore.max);
  assert.equal(n.layout.linea.stile, 'continua');
  assert.equal(n.layout.a.tipo, 'zona');
  assert.equal(n.layout.a.impostazioni.motivo, 'puntini');
  assert.equal(n.layout.b.tipo, 'zona');
  assert.deepEqual(L.elencaNodi(n.layout).map((v) => v.id), ['d1', 'z1', 'z2']);
});

test('normalizza: gli identificatori sono sempre ricostruiti e unici', () => {
  const zona = () => ({ tipo: 'zona', id: 'z1', impostazioni: {} });
  const n = M.normalizza({ layout: { tipo: 'divisione', id: 'z1', a: zona(), b: zona() } });
  const id = L.elencaNodi(n.layout).map((v) => v.id);
  assert.equal(new Set(id).size, id.length);
  assert.deepEqual(id, ['d1', 'z1', 'z2']);
});

test('normalizza: un albero troppo profondo viene troncato senza bloccarsi', () => {
  let nodo = { tipo: 'zona', impostazioni: {} };
  for (let i = 0; i < 5000; i++) nodo = { tipo: 'divisione', a: nodo, b: { tipo: 'zona', impostazioni: {} } };
  const t0 = Date.now();
  const n = M.normalizza({ layout: nodo });
  assert.ok(Date.now() - t0 < 2000);
  const e = L.elencaNodi(n.layout);
  assert.ok(e.length <= 2 * 1000 + 1);
  assert.ok(Math.max(...e.map((v) => v.profondita)) <= 41);
});

test('normalizza: un oggetto che contiene se stesso non manda in ciclo', () => {
  const ciclico = { tipo: 'divisione' };
  ciclico.a = ciclico;
  ciclico.b = ciclico;
  const n = M.normalizza({ layout: ciclico });
  assert.ok(L.elencaNodi(n.layout).length <= 2001);
});

test('normalizza: chiavi pericolose non inquinano gli oggetti', () => {
  const grezzo = JSON.parse('{"layout":{"tipo":"zona","impostazioni":{"__proto__":{"inquinato":true},"motivo":"quadretti"}}}');
  const n = M.normalizza(grezzo);
  assert.equal(n.layout.impostazioni.motivo, 'quadretti');
  assert.equal({}.inquinato, undefined);
  assert.equal(n.layout.impostazioni.inquinato, undefined);
});

// ---------------------------------------------------------------- nomi e PDF

test('nome file con più zone', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  L.dividiZona(s, 'z2', 'orizzontale');
  assert.equal(M.nomeFileAutomatico(s), 'foglio-A4-3-zone.pdf');
  s.pagina.formato = 'A3';
  s.pagina.orientamento = 'orizzontale';
  assert.equal(M.nomeFileAutomatico(s), 'foglio-A3-orizzontale-3-zone.pdf');
});

test('PDF con più zone: un riempimento per puntino e una linea per ogni segmento', () => {
  const s = stato();
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.b.impostazioni.motivo = 'quadretti';
  s.layout.b.impostazioni.passoX = 10;
  const f = G.generaFoglio(s);
  assert.equal(f.errore, null);
  const attesiPunti = f.elementi.filter((e) => e.tipo === 'punti').reduce((t, e) => t + e.centri.length, 0);
  const attesiLinee = f.elementi.filter((e) => e.tipo === 'linee').reduce((t, e) => t + e.segmenti.length, 0);
  const doc = P.creaPdf(jsPDF, f, { titolo: 'prova', comprimi: false });
  const testo = doc.output();
  assert.equal((testo.match(/\nf\n/g) || []).length, attesiPunti);
  assert.equal((testo.match(/ l\nS\n/g) || []).length, attesiLinee);
  assert.equal((testo.match(/\/Type\s*\/Page\b/g) || []).length, 1);
});
