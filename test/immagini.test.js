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

// A4 verticale con due zone sovrapposte (210 × 148,5 mm), foglio aperto 203 × 145 mm, piega verticale.
function dueZone(mod1, mod2, finito = true) {
  const s = M.creaStatoIniziale();
  s.pagina.formato = 'A4'; s.pagina.orientamento = 'verticale'; s.margini.senza = true; s.stampa.sogliaAvviso = 0;
  L.dividiZona(s, 'z1', 'orizzontale', { valore: 50, unita: '%' });
  s.layout.spazio = 0;
  const zone = L.foglie(s.layout);
  for (const z of zone) {
    Object.assign(z.impostazioni, { motivo: 'puntini', passoX: 5, passoY: 5, passoUguale: false });
    z.impostazioni.foglio.attivo = finito;
  }
  if (mod1) mod1(zone[0].impostazioni);
  if (mod2) mod2(zone[1].impostazioni);
  return { stato: M.normalizza(s), ids: L.foglie(M.normalizza(s).layout).map((z) => z.id) };
}
const imm = (f) => f.elementi.filter((e) => e.tipo === 'immagine');
const img = (ids, ...dim) => Object.fromEntries(dim.map((d, i) => [ids[i], d]).filter((x) => x[1]));
const soloImmagine = (i) => { i.motivo = 'immagine'; };

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

test('motivo immagine senza file caricato: la zona resta vuota, nessun errore', () => {
  const { stato, ids } = dueZone(soloImmagine, soloImmagine);
  const f = G.generaFoglio(stato, {});
  assert.equal(f.errore, null);
  assert.equal(imm(f).length, 0);
  assert.equal(f.elementi.filter((e) => e.tipo === 'punti').length, 0);
  assert.equal(ids.length, 2);
});

test('l’immagine copre tutto il foglio aperto della zona (203 × 145) e la zona 2 è indipendente', () => {
  const { stato, ids } = dueZone(soloImmagine, soloImmagine);
  const f = G.generaFoglio(stato, img(ids, { w: 2030, h: 1450 }, { w: 2030, h: 1450 }));
  const [a, b] = imm(f);
  assert.equal(a.zona, ids[0]); assert.equal(b.zona, ids[1]);
  assert.ok(vicino(a.x, 3.5) && vicino(a.y, 1.75) && vicino(a.w, 203) && vicino(a.h, 145));
  assert.ok(vicino(b.y, 148.5 + 1.75) && vicino(b.w, 203));
  assert.equal(f.immagini.length, 2);
  assert.ok(a.dpi >= 250 && a.dpi <= 260);
});

test('solo una zona con immagine: l’altra mantiene la sua griglia', () => {
  const { stato, ids } = dueZone(soloImmagine, null);
  const f = G.generaFoglio(stato, img(ids, { w: 2030, h: 1450 }));
  assert.equal(imm(f).length, 1);
  const punti = f.elementi.filter((e) => e.tipo === 'punti').flatMap((e) => e.centri);
  assert.ok(punti.length > 0 && punti.every((c) => c[1] > 148.5));
});

test('senza foglio finito l’immagine copre la zona intera', () => {
  const { stato, ids } = dueZone(soloImmagine, null, false);
  const e = imm(G.generaFoglio(stato, img(ids, { w: 2100, h: 1485 })))[0];
  assert.ok(vicino(e.x, 0) && vicino(e.y, 0) && vicino(e.w, 210) && vicino(e.h, 148.5));
});

test('adattamento: contieni, riempi, estendi', () => {
  const quadrata = (m) => {
    const { stato, ids } = dueZone((i) => { soloImmagine(i); m(i); });
    return imm(G.generaFoglio(stato, img(ids, { w: 1000, h: 1000 })))[0];
  };
  let e = quadrata(() => {});
  assert.ok(vicino(e.h, 145) && vicino(e.w, 145) && vicino(e.x, 3.5 + (203 - 145) / 2), 'contieni centra senza deformare');
  e = quadrata((i) => { i.immagine.adatta = 'riempi'; });
  assert.ok(vicino(e.w, 203) && vicino(e.h, 145));
  assert.ok(vicino(e.ritaglio.w, 1) && vicino(e.ritaglio.h, 145 / 203, 1e-3) && vicino(e.ritaglio.y, (1 - 145 / 203) / 2, 1e-3));
  e = quadrata((i) => { i.immagine.adatta = 'estendi'; });
  assert.ok(vicino(e.w, 203) && vicino(e.h, 145));
  assert.deepEqual(e.ritaglio, { x: 0, y: 0, w: 1, h: 1 });
});

