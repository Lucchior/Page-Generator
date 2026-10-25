/*
 * Tema chiaro/scuro: applica subito la scelta salvata (prima del disegno della pagina,
 * per evitare il lampo di colore sbagliato). Valori: "auto" (segue il sistema), "chiaro", "scuro".
 * L'interruttore vero e proprio è in interfaccia.js, che usa Fogli.tema.imposta.
 */
(function (radice) {
  'use strict';

  const CHIAVE = 'fogli.tema.v1';
  const VALORI = { auto: null, chiaro: 'light', scuro: 'dark' };

  function leggi() {
    try {
      const v = radice.localStorage.getItem(CHIAVE);
      return Object.prototype.hasOwnProperty.call(VALORI, v) ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function applica(scelta) {
    const radiceHtml = radice.document.documentElement;
    const valore = Object.prototype.hasOwnProperty.call(VALORI, scelta) ? VALORI[scelta] : null;
    if (valore) radiceHtml.setAttribute('data-theme', valore);
    else radiceHtml.removeAttribute('data-theme');
  }

  function imposta(scelta) {
    if (!Object.prototype.hasOwnProperty.call(VALORI, scelta)) scelta = 'auto';
    applica(scelta);
    try {
      radice.localStorage.setItem(CHIAVE, scelta);
    } catch (e) { /* la scelta vale comunque fino alla chiusura della pagina */ }
  }

  const Fogli = (radice.Fogli = radice.Fogli || {});
  Fogli.tema = { leggi, imposta };
  applica(leggi());
})(window);
