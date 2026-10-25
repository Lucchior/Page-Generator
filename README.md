# Generatore di fogli

Sito statico per creare fogli a **puntini**, **righe** o **quadretti** nel formato che preferisci e scaricarli in **PDF in scala reale**, pronti da stampare (per quaderni, taccuini e lavori di rilegatura).

Funziona interamente nel browser: nessun server, nessun account, nessun dato inviato in rete. Si pubblica su GitHub Pages.

> Stato: **Fase 1 di 3** (foglio con una sola zona). La divisione del foglio in più zone, il salvataggio dei preset e il tema chiaro/scuro con interruttore arrivano nelle fasi successive. Vedi `PROJECT_STATUS.md`.

## Cosa fa (Fase 1)

- **Formati:** A3, A4, A5, A6, B5, B6, JIS B5, JIS B6, Letter, Half Letter e misura personalizzata (da 20 a 1000 mm). Verticale o orizzontale.
- **Motivi:** puntini, righe orizzontali, quadretti, righe verticali, foglio bianco.
- **Tutto regolabile:** ogni valore ha un cursore e un campo numerico in cui scrivere la misura esatta (in millimetri).
  - passo orizzontale e verticale (anche indipendenti);
  - spessore e intensità di grigio delle linee (100% = nero, 0% = bianco);
  - stile delle linee: continua, tratteggiata, a puntini (con lunghezza del tratto e spazio);
  - forma (tondi o quadrati), dimensione e grigio dei puntini.
- **Margini:** senza margine (la griglia riempie la pagina), uguali su tutti i lati oppure diversi per ogni lato. Due modi: *fissa* (parte dall'angolo in alto a sinistra) oppure *adattata al passo* (entra un numero esatto di celle e la griglia è centrata).
- **Anteprima dal vivo** su un tappetino da taglio, con numero di celle e distanza minima dal bordo.
- **Avviso sul bordo:** molte stampanti non stampano vicino al bordo del foglio. Se il disegno arriva più vicino della soglia che imposti (predefinita: 5 mm) compare un avviso.
- **PDF vettoriale** con le dimensioni esatte del foglio. Il nome del file è automatico (per esempio `foglio-A4-puntini-5mm.pdf`) oppure lo scegli tu.

## Come si usa

1. Scegli formato e orientamento.
2. Scegli il motivo e regola passo, spessore e grigio.
3. Controlla l'anteprima e gli eventuali avvisi.
4. Premi **Scarica PDF**.

### Stampa in scala reale

Apri il PDF e, nella finestra di stampa, scegli **scala 100%** (o «dimensione reale») e **disattiva «Adatta alla pagina»**. Se la stampa viene ridimensionata, le misure non corrispondono più. Il PDF contiene già l'indicazione di non ridimensionare, ma non tutti i programmi la rispettano.

Per un controllo rapido: stampa un foglio a quadretti con passo 10 mm e misura con il righello dieci quadretti: devono essere 100 mm.

Per il fronte-retro, stampa la prima pagina e poi imposta il fronte-retro dal menu di stampa.

## Aprire il sito in locale

Il modo più semplice: apri `index.html` con un doppio clic. Funziona anche così, perché usa solo percorsi relativi e script classici.

In alternativa, da terminale, nella cartella del progetto:

```
python3 -m http.server 8000
```

e apri `http://localhost:8000`.

## Pubblicare su GitHub Pages (manuale)

1. Crea il repository `Page-Generator` sul tuo account GitHub (`Lucchior`), se non l'hai già fatto.
2. Carica tutto il contenuto della cartella del progetto **mantenendo le sottocartelle** (`css/`, `js/`, `vendor/`, `test/`) e i file nella radice (`index.html`, `README.md`, `LICENSE`, `PROJECT_STATUS.md`).
3. Nel repository vai su **Settings → Pages**. In *Build and deployment* scegli **Deploy from a branch**, il ramo `main` e la cartella `/ (root)`, poi salva.
4. Dopo un minuto o due il sito è raggiungibile all'indirizzo che GitHub mostra nella stessa pagina, che dovrebbe essere `https://lucchior.github.io/Page-Generator/`.

Dopo la pubblicazione controlla che: la pagina si carichi senza errori nella console del browser, l'anteprima compaia, il pulsante **Scarica PDF** scarichi un file e il PDF abbia le dimensioni giuste. Tutti i percorsi sono relativi e in minuscolo, quindi funzionano anche sotto il percorso del repository.

## Struttura del progetto

```
index.html                pagina unica
css/stile.css             stili, temi chiaro e scuro
js/modello.js             formati, limiti, valori predefiniti, validazione
js/geometria.js           calcolo di linee e puntini in millimetri
js/anteprima.js           anteprima SVG
js/pdf.js                 esportazione PDF
js/interfaccia.js         controlli e collegamento di tutte le parti
vendor/jspdf.umd.min.js   libreria jsPDF 4.2.1 (di terzi)
vendor/LICENSE-jspdf.txt  licenza di jsPDF
test/geometria.test.js    test automatici
LICENSE                   licenza del progetto (MIT)
PROJECT_STATUS.md         stato del progetto
```

Anteprima e PDF leggono lo stesso risultato di `js/geometria.js`: ciò che vedi è ciò che viene stampato.

## Test

Servono solo Node (versione 18 o successiva) e nessuna installazione di pacchetti. Dalla cartella del progetto:

```
node --test
```

I test verificano geometria, margini, validazione degli input, nomi dei file e il PDF generato (dimensioni della pagina in millimetri, numero di puntini e di linee, tratteggio).

## Libreria di terzi

Il PDF viene creato con **jsPDF 4.2.1** (licenza MIT, https://github.com/parallax/jsPDF), inclusa nel file `vendor/jspdf.umd.min.js`. Il file è stato scaricato da cdnjs.

Per verificare di avere il file originale, confronta l'hash con quello indicato da cdnjs per `jspdf/4.2.1`:

```
SHA-256: e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54
SHA-512 (formato SRI): sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==
```

Per aggiornare jsPDF sostituisci quel file con la nuova versione (`dist/jspdf.umd.min.js`) e aggiorna questo paragrafo. Le versioni recenti di jsPDF correggono vulnerabilità di sicurezza: conviene controllare ogni tanto le novità. Questo sito usa jsPDF solo per disegnare linee, cerchi e rettangoli.

Il file contiene in fondo il riferimento a una mappa dei sorgenti (`jspdf.umd.min.js.map`) che non è inclusa: serve solo per il debug e la sua assenza non influisce sul funzionamento (a strumenti di sviluppo aperti il browser può segnalare che non la trova).

## Limiti noti

- Le stampanti hanno una zona non stampabile ai bordi: con «senza margine» la parte esterna può mancare.
- Il numero di puntini è limitato a 80.000 per foglio, per tenere veloci anteprima e PDF.
- I preset e la divisione in zone non sono ancora disponibili (Fasi 2 e 3).

## Licenza

MIT, vedi `LICENSE` (intestatario: Lucchior). jsPDF ha la sua licenza MIT in `vendor/LICENSE-jspdf.txt`.
