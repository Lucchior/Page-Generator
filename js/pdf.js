/*
 * Esportazione PDF con jsPDF (vendor/jspdf.umd.min.js).
 * Il PDF è vettoriale e ha esattamente le dimensioni del foglio, in millimetri.
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});

  // Rende sicuro il nome del file: solo lettere, numeri, punto, trattino trattino basso.
  function sanificaNomeFile(nome, predefinito) {
    let n = String(nome == null ? '' : nome).trim().replace(/\.pdf$/i, '');
    n = n
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80)
      .replace(/[-.]+$/g, '');
    if (!n) n = predefinito || 'foglio';
    return n + '.pdf';
  }

  // Crea il documento jsPDF a partire dal risultato di Fogli.geometria.generaFoglio.
  function creaPdf(JsPDF, foglio, opzioni) {
    const o = opzioni || {};
    const w = foglio.larghezza;
    const h = foglio.altezza;
    const doc = new JsPDF({
      orientation: w > h ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [w, h],
      compress: o.comprimi !== false,
      floatPrecision: 3
    });

    doc.setProperties({
      title: o.titolo || 'Foglio',
      subject: 'Foglio da stampare in scala reale',
      creator: 'Generatore di fogli'
    });
    // Chiede ai programmi di stampa di non ridimensionare la pagina (dove supportato).
    if (typeof doc.viewerPreferences === 'function') doc.viewerPreferences({ PrintScaling: 'None' });

    for (const el of foglio.elementi) {
      if (el.tipo === 'linee') {
        doc.setLineWidth(el.spessore);
        doc.setDrawColor(el.grigio);
        doc.setLineCap(el.cap);
        doc.setLineDash(el.dash, 0);
        for (const s of el.segmenti) doc.line(s[0], s[1], s[2], s[3]);
        doc.setLineDash([], 0);
      } else if (el.tipo === 'punti') {
        doc.setFillColor(el.grigio);
        if (el.forma === 'quadrato') {
          const lato = el.dimensione;
          for (const c of el.centri) doc.rect(c[0] - lato / 2, c[1] - lato / 2, lato, lato, 'F');
        } else {
          const r = el.dimensione / 2;
          for (const c of el.centri) doc.circle(c[0], c[1], r, 'F');
        }
      }
    }
    return doc;
  }

  function scarica(foglio, nomeFile) {
    const JsPDF = radice.jspdf && radice.jspdf.jsPDF;
    if (!JsPDF) {
      throw new Error('Libreria jsPDF non trovata: controlla che il file vendor/jspdf.umd.min.js sia presente.');
    }
    const doc = creaPdf(JsPDF, foglio, { titolo: nomeFile.replace(/\.pdf$/i, '') });
    doc.save(nomeFile);
  }

  Fogli.pdf = { sanificaNomeFile, creaPdf, scarica };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.pdf;
})(typeof window !== 'undefined' ? window : globalThis);
