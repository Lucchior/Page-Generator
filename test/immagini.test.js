'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const M = require('../js/modello.js');
const L = require('../js/layout.js');
const G = require('../js/geometria.js');
const P = require('../js/pdf.js');
const I = require('../js/immagini.js');
const { jsPDF } = require(path.join(__dirname, '..', 'vendor', 'jspdf.umd.min.js'));

const vicino = (a, b, t = 1e-3) => Math.abs(a - b) < t;

// PNG minimo valido (colore pieno) costruito a mano: firma, IHDR, IDAT, IEND.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function blocco(tipo, dati) {
  const l = Buffer.alloc(4); l.writeUInt32BE(dati.length);
  const t = Buffer.from(tipo, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, dati])));
  return Buffer.concat([l, t, dati, c]);
}
function png(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const riga = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => riga));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), blocco('IHDR', ihdr), blocco('IDAT', zlib.deflateSync(raw)), blocco('IEND', Buffer.alloc(0))]);
}

function dueFogli(mod) {
  const s = M.creaStatoIniziale();
  s.pagina.formato = 'A4'; s.pagina.orientamento = 'orizzontale'; s.margini.senza = true; s.stampa.sogliaAvviso = 0;
  L.dividiZona(s, 'z1', 'verticale', { valore: 50, unita: '%' });
  s.layout.spazio = 0;
  for (const z of L.foglie(s.layout)) {
    Object.assign(z.impostazioni, { motivo: 'puntini', passoX: 5, passoY: 5, passoUguale: false });
    z.impostazioni.foglio.attivo = true;
  }
  if (mod) mod(L.foglie(s.layout)[0].impostazioni);
  return M.normalizza(s);
}
const imm = (f) => f.elementi.filter((e) => e.tipo === 'immagine');

test('intestazione PNG: dimensioni lette dal contenuto', () => {
  assert.deepEqual(I.leggiIntestazionePng(png(30, 20)), { w: 30, h: 20 });
});

test('intestazione PNG: file non PNG, troncati o enormi vengono rifiutati', () => {
  assert.ok(I.leggiIntestazionePng(Buffer.from('GIF89a'.repeat(10))).errore);
  assert.ok(I.leggiIntestazionePng(png(30, 20).subarray(0, 20)).errore);
  assert.ok(I.leggiIntestazionePng(null).errore);
  const enorme = png(10, 10);
  enorme.writeUInt32BE(9000, 16); enorme.writeUInt32BE(9000, 20);
  assert.match(I.leggiIntestazionePng(enorme).errore, /60 megapixel/);
  const zero = png(10, 10); zero.writeUInt32BE(0, 16);
  assert.ok(I.leggiIntestazionePng(zero).errore);
});

test('senza immagini nulla cambia; con piega assente le immagini non compaiono', () => {
  assert.equal(imm(G.generaFoglio(dueFogli())).length, 0);
  const f = G.generaFoglio(dueFogli((i) => { i.foglio.piega.modo = 'nessuna'; }), { alto: { w: 1713, h: 1200 } });
  assert.equal(imm(f).length, 0);
});

test('immagine nelle due metà della zona 1: foglio aperto, 145 × 101,5 mm, solo zona 1', () => {
  const f = G.generaFoglio(dueFogli(), { alto: { w: 1740, h: 1218 }, basso: { w: 1740, h: 1218 } });
  const [a, b] = imm(f);
  assert.equal(a.lato, 'alto'); assert.equal(b.lato, 'basso');
  assert.ok(vicino(a.x, 1.75) && vicino(a.y, 3.5) && vicino(a.w, 145) && vicino(a.h, 101.5));
  assert.ok(vicino(b.y, 105) && vicino(b.h, 101.5));
  assert.equal(f.immagini.length, 2);
  assert.ok(a.dpi >= 300);
});

test('le metà con immagine non hanno griglia; l’altra metà sì; la zona 2 resta intera', () => {
  const f = G.generaFoglio(dueFogli(), { alto: { w: 1740, h: 1218 } });
  const centri = f.elementi.filter((e) => e.tipo === 'punti').flatMap((e) => e.centri);
  const z1 = centri.filter((c) => c[0] < 148.5);
  assert.ok(z1.every((c) => c[1] > 105), 'nessun puntino sopra la piega in zona 1');
  assert.ok(z1.length > 0);
  assert.ok(centri.some((c) => c[0] > 148.5 && c[1] < 105), 'la zona 2 ha ancora la metà alta');
});