test('area "finito": limitata al foglio finito (rifilo escluso: 200 × 140)', () => {
  const { stato, ids } = dueZone((i) => { soloImmagine(i); i.immagine.area = 'finito'; i.immagine.adatta = 'estendi'; });
  const e = imm(G.generaFoglio(stato, img(ids, { w: 1000, h: 700 })))[0];
  assert.ok(vicino(e.x, 5) && vicino(e.w, 200) && vicino(e.y, 4.25) && vicino(e.h, 140));
});

test('rotazione e dpi bassi: segnalati', () => {
  const { stato, ids } = dueZone((i) => { soloImmagine(i); i.immagine.ruota = true; });
  const f = G.generaFoglio(stato, img(ids, { w: 600, h: 420 }));
  assert.equal(imm(f)[0].ruota, true);
  assert.ok(f.avvisi.some((a) => /dpi/.test(a)));
});

test('avviso sul bordo della stampante: conta solo la parte dell’immagine che resta dopo il rifilo', () => {
  const { stato, ids } = dueZone((i) => { soloImmagine(i); i.immagine.adatta = 'estendi'; }, soloImmagine);
  stato.stampa.sogliaAvviso = 4;
  const f = G.generaFoglio(stato, img(ids, { w: 2030, h: 1450 }, { w: 2030, h: 1450 }));
  assert.ok(!f.avvisi.some((a) => /bordo/.test(a)), f.avvisi.join('|'));
  stato.stampa.sogliaAvviso = 6;
  assert.ok(G.generaFoglio(stato, img(ids, { w: 2030, h: 1450 }, { w: 2030, h: 1450 })).avvisi.some((a) => /bordo/.test(a)));
});

test('opzioni immagine: valori non validi normalizzati; vecchi preset senza il campo', () => {
  const s = M.normalizza({ layout: { tipo: 'zona', id: 'z1', impostazioni: { motivo: 'immagine', immagine: { adatta: 'boh', area: 3, ruota: 'si' } } } });
  assert.equal(s.layout.impostazioni.motivo, 'immagine');
  assert.deepEqual(s.layout.impostazioni.immagine, { adatta: 'contieni', area: 'aperto', ruota: false });
  const vecchio = M.normalizza({ layout: { tipo: 'zona', id: 'z1', impostazioni: { motivo: 'quadretti' } } });
  assert.deepEqual(vecchio.layout.impostazioni.immagine, { adatta: 'contieni', area: 'aperto', ruota: false });
});

test('nome file automatico con motivo immagine', () => {
  const s = M.creaStatoIniziale();
  s.layout.impostazioni.motivo = 'immagine';
  assert.equal(M.nomeFileAutomatico(s), 'foglio-A4-immagine.pdf');
});

test('PDF: l’immagine è inserita; senza dati viene saltata', () => {
  const { stato, ids } = dueZone(soloImmagine, null);
  const f = G.generaFoglio(stato, img(ids, { w: 60, h: 42 }));
  const copia = Object.assign({}, f, { elementi: f.elementi.map((e) => (e.tipo === 'immagine' ? Object.assign({}, e, { dati: 'data:image/png;base64,' + png(60, 42).toString('base64') }) : e)) });
  const testo = Buffer.from(P.creaPdf(jsPDF, copia, { titolo: 't' }).output('arraybuffer')).toString('latin1');
  assert.match(testo, /\/Subtype \/Image/);
  assert.match(testo, /\/Width 60/);
  const senza = Buffer.from(P.creaPdf(jsPDF, f, { titolo: 't' }).output('arraybuffer')).toString('latin1');
  assert.ok(!senza.includes('/Subtype /Image'));
});
