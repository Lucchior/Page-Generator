'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/modello.js');
const L = require('../js/layout.js');
const G = require('../js/geometria.js');

const vicino = (a, b, t = 1e-6) => Math.abs(a - b) < t;

// Due zone affiancate su A4 orizzontale, senza margini e senza spazio: 148,5 mm ciascuna.
function dueFogli(mod) {
  const s = M.creaStatoIniziale();
  s.pagina.formato = 'A4';
  s.pagina.orientamento = 'orizzontale';
  s.margini.senza = true;
  s.stampa.sogliaAvviso = 0;
  L.dividiZona(s, 'z1', 'verticale', { valore: 50, unita: '%' });
  s.layout.spazio = 0;
  for (const z of L.foglie(s.layout)) {
    Object.assign(z.impostazioni, { motivo: 'puntini', passoX: 5, passoY: 5, passoUguale: false });
    z.impostazioni.foglio.attivo = true;
    z.impostazioni.foglio.piega.distanza = 5;
    if (mod) mod(z.impostazioni);
  }
  return M.normalizza(s);
}
const zona = (f, i = 0) => f.zone[i];

test('foglio finito spento di default: comportamento invariato', () => {
  const s = M.creaStatoIniziale();
  assert.equal(s.layout.impostazioni.foglio.attivo, false);
  assert.equal(G.generaFoglio(s).zone[0].finito, null);
});

test('foglio aperto 145×203 centrato nella zona, finito 140×200 con rifilo 2,5+2,5 / 1,5+1,5', () => {
  const f = G.generaFoglio(dueFogli());
  assert.equal(f.errore, null);
  const z = zona(f).finito;
  assert.deepEqual([z.aperto.w, z.aperto.h], [145, 203]);
  assert.ok(vicino(z.aperto.x, 1.75) && vicino(z.aperto.y, 3.5));
  assert.deepEqual([z.finito.w, z.finito.h], [140, 200]);
  assert.ok(vicino(z.finito.x, 4.25) && vicino(z.finito.y, 5));
  const z2 = zona(f, 1).finito;
  assert.ok(vicino(z2.aperto.x, 148.5 + 1.75));
});

test('rifilo tutto da un lato', () => {
  const f = G.generaFoglio(dueFogli((i) => { i.foglio.rifilo = { sinistra: 5, destra: 0, alto: 3, basso: 0 }; }));
  const z = zona(f).finito;
  assert.ok(vicino(z.finito.x, z.aperto.x + 5) && vicino(z.finito.y, z.aperto.y + 3));
  assert.deepEqual([z.finito.w, z.finito.h], [140, 200]);
});

test('piega orizzontale al centro dei 203 prima del rifilo', () => {
  const z = zona(G.generaFoglio(dueFogli())).finito;
  assert.ok(vicino(z.piega.y, z.aperto.y + 101.5));
});

test('griglia "dentro": nessun elemento fuori dal foglio finito; prima riga alla distanza dalla piega', () => {
  const f = G.generaFoglio(dueFogli());
  const z = zona(f).finito;
  const el = f.elementi.find((e) => e.tipo === 'punti');
  for (const [x, y] of el.centri) {
    if (x > 148.5) continue;
    assert.ok(x >= z.finito.x - 1e-6 && x <= z.finito.x + z.finito.w + 1e-6);
    assert.ok(y >= z.finito.y - 1e-6 && y <= z.finito.y + z.finito.h + 1e-6);
  }
  const ys = [...new Set(el.centri.filter((c) => c[0] < 148.5).map((c) => c[1]))].sort((a, b) => a - b);
  assert.ok(ys.some((y) => vicino(y, z.piega.y + 5)));
  assert.ok(ys.some((y) => vicino(y, z.piega.y - 5)));
  assert.ok(!ys.some((y) => y > z.piega.y - 5 && y < z.piega.y + 5));
});

test('le due metà sono speculari rispetto alla piega', () => {
  for (const motivo of ['puntini', 'quadretti', 'righe-orizzontali', 'righe-verticali']) {
    const f = G.generaFoglio(dueFogli((i) => { i.motivo = motivo; i.foglio.distanza = { uguale: true, tutti: 0 }; }));
    const piega = zona(f).finito.piega.y;
    const chiave = (a) => a.map((v) => v.toFixed(3)).join(',');
    const raccogli = (e) => {
      if (e.tipo === 'punti') return e.centri.filter((c) => c[0] < 148.5).map((c) => [c[0], c[1]]);
      return e.segmenti.filter((s) => s[0] < 148.5).flatMap((s) => [[s[0], s[1]], [s[2], s[3]]]);
    };
    const tutti = f.elementi.filter((e) => e.tipo !== 'linee' || e.segmenti.length > 0).flatMap(raccogli);
    const set = new Set(tutti.map(chiave));
    // riflesso di un elemento che sta nella metà con più spazio: se cade nell'area utile deve esistere
    const z = zona(f).finito.finito;
    let verificati = 0;
    for (const [x, y] of tutti) {
      const yr = 2 * piega - y;
      if (yr < z.y - 1e-6 || yr > z.y + z.h + 1e-6) continue;
      if (motivo === 'righe-verticali' && (yr > piega - 5 && yr < piega + 5)) continue;
      assert.ok(set.has(chiave([x, yr])), motivo + ': manca il riflesso di ' + x + ',' + y);
      verificati++;
    }
    assert.ok(verificati > 0, motivo);
  }
});