test('adattamento: contieni, riempi, estendi', () => {
  const dim = { alto: { w: 1000, h: 1000 } }; // quadrata in una metà 145 × 101,5
  let e = imm(G.generaFoglio(dueFogli(), dim))[0];
  assert.ok(vicino(e.h, 101.5) && vicino(e.w, 101.5) && vicino(e.x, 1.75 + (145 - 101.5) / 2), 'contieni centra senza deformare');
  e = imm(G.generaFoglio(dueFogli((i) => { i.foglio.immagini.alto.adatta = 'riempi'; }), dim))[0];
  assert.ok(vicino(e.w, 145) && vicino(e.h, 101.5));
  assert.ok(vicino(e.ritaglio.w, 1) && vicino(e.ritaglio.h, 101.5 / 145, 1e-3) && vicino(e.ritaglio.y, (1 - 101.5 / 145) / 2, 1e-3));
  e = imm(G.generaFoglio(dueFogli((i) => { i.foglio.immagini.alto.adatta = 'estendi'; }), dim))[0];
  assert.ok(vicino(e.w, 145) && vicino(e.h, 101.5));
  assert.deepEqual(e.ritaglio, { x: 0, y: 0, w: 1, h: 1 });
});

test('area "finito": limitata al foglio finito (rifilo escluso)', () => {
  const e = imm(G.generaFoglio(dueFogli((i) => { i.foglio.immagini.alto.area = 'finito'; i.foglio.immagini.alto.adatta = 'estendi'; }), { alto: { w: 1000, h: 700 } }))[0];
  assert.ok(vicino(e.x, 4.25) && vicino(e.w, 140) && vicino(e.y, 5) && vicino(e.h, 100));
});

test('rotazione e dpi bassi: segnalati', () => {
  const f = G.generaFoglio(dueFogli((i) => { i.foglio.immagini.alto.ruota = true; }), { alto: { w: 600, h: 420 } });
  assert.equal(imm(f)[0].ruota, true);
  assert.ok(f.avvisi.some((a) => /dpi/.test(a)));
});

test('con immagini in entrambe le metà non compare l’avviso "nessuna riga"', () => {
  const f = G.generaFoglio(dueFogli(), { alto: { w: 1740, h: 1218 }, basso: { w: 1740, h: 1218 } });
  assert.ok(!f.avvisi.some((a) => /Nessuna riga/.test(a)), f.avvisi.join('|'));
});

test('opzioni immagine: valori non validi normalizzati; vecchi preset senza il campo', () => {
  const s = M.normalizza({ layout: { tipo: 'zona', id: 'z1', impostazioni: { foglio: { immagini: { alto: { adatta: 'boh', area: 3, ruota: 'si' } } } } } });
  assert.deepEqual(s.layout.impostazioni.foglio.immagini.alto, { adatta: 'contieni', area: 'aperto', ruota: false });
  assert.deepEqual(s.layout.impostazioni.foglio.immagini.basso, { adatta: 'contieni', area: 'aperto', ruota: false });
});

test('PDF: l’immagine è inserita nella posizione e nella misura calcolate', () => {
  const f = G.generaFoglio(dueFogli(), { alto: { w: 60, h: 42 } });
  const el = imm(f)[0];
  const copia = Object.assign({}, f, { elementi: f.elementi.map((e) => (e.tipo === 'immagine' ? Object.assign({}, e, { dati: 'data:image/png;base64,' + png(60, 42).toString('base64') }) : e)) });
  const doc = P.creaPdf(jsPDF, copia, { titolo: 't' });
  const testo = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.match(testo, /\/Subtype \/Image/);
  assert.match(testo, /\/Width 60/);
  assert.ok(el.w > 0);
  // senza "dati" l’immagine viene saltata senza errori
  const senza = P.creaPdf(jsPDF, f, { titolo: 't' });
  assert.ok(!Buffer.from(senza.output('arraybuffer')).toString('latin1').includes('/Subtype /Image'));
});
