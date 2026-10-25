/*
 * Interfaccia: costruisce i controlli, collega lo stato all'anteprima e al download del PDF.
 * I nodi vengono creati con le API del DOM (niente innerHTML) e ogni valore inserito
 * passa dai limiti del modello.
 */
(function () {
  'use strict';

  const F = window.Fogli;
  if (!F || !F.modello || !F.geometria || !F.anteprima || !F.pdf) {
    document.body.textContent = 'Errore: alcuni file del programma non sono stati caricati. Controlla la cartella js/ e ricarica la pagina.';
    return;
  }
  const M = F.modello;
  const G = F.geometria;
  const A = F.anteprima;
  const P = F.pdf;

  const stato = M.creaStatoIniziale();
  const sezioni = [];
  let contatoreId = 0;
  let ultimo = null;
  let pianificato = false;

  const pannello = document.getElementById('pannello');
  const contenitoreSezioni = document.getElementById('sezioni');
  const foglioEl = document.getElementById('foglio');
  const pianoEl = document.querySelector('.piano');
  const didascaliaEl = document.getElementById('didascalia');
  const avvisiEl = document.getElementById('avvisi');
  const annunciEl = document.getElementById('annunci');
  const scaricaEl = document.getElementById('scarica');

  // ------------------------------------------------------------ utilità

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  }

  const prossimoId = () => 'c' + ++contatoreId;
  const valoreCampo = (v) => String(Math.round(v * 1000) / 1000);
  const testo = (v, stato_) => (typeof v === 'function' ? v(stato_) : v);

  function annuncia(messaggio) {
    annunciEl.textContent = '';
    window.setTimeout(() => { annunciEl.textContent = messaggio; }, 50);
  }

  // I percorsi arrivano solo dai descrittori qui sotto; "zona." indica la zona in modifica.
  function risolvi(percorso) {
    const parti = percorso.split('.');
    let base = stato;
    if (parti[0] === 'zona') {
      base = stato.layout.impostazioni;
      parti.shift();
    }
    while (parti.length > 1) base = base[parti.shift()];
    return [base, parti[0]];
  }
  function leggi(percorso) {
    const [b, k] = risolvi(percorso);
    return b[k];
  }
  function scrivi(percorso, valore) {
    const [b, k] = risolvi(percorso);
    b[k] = valore;
  }

  const motivo = () => stato.layout.impostazioni.motivo;
  const motivoTra = (...elenco) => () => elenco.indexOf(motivo()) !== -1;
  const dueAssi = () => M.MOTIVI_DUE_PASSI.indexOf(motivo()) !== -1;

  // ------------------------------------------------------------ componenti

  // Parti comuni: etichetta, nota d'aiuto, visibilità e abilitazione.
  function base(d, nodo) {
    const nota = el('p', 'nota');
    nota.id = prossimoId();
    nodo.appendChild(nota);
    const c = { d, nodo, nota, sincronizza() {} };
    c.aggiorna = function () {
      const visibile = d.visibile ? d.visibile(stato) : true;
      nodo.hidden = !visibile;
      const abilitato = d.abilitato ? d.abilitato(stato) : true;
      nodo.classList.toggle('disabilitato', !abilitato);
      for (const i of nodo.querySelectorAll('input,select')) i.disabled = !abilitato;
      const t = d.nota ? testo(d.nota, stato) : '';
      nota.textContent = t;
      nota.hidden = !t;
      c.sincronizza();
    };
    return c;
  }

  function descrivi(c, ...campi) {
    for (const i of campi) i.setAttribute('aria-describedby', c.nota.id);
  }

  function creaNumero(d) {
    const id = prossimoId();
    const nodo = el('div', 'campo campo-numero');
    const etichetta = el('label');
    etichetta.htmlFor = id;
    const riga = el('div', 'riga-numero' + (d.soloNumero ? ' solo' : ''));
    nodo.append(etichetta, riga);

    let cursore = null;
    if (!d.soloNumero) {
      cursore = el('input');
      cursore.type = 'range';
      cursore.min = d.minCursore;
      cursore.max = d.maxCursore;
      cursore.step = d.passoCursore || d.passo;
      cursore.id = id + '-cursore';
      riga.appendChild(cursore);
    }
    const valore = el('span', 'valore');
    const num = el('input');
    num.type = 'number';
    num.id = id;
    num.min = d.min;
    num.max = d.max;
    num.step = d.passo;
    num.inputMode = 'decimal';
    num.autocomplete = 'off';
    valore.append(num, el('span', 'unita', d.unita));
    riga.appendChild(valore);

    const c = base(d, nodo);
    descrivi(c, num);

    c.sincronizza = function () {
      const t = testo(d.etichetta, stato);
      etichetta.textContent = t;
      const v = leggi(d.percorso);
      if (document.activeElement !== num) num.value = valoreCampo(v);
      if (cursore) {
        cursore.value = Math.min(d.maxCursore, Math.max(d.minCursore, v));
        cursore.setAttribute('aria-label', t + ', cursore');
        cursore.setAttribute('aria-valuetext', valoreCampo(v) + ' ' + d.unita);
      }
    };

    num.addEventListener('input', () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v) || v < d.min || v > d.max) return; // si corregge quando esci dal campo
      scrivi(d.percorso, v);
      cambiato();
    });
    num.addEventListener('change', () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v)) {
        num.value = valoreCampo(leggi(d.percorso));
        return;
      }
      const limitato = Math.min(d.max, Math.max(d.min, v));
      if (limitato !== v) {
        annuncia('Valore portato a ' + valoreCampo(limitato) + ' ' + d.unita + ': è il ' + (limitato === d.max ? 'massimo' : 'minimo') + ' consentito.');
      }
      scrivi(d.percorso, limitato);
      num.value = valoreCampo(limitato);
      cambiato();
    });
    if (cursore) {
      cursore.addEventListener('input', () => {
        scrivi(d.percorso, parseFloat(cursore.value));
        cambiato();
      });
    }
    return c;
  }

  function creaSelezione(d) {
    const id = prossimoId();
    const nodo = el('div', 'campo');
    const etichetta = el('label', null, d.etichetta);
    etichetta.htmlFor = id;
    const sel = el('select');
    sel.id = id;
    for (const [v, t] of d.opzioni) {
      const o = el('option', null, t);
      o.value = v;
      sel.appendChild(o);
    }
    nodo.append(etichetta, sel);
    const c = base(d, nodo);
    descrivi(c, sel);
    c.sincronizza = function () { sel.value = leggi(d.percorso); };
    sel.addEventListener('change', () => {
      if (d.prima) d.prima(sel.value);
      scrivi(d.percorso, sel.value);
      cambiato();
    });
    return c;
  }

  function creaRadio(d) {
    const id = prossimoId();
    const nodo = el('div', 'campo');
    const etichetta = el('span', d.etichettaNascosta ? 'visivamente-nascosto' : 'etichetta', d.etichetta);
    etichetta.id = id + '-etichetta';
    const gruppo = el('div', 'segmenti' + (d.classe ? ' ' + d.classe : ''));
    gruppo.setAttribute('role', 'radiogroup');
    gruppo.setAttribute('aria-labelledby', etichetta.id);
    const ingressi = [];
    for (const [v, t, mini] of d.opzioni) {
      const lab = el('label');
      const inp = el('input');
      inp.type = 'radio';
      inp.name = id;
      inp.value = v;
      const apparenza = el('span', 'opzione');
      if (mini) {
        const m = el('span', 'mini ' + mini);
        m.setAttribute('aria-hidden', 'true');
        apparenza.appendChild(m);
      }
      apparenza.appendChild(el('span', 'testo', t));
      lab.append(inp, apparenza);
      gruppo.appendChild(lab);
      ingressi.push(inp);
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        scrivi(d.percorso, v);
        cambiato();
      });
    }
    nodo.append(etichetta, gruppo);
    const c = base(d, nodo);
    descrivi(c, ...ingressi);
    c.sincronizza = function () {
      const corrente = leggi(d.percorso);
      for (const i of ingressi) i.checked = i.value === corrente;
    };
    return c;
  }

  function creaCasella(d) {
    const nodo = el('div', 'campo');
    const lab = el('label', 'casella');
    const inp = el('input');
    inp.type = 'checkbox';
    lab.append(inp, el('span', null, ''));
    nodo.appendChild(lab);
    const c = base(d, nodo);
    descrivi(c, inp);
    c.sincronizza = function () {
      lab.lastChild.textContent = testo(d.etichetta, stato);
      inp.checked = !!leggi(d.percorso);
    };
    inp.addEventListener('change', () => {
      scrivi(d.percorso, inp.checked);
      cambiato();
    });
    return c;
  }

  function creaTesto(d) {
    const id = prossimoId();
    const nodo = el('div', 'campo');
    const etichetta = el('label', null, d.etichetta);
    etichetta.htmlFor = id;
    const inp = el('input');
    inp.type = 'text';
    inp.id = id;
    inp.maxLength = d.lunghezzaMax;
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    nodo.append(etichetta, inp);
    const c = base(d, nodo);
    descrivi(c, inp);
    c.campo = inp;
    c.sincronizza = function () {
      if (document.activeElement !== inp) inp.value = leggi(d.percorso);
    };
    inp.addEventListener('input', () => {
      scrivi(d.percorso, inp.value);
    });
    return c;
  }

  function creaNota(d) {
    const nodo = el('p', 'nota nota-fissa', d.testo);
    return { d, nodo, aggiorna() { nodo.hidden = d.visibile ? !d.visibile(stato) : false; } };
  }

  function creaControllo(d) {
    switch (d.tipo) {
      case 'numero': return creaNumero(d);
      case 'selezione': return creaSelezione(d);
      case 'radio': return creaRadio(d);
      case 'casella': return creaCasella(d);
      case 'testo': return creaTesto(d);
      default: return creaNota(d);
    }
  }

  // ------------------------------------------------------------ descrizione dei controlli

  const margine = (percorso, etichetta, visibile) => ({
    tipo: 'numero', percorso, etichetta, unita: 'mm',
    min: M.LIMITI.margine.min, max: M.LIMITI.margine.max, passo: 0.1,
    minCursore: 0, maxCursore: 40, passoCursore: 0.5, visibile
  });
  const conMargini = () => !stato.margini.senza;
  const intensita = (percorso) => ({
    tipo: 'numero', percorso, etichetta: 'Intensità del grigio', unita: '%',
    min: 0, max: 100, passo: 1, minCursore: 0, maxCursore: 100, passoCursore: 1,
    nota: '100% è nero, 0% è bianco.'
  });

  const DESCRITTORI = [
    {
      titolo: 'Foglio',
      campi: [
        {
          tipo: 'selezione', percorso: 'pagina.formato', etichetta: 'Formato',
          opzioni: Object.keys(M.FORMATI)
            .map((n) => [n, n + ' (' + M.formatta(M.FORMATI[n].larghezza) + ' × ' + M.formatta(M.FORMATI[n].altezza) + ' mm)'])
            .concat([['personalizzato', 'Personalizzato']]),
          prima(nuovo) {
            if (nuovo === 'personalizzato' && stato.pagina.formato !== 'personalizzato') {
              const dim = M.dimensioniPagina(stato.pagina);
              stato.pagina.larghezza = dim.larghezza;
              stato.pagina.altezza = dim.altezza;
            }
          }
        },
        {
          tipo: 'radio', percorso: 'pagina.orientamento', etichetta: 'Orientamento',
          opzioni: [['verticale', 'Verticale'], ['orizzontale', 'Orizzontale']],
          abilitato: (s) => s.pagina.formato !== 'personalizzato',
          nota: (s) => (s.pagina.formato === 'personalizzato' ? 'Con una misura personalizzata l’orientamento dipende da larghezza e altezza.' : '')
        },
        { tipo: 'numero', percorso: 'pagina.larghezza', etichetta: 'Larghezza', unita: 'mm', min: M.LIMITI.dimPagina.min, max: M.LIMITI.dimPagina.max, passo: 0.1, soloNumero: true, visibile: (s) => s.pagina.formato === 'personalizzato' },
        { tipo: 'numero', percorso: 'pagina.altezza', etichetta: 'Altezza', unita: 'mm', min: M.LIMITI.dimPagina.min, max: M.LIMITI.dimPagina.max, passo: 0.1, soloNumero: true, visibile: (s) => s.pagina.formato === 'personalizzato' }
      ]
    },
    {
      titolo: 'Motivo',
      campi: [
        {
          tipo: 'radio', percorso: 'zona.motivo', etichetta: 'Motivo del foglio', etichettaNascosta: true, classe: 'motivi',
          opzioni: [
            ['puntini', 'Puntini', 'mini-puntini'],
            ['righe-orizzontali', 'Righe orizzontali', 'mini-righe-o'],
            ['quadretti', 'Quadretti', 'mini-quadretti'],
            ['righe-verticali', 'Righe verticali', 'mini-righe-v'],
            ['bianco', 'Bianco', 'mini-bianco']
          ]
        }
      ]
    },
    {
      titolo: 'Passo',
      visibile: () => motivo() !== 'bianco',
      campi: [
        {
          tipo: 'numero', percorso: 'zona.passoX', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: () => (motivo() === 'righe-verticali' ? 'Distanza tra le righe' : dueAssi() && stato.layout.impostazioni.passoUguale ? 'Passo' : 'Passo orizzontale'),
          visibile: motivoTra('puntini', 'quadretti', 'righe-verticali')
        },
        { tipo: 'casella', percorso: 'zona.passoUguale', etichetta: 'Passo verticale uguale all’orizzontale', visibile: motivoTra('puntini', 'quadretti') },
        {
          tipo: 'numero', percorso: 'zona.passoY', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: () => (motivo() === 'righe-orizzontali' ? 'Distanza tra le righe' : 'Passo verticale'),
          visibile: () => motivo() === 'righe-orizzontali' || (dueAssi() && !stato.layout.impostazioni.passoUguale)
        }
      ]
    },
    {
      titolo: 'Margini',
      campi: [
        { tipo: 'casella', percorso: 'margini.senza', etichetta: 'Senza margine: la griglia riempie tutta la pagina' },
        { tipo: 'casella', percorso: 'margini.diversi', etichetta: 'Margini diversi per ogni lato', visibile: conMargini },
        margine('margini.tutti', 'Margine', () => conMargini() && !stato.margini.diversi),
        margine('margini.alto', 'Margine in alto', () => conMargini() && stato.margini.diversi),
        margine('margini.basso', 'Margine in basso', () => conMargini() && stato.margini.diversi),
        margine('margini.sinistro', 'Margine a sinistra', () => conMargini() && stato.margini.diversi),
        margine('margini.destro', 'Margine a destra', () => conMargini() && stato.margini.diversi),
        {
          tipo: 'radio', percorso: 'margini.modo', etichetta: 'Posizione della griglia',
          opzioni: [['fisso', 'Fissa'], ['adatta', 'Adattata al passo']],
          visibile: () => motivo() !== 'bianco',
          nota: (s) => (s.margini.modo === 'fisso'
            ? 'La griglia parte dall’angolo in alto a sinistra dell’area utile; l’eventuale resto rimane a destra e in basso.'
            : 'Entra un numero esatto di celle e la griglia è centrata: il resto si divide tra i due lati.')
        }
      ]
    },
    {
      titolo: 'Linee',
      visibile: motivoTra('righe-orizzontali', 'quadretti', 'righe-verticali'),
      campi: [
        { tipo: 'numero', percorso: 'zona.spessore', etichetta: 'Spessore', unita: 'mm', min: M.LIMITI.spessore.min, max: M.LIMITI.spessore.max, passo: 0.01, minCursore: 0.05, maxCursore: 1, passoCursore: 0.01 },
        intensita('zona.intensitaLinee'),
        { tipo: 'selezione', percorso: 'zona.stileLinea', etichetta: 'Stile', opzioni: [['continua', 'Continua'], ['tratteggiata', 'Tratteggiata'], ['puntini', 'A puntini']] },
        { tipo: 'numero', percorso: 'zona.tratto', etichetta: 'Lunghezza del tratto', unita: 'mm', min: M.LIMITI.tratto.min, max: M.LIMITI.tratto.max, passo: 0.1, minCursore: 0.5, maxCursore: 10, passoCursore: 0.1, visibile: () => stato.layout.impostazioni.stileLinea === 'tratteggiata' },
        {
          tipo: 'numero', percorso: 'zona.spazio', unita: 'mm', min: M.LIMITI.spazio.min, max: M.LIMITI.spazio.max, passo: 0.1, minCursore: 0.2, maxCursore: 10, passoCursore: 0.1,
          etichetta: () => (stato.layout.impostazioni.stileLinea === 'puntini' ? 'Distanza tra i puntini' : 'Spazio tra i tratti'),
          visibile: () => stato.layout.impostazioni.stileLinea !== 'continua'
        }
      ]
    },
    {
      titolo: 'Puntini',
      visibile: motivoTra('puntini'),
      campi: [
        { tipo: 'radio', percorso: 'zona.formaPunto', etichetta: 'Forma', opzioni: [['tondo', 'Tondi'], ['quadrato', 'Quadrati']] },
        { tipo: 'numero', percorso: 'zona.dimPunto', etichetta: 'Dimensione', unita: 'mm', min: M.LIMITI.dimPunto.min, max: M.LIMITI.dimPunto.max, passo: 0.05, minCursore: 0.2, maxCursore: 2, passoCursore: 0.05 },
        intensita('zona.intensitaPunti')
      ]
    },
    {
      titolo: 'Stampa',
      campi: [
        { tipo: 'testo', percorso: 'stampa.nomeFile', etichetta: 'Nome del file', lunghezzaMax: 80, nota: 'Se lo lasci vuoto viene scelto in automatico.', id: 'nome-file' },
        { tipo: 'numero', percorso: 'stampa.sogliaAvviso', etichetta: 'Avvisa se il disegno è più vicino al bordo di', unita: 'mm', min: M.LIMITI.soglia.min, max: M.LIMITI.soglia.max, passo: 0.1, minCursore: 0, maxCursore: 15, passoCursore: 0.5, nota: 'Molte stampanti non stampano vicino al bordo. Metti 0 per non ricevere l’avviso.' },
        { tipo: 'nota', testo: 'Stampa il PDF al 100% (scala reale) e disattiva «Adatta alla pagina»: solo così le misure restano esatte.' }
      ]
    }
  ];

  let campoNome = null;
  for (const dSez of DESCRITTORI) {
    const nodo = el('fieldset', 'sezione');
    nodo.appendChild(el('legend', null, dSez.titolo));
    const controlli = [];
    for (const dc of dSez.campi) {
      const c = creaControllo(dc);
      if (dc.id === 'nome-file') campoNome = c.campo;
      nodo.appendChild(c.nodo);
      controlli.push(c);
    }
    contenitoreSezioni.appendChild(nodo);
    sezioni.push({ d: dSez, nodo, controlli });
  }

  // ------------------------------------------------------------ aggiornamento

  function aggiornaControlli() {
    for (const s of sezioni) {
      s.nodo.hidden = s.d.visibile ? !s.d.visibile(stato) : false;
      for (const c of s.controlli) c.aggiorna();
    }
  }

  function cambiato() {
    aggiornaControlli();
    pianificaRigenerazione();
  }

  function pianificaRigenerazione() {
    if (pianificato) return;
    pianificato = true;
    window.requestAnimationFrame(() => {
      pianificato = false;
      rigenera();
    });
  }

  function nomeFormato() {
    if (stato.pagina.formato === 'personalizzato') return 'Misura personalizzata';
    return stato.pagina.formato + ' ' + stato.pagina.orientamento;
  }

  function descrizioneMotivo(foglio) {
    const c = foglio.colonne;
    const r = foglio.righe;
    switch (motivo()) {
      case 'puntini': return c == null ? 'Puntini.' : (c + 1) + ' × ' + (r + 1) + ' puntini.';
      case 'quadretti': return c == null ? 'Quadretti.' : c + ' × ' + r + ' quadretti.';
      case 'righe-orizzontali': return r == null ? 'Righe orizzontali.' : (r + 1) + ' righe orizzontali.';
      case 'righe-verticali': return c == null ? 'Righe verticali.' : (c + 1) + ' righe verticali.';
      default: return 'Foglio bianco.';
    }
  }

  function aggiungiAvviso(messaggio, tipo) {
    avvisiEl.appendChild(el('p', 'avviso ' + tipo, messaggio));
  }

  function rigenera() {
    const foglio = G.generaFoglio(stato);
    ultimo = foglio;
    avvisiEl.replaceChildren();
    campoNome.placeholder = M.nomeFileAutomatico(stato);

    if (foglio.errore) {
      foglioEl.classList.add('obsoleto');
      scaricaEl.disabled = true;
      aggiungiAvviso(foglio.errore, 'errore');
      return;
    }
    foglioEl.classList.remove('obsoleto');
    scaricaEl.disabled = false;

    A.mostra(foglioEl, foglio);
    A.adatta(pianoEl, foglioEl, foglio);
    foglioEl.setAttribute('aria-label', 'Anteprima del foglio: ' + nomeFormato() + ', ' + descrizioneMotivo(foglio));

    let didascalia = nomeFormato() + ', ' + M.formattaIt(foglio.larghezza) + ' × ' + M.formattaIt(foglio.altezza) + ' mm. ' + descrizioneMotivo(foglio);
    if (foglio.margineMinimo) didascalia += ' Distanza minima dal bordo: ' + M.formattaIt(foglio.margineMinimo.mm) + ' mm.';
    didascaliaEl.textContent = didascalia;
    for (const a of foglio.avvisi) aggiungiAvviso(a, 'attenzione');
  }

  // ------------------------------------------------------------ azioni

  scaricaEl.addEventListener('click', () => {
    if (!ultimo || ultimo.errore) return;
    const automatico = M.nomeFileAutomatico(stato).replace(/\.pdf$/, '');
    const nome = P.sanificaNomeFile(stato.stampa.nomeFile, automatico);
    try {
      P.scarica(ultimo, nome);
      annuncia('PDF creato: ' + nome + '.');
    } catch (errore) {
      aggiungiAvviso('Non è stato possibile creare il PDF: ' + errore.message, 'errore');
      annuncia('Errore: il PDF non è stato creato.');
    }
  });

  pannello.addEventListener('submit', (e) => e.preventDefault());

  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(() => {
      if (ultimo && !ultimo.errore) A.adatta(pianoEl, foglioEl, ultimo);
    }).observe(pianoEl);
  } else {
    window.addEventListener('resize', () => {
      if (ultimo && !ultimo.errore) A.adatta(pianoEl, foglioEl, ultimo);
    });
  }

  aggiornaControlli();
  rigenera();
})();