test('"con abbondanza" prolunga lo stesso reticolo nello scarto, senza spostarlo', () => {
  const dentro = G.generaFoglio(dueFogli((i) => { i.passoX = 2; i.passoY = 2; i.foglio.distanza = { uguale: true, tutti: 2 }; }));
  const abb = G.generaFoglio(dueFogli((i) => { i.passoX = 2; i.passoY = 2; i.foglio.distanza = { uguale: true, tutti: 2 }; i.foglio.disegno = 'abbondanza'; }));
  const pd = dentro.elementi.find((e) => e.tipo === 'punti').centri.filter((c) => c[0] < 148.5);
  const pa = abb.elementi.find((e) => e.tipo === 'punti').centri.filter((c) => c[0] < 148.5);
  assert.ok(pa.length > pd.length);
  const set = new Set(pa.map((c) => c.join(',')));
  for (const c of pd) assert.ok(set.has(c.join(',')));
  const z = zona(abb).finito;
  assert.ok(Math.min(...pa.map((c) => c[0])) < z.finito.x);
  assert.ok(Math.max(...pa.map((c) => c[1])) <= z.aperto.y + z.aperto.h + 1e-6);
  // ancorato a 2 mm dal bordo finito con passo 2: il reticolo continua e cade anche sul bordo finito (0 mm)
  assert.ok(vicino(z.distanze.sinistra, 0));
});

test('distanze riportate dal bordo del foglio finito', () => {
  const z = zona(G.generaFoglio(dueFogli((i) => { i.foglio.distanza = { uguale: false, alto: 3, basso: 4, sinistra: 6, destra: 1 }; }))).finito;
  assert.ok(vicino(z.distanze.sinistra, 6));
  assert.ok(z.distanze.destra >= 1 - 1e-6 && z.distanze.destra < 6);
  assert.ok(z.distanze.alto >= 3 - 1e-6);
  assert.ok(z.distanze.basso >= 4 - 1e-6);
});

test('senza piega il reticolo parte dall’alto del foglio finito', () => {
  const f = G.generaFoglio(dueFogli((i) => { i.foglio.piega.modo = 'nessuna'; }));
  const z = zona(f).finito;
  assert.equal(z.piega, null);
  assert.ok(vicino(z.distanze.alto, 0));
});

test('valori fuori intervallo e dati vecchi vengono normalizzati', () => {
  const s = M.normalizza({ layout: { tipo: 'zona', id: 'z1', impostazioni: { foglio: { attivo: 'si', larghezza: -5, rifilo: { sinistra: 'x', alto: 9999 }, disegno: 'boh', piega: { modo: 'diagonale', distanza: -3 } } } } });
  const fg = s.layout.impostazioni.foglio;
  assert.equal(fg.attivo, false);
  assert.ok(fg.larghezza >= 20);
  assert.equal(fg.rifilo.sinistra, 2.5);
  assert.ok(fg.rifilo.alto <= 100);
  assert.equal(fg.disegno, 'dentro');
  assert.equal(fg.piega.modo, 'orizzontale');
  assert.ok(fg.piega.distanza >= 0);
  const vecchio = M.normalizza({ layout: { tipo: 'zona', id: 'z1', impostazioni: { motivo: 'quadretti' } } });
  assert.equal(vecchio.layout.impostazioni.foglio.attivo, false);
});

test('rifilo e distanze eccessivi: avviso, nessun errore né crash', () => {
  let f = G.generaFoglio(dueFogli((i) => { i.foglio.rifilo = { sinistra: 80, destra: 80, alto: 0, basso: 0 }; }));
  assert.equal(f.errore, null);
  assert.ok(f.avvisi.some((a) => /rifilo/i.test(a)));
  f = G.generaFoglio(dueFogli((i) => { i.foglio.distanza = { uguale: true, tutti: 90 }; }));
  assert.ok(f.avvisi.some((a) => /distanze/i.test(a)));
});

test('foglio più grande della zona: avviso', () => {
  const f = G.generaFoglio(dueFogli((i) => { i.foglio.larghezza = 200; }));
  assert.ok(f.avvisi.some((a) => /più grande della zona/.test(a)));
});

test('avviso bordo stampante: solo la parte che resta dopo il rifilo', () => {
  const s = dueFogli((i) => { i.foglio.disegno = 'abbondanza'; });
  s.stampa.sogliaAvviso = 3;
  const f = G.generaFoglio(s);
  // abbondanza arriva a ~0,5 mm dal bordo nello scarto, ma il finito sta a ≥ 4 mm: nessun avviso
  assert.ok(!f.avvisi.some((a) => /bordo/.test(a)), f.avvisi.join('|'));
  s.stampa.sogliaAvviso = 5;
  assert.ok(G.generaFoglio(s).avvisi.some((a) => /bordo/.test(a)));
});

test('dividere una zona copia anche il foglio finito senza condividerlo', () => {
  const s = M.creaStatoIniziale();
  L.dividiZona(s, 'z1', 'verticale', { valore: 50, unita: '%' });
  const [a, b] = L.foglie(s.layout);
  a.impostazioni.foglio.attivo = true;
  a.impostazioni.foglio.rifilo.sinistra = 7;
  assert.equal(b.impostazioni.foglio.attivo, false);
  assert.equal(b.impostazioni.foglio.rifilo.sinistra, 2.5);
});
