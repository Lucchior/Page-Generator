/*
 * Layout: operazioni sull'albero delle zone (elenco, ricerca, divisione, unione).
 * Il foglio è un albero: ogni nodo è una "zona" (con le impostazioni del motivo)
 * oppure una "divisione" (con una linea e due parti, a e b).
 * Nessun accesso al DOM: funziona anche in Node (per i test).
 */
(function (radice) {
  'use strict';

  const Fogli = (radice.Fogli = radice.Fogli || {});
  const M = Fogli.modello || (typeof require === 'function' ? require('./modello.js') : null);

  // Elenco di tutti i nodi in ordine di lettura (una divisione precede le sue parti).
  // Le zone sono numerate nell'ordine in cui compaiono (a prima di b), le divisioni a parte.
  function elencaNodi(nodo) {
    const elenco = [];
    const contatori = { zona: 0, divisione: 0 };
    (function visita(n, profondita) {
      if (n.tipo === 'divisione') {
        const numero = ++contatori.divisione;
        elenco.push({ nodo: n, id: n.id, tipo: 'divisione', numero, profondita, etichetta: 'Divisione ' + numero });
        visita(n.a, profondita + 1);
        visita(n.b, profondita + 1);
      } else {
        const numero = ++contatori.zona;
        elenco.push({ nodo: n, id: n.id, tipo: 'zona', numero, profondita, etichetta: 'Zona ' + numero });
      }
    })(nodo, 0);
    return elenco;
  }

  function foglie(nodo) {
    return elencaNodi(nodo)
      .filter((v) => v.tipo === 'zona')
      .map((v) => v.nodo);
  }

  function primaFoglia(nodo) {
    return nodo.tipo === 'divisione' ? primaFoglia(nodo.a) : nodo;
  }

  function trovaNodo(nodo, id) {
    if (nodo.id === id) return nodo;
    if (nodo.tipo !== 'divisione') return null;
    return trovaNodo(nodo.a, id) || trovaNodo(nodo.b, id);
  }

  // Divisione che contiene il nodo, oppure null per la radice.
  function trovaGenitore(nodo, id) {
    if (nodo.tipo !== 'divisione') return null;
    if (nodo.a.id === id || nodo.b.id === id) return nodo;
    return trovaGenitore(nodo.a, id) || trovaGenitore(nodo.b, id);
  }

  function nuovoId(nodo, prefisso) {
    let massimo = 0;
    for (const v of elencaNodi(nodo)) {
      if (v.id.charAt(0) === prefisso) massimo = Math.max(massimo, parseInt(v.id.slice(1), 10) || 0);
    }
    return prefisso + (massimo + 1);
  }

  // Mette "nuovo" al posto del nodo con l'id indicato.
  function sostituisci(stato, id, nuovo) {
    if (stato.layout.id === id) {
      stato.layout = nuovo;
      return true;
    }
    const genitore = trovaGenitore(stato.layout, id);
    if (!genitore) return false;
    if (genitore.a.id === id) genitore.a = nuovo;
    else genitore.b = nuovo;
    return true;
  }

  // Divide una zona in due: la prima parte è la zona originale, la seconda è una copia
  // con le stesse impostazioni, così il foglio non cambia aspetto finché non lo modifichi.
  // "posizione" (facoltativa): {valore, unita} della nuova linea; senza, la linea parte al 50%.
  function dividiZona(stato, idZona, direzione, posizione) {
    const zona = trovaNodo(stato.layout, idZona);
    if (!zona || zona.tipo !== 'zona') return null;
    const copia = {
      tipo: 'zona',
      id: nuovoId(stato.layout, 'z'),
      impostazioni: Object.assign({}, zona.impostazioni)
    };
    const divisione = Object.assign(
      { tipo: 'divisione', id: nuovoId(stato.layout, 'd') },
      M.divisionePredefinita(direzione),
      { a: zona, b: copia }
    );
    if (posizione && Number.isFinite(posizione.valore) && (posizione.unita === 'mm' || posizione.unita === '%')) {
      divisione.posizione = { valore: posizione.valore, unita: posizione.unita };
    }
    sostituisci(stato, idZona, divisione);
    return { divisione, zonaNuova: copia };
  }

  // Toglie una divisione: resta una sola zona, con le impostazioni della prima zona
  // della parte a. Le altre zone di quella divisione vengono eliminate.
  function unisciDivisione(stato, idDivisione) {
    const divisione = trovaNodo(stato.layout, idDivisione);
    if (!divisione || divisione.tipo !== 'divisione') return null;
    const zona = primaFoglia(divisione.a);
    sostituisci(stato, idDivisione, zona);
    return zona;
  }

  Fogli.layout = {
    elencaNodi,
    foglie,
    primaFoglia,
    trovaNodo,
    trovaGenitore,
    nuovoId,
    dividiZona,
    unisciDivisione
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fogli.layout;
})(typeof window !== 'undefined' ? window : globalThis);
