/*
 * Immagini della prima e dell'ultima pagina (Fase 6): solo PNG, lette nel browser (nessun invio in rete).
 * - leggiIntestazionePng: controlli sul contenuto del file, senza DOM (si prova anche in Node).
 * - carica / preparaPerPdf: usano il DOM (Image e canvas).
 * Le immagini non entrano nello stato, nei preset né nell'ultima configurazione: pesano troppo per il browser.
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});

  const MAX_BYTE = 30 * 1024 * 1024; // 30 MB
  const MAX_PIXEL = 60 * 1000 * 1000; // 60 megapixel
  const LATO_ANTEPRIMA = 1800; // l'anteprima usa una copia ridotta, il PDF l'originale
  const FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // Controlla firma PNG e blocco IHDR, legge larghezza e altezza. Restituisce { w, h } oppure { errore }.
  function leggiIntestazionePng(byte) {
    if (!byte || byte.length < 33) return { errore: 'Il file non è un PNG valido.' };
    for (let i = 0; i < FIRMA.length; i++) if (byte[i] !== FIRMA[i]) return { errore: 'Il file non è un PNG valido.' };
    const tipo = String.fromCharCode(byte[12], byte[13], byte[14], byte[15]);
    const lunghezza = ((byte[8] << 24) | (byte[9] << 16) | (byte[10] << 8) | byte[11]) >>> 0;
    if (tipo !== 'IHDR' || lunghezza !== 13) return { errore: 'Il file non è un PNG valido.' };
    const w = ((byte[16] << 24) | (byte[17] << 16) | (byte[18] << 8) | byte[19]) >>> 0;
    const h = ((byte[20] << 24) | (byte[21] << 16) | (byte[22] << 8) | byte[23]) >>> 0;
    if (!w || !h) return { errore: 'Il PNG ha dimensioni non valide.' };
    if (w * h > MAX_PIXEL) {
      return { errore: 'Immagine troppo grande (' + w + ' × ' + h + ' px): il massimo è 60 megapixel.' };
    }
    return { w, h };
  }

  function leggiByte(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((ok, no) => {
      const l = new FileReader();
      l.onload = () => ok(new Uint8Array(l.result));
      l.onerror = () => no(new Error('lettura non riuscita'));
      l.readAsArrayBuffer(file);
    });
  }

  function creaImmagine(url) {
    return new Promise((ok, no) => {
      const img = new radice.Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('decodifica non riuscita'));
      img.src = url;
    });
  }

  // Legge un file scelto dall'utente. Restituisce una promessa con { nome, w, h, sorgente, anteprima }
  // oppure rifiutata con un Error il cui messaggio è già in italiano.
  async function carica(file) {
    if (!file) throw new Error('Nessun file scelto.');
    if (file.size > MAX_BYTE) throw new Error('Il file è troppo grande: il massimo è 30 MB.');
    if (!/\.png$/i.test(file.name || '')) throw new Error('Scegli un file PNG (estensione .png).');
    let byte;
    try {
      byte = await leggiByte(file);
    } catch (e) {
      throw new Error('Non è stato possibile leggere il file.');
    }
    const info = leggiIntestazionePng(byte);
    if (info.errore) throw new Error(info.errore);

    const urlOriginale = radice.URL.createObjectURL(new Blob([byte], { type: 'image/png' }));
    let sorgente;
    try {
      sorgente = await creaImmagine(urlOriginale);
    } catch (e) {
      throw new Error('Il PNG è danneggiato o non si riesce a leggere.');
    } finally {
      radice.URL.revokeObjectURL(urlOriginale);
    }
    // Copia ridotta per l'anteprima (il PDF userà sempre l'originale).
    const scala = Math.min(1, LATO_ANTEPRIMA / Math.max(info.w, info.h));
    const c = radice.document.createElement('canvas');
    c.width = Math.max(1, Math.round(info.w * scala));
    c.height = Math.max(1, Math.round(info.h * scala));
    c.getContext('2d').drawImage(sorgente, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('Non è stato possibile preparare l’anteprima.');
    return {
      nome: String(file.name).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 80),
      w: info.w,
      h: info.h,
      sorgente,
      anteprima: radice.URL.createObjectURL(blob)
    };
  }

  function libera(immagine) {
    if (immagine && immagine.anteprima) radice.URL.revokeObjectURL(immagine.anteprima);
  }

  // "caricate": immagini già lette, per id di zona. Copia del foglio in cui ogni immagine ha il PNG già ritagliato (Riempi) e ruotato (180°) alla risoluzione piena.
  function preparaPerPdf(foglio, caricate) {
    const elementi = foglio.elementi.map((el) => {
      if (el.tipo !== 'immagine') return el;
      const src = caricate[el.zona];
      if (!src) return Object.assign({}, el, { dati: null });
      const r = el.ritaglio;
      const sx = Math.round(src.w * r.x);
      const sy = Math.round(src.h * r.y);
      const sw = Math.max(1, Math.min(src.w - sx, Math.round(src.w * r.w)));
      const sh = Math.max(1, Math.min(src.h - sy, Math.round(src.h * r.h)));
      const c = radice.document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      if (el.ruota) {
        g.translate(sw, sh);
        g.rotate(Math.PI);
      }
      g.drawImage(src.sorgente, sx, sy, sw, sh, 0, 0, sw, sh);
      return Object.assign({}, el, { dati: c.toDataURL('image/png') });
    });
    return Object.assign({}, foglio, { elementi });
  }

  Fogli.immagini = { MAX_BYTE, MAX_PIXEL, leggiIntestazionePng, carica, libera, preparaPerPdf };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.immagini;
})(typeof window !== 'undefined' ? window : globalThis);
