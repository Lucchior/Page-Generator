/*
 * Interfaccia: costruisce i controlli, collega lo stato all'anteprima e al download del PDF.
 * I nodi vengono creati con le API del DOM (niente innerHTML) e ogni valore inserito
 * passa dai limiti del modello.
 */
(function () {
  'use strict';

  const F = window.Fogli;
  if (!F || !F.modello || !F.layout || !F.geometria || !F.anteprima || !F.pdf || !F.preset || !F.immagini) {
    document.body.textContent = 'Errore: alcuni file del programma non sono stati caricati. Controlla la cartella js/ e ricarica la pagina.';
    return;
  }
  const M = F.modello;
  const L = F.layout;
  const G = F.geometria;
  const A = F.anteprima;
  const P = F.pdf;
  const PR = F.preset;
  const IM = F.immagini;

  const stato = M.creaStatoIniziale();
  const sezioni = [];
  let contatoreId = 0;
  let ultimo = null;
  let pianificato = false;
  // Blocchi del pannello (uno per zona e per divisione) e stato aperto/chiuso di ciascuno.
  const blocchi = [];
  const aperti = new Map();
  let firmaBlocchi = '';
  // Modalità «Dividi con il clic»: il clic sull'anteprima divide una zona o toglie una linea.
  let modoDividi = false;
  let direzioneClic = 'verticale';
  // «Vista finita»: nasconde lo scarto nell'anteprima (non cambia il PDF).
  let vistaFinita = false;
  // Immagini caricate per le due metà della zona 1 (solo in memoria: non vanno nei preset né nel salvataggio).
  const immagini = { alto: null, basso: null };
  const NOMI_LATO = { alto: 'in alto', basso: 'in basso' };
  const dimImmagini = () => {
    const d = {};
    for (const lato of ['alto', 'basso']) if (immagini[lato]) d[lato] = { w: immagini[lato].w, h: immagini[lato].h };
    return d;
  };
  function togliImmagine(lato) {
    IM.libera(immagini[lato]);
    immagini[lato] = null;
  }
  let casellaVista = null;

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
  const testo = (v, stato_, ctx) => (typeof v === 'function' ? v(stato_, ctx) : v);
  const val = (v, ctx) => testo(v, stato, ctx);

  function annuncia(messaggio) {
    annunciEl.textContent = '';
    window.setTimeout(() => { annunciEl.textContent = messaggio; }, 50);
  }

  // I percorsi arrivano solo dai descrittori; «zona.» e «divisione.» valgono per il nodo del blocco (ctx.id).
  function risolvi(percorso, ctx) {
    const parti = percorso.split('.');
    let base = stato;
    if (parti[0] === 'zona') {
      base = L.trovaNodo(stato.layout, ctx.id).impostazioni;
      parti.shift();
    } else if (parti[0] === 'divisione') {
      base = L.trovaNodo(stato.layout, ctx.id);
      parti.shift();
    }
    while (parti.length > 1) base = base[parti.shift()];
    return [base, parti[0]];
  }
  function leggi(percorso, ctx) {
    const [b, k] = risolvi(percorso, ctx);
    return b[k];
  }
  function scrivi(percorso, valore, ctx) {
    const [b, k] = risolvi(percorso, ctx);
    b[k] = valore;
  }

  // ------------------------------------------------------------ componenti

  // Parti comuni: etichetta, nota d'aiuto, visibilità e abilitazione.
  function base(d, nodo, ctx) {
    const nota = el('p', 'nota');
    nota.id = prossimoId();
    nodo.appendChild(nota);
    const c = { d, nodo, nota, sincronizza() {} };
    c.aggiorna = function () {
      const visibile = d.visibile ? d.visibile(stato, ctx) : true;
      nodo.hidden = !visibile;
      const abilitato = d.abilitato ? d.abilitato(stato, ctx) : true;
      nodo.classList.toggle('disabilitato', !abilitato);
      for (const i of nodo.querySelectorAll('input,select')) i.disabled = !abilitato;
      const t = d.nota ? testo(d.nota, stato, ctx) : '';
      nota.textContent = t;
      nota.hidden = !t;
      c.sincronizza();
    };
    return c;
  }

  function descrivi(c, ...campi) {
    for (const i of campi) i.setAttribute('aria-describedby', c.nota.id);
  }

  function creaNumero(d, ctx) {
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
      min: val(d.min, ctx), max: val(d.max, ctx), minC: val(d.minCursore, ctx), maxC: val(d.maxCursore, ctx), unita: val(d.unita, ctx)
    });
    riga.appendChild(valore);

    const c = base(d, nodo, ctx);
    descrivi(c, num);

    c.sincronizza = function () {
      const t = testo(d.etichetta, stato, ctx);
      const l = lim();
      etichetta.textContent = t;
      unitaEl.textContent = l.unita;
      num.min = l.min;
      num.max = l.max;
      const v = leggi(d.percorso, ctx);
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
      scrivi(d.percorso, v, ctx);
      cambiato();
    });
    num.addEventListener('change', () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v)) {
        num.value = valoreCampo(leggi(d.percorso, ctx));
        return;
      }
      const l = lim();
      const limitato = Math.min(l.max, Math.max(l.min, v));
      if (limitato !== v) {
        annuncia('Valore portato a ' + valoreCampo(limitato) + ' ' + l.unita + ': è il ' + (limitato === l.max ? 'massimo' : 'minimo') + ' consentito.');
      }
      scrivi(d.percorso, limitato, ctx);
      num.value = valoreCampo(limitato);
      cambiato();
    });
    if (cursore) {
      cursore.addEventListener('input', () => {
        scrivi(d.percorso, parseFloat(cursore.value), ctx);
        cambiato();
      });
    }
    return c;
  }

  function creaSelezione(d, ctx) {
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
    const c = base(d, nodo, ctx);
    descrivi(c, sel);
    c.sincronizza = function () { sel.value = leggi(d.percorso, ctx); };
    sel.addEventListener('change', () => {
      if (d.prima) d.prima(sel.value, ctx);
      scrivi(d.percorso, sel.value, ctx);
      cambiato();
    });
    return c;
  }

  function creaRadio(d, ctx) {
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
        if (d.prima) d.prima(v, ctx);
        scrivi(d.percorso, v, ctx);
        cambiato();
      });
    }
    nodo.append(etichetta, gruppo);
    const c = base(d, nodo, ctx);
    descrivi(c, ...ingressi);
    c.sincronizza = function () {
      const corrente = leggi(d.percorso, ctx);
      for (const i of ingressi) i.checked = i.value === corrente;
    };
    return c;
  }

  function creaCasella(d, ctx) {
    const nodo = el('div', 'campo');
    const lab = el('label', 'casella');
    const inp = el('input');
    inp.type = 'checkbox';
    lab.append(inp, el('span', null, ''));
    nodo.appendChild(lab);
    const c = base(d, nodo, ctx);
    descrivi(c, inp);
    c.sincronizza = function () {
      lab.lastChild.textContent = testo(d.etichetta, stato, ctx);
      inp.checked = !!leggi(d.percorso, ctx);
    };
    inp.addEventListener('change', () => {
      scrivi(d.percorso, inp.checked, ctx);
      cambiato();
    });
    return c;
  }

  function creaTesto(d, ctx) {
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
    const c = base(d, nodo, ctx);
    descrivi(c, inp);
    c.campo = inp;
    c.sincronizza = function () {
      if (document.activeElement !== inp) inp.value = leggi(d.percorso, ctx);
    };
    inp.addEventListener('input', () => {
      scrivi(d.percorso, inp.value, ctx);
    });
    return c;
  }

  const NOMI_MOTIVI = {
    'puntini': 'Puntini', 'righe-orizzontali': 'Righe orizzontali', 'quadretti': 'Quadretti',
    'righe-verticali': 'Righe verticali', 'bianco': 'Bianco'
  };

  function creaPulsante(d, ctx) {
    const nodo = el('div', 'campo');
    const b = el('button', 'pulsante secondario');
    b.type = 'button';
    nodo.appendChild(b);
    const c = base(d, nodo, ctx);
    descrivi(c, b);
    c.sincronizza = function () { b.textContent = testo(d.etichetta, stato, ctx); };
    b.addEventListener('click', () => d.azione(ctx));
    return c;
  }

  // Caricamento di un'immagine per una metà del foglio: scelta file, informazioni, rimozione.
  function creaImmagineMeta(d, ctx) {
    const lato = d.lato;
    const id = prossimoId();
    const nodo = el('div', 'campo campo-immagine');
    nodo.appendChild(el('span', 'etichetta', 'Immagine ' + NOMI_LATO[lato]));
    const riga = el('div', 'gruppo-pulsanti due');
    const bCarica = el('button', 'pulsante secondario', 'Carica PNG…');
    bCarica.type = 'button';
    const bRimuovi = el('button', 'pulsante secondario', 'Rimuovi');
    bRimuovi.type = 'button';
    const file = el('input');
    file.type = 'file';
    file.accept = '.png,image/png';
    file.hidden = true;
    file.id = id;
    file.setAttribute('aria-label', 'File PNG per l’immagine ' + NOMI_LATO[lato]);
    riga.append(bCarica, bRimuovi);
    const info = el('p', 'nota');
    const errore = el('p', 'messaggio errore');
    errore.hidden = true;
    errore.setAttribute('role', 'alert');
    nodo.append(riga, file, info, errore);
    const c = base(d, nodo, ctx);
    descrivi(c, bCarica);
    c.sincronizza = function () {
      const im = immagini[lato];
      bRimuovi.hidden = !im;
      bCarica.textContent = im ? 'Sostituisci…' : 'Carica PNG…';
      if (!im) {
        info.textContent = 'Nessuna immagine: la metà resta con la griglia.';
        return;
      }
      const dato = ultimo && ultimo.immagini ? ultimo.immagini.find((x) => x.lato === lato) : null;
      info.textContent = im.nome + ' · ' + im.w + ' × ' + im.h + ' px' + (dato ? ' · circa ' + dato.dpi + ' dpi' : '');
    };
    bCarica.addEventListener('click', () => file.click());
    bRimuovi.addEventListener('click', () => {
      togliImmagine(lato);
      errore.hidden = true;
      annuncia('Immagine ' + NOMI_LATO[lato] + ' rimossa.');
      cambiato();
    });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      errore.hidden = true;
      IM.carica(f).then(
        (nuova) => {
          togliImmagine(lato);
          immagini[lato] = nuova;
          annuncia('Immagine ' + NOMI_LATO[lato] + ' caricata.');
          cambiato();
        },
        (e) => {
          errore.textContent = e.message;
          errore.hidden = false;
          annuncia(e.message);
        }
      );
    });
    return c;
  }

  function creaNota(d, ctx) {
    const nodo = el('p', 'nota nota-fissa');
    const c = {
      d,
      nodo,
      aggiorna() {
        const t = testo(d.testo, stato, ctx);
        nodo.textContent = t;
        nodo.hidden = !t || (d.visibile ? !d.visibile(stato, ctx) : false);
      }
    };
    c.aggiorna();
    return c;
  }

  function creaControllo(d, ctx) {
    switch (d.tipo) {
      case 'numero': return creaNumero(d, ctx);
      case 'selezione': return creaSelezione(d, ctx);
      case 'radio': return creaRadio(d, ctx);
      case 'casella': return creaCasella(d, ctx);
      case 'testo': return creaTesto(d, ctx);
      case 'pulsante': return creaPulsante(d, ctx);
      case 'immagine': return creaImmagineMeta(d, ctx);
      default: return creaNota(d, ctx);
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

  // Ogni blocco (zona o divisione) ha un contesto {id}: i percorsi «zona.» e «divisione.» valgono per quel nodo.
  const nodoDi = (c) => L.trovaNodo(stato.layout, c.id);
  const impDi = (c) => nodoDi(c).impostazioni;
  const motivoDi = (c) => impDi(c).motivo;
  const motivoTra = (...elenco) => (s, c) => elenco.indexOf(motivoDi(c)) !== -1;
  const dueAssi = (c) => M.MOTIVI_DUE_PASSI.indexOf(motivoDi(c)) !== -1;
  const piuZone = () => M.contaZone(stato.layout) > 1;
  const divDi = (c) => nodoDi(c);
  const fgDi = (c) => impDi(c).foglio;
  const fgAttivo = (s, c) => fgDi(c).attivo;

  // Distanze della prima/ultima riga e colonna dal bordo del foglio finito, come calcolate dalla geometria.
  function testoDistanze(c) {
    const z = ultimo && ultimo.zone ? ultimo.zone.find((x) => x.id === c.id) : null;
    if (!z || !z.finito) return '';
    const d = z.finito.distanze;
    const f = (v) => (v === null ? '—' : M.formattaIt(v) + ' mm');
    return 'Dal bordo del foglio finito (' + M.formattaIt(z.finito.finito.w) + ' × ' + M.formattaIt(z.finito.finito.h) + ' mm): sopra ' + f(d.alto) +
      ', sotto ' + f(d.basso) + ', a sinistra ' + f(d.sinistra) + ', a destra ' + f(d.destra) + '.';
  }

  // Copia le misure del foglio finito di una zona in tutte le altre.
  function copiaFoglioInTutte(c) {
    const sorgente = JSON.stringify(fgDi(c));
    let n = 0;
    for (const z of L.foglie(stato.layout)) {
      if (z.id === c.id) continue;
      z.impostazioni.foglio = M.normalizzaZona({ foglio: JSON.parse(sorgente) }).foglio;
      n++;
    }
    if (!n) return;
    annuncia('Misure del foglio finito copiate in ' + n + (n === 1 ? ' altra zona.' : ' altre zone.'));
    cambiato();
  }
  const rifilo = (lato, etichetta) => ({
    tipo: 'numero', percorso: 'zona.foglio.rifilo.' + lato, etichetta, unita: 'mm', soloNumero: true,
    min: M.LIMITI.rifilo.min, max: M.LIMITI.rifilo.max, passo: 0.1, visibile: fgAttivo
  });
  const distanzaLato = (lato, etichetta) => ({
    tipo: 'numero', percorso: 'zona.foglio.distanza.' + lato, etichetta, unita: 'mm', soloNumero: true,
    min: M.LIMITI.distanzaFoglio.min, max: M.LIMITI.distanzaFoglio.max, passo: 0.1,
    visibile: (s, c) => fgAttivo(s, c) && !fgDi(c).distanza.uguale
  });

  function lunghezzaDivisione(c) {
    const dv = ultimo && ultimo.divisioni ? ultimo.divisioni.find((x) => x.id === c.id) : null;
    return dv ? Math.min(M.LIMITI.posizioneMm.max, Math.round(dv.lunghezza * 100) / 100) : M.LIMITI.posizioneMm.max;
  }

  // Cambiando unità la linea resta dov'è: il valore viene convertito.
  function convertiPosizione(nuova, c) {
    const div = divDi(c);
    if (!div || div.posizione.unita === nuova) return;
    const dv = ultimo && ultimo.divisioni ? ultimo.divisioni.find((x) => x.id === div.id) : null;
    if (!dv || !(dv.lunghezza > 0)) return;
    const v = div.posizione.valore;
    const convertito = nuova === 'mm' ? (dv.lunghezza * v) / 100 : (v / dv.lunghezza) * 100;
    const massimo = nuova === 'mm' ? M.LIMITI.posizioneMm.max : 100;
    div.posizione.valore = Math.round(Math.min(massimo, Math.max(0, convertito)) * 100) / 100;
  }

  // ---- azioni sulla struttura delle zone

  // Chiude tutti i blocchi tranne uno (quello appena creato).
  function apriSolo(id) {
    for (const b of blocchi) impostaAperto(b, false);
    aperti.set(id, true);
  }

  function focusBlocco(id) {
    const b = blocchi.find((x) => x.id === id) || blocchi[0];
    if (b) b.btn.focus();
  }

  function dividi(idZona, direzione) {
    const r = L.dividiZona(stato, idZona, direzione);
    if (!r) return;
    apriSolo(r.divisione.id);
    annuncia('Zona divisa: ora ci sono ' + M.contaZone(stato.layout) + ' zone. È aperto il blocco della nuova divisione.');
    cambiato();
    focusBlocco(r.divisione.id);
  }

  function unisci(idDivisione) {
    const zona = L.unisciDivisione(stato, idDivisione);
    if (!zona) return;
    annuncia('Zone unite: ora ci sono ' + M.contaZone(stato.layout) + ' zone.');
    cambiato();
    focusBlocco(zona.id);
  }

  // Toglie una zona: quella accanto occupa il suo spazio. Le altre zone non cambiano.
  function eliminaZona(id) {
    const v = L.elencaNodi(stato.layout).find((x) => x.id === id);
    const rimasto = L.eliminaZona(stato, id);
    if (!rimasto) return;
    const ora = M.contaZone(stato.layout);
    annuncia((v ? v.etichetta : 'Zona') + ' eliminata: ' + (ora > 1 ? 'ora ci sono ' + ora + ' zone.' : 'il foglio è di nuovo una sola zona.'));
    cambiato();
    focusBlocco(L.primaFoglia(rimasto).id);
  }

  // ---- descrittori dei blocchi

  const ZONA_SEZIONI = [
    {
      titolo: 'Motivo',
      campi: [
        {
          tipo: 'radio', percorso: 'zona.motivo', etichetta: 'Motivo della zona', etichettaNascosta: true, classe: 'motivi',
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
      visibile: (s, c) => motivoDi(c) !== 'bianco',
      campi: [
        {
          tipo: 'numero', percorso: 'zona.passoX', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: (s, c) => (motivoDi(c) === 'righe-verticali' ? 'Distanza tra le righe' : dueAssi(c) && impDi(c).passoUguale ? 'Passo' : 'Passo orizzontale'),
          visibile: motivoTra('puntini', 'quadretti', 'righe-verticali')
        },
        { tipo: 'casella', percorso: 'zona.passoUguale', etichetta: 'Passo verticale uguale all’orizzontale', visibile: motivoTra('puntini', 'quadretti') },
        {
          tipo: 'numero', percorso: 'zona.passoY', unita: 'mm', min: M.LIMITI.passo.min, max: M.LIMITI.passo.max, passo: 0.1,
          minCursore: 2, maxCursore: 20, passoCursore: 0.1,
          etichetta: (s, c) => (motivoDi(c) === 'righe-orizzontali' ? 'Distanza tra le righe' : 'Passo verticale'),
          visibile: (s, c) => motivoDi(c) === 'righe-orizzontali' || (dueAssi(c) && !impDi(c).passoUguale)
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
        { tipo: 'numero', percorso: 'zona.tratto', etichetta: 'Lunghezza del tratto', unita: 'mm', min: M.LIMITI.tratto.min, max: M.LIMITI.tratto.max, passo: 0.1, minCursore: 0.5, maxCursore: 10, passoCursore: 0.1, visibile: (s, c) => impDi(c).stileLinea === 'tratteggiata' },
        {
          tipo: 'numero', percorso: 'zona.spazio', unita: 'mm', min: M.LIMITI.spazio.min, max: M.LIMITI.spazio.max, passo: 0.1, minCursore: 0.2, maxCursore: 10, passoCursore: 0.1,
          etichetta: (s, c) => (impDi(c).stileLinea === 'puntini' ? 'Distanza tra i puntini' : 'Spazio tra i tratti'),
          visibile: (s, c) => impDi(c).stileLinea !== 'continua'
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
      titolo: 'Foglio finito e rifilo',
      campi: [
        {
          tipo: 'casella', percorso: 'zona.foglio.attivo', etichetta: 'Questa zona è un foglio aperto da rifilare',
          nota: (s, c) => (fgDi(c).attivo ? '' : 'Mostra nell’anteprima cosa resta dopo il rifilo; la griglia parte dal bordo del foglio finito.')
        },
        { tipo: 'numero', percorso: 'zona.foglio.larghezza', etichetta: 'Larghezza del foglio aperto (prima del rifilo)', unita: 'mm', soloNumero: true, min: M.LIMITI.dimPagina.min, max: M.LIMITI.dimPagina.max, passo: 0.1, visibile: fgAttivo },
        { tipo: 'numero', percorso: 'zona.foglio.altezza', etichetta: 'Altezza del foglio aperto (prima del rifilo)', unita: 'mm', soloNumero: true, min: M.LIMITI.dimPagina.min, max: M.LIMITI.dimPagina.max, passo: 0.1, visibile: fgAttivo },
        { tipo: 'nota', testo: 'Rifilo: quanto si toglie su ogni lato dopo la piegatura. Ogni stampa può avere una ripartizione diversa.', visibile: fgAttivo },
        rifilo('sinistra', 'Rifilo a sinistra'),
        rifilo('destra', 'Rifilo a destra'),
        rifilo('alto', 'Rifilo in alto'),
        rifilo('basso', 'Rifilo in basso'),
        {
          tipo: 'radio', percorso: 'zona.foglio.disegno', etichetta: 'Disegno della griglia', visibile: fgAttivo,
          opzioni: [['dentro', 'Dentro il foglio finito'], ['abbondanza', 'Con abbondanza']],
          nota: (s, c) => (fgDi(c).disegno === 'dentro'
            ? 'Linee e puntini si fermano dentro il foglio finito.'
            : 'Lo stesso reticolo continua anche nella parte che verrà tagliata.')
        },
        { tipo: 'casella', percorso: 'zona.foglio.distanza.uguale', etichetta: 'Stessa distanza dal bordo su tutti i lati', visibile: fgAttivo },
        {
          tipo: 'numero', percorso: 'zona.foglio.distanza.tutti', etichetta: 'Distanza dal bordo del foglio finito', unita: 'mm', soloNumero: true,
          min: M.LIMITI.distanzaFoglio.min, max: M.LIMITI.distanzaFoglio.max, passo: 0.1,
          visibile: (s, c) => fgAttivo(s, c) && fgDi(c).distanza.uguale
        },
        distanzaLato('alto', 'Distanza in alto'),
        distanzaLato('basso', 'Distanza in basso'),
        distanzaLato('sinistra', 'Distanza a sinistra'),
        distanzaLato('destra', 'Distanza a destra'),
        {
          tipo: 'radio', percorso: 'zona.foglio.piega.modo', etichetta: 'Piega', visibile: fgAttivo,
          opzioni: [['orizzontale', 'Orizzontale, al centro'], ['nessuna', 'Nessuna']],
          nota: (s, c) => (fgDi(c).piega.modo === 'orizzontale'
            ? 'Al centro dell’altezza del foglio aperto (prima del rifilo). Le due metà hanno la griglia speculare rispetto alla piega. La piega si vede solo nell’anteprima.'
            : '')
        },
        {
          tipo: 'numero', percorso: 'zona.foglio.piega.distanza', etichetta: 'Distanza della prima riga dalla piega', unita: 'mm', soloNumero: true,
          min: M.LIMITI.distanzaPiega.min, max: M.LIMITI.distanzaPiega.max, passo: 0.1,
          visibile: (s, c) => fgAttivo(s, c) && fgDi(c).piega.modo === 'orizzontale'
        },
        { tipo: 'nota', testo: (s, c) => testoDistanze(c), visibile: fgAttivo },
        {
          tipo: 'pulsante', azione: (c) => copiaFoglioInTutte(c), etichetta: 'Copia queste misure in tutte le zone',
          visibile: (s, c) => fgAttivo(s, c) && piuZone()
        }
      ]
    },
    {
      titolo: 'Prima e ultima pagina (immagini)',
      visibile: (s, c) => c.id === L.primaFoglia(s.layout).id && fgAttivo(s, c) && fgDi(c).piega.modo === 'orizzontale',
      campi: [
        { tipo: 'nota', testo: 'Una PNG per ciascuna metà del foglio aperto, sopra e sotto la piega. Nelle metà con immagine non c’è griglia. Le immagini non si salvano nei preset: dopo aver ricaricato la pagina vanno scelte di nuovo. Per 300 dpi servono circa 1713 × 1200 px per metà.' },
        ...['alto', 'basso'].flatMap((lato) => {
          const quando = () => !!immagini[lato];
          return [
            { tipo: 'immagine', lato },
            { tipo: 'selezione', percorso: 'zona.foglio.immagini.' + lato + '.adatta', etichetta: 'Adattamento (immagine ' + NOMI_LATO[lato] + ')', visibile: quando, opzioni: [['contieni', 'Contieni (tutta visibile)'], ['riempi', 'Riempi (ritaglia l’eccesso)'], ['estendi', 'Estendi (deforma)']] },
            { tipo: 'selezione', percorso: 'zona.foglio.immagini.' + lato + '.area', etichetta: 'Area (immagine ' + NOMI_LATO[lato] + ')', visibile: quando, opzioni: [['aperto', 'Foglio aperto (con abbondanza)'], ['finito', 'Solo foglio finito']] },
            { tipo: 'casella', percorso: 'zona.foglio.immagini.' + lato + '.ruota', etichetta: 'Ruota di 180° (immagine ' + NOMI_LATO[lato] + ')', visibile: quando }
          ];
        })
      ]
    },
    {
      titolo: 'Dividi questa zona',
      campi: [
        {
          tipo: 'pulsante', azione: (c) => dividi(c.id, 'verticale'),
          etichetta: 'Dividi con una linea verticale',
          nota: 'Due zone affiancate, una a sinistra e una a destra.'
        },
        {
          tipo: 'pulsante', azione: (c) => dividi(c.id, 'orizzontale'),
          etichetta: 'Dividi con una linea orizzontale',
          nota: 'Due zone una sopra l’altra.'
        }
      ]
    }
  ];

  const DIVISIONE_SEZIONI = [
    {
      titolo: null,
      campi: [
        {
          tipo: 'radio', percorso: 'divisione.direzione', etichetta: 'Direzione della linea',
          opzioni: [['verticale', 'Verticale (zone affiancate)'], ['orizzontale', 'Orizzontale (zone sovrapposte)']]
        },
        {
          tipo: 'radio', percorso: 'divisione.posizione.unita', etichetta: 'Posizione misurata in',
          opzioni: [['%', 'Percentuale'], ['mm', 'Millimetri']],
          prima: (nuova, c) => convertiPosizione(nuova, c)
        },
        {
          tipo: 'numero', percorso: 'divisione.posizione.valore', passo: 0.1, passoCursore: 0.5,
          etichetta: (s, c) => (divDi(c).direzione === 'verticale' ? 'Posizione dal lato sinistro' : 'Posizione dal lato superiore'),
          unita: (s, c) => divDi(c).posizione.unita,
          min: 0, minCursore: 0,
          max: (s, c) => (divDi(c).posizione.unita === '%' ? 100 : lunghezzaDivisione(c)),
          maxCursore: (s, c) => (divDi(c).posizione.unita === '%' ? 100 : lunghezzaDivisione(c)),
          nota: 'Se una zona risulterebbe più stretta di ' + M.MIN_ZONA + ' mm la linea viene spostata e comparirà un avviso.'
        },
        {
          tipo: 'numero', percorso: 'divisione.spazio', etichetta: 'Spazio tra le due zone', unita: 'mm',
          min: M.LIMITI.spazioZone.min, max: M.LIMITI.spazioZone.max, passo: 0.1,
          minCursore: 0, maxCursore: 20, passoCursore: 0.5,
          nota: 'Fascia lasciata libera attorno alla linea: le griglie delle due zone partono ai suoi lati.'
        },
        {
          tipo: 'casella', percorso: 'divisione.linea.visibile', etichetta: 'Stampa questa linea nel PDF',
          nota: (s, c) => (divDi(c).linea.visibile ? '' : 'La linea non viene stampata: resta nell’anteprima come guida tratteggiata.')
        },
        {
          tipo: 'numero', percorso: 'divisione.linea.spessore', etichetta: 'Spessore della linea', unita: 'mm',
          min: M.LIMITI.spessore.min, max: M.LIMITI.spessore.max, passo: 0.01, minCursore: 0.05, maxCursore: 1, passoCursore: 0.01,
          visibile: (s, c) => divDi(c).linea.visibile
        },
        { ...intensita('divisione.linea.intensita'), etichetta: 'Intensità del grigio della linea', visibile: (s, c) => divDi(c).linea.visibile },
        {
          tipo: 'selezione', percorso: 'divisione.linea.stile', etichetta: 'Stile della linea',
          opzioni: [['continua', 'Continua'], ['tratteggiata', 'Tratteggiata'], ['puntini', 'A puntini']],
          visibile: (s, c) => divDi(c).linea.visibile
        },
        {
          tipo: 'numero', percorso: 'divisione.linea.tratto', etichetta: 'Lunghezza del tratto', unita: 'mm',
          min: M.LIMITI.tratto.min, max: M.LIMITI.tratto.max, passo: 0.1, minCursore: 0.5, maxCursore: 10, passoCursore: 0.1,
          visibile: (s, c) => divDi(c).linea.visibile && divDi(c).linea.stile === 'tratteggiata'
        },
        {
          tipo: 'numero', percorso: 'divisione.linea.spazio', unita: 'mm',
          min: M.LIMITI.spazio.min, max: M.LIMITI.spazio.max, passo: 0.1, minCursore: 0.2, maxCursore: 10, passoCursore: 0.1,
          etichetta: (s, c) => (divDi(c).linea.stile === 'puntini' ? 'Distanza tra i puntini' : 'Spazio tra i tratti'),
          visibile: (s, c) => divDi(c).linea.visibile && divDi(c).linea.stile !== 'continua'
        },
        {
          tipo: 'pulsante', azione: (c) => unisci(c.id),
          etichetta: 'Unisci le due parti in una zona',
          nota: 'Resta una sola zona con le impostazioni della prima; le altre zone di questa divisione vengono eliminate.'
        }
      ]
    }
  ];

  const DESCRITTORI_INIZIO = [
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
    }
  ];

  const DESCRITTORI_FINE = [
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
  function creaSezioneGlobale(dSez) {
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
  DESCRITTORI_INIZIO.forEach(creaSezioneGlobale);

  // ---- sezione «Zone»: un blocco per ogni zona e per ogni divisione

  const zoneEl = el('fieldset', 'sezione sezione-zone');
  zoneEl.appendChild(el('legend', null, 'Zone'));
  zoneEl.appendChild(el('p', 'nota nota-fissa', 'Dividi il foglio con una linea verticale o orizzontale. Ogni zona ha il suo blocco con motivo e misure; ogni linea di divisione ha il suo. Puoi dividere ancora una zona per ottenere croci e griglie di zone.'));
  const barraBlocchi = el('div', 'barra-blocchi');
  const bApriTutti = el('button', 'pulsante secondario piccolo', 'Apri tutti');
  const bChiudiTutti = el('button', 'pulsante secondario piccolo', 'Chiudi tutti');
  bApriTutti.type = bChiudiTutti.type = 'button';
  barraBlocchi.append(bApriTutti, bChiudiTutti);
  const blocchiEl = el('div', 'blocchi');
  zoneEl.append(barraBlocchi, blocchiEl);
  contenitoreSezioni.appendChild(zoneEl);
  bApriTutti.addEventListener('click', () => { for (const b of blocchi) impostaAperto(b, true); annuncia('Tutti i blocchi aperti.'); });
  bChiudiTutti.addEventListener('click', () => { for (const b of blocchi) impostaAperto(b, false); annuncia('Tutti i blocchi chiusi.'); });

  DESCRITTORI_FINE.forEach(creaSezioneGlobale);

  function impostaAperto(b, aperto) {
    aperti.set(b.id, aperto);
    b.corpo.hidden = !aperto;
    b.btn.setAttribute('aria-expanded', String(aperto));
    b.nodo.classList.toggle('aperto', aperto);
  }

  function creaBlocco(v, nZone) {
    const ctx = { id: v.id, tipo: v.tipo };
    const nodo = el('div', 'blocco ' + v.tipo);
    const testa = el('div', 'blocco-testa');
    const idCorpo = prossimoId();
    const btn = el('button', 'blocco-titolo');
    btn.type = 'button';
    btn.setAttribute('aria-controls', idCorpo);
    const freccia = el('span', 'freccia', '▸');
    freccia.setAttribute('aria-hidden', 'true');
    const nome = el('span', 'blocco-nome', v.etichetta);
    const riepilogo = el('span', 'blocco-riepilogo');
    btn.append(freccia, nome, riepilogo);
    testa.appendChild(btn);

    // La X in alto a destra toglie la zona (non esiste per le divisioni né per l'unica zona).
    let chiudi = null;
    if (v.tipo === 'zona' && nZone > 1) {
      chiudi = el('button', 'voce-chiudi', '×');
      chiudi.type = 'button';
      chiudi.addEventListener('click', () => eliminaZona(v.id));
      testa.appendChild(chiudi);
    }

    const corpo = el('div', 'blocco-corpo');
    corpo.id = idCorpo;
    const parti = [];
    for (const dSez of v.tipo === 'zona' ? ZONA_SEZIONI : DIVISIONE_SEZIONI) {
      const sNodo = dSez.titolo ? el('fieldset', 'sottosezione') : el('div', 'sottosezione');
      if (dSez.titolo) sNodo.appendChild(el('legend', null, dSez.titolo));
      const controlli = [];
      for (const dc of dSez.campi) {
        const c = creaControllo(dc, ctx);
        sNodo.appendChild(c.nodo);
        controlli.push(c);
      }
      corpo.appendChild(sNodo);
      parti.push({ d: dSez, nodo: sNodo, controlli });
    }
    nodo.append(testa, corpo);

    const b = { id: v.id, tipo: v.tipo, ctx, nodo, btn, nome, riepilogo, corpo, chiudi, parti, etichetta: '' };
    btn.addEventListener('click', () => impostaAperto(b, b.corpo.hidden));
    // Collegamento con l'anteprima: sopra il blocco si illumina la zona (o la linea) corrispondente.
    nodo.addEventListener('pointerenter', () => evidenziaNodo(b.id));
    nodo.addEventListener('pointerleave', () => evidenziaNodo(null));
    nodo.addEventListener('focusin', () => evidenziaNodo(b.id));
    nodo.addEventListener('focusout', () => evidenziaNodo(null));
    return b;
  }

  function etichettaBlocco(b, v) {
    if (b.etichetta === v.etichetta) return;
    b.etichetta = v.etichetta;
    b.nome.textContent = v.etichetta;
    if (b.chiudi) {
      b.chiudi.setAttribute('aria-label', 'Elimina ' + v.etichetta);
      b.chiudi.title = 'Elimina ' + v.etichetta + ' (la zona accanto prende il suo posto)';
    }
  }

  // Ricostruisce i blocchi solo quando cambia la struttura del foglio (zone e divisioni).
  function sincronizzaBlocchi() {
    const ordine = L.ordineVisivo(stato.layout);
    const nZone = M.contaZone(stato.layout);
    const firma = nZone + '|' + ordine.map((v) => v.id).join(',');
    if (firma !== firmaBlocchi) {
      firmaBlocchi = firma;
      for (const b of blocchi) aperti.set(b.id, !b.corpo.hidden);
      blocchi.length = 0;
      blocchiEl.replaceChildren();
      for (const v of ordine) {
        const b = creaBlocco(v, nZone);
        blocchi.push(b);
        blocchiEl.appendChild(b.nodo);
        // Con una sola zona il blocco è aperto; con più zone restano aperti solo quelli scelti.
        impostaAperto(b, nZone === 1 ? true : aperti.get(v.id) === true);
      }
    }
    barraBlocchi.hidden = nZone < 2;
    ordine.forEach((v, i) => {
      const b = blocchi[i];
      etichettaBlocco(b, v);
      for (const s of b.parti) {
        const visibile = s.d.visibile ? s.d.visibile(stato, b.ctx) : true;
        s.nodo.hidden = !visibile;
        if (!visibile) continue;
        for (const c of s.controlli) c.aggiorna();
      }
    });
  }

  // Riepilogo di una riga nell'intestazione del blocco (misure, motivo, posizione della linea).
  function aggiornaRiepiloghi(foglio) {
    for (const b of blocchi) {
      const n = L.trovaNodo(stato.layout, b.id);
      if (!n) continue;
      let t = '';
      if (n.tipo === 'zona') {
        const z = foglio.zone.find((x) => x.id === b.id);
        t = z && z.finito
          ? 'finito ' + M.formattaIt(z.finito.finito.w) + ' × ' + M.formattaIt(z.finito.finito.h) + ' mm · '
          : (z ? M.formattaIt(z.rettangolo.w) + ' × ' + M.formattaIt(z.rettangolo.h) + ' mm · ' : '');
        t += NOMI_MOTIVI[n.impostazioni.motivo] || '';
      } else {
        const dv = foglio.divisioni.find((x) => x.id === b.id);
        t = 'Linea ' + n.direzione + (dv ? ' a ' + M.formattaIt(dv.posizioneMm) + ' mm' : '') + (n.linea.visibile ? '' : ' · non stampata');
      }
      b.riepilogo.textContent = t;
      // Le note con le distanze dipendono dal foglio appena calcolato.
      for (const s of b.parti) for (const c of s.controlli) if (c.d.tipo === 'nota' || c.d.tipo === 'immagine') c.aggiorna();
    }
  }

  // Illumina nell'anteprima la zona o la linea del blocco (e viceversa), solo mentre ci si passa sopra.
  function evidenziaNodo(id) {
    for (const r of foglioEl.querySelectorAll('.evidenziata')) r.classList.remove('evidenziata');
    for (const b of blocchi) b.nodo.classList.toggle('evidenziato', b.id === id);
    if (id && /^[zd]\d+$/.test(id)) {
      const r = foglioEl.querySelector('[data-nodo="' + id + '"]');
      if (r) r.classList.add('evidenziata');
    }
  }

  function evidenziaNodoBlocco(id) {
    for (const b of blocchi) b.nodo.classList.toggle('evidenziato', b.id === id);
  }

  // Clic sull'anteprima: apre il blocco corrispondente, lo porta in vista e lo fa lampeggiare un attimo.
  function vaiAlBlocco(id) {
    const b = blocchi.find((x) => x.id === id);
    if (!b) return;
    impostaAperto(b, true);
    const ridotto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    b.nodo.scrollIntoView({ block: 'nearest', behavior: ridotto ? 'auto' : 'smooth' });
    b.nodo.classList.remove('lampo');
    void b.nodo.offsetWidth; // riavvia l'animazione
    b.nodo.classList.add('lampo');
    window.setTimeout(() => b.nodo.classList.remove('lampo'), 1400);
    b.btn.focus({ preventScroll: true });
    annuncia(b.etichetta + ' aperta.');
  }

  // ------------------------------------------------------------ aggiornamento

  function aggiornaControlli() {
    for (const s of sezioni) {
      const visibile = s.d.visibile ? s.d.visibile(stato) : true;
      s.nodo.hidden = !visibile;
      if (!visibile) continue;
      s.legenda.textContent = testo(s.d.titolo, stato);
      for (const c of s.controlli) c.aggiorna();
    }
    sincronizzaBlocchi();
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
    switch (L.primaFoglia(stato.layout).impostazioni.motivo) {
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
    const foglio = G.generaFoglio(stato, dimImmagini());
    for (const el of foglio.elementi) if (el.tipo === 'immagine' && immagini[el.lato]) el.anteprima = immagini[el.lato].anteprima;
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

    const conFinito = foglio.zone.some((z) => z.finito);
    if (casellaVista) casellaVista.hidden = !conFinito;
    A.mostra(foglioEl, foglio, { dividi: modoDividi, vistaFinita: vistaFinita && conFinito });
    aggiornaRiepiloghi(foglio);
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
      P.scarica(IM.preparaPerPdf(ultimo, immagini), nome);
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
      vaiAlBlocco(n.id);
      return;
    }
    if (n.tipo === 'divisione') {
      const prima = M.contaZone(stato.layout);
      const zona = L.unisciDivisione(stato, n.id);
      if (!zona) return;
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
      apriSolo(r.divisione.id);
      annuncia('Zona divisa a ' + M.formattaIt(t.valore) + ' mm: ora ci sono ' + M.contaZone(stato.layout) + ' zone.');
    }
    A.guida(foglioEl, null);
    cambiato();
  });

  // Guida che segue il puntatore: mostra dove cadrebbe la linea (o segnala che un clic la toglie).
  foglioEl.addEventListener('pointermove', (e) => {
    const sotto = nodoSotto(e);
    if (!modoDividi) {
      // Il blocco corrispondente si illumina solo mentre il puntatore è sopra la zona o la linea.
      evidenziaNodoBlocco(sotto ? sotto.id : null);
      return;
    }
    const n = sotto;
    evidenziaNodoBlocco(n ? n.id : null);
    foglioEl.classList.toggle('su-linea', !!n && n.tipo === 'divisione');
    if (!n || n.tipo !== 'zona') {
      A.guida(foglioEl, null);
      return;
    }
    const t = taglioPrevisto(n.id, e);
    A.guida(foglioEl, t && t.segmento ? t.segmento : null);
  });
  foglioEl.addEventListener('pointerleave', () => {
    evidenziaNodoBlocco(null);
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

    const labVista = el('label', 'casella');
    const cVista = el('input');
    cVista.type = 'checkbox';
    cVista.id = prossimoId();
    labVista.append(cVista, el('span', null, 'Vista finita (nasconde lo scarto)'));
    labVista.hidden = true;
    casellaVista = labVista;
    riga.appendChild(labVista);
    cVista.addEventListener('change', () => {
      vistaFinita = cVista.checked;
      rigenera();
      annuncia(vistaFinita ? 'Vista finita attiva: lo scarto è nascosto nell’anteprima.' : 'Vista finita disattivata.');
    });

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
      if (ultimo && !ultimo.errore) A.evidenzia(foglioEl, ultimo, { dividi: modoDividi });
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

  // Sostituisce tutte le impostazioni (da preset, file o ripristino) e riparte con i blocchi nello stato iniziale.
  function applicaStato(nuovo) {
    const avevaImmagini = !!(immagini.alto || immagini.basso);
    togliImmagine('alto');
    togliImmagine('basso');
    if (avevaImmagini) annuncia('Le immagini sono state rimosse: vanno caricate di nuovo.');
    Object.assign(stato, nuovo);
    aperti.clear();
    cambiato();
  }

  const MODELLI = PR.modelli();
  const PREFISSO_MODELLO = '\u0000modello:';

  function creaPannelloPreset() {
    const nodo = el('fieldset', 'sezione');
    const legenda = el('legend', null, 'Preset');
    nodo.appendChild(legenda);
    nodo.appendChild(el('p', 'nota nota-fissa', 'Un preset salva formato, margini, zone e tutte le impostazioni. Si conserva in questo browser, su questo dispositivo; per spostarlo altrove esportalo in un file.'));

    const idSelezione = prossimoId();
    const campoSel = el('div', 'campo');
    const etichettaSel = el('label', null, 'Preset e modelli');
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
      const vuoto = el('option', null, '— scegli un preset o un modello —');
      vuoto.value = '';
      elenco.appendChild(vuoto);
      // I modelli incorporati hanno un valore che un nome salvato non può avere (i caratteri di controllo vengono tolti).
      const gMod = el('optgroup');
      gMod.label = 'Modelli incorporati';
      MODELLI.forEach((m, i) => {
        const o = el('option', null, m.nome);
        o.value = PREFISSO_MODELLO + i;
        gMod.appendChild(o);
      });
      elenco.appendChild(gMod);
      if (nomi.length) {
        const gUt = el('optgroup');
        gUt.label = 'I tuoi preset';
        for (const n of nomi) {
          const o = el('option', null, n);
          o.value = n;
          gUt.appendChild(o);
        }
        elenco.appendChild(gUt);
      }
      elenco.value = scelto && nomi.indexOf(scelto) !== -1 ? scelto : '';
      aggiornaBottoni();
    }
    function aggiornaBottoni() {
      bCarica.disabled = !elenco.value;
      bElimina.disabled = !elenco.value || elenco.value.startsWith(PREFISSO_MODELLO);
    }
    elenco.addEventListener('change', () => {
      aggiornaBottoni();
      if (elenco.value && !elenco.value.startsWith(PREFISSO_MODELLO)) nome.value = elenco.value;
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
      if (elenco.value.startsWith(PREFISSO_MODELLO)) {
        const m = MODELLI[Number(elenco.value.slice(PREFISSO_MODELLO.length))];
        if (!m) return;
        applicaStato(JSON.parse(JSON.stringify(m.stato)));
        mostra('Modello «' + m.nome + '» caricato.', false);
        return;
      }
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
    }
  }

  aggiornaControlli();
  rigenera();
})();
