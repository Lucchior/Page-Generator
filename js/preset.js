/*
 * Preset e ultima configurazione.
 * - Formato del file JSON: { formato, versione, nome, impostazioni }.
 * - Archivio nel browser (localStorage) con un oggetto "storage" passato dall'esterno,
 *   così si può provare in Node con un finto storage.
 * Ogni dato che arriva da file o dal browser passa da Fogli.modello.normalizza:
 * non ci si fida mai del contenuto. Nessun accesso al DOM.
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});
  const M = Fogli.modello || (typeof require === 'function' ? require('./modello.js') : null);

  const FORMATO = 'generatore-fogli-preset';
  const VERSIONE = 1;
  const MAX_BYTE_FILE = 1024 * 1024; // un preset vero pesa pochi kB: oltre 1 MB non è un preset
  const MAX_PRESET = 50;
  const MAX_NOME = 60;
  const CHIAVE_PRESET = 'fogli.preset.v1';
  const CHIAVE_ULTIMA = 'fogli.ultima.v1';
  const CHIAVE_TEMA = 'fogli.tema.v1';

  // Nome pulito: niente caratteri di controllo, spazi compattati, lunghezza limitata.
  function sanificaNome(nome) {
    return String(nome == null ? '' : nome)
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NOME);
  }

  // Le impostazioni da salvare: tutto tranne il nome del file PDF (riguarda una singola esportazione).
  function impostazioniDa(stato) {
    const copia = JSON.parse(JSON.stringify(M.normalizza(stato)));
    copia.stampa.nomeFile = '';
    return copia;
  }

  function creaPreset(stato, nome) {
    return { formato: FORMATO, versione: VERSIONE, nome: sanificaNome(nome), impostazioni: impostazioniDa(stato) };
  }

  // Legge il testo di un file preset. Restituisce { stato, nome } oppure { errore }.
  function leggiPreset(testo) {
    if (typeof testo !== 'string' || !testo.trim()) return { errore: 'Il file è vuoto.' };
    if (testo.length > MAX_BYTE_FILE) return { errore: 'Il file è troppo grande per essere un preset.' };
    let dati;
    try {
      dati = JSON.parse(testo);
    } catch (e) {
      return { errore: 'Il file non è un JSON valido.' };
    }
    if (!dati || typeof dati !== 'object' || Array.isArray(dati)) return { errore: 'Il file non contiene un preset.' };
    if (dati.formato !== FORMATO) return { errore: 'Il file non è un preset di questo generatore.' };
    if (typeof dati.versione !== 'number' || dati.versione > VERSIONE) {
      return { errore: 'Il preset è stato creato da una versione più recente del generatore.' };
    }
    if (!dati.impostazioni || typeof dati.impostazioni !== 'object') return { errore: 'Il preset non contiene impostazioni.' };
    const stato = M.normalizza(dati.impostazioni);
    stato.stampa.nomeFile = '';
    return { stato, nome: sanificaNome(dati.nome) };
  }

  // Archivio nel browser. Ogni operazione restituisce { ok:true, ... } oppure { ok:false, errore }.
  function creaArchivio(storage) {
    function leggiGrezzo(chiave) {
      try {
        return storage.getItem(chiave);
      } catch (e) {
        return undefined; // storage non disponibile (navigazione privata, blocco dei dati del sito)
      }
    }
    function scriviGrezzo(chiave, valore) {
      try {
        storage.setItem(chiave, valore);
        return true;
      } catch (e) {
        return false;
      }
    }

    // Elenco di { nome, stato }: ogni voce è riconvalidata, quelle rovinate vengono scartate.
    function leggiElenco() {
      const grezzo = leggiGrezzo(CHIAVE_PRESET);
      if (!grezzo) return [];
      let dati;
      try {
        dati = JSON.parse(grezzo);
      } catch (e) {
        return [];
      }
      if (!Array.isArray(dati)) return [];
      const elenco = [];
      const visti = new Set();
      for (const voce of dati.slice(0, MAX_PRESET)) {
        if (!voce || typeof voce !== 'object') continue;
        const nome = sanificaNome(voce.nome);
        if (!nome || visti.has(nome)) continue;
        visti.add(nome);
        const stato = M.normalizza(voce.impostazioni);
        stato.stampa.nomeFile = '';
        elenco.push({ nome, stato });
      }
      return elenco.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    }

    function scriviElenco(elenco) {
      const dati = elenco.map((v) => ({ nome: v.nome, impostazioni: impostazioniDa(v.stato) }));
      return scriviGrezzo(CHIAVE_PRESET, JSON.stringify(dati));
    }

    return {
      disponibile() {
        return leggiGrezzo(CHIAVE_PRESET) !== undefined;
      },
      elenco() {
        return leggiElenco().map((v) => v.nome);
      },
      esiste(nome) {
        const n = sanificaNome(nome);
        return leggiElenco().some((v) => v.nome === n);
      },
      salva(nome, stato) {
        const n = sanificaNome(nome);
        if (!n) return { ok: false, errore: 'Scrivi un nome per il preset.' };
        const elenco = leggiElenco();
        const indice = elenco.findIndex((v) => v.nome === n);
        const voce = { nome: n, stato: M.normalizza(stato) };
        if (indice >= 0) elenco[indice] = voce;
        else if (elenco.length >= MAX_PRESET) return { ok: false, errore: 'Hai raggiunto il massimo di ' + MAX_PRESET + ' preset: eliminane qualcuno.' };
        else elenco.push(voce);
        if (!scriviElenco(elenco)) return { ok: false, errore: 'Il browser non permette di salvare qui (navigazione privata o spazio esaurito). Usa l’esportazione in file.' };
        return { ok: true, nome: n, sostituito: indice >= 0 };
      },
      carica(nome) {
        const n = sanificaNome(nome);
        const v = leggiElenco().find((x) => x.nome === n);
        return v ? { ok: true, nome: n, stato: v.stato } : { ok: false, errore: 'Preset non trovato.' };
      },
      elimina(nome) {
        const n = sanificaNome(nome);
        const elenco = leggiElenco();
        const resto = elenco.filter((v) => v.nome !== n);
        if (resto.length === elenco.length) return { ok: false, errore: 'Preset non trovato.' };
        if (!scriviElenco(resto)) return { ok: false, errore: 'Il browser non permette di salvare le modifiche.' };
        return { ok: true };
      },
      salvaUltima(stato) {
        return scriviGrezzo(CHIAVE_ULTIMA, JSON.stringify(impostazioniDa(stato)));
      },
      leggiUltima() {
        const grezzo = leggiGrezzo(CHIAVE_ULTIMA);
        if (!grezzo) return null;
        try {
          const stato = M.normalizza(JSON.parse(grezzo));
          stato.stampa.nomeFile = '';
          return stato;
        } catch (e) {
          return null;
        }
      },
      dimenticaUltima() {
        try {
          storage.removeItem(CHIAVE_ULTIMA);
        } catch (e) { /* niente da fare */ }
      }
    };
  }

  Fogli.preset = {
    FORMATO, VERSIONE, MAX_PRESET, MAX_NOME, CHIAVE_PRESET, CHIAVE_ULTIMA, CHIAVE_TEMA,
    sanificaNome, creaPreset, leggiPreset, creaArchivio
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.preset;
})(typeof window !== 'undefined' ? window : globalThis);
