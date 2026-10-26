/*
 * Interfaccia: costruisce i controlli, collega lo stato all'anteprima e al download del PDF.
 * I nodi vengono creati con le API del DOM (niente innerHTML) e ogni valore inserito
 * passa dai limiti del modello.
 */
(function () {
  'use strict';

  const F = window.Fogli;
  if (!F || !F.modello || !F.layout || !F.geometria || !F.anteprima || !F.pdf || !F.preset) {
    document.body.textContent = 'Errore: alcuni file del programma non sono stati caricati. Controlla la cartella js/ e ricarica la pagina.';
    return;
  }
  const M = F.modello;
  const L = F.layout;
  const G = F.geometria;
  const A = F.anteprima;
  const P = F.pdf;
  const PR = F.preset;

  const stato = M.creaStatoIniziale();
  const sezioni = [];
  let contatoreId = 0;
  let ultimo = null;
  let pianificato = false;
  // Selezione corrente: una zona (le cui impostazioni sono in modifica) o una divisione.
  let selezione = { tipo: 'zona', id: 'z1' };
  let ultimaZonaId = 'z1';
  // Modalità «Dividi con il clic»: il clic sull'anteprima divide una zona o toglie una linea.
  let modoDividi = false;
  let direzioneClic = 'verticale';

  // Archivio nel browser: se localStorage non è accessibile le operazioni falliscono con un messaggio.
  let memoria = null;
  try { memoria = window.localStorage; } catch (e) { memoria = null; }
  const archivio = PR.creaArchivio(memoria || {});
  let timerSalvataggio = 0;

  const pannello = document.getElementById('pannello');
  const contenitoreSezioni = document.getElementById('sezioni');
  const foglioEl = document.getElementById('foglio');
  const pianoEl = document.querySelector('.piano');
  const didascaliaEl = document.getElementById('didascalia');
  const avvisiEl = document.getElementById('avvisi');
  const annunciEl = document.getElementById('annunci');
  const scaricaEl = document.getElementById('scarica');
  const strumentiEl = document.getElementById('strumenti');
  const temaEl = document.getElementById('tema');
  const nuovoEl = document.getElementById('nuovo');

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
  const val = (v) => testo(v, stato);

  function annuncia(messaggio) {
    annunciEl.textContent = '';
    window.setTimeout(() => { annunciEl.textContent = messaggio; }, 50);
  }

  // Zona in modifica: quella selezionata, oppure l'ultima scelta se è selezionata una divisione.
  function zonaCorrente() {
    const id = selezione.tipo === 'zona' ? selezione.id : ultimaZonaId;
    const n = L.trovaNodo(stato.layout, id);
    return n && n.tipo === 'zona' ? n : L.primaFoglia(stato.layout);
  }
  function divisioneCorrente() {
    const n = selezione.tipo === 'divisione' ? L.trovaNodo(stato.layout, selezione.id) : null;
    return n && n.tipo === 'divisione' ? n : null;
  }
  const impostazioni = () => zonaCorrente().impostazioni;
  const piuZone = () => M.contaZone(stato.layout) > 1;
  const suffissoZona = () => {
    if (!piuZone()) return '';
    const v = L.elencaNodi(stato.layout).find((x) => x.id === zonaCorrente().id);
    return ' — ' + (v ? v.etichetta : '');
  };

  // I percorsi arrivano solo dai descrittori qui sotto; "zona." indica la zona in modifica,
  // "divisione." la divisione selezionata.
  function risolvi(percorso) {
    const parti = percorso.split('.');
    let base = stato;
    if (parti[0] === 'zona') {
      base = zonaCorrente().impostazioni;
      parti.shift();
    } else if (parti[0] === 'divisione') {
      base = divisioneCorrente();
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

  const motivo = () => impostazioni().motivo;
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
      cursore.step = d.passoCursore || d.passo;
      cursore.id = id + '-cursore';
      riga.appendChild(cursore);
    }
    const valore = el('span', 'valore');
    const num = el('input');
    num.type = 'number';
    num.id = id;
    num.step = d.passo;
    num.inputMode = 'decimal';
    num.autocomplete = 'off';
    const unitaEl = el('span', 'unita');
    valore.append(num, unitaEl);
    // Limiti e unità possono dipendere dallo stato (posizione di una divisione in mm o %).
    const lim = () => ({
      min: val(d.min), max: val(d.max), minC: val(d.minCursore), maxC: val(d.maxCursore), unita: val(d.unita)
    });
    riga.appendChild(valore);

    const c = base(d, nodo);
    descrivi(c, num);

    c.sincronizza = function () {
      const t = testo(d.etichetta, stato);
      const l = lim();
      etichetta.textContent = t;
      unitaEl.textContent = l.unita;
      num.min = l.min;
      num.max = l.max;
      const v = leggi(d.percorso);
      if (document.activeElement !== num) num.value = valoreCampo(v);
      if (cursore) {
        cursore.min = l.minC;
        cursore.max = l.maxC;
        cursore.value = Math.min(l.maxC, Math.max(l.minC, v));
        cursore.setAttribute('aria-label', t + ', cursore');
        cursore.setAttribute('aria-valuetext', valoreCampo(v) + ' ' + l.unita);
      }
    };

    num.addEventListener('input', () => {
      const v = num.valueAsNumber;
      const l = lim();
      if (!Number.isFinite(v) || v < l.min || v > l.max) return; // si corregge quando esci dal campo
      scrivi(d.percorso, v);
      cambiato();
    });
    num.addEventListener('change', () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v)) {
        num.value = valoreCampo(leggi(d.percorso));
        return;
      }
      const l = lim();
      const limitato = Math.min(l.max, Math.max(l.min, v));
      if (limitato !== v) {
        annuncia('Valore portato a ' + valoreCampo(limitato) + ' ' + l.unita + ': è il ' + (limitato === l.max ? 'massimo' : 'minimo') + ' consentito.');
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
        if (d.prima) d.prima(v);
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

  const NOMI_MOTIVI = {
    'puntini': 'Puntini', 'righe-orizzontali': 'Righe orizzontali', 'quadretti': 'Quadretti',
    'righe-verticali': 'Righe verticali', 'bianco': 'Bianco'
  };

  // Elenco di zone e divisioni, scelta singola: serve a selezionare anche da tastiera.
  // Si ricostruisce solo quando cambia la struttura, così il focus non si perde.
  function creaStruttura(d) {
    const id = prossimoId();
    const nodo = el('div', 'campo');
    const etichetta = el('span', 'etichetta', 'Zone e divisioni');
    etichetta.id = id + '-etichetta';
    const gruppo = el('div', 'struttura');
    gruppo.setAttribute('role', 'group');
    gruppo.setAttribute('aria-labelledby', etichetta.id);
    nodo.append(etichetta, gruppo);
    let firma = '';
    let voci = [];

    const c = base(d, nodo);
    c.sincronizza = function () {
      const elenco = L.elencaNodi(stato.layout);
      const nuova = elenco.map((v) => v.id).join(',');
      if (nuova !== firma) {
        const aveva = gruppo.contains(document.activeElement);
        firma = nuova;
        gruppo.replaceChildren();
        voci = elenco.map((v) => {
          const voceEl = el('div', 'voce ' + v.tipo);
          voceEl.style.setProperty('--livello', String(Math.min(v.profondita, 6)));
          const lab = el('label', 'voce-selezione');
          const inp = el('input');
          inp.type = 'radio';
          inp.name = id;
          inp.value = v.id;
          const corpo = el('span', 'voce-corpo');
          const titolo = el('span', 'voce-titolo', v.etichetta);
          const dettaglio = el('span', 'voce-dettaglio');
          corpo.append(titolo, dettaglio);
          lab.append(inp, corpo);
          voceEl.appendChild(lab);
          inp.addEventListener('change', () => {
            if (inp.checked) cambiaSelezione({ tipo: v.tipo, id: v.id });
          });
          // La X in alto a destra toglie la zona (non esiste per le divisioni né per l'unica zona).
          let chiudi = null;
          if (v.tipo === 'zona' && elenco.length > 1) {
            chiudi = el('button', 'voce-chiudi', '×');
            chiudi.type = 'button';
            chiudi.setAttribute('aria-label', 'Elimina ' + v.etichetta);
            chiudi.title = 'Elimina ' + v.etichetta + ' (la zona accanto prende il suo posto)';
            chiudi.addEventListener('click', () => eliminaZona(v.id));
            voceEl.appendChild(chiudi);
          }
          gruppo.appendChild(voceEl);
          return { id: v.id, inp, dettaglio, titolo, chiudi, etichettaNodo: v.etichetta };
        });
        if (aveva) {
          const scelto = voci.find((x) => x.id === selezione.id);
          if (scelto) scelto.inp.focus();
        }
      }
      for (const v of elenco) {
        const voce = voci.find((x) => x.id === v.id);
        voce.titolo.textContent = v.etichetta;
        if (voce.chiudi && voce.etichettaNodo !== v.etichetta) {
          voce.etichettaNodo = v.etichetta;
          voce.chiudi.setAttribute('aria-label', 'Elimina ' + v.etichetta);
          voce.chiudi.title = 'Elimina ' + v.etichetta + ' (la zona accanto prende il suo posto)';
        }
        voce.inp.checked = v.id === selezione.id;
        voce.inp.disabled = false;
      }
    };
    // Dettagli (misure, motivo): dipendono dal foglio calcolato.
    c.dettagli = function (foglio) {
      for (const voce of voci) {
        const nodoLayout = L.trovaNodo(stato.layout, voce.id);
        if (!nodoLayout) continue;
        let testoDettaglio = '';
        if (nodoLayout.tipo === 'zona') {
          const z = foglio.zone.find((x) => x.id === voce.id);
          testoDettaglio = (z ? M.formattaIt(z.rettangolo.w) + ' × ' + M.formattaIt(z.rettangolo.h) + ' mm · ' : '') +
            (NOMI_MOTIVI[nodoLayout.impostazioni.motivo] || '');
        } else {
          const dv = foglio.divisioni.find((x) => x.id === voce.id);
          testoDettaglio = 'Linea ' + nodoLayout.direzione + (dv ? ' a ' + M.formattaIt(dv.posizioneMm) + ' mm' : '');
        }
        voce.dettaglio.textContent = testoDettaglio;
      }
    };
    return c;
  }

  function creaPulsante(d) {
    const nodo = el('div', 'campo');
    const b = el('button', 'pulsante secondario');
    b.type = 'button';
    nodo.appendChild(b);
    const c = base(d, nodo);
    descrivi(c, b);
    c.sincronizza = function () { b.textContent = testo(d.etichetta, stato); };
    b.addEventListener('click', () => d.azione());
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
      case 'struttura': return creaStruttura(d);
      case 'pulsante': return creaPulsante(d);
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

  function etichettaNodo(id) {
    const v = L.elencaNodi(stato.layout).find((x) => x.id === id);
    return v ? v.etichetta : '';
  }

  function lunghezzaDivisione() {
    const dv = ultimo && ultimo.divisioni ? ultimo.divisioni.find((x) => x.id === selezione.id) : null;
    return dv ? Math.min(M.LIMITI.posizioneMm.max, Math.round(dv.lunghezza * 100) / 100) : M.LIMITI.posizioneMm.max;
  }

  // Cambiando unità la linea resta dov'è: il valore viene convertito.
  function convertiPosizione(nuova) {
    const div = divisioneCorrente();
    if (!div || div.posizione.unita === nuova) return;
    const dv = ultimo && ultimo.divisioni ? ultimo.divisioni.find((x) => x.id === div.id) : null;
    if (!dv || !(dv.lunghezza > 0)) return;
    const v = div.posizione.valore;
    const convertito = nuova === 'mm' ? (dv.lunghezza * v) / 100 : (v / dv.lunghezza) * 100;
    const massimo = nuova === 'mm' ? M.LIMITI.posizioneMm.max : 100;
    div.posizione.valore = Math.round(Math.min(massimo, Math.max(0, convertito)) * 100) / 100;
  }

  function cambiaSelezione(nuova) {
    selezione = nuova;
    if (nuova.tipo === 'zona') ultimaZonaId = nuova.id;
    aggiornaControlli();
    if (ultimo && !ultimo.errore) A.evidenzia(foglioEl, ultimo, selezione, { dividi: modoDividi });
  }

  function dividi(direzione) {
    const zona = zonaCorrente();
    const r = L.dividiZona(stato, zona.id, direzione);
    if (!r) return;
    ultimaZonaId = zona.id;
    selezione = { tipo: 'divisione', id: r.divisione.id };
    annuncia('Foglio diviso: ora ci sono ' + M.contaZone(stato.layout) + ' zone. Sono selezionate le impostazioni della divisione.');
    cambiato();
  }

  function unisci() {
    const div = divisioneCorrente();
    if (!div) return;
    const zona = L.unisciDivisione(stato, div.id);
    if (!zona) return;
    selezione = { tipo: 'zona', id: zona.id };
    ultimaZonaId = zona.id;
    annuncia('Zone unite: ora ci sono ' + M.contaZone(stato.layout) + ' zone.');
    cambiato();
  }

  // Toglie una zona: quella accanto occupa il suo spazio. Le altre zone non cambiano.
  function eliminaZona(id) {
    const v = L.elencaNodi(stato.layout).find((x) => x.id === id);
    const rimasto = L.eliminaZona(stato, id);
    if (!rimasto) return;
    const prima = L.primaFoglia(rimasto);
    selezione = { tipo: 'zona', id: prima.id };
    ultimaZonaId = prima.id;
    const ora = M.contaZone(stato.layout);
    annuncia((v ? v.etichetta : 'Zona') + ' eliminata: ' + (ora > 1 ? 'ora ci sono ' + ora + ' zone.' : 'il foglio è di nuovo una sola zona.'));
    cambiato();
    // Il pulsante premuto non esiste più: il focus passa alla voce selezionata (o al primo comando).
    const scelto = contenitoreSezioni.querySelector('.struttura input:checked');
    if (scelto && scelto.offsetParent) scelto.focus();
    else {
      const prossimo = contenitoreSezioni.querySelector('.sezione:not([hidden]) button');
      if (prossimo) prossimo.focus();
    }
  }

  function selezionaGenitore() {
    const g = L.trovaGenitore(stato.layout, zonaCorrente().id);
    if (g) cambiaSelezione({ tipo: 'divisione', id: g.id });
  }

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
          visibile: () => L.foglie(stato.layout).some((z) => z.impostazioni.motivo !== 'bianco'),
          nota: (s) => {
            const dove = piuZone() ? 'di ogni zona' : 'dell’area utile';
            return s.margini.modo === 'fisso'
              ? 'La griglia parte dall’angolo in alto a sinistra ' + dove + '; l’eventuale resto rimane a destra e in basso.'
              : 'Entrano un numero esatto di celle e la griglia è centrata ' + (piuZone() ? 'in ogni zona' : 'nell’area utile') + ': il resto si divide tra i due lati.';
          }
        }
      ]
    },
    {
      titolo: 'Zone',
      campi: [
        { tipo: 'nota', testo: 'Dividi il foglio con una linea verticale o orizzontale. Ogni zona ha il suo motivo e le sue misure; puoi dividere ancora una zona per ottenere croci e griglie di zone.' },
        { tipo: 'struttura', visibile: piuZone },
        {
          tipo: 'pulsante', azione: () => dividi('verticale'),
          etichetta: () => (piuZone() ? 'Dividi' + suffissoZona().replace(' — ', ' ').toLowerCase() + ' con una linea verticale' : 'Dividi con una linea verticale'),
          nota: 'Due zone affiancate, una a sinistra e una a destra.'
        },
        {
          tipo: 'pulsante', azione: () => dividi('orizzontale'),
          etichetta: () => (piuZone() ? 'Dividi' + suffissoZona().replace(' — ', ' ').toLowerCase() + ' con una linea orizzontale' : 'Dividi con una linea orizzontale'),
          nota: 'Due zone una sopra l’altra.'
        },
        {
          tipo: 'pulsante', azione: () => selezionaGenitore(),
          etichetta: () => 'Seleziona la divisione di ' + suffissoZona().replace(' — ', '').toLowerCase(),
          visibile: () => selezione.tipo === 'zona' && !!L.trovaGenitore(stato.layout, zonaCorrente().id)
        }
      ]
    },
    {
      titolo: () => 'Divisione' + (divisioneCorrente() ? ' — ' + etichettaNodo(divisioneCorrente().id) : ''),
      visibile: () => !!divisioneCorrente(),
      campi: [
        {
          tipo: 'radio', percorso: 'divisione.direzione', etichetta: 'Direzione della linea',
          opzioni: [['verticale', 'Verticale (zone affiancate)'], ['orizzontale', 'Orizzontale (zone sovrapposte)']]
        },
        {
          tipo: 'radio', percorso: 'divisione.posizione.unita', etichetta: 'Posizione misurata in',
          opzioni: [['%', 'Percentuale'], ['mm', 'Millimetri']],
          prima: convertiPosizione
        },
        {
          tipo: 'numero', percorso: 'divisione.posizione.valore', passo: 0.1, passoCursore: 0.5,
          etichetta: () => (divisioneCorrente().direzione === 'verticale' ? 'Posizione dal lato sinistro' : 'Posizione dal lato superiore'),
          unita: () => divisioneCorrente().posizione.unita,
          min: 0, minCursore: 0,
          max: () => (divisioneCorrente().posizione.unita === '%' ? 100 : lunghezzaDivisione()),
          maxCursore: () => (divisioneCorrente().posizione.unita === '%' ? 100 : lunghezzaDivisione()),
          nota: 'Se una zona risulterebbe più stretta di ' + M.MIN_ZONA + ' mm la linea viene spostata e comparirà un avviso.'
        },
        {
          tipo: 'numero', percorso: 'divisione.spazio', etichetta: 'Spazio tra le due zone', unita: 'mm',
          min: M.LIMITI.spazioZone.min, max: M.LIMITI.spazioZone.max, passo: 0.1,
          minCursore: 0, maxCursore: 20, passoCursore: 0.5,
          nota: 'Fascia lasciata libera attorno alla linea: le griglie delle due zone partono ai suoi lati.'
        },
        { tipo: 'casella', percorso: 'divisione.linea.visibile', etichetta: 'Disegna la linea di divisione' },
        {
          tipo: 'numero', percorso: 'divisione.linea.spessore', etichetta: 'Spessore della linea', unita: 'mm',
          min: M.LIMITI.spessore.min, max: M.LIMITI.spessore.max, passo: 0.01, minCursore: 0.05, maxCursore: 1, passoCursore: 0.01,
          visibile: () => divisioneCorrente().linea.visibile
        },
        { ...intensita('divisione.linea.intensita'), etichetta: 'Intensità del grigio della linea', visibile: () => divisioneCorrente().linea.visibile },
        {
          tipo: 'selezione', percorso: 'divisione.linea.stile', etichetta: 'Stile della linea',
          opzioni: [['continua', 'Continua'], ['tratteggiata', 'Tratteggiata'], ['puntini', 'A puntini']],
          visibile: () => divisioneCorrente().linea.visibile
        },
        {
          tipo: 'numero', percorso: 'divisione.linea.tratto', etichetta: 'Lunghezza del tratto', unita: 'mm',
          min: M.LIMITI.tratto.min, max: M.LIMITI.tratto.max, passo: 0.1, minCursore: 0.5, maxCursore: 10, passoCursore: 0.1,
          visibile: () => divisioneCorrente().linea.visibile && divisioneCorrente().linea.stile === 'tratteggiata'
        },
        {
          tipo: 'numero', percorso: 'divisione.linea.spazio', unita: 'mm',
          min: M.LIMITI.spazio.min, max: M.LIMITI.spazio.max, passo: 0.1, minCursore: 0.2, maxCursore: 10, passoCursore: 0.1,
          etichetta: () => (divisioneCorrente().linea.stile === 'puntini' ? 'Distanza tra i puntini' : 'Spazio tra i tratti'),
          visibile: () => divisioneCorrente().linea.visibile && divisioneCorrente().linea.stile !== 'continua'
        },
        {
          tipo: 'pulsante', azione: () => unisci(),
          etichetta: 'Unisci le due parti in una zona',
          nota: 'Resta una sola zona con le impostazioni della prima; le altre zone di questa divisione vengono eliminate.'
        }
      ]
    },
    {
      titolo: () => 'Motivo' + suffissoZona(),
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
      titolo: () => 'Passo' + suffissoZona(),
      visibile: () => motivo() !== 'bianco',
      campi: [
        {
          tipo: 'numero', percorso: 'zona.passoX', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: () => (motivo() === 'righe-verticali' ? 'Distanza tra le righe' : dueAssi() && impostazioni().passoUguale ? 'Passo' : 'Passo orizzontale'),
          visibile: motivoTra('puntini', 'quadretti', 'righe-verticali')
        },
        { tipo: 'casella', percorso: 'zona.passoUguale', etichetta: 'Passo verticale uguale all’orizzontale', visibile: motivoTra('puntini', 'quadretti') },
        {
          tipo: 'numero', percorso: 'zona.passoY', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: () => (motivo() === 'righe-orizzontali' ? 'Distanza tra le righe' : 'Passo verticale'),
          visibile: () => motivo() === 'righe-orizzontali' || (dueAssi() && !impostazioni().passoUguale)
        }
      ]
    },
    {
      titolo: () => 'Linee' + suffissoZona(),
      visibile: motivoTra('righe-orizzontali', 'quadretti', 'righe-verticali'),
      campi: [
        { tipo: 'numero', percorso: 'zona.spessore', etichetta: 'Spessore', unita: 'mm', min: M.LIMITI.spessore.min, max: M.LIMITI.spessore.max, passo: 0.01, minCursore: 0.05, maxCursore: 1, passoCursore: 0.01 },
        intensita('zona.intensitaLinee'),
        { tipo: 'selezione', percorso: 'zona.stileLinea', etichetta: 'Stile', opzioni: [['continua', 'Continua'], ['tratteggiata', 'Tratteggiata'], ['puntini', 'A puntini']] },
        { tipo: 'numero', percorso: 'zona.tratto', etichetta: 'Lunghezza del tratto', unita: 'mm', min: M.LIMITI.tratto.min, max: M.LIMITI.tratto.max, passo: 0.1, minCursore: 0.5, maxCursore: 10, passoCursore: 0.1, visibile: () => impostazioni().stileLinea === 'tratteggiata' },
        {
          tipo: 'numero', percorso: 'zona.spazio', unita: 'mm', min: M.LIMITI.spazio.min, max: M.LIMITI.spazio.max, passo: 0.1, minCursore: 0.2, maxCursore: 10, passoCursore: 0.1,
          etichetta: () => (impostazioni().stileLinea === 'puntini' ? 'Distanza tra i puntini' : 'Spazio tra i tratti'),
          visibile: () => impostazioni().stileLinea !== 'continua'
        }
      ]
    },
    {
      titolo: () => 'Puntini' + suffissoZona(),
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
    const legenda = el('legend', null, testo(dSez.titolo, stato));
    nodo.appendChild(legenda);
    const controlli = [];
    for (const dc of dSez.campi) {
      const c = creaControllo(dc);
      if (dc.id === 'nome-file') campoNome = c.campo;
      nodo.appendChild(c.nodo);
      controlli.push(c);
    }
    contenitoreSezioni.appendChild(nodo);
    sezioni.push({ d: dSez, nodo, controlli, legenda });
  }

  // ------------------------------------------------------------ aggiornamento

  function aggiornaControlli() {
    // La selezione deve sempre indicare un nodo esistente.
    if (!L.trovaNodo(stato.layout, selezione.id)) selezione = { tipo: 'zona', id: L.primaFoglia(stato.layout).id };
    if (!L.trovaNodo(stato.layout, ultimaZonaId)) ultimaZonaId = L.primaFoglia(stato.layout).id;
    for (const s of sezioni) {
      const visibile = s.d.visibile ? s.d.visibile(stato) : true;
      s.nodo.hidden = !visibile;
      if (!visibile) continue;
      s.legenda.textContent = testo(s.d.titolo, stato);
      for (const c of s.controlli) c.aggiorna();
    }
  }

  function cambiato() {
    aggiornaControlli();
    pianificaRigenerazione();
    pianificaSalvataggio();
  }

  // L'ultima configurazione si salva poco dopo l'ultima modifica (e quando si chiude la pagina).
  function pianificaSalvataggio() {
    window.clearTimeout(timerSalvataggio);
    timerSalvataggio = window.setTimeout(salvaSubito, 500);
  }
  function salvaSubito() {
    window.clearTimeout(timerSalvataggio);
    archivio.salvaUltima(stato);
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
    if (foglio.zone.length > 1) {
      return foglio.zone.length + ' zone: ' +
        foglio.zone.map((z) => 'zona ' + z.numero + ' ' + (NOMI_MOTIVI[z.motivo] || '').toLowerCase()).join(', ') + '.';
    }
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

    A.mostra(foglioEl, foglio, selezione, { dividi: modoDividi });
    for (const s of sezioni) for (const c of s.controlli) if (c.dettagli) c.dettagli(foglio);
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

  // Clic o tocco sull'anteprima: sceglie la zona o la divisione sotto il puntatore.
  function nodoSotto(e) {
    const bersaglio = e.target instanceof Element ? e.target.closest('[data-nodo]') : null;
    if (!bersaglio) return null;
    const id = bersaglio.getAttribute('data-nodo');
    if (!/^[zd]\d+$/.test(id)) return null;
    return L.trovaNodo(stato.layout, id);
  }

  // Posizione (in mm dal bordo della zona) e segmento della linea che nascerebbe cliccando qui.
  function taglioPrevisto(zonaId, e) {
    if (!ultimo || ultimo.errore) return null;
    const z = ultimo.zone.find((x) => x.id === zonaId);
    const pt = A.punto(foglioEl, ultimo, e.clientX, e.clientY);
    if (!z || !pt) return null;
    const r = z.rettangolo;
    const verticale = direzioneClic === 'verticale';
    const lunghezza = verticale ? r.w : r.h;
    const minimo = M.MIN_ZONA + M.divisionePredefinita(direzioneClic).spazio / 2;
    if (lunghezza < 2 * minimo) return { troppoPiccola: true };
    const grezzo = verticale ? pt.x - r.x : pt.y - r.y;
    const valore = Math.round(Math.min(lunghezza - minimo, Math.max(minimo, grezzo)) * 10) / 10;
    const segmento = verticale
      ? [r.x + valore, r.y, r.x + valore, r.y + r.h]
      : [r.x, r.y + valore, r.x + r.w, r.y + valore];
    return { valore, segmento };
  }

  foglioEl.addEventListener('click', (e) => {
    const n = nodoSotto(e);
    if (!n) return;
    if (!modoDividi) {
      cambiaSelezione({ tipo: n.tipo, id: n.id });
      return;
    }
    if (n.tipo === 'divisione') {
      const prima = M.contaZone(stato.layout);
      const zona = L.unisciDivisione(stato, n.id);
      if (!zona) return;
      selezione = { tipo: 'zona', id: zona.id };
      ultimaZonaId = zona.id;
      annuncia('Linea tolta: zone da ' + prima + ' a ' + M.contaZone(stato.layout) + '.');
    } else {
      const t = taglioPrevisto(n.id, e);
      if (!t) return;
      if (t.troppoPiccola) {
        annuncia('Questa zona è troppo piccola per essere divisa.');
        return;
      }
      const r = L.dividiZona(stato, n.id, direzioneClic, { valore: t.valore, unita: 'mm' });
      if (!r) return;
      ultimaZonaId = n.id;
      selezione = { tipo: 'divisione', id: r.divisione.id };
      annuncia('Zona divisa a ' + M.formattaIt(t.valore) + ' mm: ora ci sono ' + M.contaZone(stato.layout) + ' zone.');
    }
    A.guida(foglioEl, null);
    cambiato();
  });

  // Guida che segue il puntatore: mostra dove cadrebbe la linea (o segnala che un clic la toglie).
  foglioEl.addEventListener('pointermove', (e) => {
    if (!modoDividi) return;
    const n = nodoSotto(e);
    foglioEl.classList.toggle('su-linea', !!n && n.tipo === 'divisione');
    if (!n || n.tipo !== 'zona') {
      A.guida(foglioEl, null);
      return;
    }
    const t = taglioPrevisto(n.id, e);
    A.guida(foglioEl, t && t.segmento ? t.segmento : null);
  });
  foglioEl.addEventListener('pointerleave', () => {
    A.guida(foglioEl, null);
    foglioEl.classList.remove('su-linea');
  });

  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(() => {
      if (ultimo && !ultimo.errore) A.adatta(pianoEl, foglioEl, ultimo);
    }).observe(pianoEl);
  } else {
    window.addEventListener('resize', () => {
      if (ultimo && !ultimo.errore) A.adatta(pianoEl, foglioEl, ultimo);
    });
  }

  // ------------------------------------------------------------ gruppi a scelta singola extra (tema, direzione)

  function gruppoRadio(etichetta, opzioni, iniziale, alCambio, classe) {
    const id = prossimoId();
    const nodo = el('div', 'campo-compatto');
    const titolo = el('span', 'visivamente-nascosto', etichetta);
    titolo.id = id + '-etichetta';
    const gruppo = el('div', 'segmenti compatto' + (classe ? ' ' + classe : ''));
    gruppo.setAttribute('role', 'radiogroup');
    gruppo.setAttribute('aria-labelledby', titolo.id);
    const ingressi = [];
    for (const [v, testoOpzione] of opzioni) {
      const lab = el('label');
      const inp = el('input');
      inp.type = 'radio';
      inp.name = id;
      inp.value = v;
      inp.checked = v === iniziale;
      lab.append(inp, el('span', 'opzione', testoOpzione));
      gruppo.appendChild(lab);
      ingressi.push(inp);
      inp.addEventListener('change', () => { if (inp.checked) alCambio(v); });
    }
    nodo.append(titolo, gruppo);
    return { nodo, imposta(v) { for (const i of ingressi) i.checked = i.value === v; } };
  }

  // ------------------------------------------------------------ tema chiaro/scuro

  if (F.tema && temaEl) {
    temaEl.appendChild(el('span', 'tema-etichetta', 'Tema'));
    temaEl.appendChild(gruppoRadio(
      'Tema dell’interfaccia',
      [['auto', 'Automatico'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']],
      F.tema.leggi(),
      (v) => { F.tema.imposta(v); annuncia('Tema: ' + ({ auto: 'automatico, segue il sistema', chiaro: 'chiaro', scuro: 'scuro' })[v] + '.'); }
    ).nodo);
  }

  // ------------------------------------------------------------ modalità «Dividi con il clic»

  function creaStrumenti() {
    const riga = el('div', 'strumenti-riga');
    const lab = el('label', 'casella');
    const casella = el('input');
    casella.type = 'checkbox';
    casella.id = prossimoId();
    lab.append(casella, el('span', null, 'Dividi con il clic'));
    riga.appendChild(lab);

    const direzione = gruppoRadio(
      'Direzione della linea da creare',
      [['verticale', 'Linea verticale'], ['orizzontale', 'Linea orizzontale']],
      direzioneClic,
      (v) => { direzioneClic = v; A.guida(foglioEl, null); aggiornaSuggerimento(); }
    );
    direzione.nodo.hidden = true;
    riga.appendChild(direzione.nodo);

    const suggerimento = el('p', 'suggerimento');
    suggerimento.hidden = true;
    suggerimento.id = prossimoId();
    casella.setAttribute('aria-describedby', suggerimento.id);

    function aggiornaSuggerimento() {
      suggerimento.textContent = 'Clicca su una zona per dividerla con una linea ' + direzioneClic +
        ' nel punto cliccato; clicca su una linea per toglierla. Esc per uscire.';
    }
    function imposta(attivo) {
      modoDividi = attivo;
      casella.checked = attivo;
      direzione.nodo.hidden = !attivo;
      suggerimento.hidden = !attivo;
      foglioEl.classList.toggle('modo-dividi', attivo);
      foglioEl.classList.remove('su-linea');
      aggiornaSuggerimento();
      if (ultimo && !ultimo.errore) A.evidenzia(foglioEl, ultimo, selezione, { dividi: modoDividi });
      annuncia(attivo ? 'Modalità dividi con il clic attiva.' : 'Modalità dividi con il clic disattivata.');
    }
    casella.addEventListener('change', () => imposta(casella.checked));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modoDividi) {
        imposta(false);
        casella.focus();
      }
    });
    strumentiEl.append(riga, suggerimento);
  }
  creaStrumenti();

  // ------------------------------------------------------------ preset e ultima configurazione

  // Sostituisce tutte le impostazioni (da preset, file o ripristino) e riporta la selezione alla prima zona.
  function applicaStato(nuovo) {
    Object.assign(stato, nuovo);
    const prima = L.primaFoglia(stato.layout);
    selezione = { tipo: 'zona', id: prima.id };
    ultimaZonaId = prima.id;
    cambiato();
  }

  function creaPannelloPreset() {
    const nodo = el('fieldset', 'sezione');
    const legenda = el('legend', null, 'Preset');
    nodo.appendChild(legenda);
    nodo.appendChild(el('p', 'nota nota-fissa', 'Un preset salva formato, margini, zone e tutte le impostazioni. Si conserva in questo browser, su questo dispositivo; per spostarlo altrove esportalo in un file.'));

    const idSelezione = prossimoId();
    const campoSel = el('div', 'campo');
    const etichettaSel = el('label', null, 'Preset salvati');
    etichettaSel.htmlFor = idSelezione;
    const elenco = el('select');
    elenco.id = idSelezione;
    campoSel.append(etichettaSel, elenco);

    const idNome = prossimoId();
    const campoNomePreset = el('div', 'campo');
    const etichettaNome = el('label', null, 'Nome del preset');
    etichettaNome.htmlFor = idNome;
    const nome = el('input');
    nome.type = 'text';
    nome.id = idNome;
    nome.maxLength = PR.MAX_NOME;
    nome.autocomplete = 'off';
    nome.spellcheck = false;
    campoNomePreset.append(etichettaNome, nome);

    const messaggio = el('p', 'messaggio');
    messaggio.hidden = true;
    const mostra = (testoMessaggio, errore) => {
      messaggio.textContent = testoMessaggio;
      messaggio.className = 'messaggio' + (errore ? ' errore' : '');
      messaggio.hidden = !testoMessaggio;
      if (testoMessaggio) annuncia(testoMessaggio);
    };

    const pulsante = (testoPulsante, azione) => {
      const b = el('button', 'pulsante secondario', testoPulsante);
      b.type = 'button';
      b.addEventListener('click', azione);
      return b;
    };
    const gruppoA = el('div', 'gruppo-pulsanti');
    const bSalva = pulsante('Salva', salva);
    const bCarica = pulsante('Carica', carica);
    const bElimina = pulsante('Elimina', elimina);
    gruppoA.append(bSalva, bCarica, bElimina);
    const gruppoB = el('div', 'gruppo-pulsanti due');
    const bEsporta = pulsante('Esporta in file', esporta);
    const bImporta = pulsante('Importa da file', () => file.click());
    gruppoB.append(bEsporta, bImporta);
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.setAttribute('aria-label', 'File preset da importare');
    file.addEventListener('change', importa);
    nodo.append(campoSel, campoNomePreset, gruppoA, messaggio, gruppoB, file);

    function aggiornaElenco(scelto) {
      const nomi = archivio.elenco();
      elenco.replaceChildren();
      const vuoto = el('option', null, nomi.length ? '— scegli un preset —' : '— nessun preset salvato —');
      vuoto.value = '';
      elenco.appendChild(vuoto);
      for (const n of nomi) {
        const o = el('option', null, n);
        o.value = n;
        elenco.appendChild(o);
      }
      elenco.value = scelto && nomi.indexOf(scelto) !== -1 ? scelto : '';
      bCarica.disabled = bElimina.disabled = !elenco.value;
    }
    elenco.addEventListener('change', () => {
      bCarica.disabled = bElimina.disabled = !elenco.value;
      if (elenco.value) nome.value = elenco.value;
    });

    function salva() {
      const n = PR.sanificaNome(nome.value);
      if (!n) { mostra('Scrivi un nome per il preset.', true); nome.focus(); return; }
      if (archivio.esiste(n) && !window.confirm('Esiste già un preset chiamato «' + n + '». Vuoi sostituirlo?')) return;
      const r = archivio.salva(n, stato);
      if (!r.ok) { mostra(r.errore, true); return; }
      aggiornaElenco(n);
      nome.value = n;
      mostra('Preset «' + n + '» ' + (r.sostituito ? 'sostituito.' : 'salvato.'), false);
    }

    function carica() {
      if (!elenco.value) return;
      const r = archivio.carica(elenco.value);
      if (!r.ok) { mostra(r.errore, true); aggiornaElenco(); return; }
      nome.value = r.nome;
      applicaStato(r.stato);
      mostra('Preset «' + r.nome + '» caricato.', false);
    }

    function elimina() {
      if (!elenco.value) return;
      const n = elenco.value;
      if (!window.confirm('Vuoi eliminare il preset «' + n + '»?')) return;
      const r = archivio.elimina(n);
      if (!r.ok) { mostra(r.errore, true); return; }
      aggiornaElenco();
      mostra('Preset «' + n + '» eliminato.', false);
    }

    function esporta() {
      const n = PR.sanificaNome(nome.value) || 'Preset';
      const contenuto = JSON.stringify(PR.creaPreset(stato, n), null, 2);
      const url = URL.createObjectURL(new Blob([contenuto], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'preset-' + P.sanificaNomeFile(n, 'foglio').replace(/\.pdf$/, '') + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      mostra('File preset creato: ' + a.download + '.', false);
    }

    function importa() {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (f.size > 1024 * 1024) { mostra('Il file è troppo grande per essere un preset.', true); return; }
      const finito = (testoFile) => {
        const r = PR.leggiPreset(testoFile);
        if (r.errore) { mostra('Importazione non riuscita: ' + r.errore, true); return; }
        nome.value = r.nome;
        applicaStato(r.stato);
        mostra('Preset importato' + (r.nome ? ' («' + r.nome + '»)' : '') + '. Premi «Salva» per tenerlo anche nel browser.', false);
      };
      if (typeof f.text === 'function') {
        f.text().then(finito, () => mostra('Non è stato possibile leggere il file.', true));
      } else {
        const lettore = new FileReader();
        lettore.onload = () => finito(String(lettore.result));
        lettore.onerror = () => mostra('Non è stato possibile leggere il file.', true);
        lettore.readAsText(f);
      }
    }

    if (!archivio.disponibile()) {
      campoSel.hidden = true;
      campoNomePreset.hidden = true;
      gruppoA.hidden = true;
      mostra('Il browser non permette di salvare i preset qui (navigazione privata o dati del sito bloccati): usa «Esporta in file» e «Importa da file».', true);
    }
    aggiornaElenco();
    return { d: { titolo: 'Preset' }, nodo, controlli: [], legenda };
  }

  // «Nuovo foglio»: torna ai valori di partenza (A4, una zona, puntini). I preset salvati restano.
  if (nuovoEl) {
    nuovoEl.addEventListener('click', () => {
      if (!window.confirm('Vuoi ricominciare da capo? Le impostazioni attuali andranno perse (i preset salvati restano).')) return;
      applicaStato(M.creaStatoIniziale());
      annuncia('Nuovo foglio: impostazioni iniziali ripristinate.');
    });
  }

  {
    const s = creaPannelloPreset();
    // Il pulsante «Scarica PDF» è fisso in basso: il pannello preset va in fondo alle sezioni.
    contenitoreSezioni.appendChild(s.nodo);
    sezioni.push(s);
  }

  // Su schermi stretti l'anteprima resta fissa in alto e la barra del PDF in basso: il browser deve
  // lasciare i controlli selezionati con Tab fuori da queste fasce (scroll-padding nel CSS).
  {
    const anteprimaEl = document.querySelector('.anteprima');
    const barraEl = document.querySelector('.azioni');
    const misura = () => {
      const r = document.documentElement.style;
      r.setProperty('--altezza-anteprima', anteprimaEl.offsetHeight + 'px');
      r.setProperty('--altezza-barra', barraEl.offsetHeight + 'px');
    };
    if (typeof window.ResizeObserver === 'function') {
      const o = new window.ResizeObserver(misura);
      o.observe(anteprimaEl);
      o.observe(barraEl);
    }
    window.addEventListener('resize', misura);
    misura();
  }

  window.addEventListener('pagehide', salvaSubito);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') salvaSubito(); });

  // Ripresa dell'ultima configurazione (se c'è e se è valida).
  {
    const ultima = archivio.leggiUltima();
    if (ultima) {
      Object.assign(stato, ultima);
      selezione = { tipo: 'zona', id: L.primaFoglia(stato.layout).id };
      ultimaZonaId = selezione.id;
    }
  }

  aggiornaControlli();
  rigenera();
})();
