/*
 * Test di geometria, modello e PDF. Nessuna dipendenza: servono solo Node (versione 18 o successiva)
 * e il file vendor/jspdf.umd.min.js già presente nel progetto.
 *
 * Esecuzione dalla cartella del progetto:   node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const M = require('../js/modello.js');
const G = require('../js/geometria.js');
const P = require('../js/pdf.js');
const { jsPDF } = require(path.join(__dirname, '..', 'vendor', 'jspdf.umd.min.js'));

const vicino = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function stato(modifiche) {
  const s = M.creaStatoIniziale();
  if (modifiche) modifiche(s);
  return s;
}

function elementiDi(foglio, tipo) {
  return foglio.elementi.filter((e) => e.tipo === tipo);
}

// ---------------------------------------------------------------- pagina

test('formati: dimensioni in verticale e in orizzontale', () => {
  assert.deepEqual(M.dimensioniPagina({ formato: 'A4', orientamento: 'verticale' }), { larghezza: 210, altezza: 297 });
  assert.deepEqual(M.dimensioniPagina({ formato: 'A4', orientamento: 'orizzontale' }), { larghezza: 297, altezza: 210 });
  assert.deepEqual(M.dimensioniPagina({ formato: 'A3', orientamento: 'orizzontale' }), { larghezza: 420, altezza: 297 });
  assert.deepEqual(M.dimensioniPagina({ formato: 'Letter', orientamento: 'verticale' }), { larghezza: 215.9, altezza: 279.4 });
  assert.deepEqual(M.dimensioniPagina({ formato: 'personalizzato', orientamento: 'verticale', larghezza: 120, altezza: 80 }), { larghezza: 120, altezza: 80 });
});

test('tutti i formati sono in verticale (larghezza < altezza)', () => {
  for (const [nome, f] of Object.entries(M.FORMATI)) assert.ok(f.larghezza < f.altezza, nome);
});

// ---------------------------------------------------------------- puntini

test('puntini A4, passo 5, margine 10 fisso: 39 x 56 punti, dal margine', () => {
  const f = G.generaFoglio(stato());
  assert.equal(f.errore, null);
  const [p] = elementiDi(f, 'punti');
  assert.equal(f.colonne, 38);
  assert.equal(f.righe, 55);
  assert.equal(p.centri.length, 39 * 56);
  assert.deepEqual(p.centri[0], [10, 10]);
  assert.deepEqual(p.centri[p.centri.length - 1], [200, 285]);
});

test('puntini senza margine: la griglia riempie tutta la pagina', () => {
  const f = G.generaFoglio(stato((s) => { s.margini.senza = true; }));
  const [p] = elementiDi(f, 'punti');
  assert.equal(p.centri.length, 43 * 60);
  assert.deepEqual(p.centri[0], [0, 0]);
  assert.deepEqual(p.centri[p.centri.length - 1], [210, 295]);
});

test('modo "adatta": numero esatto di celle e griglia centrata', () => {
  const f = G.generaFoglio(stato((s) => {
    s.margini.modo = 'adatta';
    s.layout.impostazioni.passoX = 7;
  }));
  const [p] = elementiDi(f, 'punti');
  // area 190 mm, passo 7 -> 27 celle = 189 mm, resto 1 mm diviso ai due lati
  assert.equal(f.colonne, 27);
  assert.ok(vicino(p.centri[0][0], 10.5));
  const ultimaX = p.centri[27][0];
  assert.ok(vicino(ultimaX, 10.5 + 189));
  assert.ok(vicino(f.estensione.x0 - 0, 10.5));
  assert.ok(vicino(210 - f.estensione.x1, 10.5));
});

test('modo "fisso": con resto la griglia parte dal margine in alto a sinistra', () => {
  const f = G.generaFoglio(stato((s) => { s.layout.impostazioni.passoX = 7; }));
  const [p] = elementiDi(f, 'punti');
  assert.equal(p.centri[0][0], 10);
  assert.ok(vicino(f.estensione.x1, 10 + 27 * 7));
});

test('passo verticale uguale all\'orizzontale, oppure indipendente', () => {
  const uguale = G.generaFoglio(stato((s) => { s.layout.impostazioni.passoX = 8; s.layout.impostazioni.passoY = 3; }));
  assert.equal(uguale.righe, Math.floor(277 / 8));
  const diverso = G.generaFoglio(stato((s) => {
    s.layout.impostazioni.passoX = 8;
    s.layout.impostazioni.passoY = 3;
    s.layout.impostazioni.passoUguale = false;
  }));
  assert.equal(diverso.righe, Math.floor(277 / 3));
  assert.equal(diverso.colonne, Math.floor(190 / 8));
});

test('forma, dimensione e grigio dei puntini', () => {
  const f = G.generaFoglio(stato((s) => {
    s.layout.impostazioni.formaPunto = 'quadrato';
    s.layout.impostazioni.dimPunto = 0.8;
    s.layout.impostazioni.intensitaPunti = 100;
  }));
  const [p] = elementiDi(f, 'punti');
  assert.equal(p.forma, 'quadrato');
  assert.equal(p.dimensione, 0.8);
  assert.equal(p.grigio, 0);
  assert.equal(G.livelloGrigio(0), 255);
  assert.equal(G.livelloGrigio(50), 128);
});

// ---------------------------------------------------------------- linee

test('righe orizzontali: ogni riga copre tutta la larghezza utile', () => {
  const f = G.generaFoglio(stato((s) => {
    s.layout.impostazioni.motivo = 'righe-orizzontali';
    s.layout.impostazioni.passoY = 7.1;
  }));
  const [l] = elementiDi(f, 'linee');
  assert.equal(l.segmenti.length, Math.floor(277 / 7.1) + 1);
  for (const s of l.segmenti) {
    assert.equal(s[0], 10);
    assert.equal(s[2], 200);
    assert.equal(s[1], s[3]);
  }
  assert.equal(l.segmenti[0][1], 10);
});

test('righe verticali', () => {
  const f = G.generaFoglio(stato((s) => {
    s.layout.impostazioni.motivo = 'righe-verticali';
    s.layout.impostazioni.passoX = 10;
  }));
  const [l] = elementiDi(f, 'linee');
  assert.equal(l.segmenti.length, 19 + 1);
  for (const s of l.segmenti) {
    assert.equal(s[0], s[2]);
    assert.equal(s[1], 10);
    assert.equal(s[3], 287);
  }
});

test('quadretti: linee verticali e orizzontali che si chiudono sulla griglia', () => {
  const f = G.generaFoglio(stato((s) => { s.layout.impostazioni.motivo = 'quadretti'; }));
  const [l] = elementiDi(f, 'linee');
  assert.equal(l.segmenti.length, 39 + 56);
  const verticali = l.segmenti.filter((s) => s[0] === s[2]);
  const orizzontali = l.segmenti.filter((s) => s[1] === s[3]);
  assert.equal(verticali.length, 39);
  assert.equal(orizzontali.length, 56);
  for (const v of verticali) assert.deepEqual([v[1], v[3]], [10, 285]);
  for (const o of orizzontali) assert.deepEqual([o[0], o[2]], [10, 200]);
});

test('stili di linea: continua, tratteggiata, a puntini', () => {
  assert.deepEqual(G.schemaLinea({ stileLinea: 'continua' }), { dash: [], cap: 'butt' });
  assert.deepEqual(G.schemaLinea({ stileLinea: 'tratteggiata', tratto: 3, spazio: 1.5 }), { dash: [3, 1.5], cap: 'butt' });
  const p = G.schemaLinea({ stileLinea: 'puntini', spazio: 2 });
  assert.equal(p.cap, 'round');
  assert.ok(vicino(p.dash[0] + p.dash[1], 2));
});

test('bianco: nessun elemento', () => {
  const f = G.generaFoglio(stato((s) => { s.layout.impostazioni.motivo = 'bianco'; }));
  assert.equal(f.errore, null);
  assert.equal(f.elementi.length, 0);
  assert.equal(f.margineMinimo, null);
});

// ---------------------------------------------------------------- margini e avvisi

test('margini diversi per lato', () => {
  const f = G.generaFoglio(stato((s) => {
    s.margini.diversi = true;
    s.margini.sinistro = 25;
    s.margini.destro = 5;
    s.margini.alto = 12;
    s.margini.basso = 8;
    s.layout.impostazioni.motivo = 'quadretti';
  }));
  assert.ok(vicino(f.estensione.x0, 25));
  assert.ok(vicino(f.estensione.y0, 12));
  assert.ok(f.estensione.x1 <= 205 + 1e-6);
  assert.ok(f.estensione.y1 <= 289 + 1e-6);
});

test('avviso quando il disegno è vicino al bordo', () => {
  const senza = G.generaFoglio(stato((s) => { s.margini.senza = true; }));
  assert.ok(senza.avvisi.some((a) => /dal bordo/.test(a)));
  const con = G.generaFoglio(stato());
  assert.ok(!con.avvisi.some((a) => /dal bordo/.test(a)));
  const disattivato = G.generaFoglio(stato((s) => { s.margini.senza = true; s.stampa.sogliaAvviso = 0; }));
  assert.ok(!disattivato.avvisi.some((a) => /dal bordo/.test(a)));
});

test('errori: margini troppo grandi e troppi elementi', () => {
  const grandi = G.generaFoglio(stato((s) => { s.margini.tutti = 110; }));
  assert.match(grandi.errore, /margini/i);
  const troppi = G.generaFoglio(stato((s) => {
    s.pagina.formato = 'A3';
    s.margini.senza = true;
    s.layout.impostazioni.passoX = 0.5;
  }));
  assert.match(troppi.errore, /Troppi puntini/);
});

test('passo maggiore dell\'area: una sola colonna, con avviso', () => {
  const f = G.generaFoglio(stato((s) => { s.layout.impostazioni.passoX = 250; s.layout.impostazioni.passoY = 250; }));
  assert.equal(f.errore, null);
  assert.ok(f.avvisi.some((a) => /una sola colonna/.test(a)));
});

// ---------------------------------------------------------------- normalizzazione e nomi

test('normalizza: valori non validi o ostili tornano a valori sicuri', () => {
  const s = M.normalizza({
    pagina: { formato: '<img src=x>', orientamento: 'diagonale', larghezza: -5, altezza: 1e9 },
    margini: { tutti: 'abc', modo: 'boh', senza: 'si' },
    layout: { impostazioni: { motivo: '__proto__', passoX: 0, spessore: 1e6, formaPunto: 'stella', intensitaPunti: 500 } },
    stampa: { sogliaAvviso: -1, nomeFile: 'x'.repeat(500) },
    extra: { __proto__: { inquinato: true } }
  });
  assert.equal(s.pagina.formato, 'A4');
  assert.equal(s.pagina.orientamento, 'verticale');
  assert.equal(s.pagina.larghezza, M.LIMITI.dimPagina.min);
  assert.equal(s.pagina.altezza, M.LIMITI.dimPagina.max);
  assert.equal(s.margini.tutti, 10);
  assert.equal(s.margini.modo, 'fisso');
  assert.equal(s.margini.senza, false);
  assert.equal(s.layout.impostazioni.motivo, 'puntini');
  assert.equal(s.layout.impostazioni.passoX, M.LIMITI.passo.min);
  assert.equal(s.layout.impostazioni.spessore, M.LIMITI.spessore.max);
  assert.equal(s.layout.impostazioni.formaPunto, 'tondo');
  assert.equal(s.layout.impostazioni.intensitaPunti, 100);
  assert.equal(s.stampa.sogliaAvviso, 0);
  assert.equal(s.stampa.nomeFile.length, 80);
  assert.equal({}.inquinato, undefined);
});

test('normalizza: input non oggetto produce lo stato iniziale', () => {
  for (const x of [null, undefined, 5, 'testo', [], true]) {
    assert.deepEqual(M.normalizza(x), M.creaStatoIniziale());
  }
});

test('nome file automatico', () => {
  assert.equal(M.nomeFileAutomatico(stato()), 'foglio-A4-puntini-5mm.pdf');
  assert.equal(
    M.nomeFileAutomatico(stato((s) => {
      s.pagina.formato = 'Half Letter';
      s.pagina.orientamento = 'orizzontale';
      s.layout.impostazioni.motivo = 'righe-orizzontali';
      s.layout.impostazioni.passoY = 7.1;
    })),
    'foglio-Half-Letter-orizzontale-righe-orizzontali-7.1mm.pdf'
  );
  assert.equal(
    M.nomeFileAutomatico(stato((s) => { s.layout.impostazioni.motivo = 'bianco'; })),
    'foglio-A4-bianco.pdf'
  );
});

test('sanificaNomeFile', () => {
  assert.equal(P.sanificaNomeFile('Il mio foglio.pdf'), 'Il-mio-foglio.pdf');
  assert.equal(P.sanificaNomeFile('../../etc/passwd'), 'etc-passwd.pdf');
  assert.equal(P.sanificaNomeFile('<script>alert(1)</script>'), 'script-alert-1-script.pdf');
  assert.equal(P.sanificaNomeFile('àèìòù'), 'aeiou.pdf');
  assert.equal(P.sanificaNomeFile('...'), 'foglio.pdf');
  assert.equal(P.sanificaNomeFile('', 'predefinito'), 'predefinito.pdf');
  assert.equal(P.sanificaNomeFile(null), 'foglio.pdf');
  assert.ok(P.sanificaNomeFile('a'.repeat(300)).length <= 84);
});

// ---------------------------------------------------------------- PDF

function leggiPdf(foglio) {
  const doc = P.creaPdf(jsPDF, foglio, { titolo: 'prova', comprimi: false });
  const testo = doc.output();
  const m = testo.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const pt2mm = (v) => (parseFloat(v) * 25.4) / 72;
  return {
    testo,
    larghezzaMm: pt2mm(m[1]),
    altezzaMm: pt2mm(m[2]),
    pagine: (testo.match(/\/Type\s*\/Page\b/g) || []).length
  };
}

test('PDF: dimensioni della pagina in mm (A4, A3 orizzontale, personalizzato)', () => {
  const casi = [
    [stato(), 210, 297],
    [stato((s) => { s.pagina.formato = 'A3'; s.pagina.orientamento = 'orizzontale'; }), 420, 297],
    [stato((s) => { s.pagina.formato = 'A5'; }), 148, 210],
    [stato((s) => { s.pagina.formato = 'Letter'; }), 215.9, 279.4],
    [stato((s) => { s.pagina.formato = 'personalizzato'; s.pagina.larghezza = 123.4; s.pagina.altezza = 77.7; }), 123.4, 77.7],
    [stato((s) => { s.pagina.formato = 'personalizzato'; s.pagina.larghezza = 100; s.pagina.altezza = 100; }), 100, 100]
  ];
  for (const [s, w, h] of casi) {
    const r = leggiPdf(G.generaFoglio(s));
    assert.ok(vicino(r.larghezzaMm, w, 0.01), 'larghezza ' + r.larghezzaMm + ' invece di ' + w);
    assert.ok(vicino(r.altezzaMm, h, 0.01), 'altezza ' + r.altezzaMm + ' invece di ' + h);
    assert.equal(r.pagine, 1);
  }
});

test('PDF: un riempimento per ogni puntino tondo e per ogni quadrato', () => {
  const tondi = G.generaFoglio(stato());
  const attesiT = elementiDi(tondi, 'punti')[0].centri.length;
  const rt = leggiPdf(tondi);
  assert.equal((rt.testo.match(/\nf\n/g) || []).length, attesiT);

  const quadrati = G.generaFoglio(stato((s) => { s.layout.impostazioni.formaPunto = 'quadrato'; }));
  const attesiQ = elementiDi(quadrati, 'punti')[0].centri.length;
  const rq = leggiPdf(quadrati);
  assert.equal((rq.testo.match(/ re\nf\n/g) || []).length, attesiQ);
});

test('PDF: una linea per ogni segmento, con tratteggio e spessore in punti', () => {
  const f = G.generaFoglio(stato((s) => {
    s.layout.impostazioni.motivo = 'quadretti';
    s.layout.impostazioni.stileLinea = 'tratteggiata';
    s.layout.impostazioni.tratto = 3;
    s.layout.impostazioni.spazio = 1.5;
    s.layout.impostazioni.spessore = 0.4;
  }));
  const attesi = elementiDi(f, 'linee')[0].segmenti.length;
  const r = leggiPdf(f);
  assert.equal((r.testo.match(/ l\nS\n/g) || []).length, attesi);
  assert.match(r.testo, /\[8\.504 4\.252\] 0\.? d/);
  assert.match(r.testo, /1\.134 w/); // 0,4 mm = 1,134 pt
});

test('PDF: pagina bianca valida e preferenza di stampa in scala reale', () => {
  const f = G.generaFoglio(stato((s) => { s.layout.impostazioni.motivo = 'bianco'; }));
  const r = leggiPdf(f);
  assert.match(r.testo, /^%PDF-/);
  assert.match(r.testo, /\/PrintScaling\s*\/None/);
});

test('PDF: scarica senza la libreria segnala un errore chiaro', () => {
  assert.throws(() => P.scarica({ larghezza: 1, altezza: 1, elementi: [] }, 'x.pdf'), /jsPDF non trovata/);
});
