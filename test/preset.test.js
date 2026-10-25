/*
 * Test di preset, archivio nel browser e dividi-con-posizione (Fase 3).
 * Esecuzione dalla cartella del progetto:   node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../js/modello.js');
const L = require('../js/layout.js');
const G = require('../js/geometria.js');
const P = require('../js/preset.js');

class FintoStorage {
  constructor() { this.d = new Map(); this.rotto = false; }
  getItem(k) { if (this.rotto) throw new Error('bloccato'); return this.d.has(k) ? this.d.get(k) : null; }
  setItem(k, v) { if (this.rotto) throw new Error('pieno'); this.d.set(k, String(v)); }
  removeItem(k) { this.d.delete(k); }
}

function statoConZone() {
  const s = M.creaStatoIniziale();
  s.pagina.formato = 'A5';
  s.stampa.nomeFile = 'mio-file';
  L.dividiZona(s, 'z1', 'verticale');
  s.layout.b.impostazioni.motivo = 'quadretti';
  return s;
}

test('dividiZona con posizione: la linea cade dove richiesto', () => {
  const s = M.creaStatoIniziale();
  L.dividiZona(s, 'z1', 'verticale', { valore: 60, unita: 'mm' });
  assert.deepEqual(s.layout.posizione, { valore: 60, unita: 'mm' });
  s.layout.spazio = 0;
  const f = G.generaFoglio(s);
  assert.deepEqual(f.divisioni[0].linea, [70, 10, 70, 287]);
});

test('dividiZona con posizione non valida: resta il 50%', () => {
  const s = M.creaStatoIniziale();
  L.dividiZona(s, 'z1', 'verticale', { valore: NaN, unita: 'mm' });
  assert.deepEqual(s.layout.posizione, { valore: 50, unita: '%' });
  const t = M.creaStatoIniziale();
  L.dividiZona(t, 'z1', 'verticale', { valore: 10, unita: 'km' });
  assert.deepEqual(t.layout.posizione, { valore: 50, unita: '%' });
});

test('sanificaNome: spazi, caratteri di controllo e lunghezza', () => {
  assert.equal(P.sanificaNome('  Mio \n\t preset  '), 'Mio preset');
  assert.equal(P.sanificaNome(null), '');
  assert.equal(P.sanificaNome('a'.repeat(200)).length, P.MAX_NOME);
  assert.equal(P.sanificaNome('<b>x</b>'), '<b>x</b>'); // il nome è solo testo: non viene mai inserito come HTML
});

test('creaPreset: nessun nome file nelle impostazioni, formato e versione presenti', () => {
  const p = P.creaPreset(statoConZone(), 'A5 a due zone');
  assert.equal(p.formato, 'generatore-fogli-preset');
  assert.equal(p.versione, 1);
  assert.equal(p.nome, 'A5 a due zone');
  assert.equal(p.impostazioni.stampa.nomeFile, '');
  assert.equal(p.impostazioni.pagina.formato, 'A5');
});

test('esporta e rilegge: lo stato torna identico', () => {
  const s = statoConZone();
  s.stampa.nomeFile = '';
  const r = P.leggiPreset(JSON.stringify(P.creaPreset(s, 'x')));
  assert.equal(r.errore, undefined);
  assert.equal(r.nome, 'x');
  assert.deepEqual(r.stato, s);
});

test('leggiPreset: errori comprensibili', () => {
  assert.match(P.leggiPreset('').errore, /vuoto/);
  assert.match(P.leggiPreset('{non json').errore, /JSON/);
  assert.match(P.leggiPreset('[1,2]').errore, /non contiene un preset/);
  assert.match(P.leggiPreset('{"formato":"altro"}').errore, /non è un preset di questo generatore/);
  assert.match(P.leggiPreset('{"formato":"generatore-fogli-preset","versione":99,"impostazioni":{}}').errore, /più recente/);
  assert.match(P.leggiPreset('{"formato":"generatore-fogli-preset","versione":1}').errore, /impostazioni/);
  assert.match(P.leggiPreset('x'.repeat(2 * 1024 * 1024)).errore, /troppo grande/);
});

test('leggiPreset: valori fuori limite e tipi sbagliati vengono corretti', () => {
  const r = P.leggiPreset(JSON.stringify({
    formato: 'generatore-fogli-preset', versione: 1, nome: '  <script> ',
    impostazioni: { pagina: { formato: 'ZZ' }, layout: { tipo: 'zona', impostazioni: { passoX: -5, motivo: 'stelle' } }, stampa: { nomeFile: 'x' } }
  }));
  assert.equal(r.errore, undefined);
  assert.equal(r.stato.pagina.formato, 'A4');
  assert.equal(r.stato.layout.impostazioni.motivo, 'puntini');
  assert.equal(r.stato.layout.impostazioni.passoX, M.LIMITI.passo.min);
  assert.equal(r.stato.stampa.nomeFile, '');
  assert.doesNotThrow(() => G.generaFoglio(r.stato)); // eventuali eccessi vengono segnalati come errore, non bloccano
});

test('archivio: salva, elenca in ordine, carica, sostituisce, elimina', () => {
  const a = P.creaArchivio(new FintoStorage());
  assert.deepEqual(a.elenco(), []);
  assert.equal(a.salva('Zeta', statoConZone()).ok, true);
  assert.equal(a.salva('alfa', M.creaStatoIniziale()).ok, true);
  assert.deepEqual(a.elenco(), ['alfa', 'Zeta']);
  assert.equal(a.esiste(' alfa '), true);
  const c = a.carica('Zeta');
  assert.equal(c.ok, true);
  assert.equal(M.contaZone(c.stato.layout), 2);
  const sost = a.salva('alfa', statoConZone());
  assert.equal(sost.sostituito, true);
  assert.equal(a.elenco().length, 2);
  assert.equal(M.contaZone(a.carica('alfa').stato.layout), 2);
  assert.equal(a.elimina('Zeta').ok, true);
  assert.deepEqual(a.elenco(), ['alfa']);
  assert.equal(a.carica('Zeta').ok, false);
  assert.equal(a.elimina('Zeta').ok, false);
});

test('archivio: nome vuoto e limite massimo', () => {
  const a = P.creaArchivio(new FintoStorage());
  assert.match(a.salva('   ', M.creaStatoIniziale()).errore, /nome/);
  for (let i = 0; i < P.MAX_PRESET; i++) assert.equal(a.salva('p' + i, M.creaStatoIniziale()).ok, true);
  assert.match(a.salva('uno-di-troppo', M.creaStatoIniziale()).errore, /massimo/);
  assert.equal(a.salva('p0', M.creaStatoIniziale()).ok, true); // sostituire è sempre permesso
});

test('archivio: nomi pericolosi non toccano i prototipi', () => {
  const a = P.creaArchivio(new FintoStorage());
  for (const n of ['__proto__', 'constructor', 'toString']) assert.equal(a.salva(n, M.creaStatoIniziale()).ok, true);
  assert.deepEqual(a.elenco(), ['__proto__', 'constructor', 'toString']);
  assert.equal(a.carica('__proto__').ok, true);
  assert.equal({}.inquinato, undefined);
});

test('archivio: dati rovinati nel browser vengono scartati senza errori', () => {
  const st = new FintoStorage();
  const a = P.creaArchivio(st);
  st.setItem(P.CHIAVE_PRESET, '{non json');
  assert.deepEqual(a.elenco(), []);
  st.setItem(P.CHIAVE_PRESET, JSON.stringify({ non: 'un array' }));
  assert.deepEqual(a.elenco(), []);
  st.setItem(P.CHIAVE_PRESET, JSON.stringify([null, 5, { nome: '' }, { nome: 'ok', impostazioni: { pagina: { formato: 'B5' } } }, { nome: 'ok' }]));
  assert.deepEqual(a.elenco(), ['ok']);
  assert.equal(a.carica('ok').stato.pagina.formato, 'B5');
});

test('archivio: storage bloccato o pieno dà un messaggio, non un\'eccezione', () => {
  const st = new FintoStorage();
  const a = P.creaArchivio(st);
  st.rotto = true;
  assert.equal(a.disponibile(), false);
  assert.deepEqual(a.elenco(), []);
  assert.match(a.salva('x', M.creaStatoIniziale()).errore, /non permette di salvare/);
  assert.equal(a.salvaUltima(M.creaStatoIniziale()), false);
  assert.equal(a.leggiUltima(), null);
});

test('ultima configurazione: salvata, riletta, senza nome file; dati rovinati ignorati', () => {
  const st = new FintoStorage();
  const a = P.creaArchivio(st);
  assert.equal(a.leggiUltima(), null);
  const s = statoConZone();
  assert.equal(a.salvaUltima(s), true);
  const r = a.leggiUltima();
  assert.equal(M.contaZone(r.layout), 2);
  assert.equal(r.stampa.nomeFile, '');
  st.setItem(P.CHIAVE_ULTIMA, '{rotto');
  assert.equal(a.leggiUltima(), null);
  a.salvaUltima(s);
  a.dimenticaUltima();
  assert.equal(a.leggiUltima(), null);
});
