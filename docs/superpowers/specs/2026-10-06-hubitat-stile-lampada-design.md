# Calendary 0.11.0 — Stile Hubitat e lampada ad arco

Data: 6 ottobre 2026 · Stato: in revisione
Origine: nota "Restyling ecosistema Hubitat" (cartella Hubitat in Calendary) e decisioni di Mattia del 6/10.

## 1. Obiettivo

Calendary passa allo stile comune dell'ecosistema Hubitat: **sfondo nero, arancione come colore e come luce**, con superfici di vetro a rifrazioni colorate e comandi in argilla (§2). Al centro c'è una **lampada da terra ad arco** che "illumina" l'app e che con un tocco passa tra le tre modalità **Normale → Risparmio energetico → Notte**.

Lo stesso componente lampada andrà poi nella homepage dell'hub Hubitat (progetto futuro): è scritto per essere copiato così com'è (un componente React + un file CSS, senza dipendenze da Calendary).

## 2. Un solo tema: "Hubitat" (vetro e argilla)

Stile comune a **tutte le app dell'ecosistema** (Calendary, Moveo, WardApp, il futuro hub): **Glassmorphism con rifrazioni colorate** per le superfici e **Claymorphism** per gli elementi da toccare. Nero e arancione restano i colori predominanti.

- **Tema unico**: Hubitat sostituisce Neon e Minimal, che vengono eliminati (CSS, selettore nelle Impostazioni, `theme.ts`). Una preferenza salvata `neon`/`minimal` viene ignorata.
- **Fondo**: nero `#070605` con poche macchie di luce arancione sfocate e ferme (in Calendary sono la luce della lampada). Il vetro "rifrange" su di esse.
- **Vetro** (card, pannelli, finestre, barre):
  - superficie trasparente con sfumatura bianca 10% → 3%, `backdrop-filter: blur(18px) saturate(160%)`;
  - un riflesso in alto a sinistra e un'ombra profonda;
  - **bordo prismatico**: gradiente conico sottile (1,5 px) arancione → ambra → rosa → viola → azzurro → arancione, come la luce scomposta da un vetro. È l'unico punto in cui compaiono colori diversi da nero e arancione, sempre tenui.
- **Argilla** (pulsanti, chip, interruttori, segmenti):
  - forme morbide e "gonfie" (raggio 18 px), con luce interna in alto a sinistra e ombra interna in basso a destra, più ombra esterna;
  - principali **arancioni** `#ff8a1f` con testo scuro `#2a1302`, secondari **neri caldi** `#1d1915`;
  - alla pressione si "schiacciano" (scala 0,96, ombre interne invertite).
- **Testi**: `#f3ece4`, secondari `#b9ab9c`; numeri e titoli importanti in arancione chiaro `#ffb46a` con alone. I colori dei calendari restano quelli scelti dall'utente.
- **Risparmio energetico**: vetro senza sfocatura (superficie opaca `#14110e`), niente aloni, rifrazioni e ombre esterne, argilla appiattita. È il punto in cui si risparmia batteria sui tablet.
- Campione di riferimento (da confermare da Mattia): card a vetro con bordo prismatico + pulsanti e chip in argilla arancione/nera, prototipo del 6/10.
- I caratteri restano quelli attuali di ogni app.

## 3. La lampada

### 3.1 Aspetto

Lampada da terra ad arco come nella foto di riferimento:
- base rettangolare nera lucida in basso a destra;
- stelo sottile nero che sale e si curva verso sinistra;
- paralume conico nero in alto a sinistra, con il bordo inferiore che si accende di arancione;
- sotto il paralume una **lampadina di vetro con filamento**.

È disegnata in SVG con sfumature e ombre leggere, per dare un'idea di volume (un "oggetto 3D" piatto, senza librerie 3D).

### 3.2 La luce

- Un **cono di luce** parte dal paralume e scende sull'app: un livello sopra lo sfondo e sotto i contenuti, con gradiente radiale arancione.
- Le card nel cono sono un po' più chiare e il loro bordo verso la lampada riflette l'arancione. È la lampada a "dare la luce" all'app.
- **Accensione**: prima si scalda il filamento (0,3 s), poi la lampadina passa da ambra a bianco caldo e il cono si allarga (circa 1,2 s, `ease-out`).
- **Spegnimento**: lo stesso al contrario.
- **Mai lampeggiante**, nessuno sfarfallio. Con `prefers-reduced-motion` i passaggi sono dissolvenze brevi.

### 3.3 Dove

| Dispositivo | Lampada |
|---|---|
| **Tablet** (vista `/kiosk`) e **PC** (dashboard *Oggi*) | Grande: occupa l'angolo in alto a sinistra della pagina, la luce cade sulla dashboard. La base sta in basso a destra della colonna della lampada (sul PC accanto alla barra laterale). |
| **Telefono** | Piccola: un paralume con lampadina nell'intestazione (circa 40 px). Toccandolo fa lo stesso ciclo; il cono di luce è un alone leggero in alto nella pagina. |

## 4. Le tre modalità

| Modalità | Lampada | App |
|---|---|---|
| **Normale** | Accesa, luce piena | Aloni e riflessi arancioni attivi |
| **Risparmio energetico** | Luce al 35%, filamento tenue | Spenti gli aloni delle scritte, i riflessi e le animazioni (come l'attuale `html.eco`); aggiornamenti più radi; luminosità più bassa nell'app Android |
| **Notte** | Spenta (si vede la lampada nera, con l'arco appena profilato) | Pagina notte: orologio **a cifre** grande con la data, prossima **sveglia** (se non c'è, il prossimo evento), prossimo **allenamento** di Moveo. Resta il rosso attenuato nelle ore notturne e il piccolo spostamento anti-bruciatura. |

- **Tocco sulla lampada**: Normale → Risparmio → Notte → Normale. Nella pagina notte la lampada spenta resta visibile e un tocco su di lei torna a Normale; un tocco altrove fa come oggi (esce dalla notte).
- **Automatico**: valgono le regole attuali.
  - Risparmio con la batteria sotto la soglia senza carica, oppure sempre attivo/spento da Impostazioni → Questo dispositivo.
  - Notte in carica e in orizzontale, oppure nelle ore notturne, dopo il tempo di inattività.
  - Un cambio fatto a mano vale finché le condizioni automatiche non cambiano: mettere in carica o staccare, entrare o uscire dalle ore notturne, la batteria che scende sotto la soglia.
- Le pagine attuali della modalità notte (orologio grande, agenda) restano scorrevoli. La pagina predefinita diventa quella descritta sopra, con l'orologio a cifre.

## 5. Struttura tecnica

- `web/src/components/Lamp.tsx` + `web/src/lamp.css`: componente `<Lamp size="large|small" mode="normal|eco|night" onToggle />`, solo SVG e CSS (variabili `--lamp-light` 0…1), copiabile nell'hub Hubitat.
- `web/src/lamp-mode.ts`: stato della modalità per questo dispositivo.
  - Unisce `ecoActive` (device.ts) con l'override manuale e il flag "notte".
  - `useLampMode()` restituisce `{ mode, cycle() }`.
  - L'override si salva in `localStorage` insieme alla "firma" delle condizioni automatiche, così si azzera quando cambiano.
- `KioskPage` e `TodayPage`/Shell mostrano la lampada grande; Shell sul telefono la piccola.
- `NightStand` prende la lampada spenta e il nuovo widget sveglia/evento.
- `styles.css`: blocchi `[data-theme='neon'|'minimal']` eliminati, palette Hubitat in `:root`, `html.eco` invariato nei principi.
- `theme.ts` e il selettore del tema nelle Impostazioni: eliminati. `meta theme-color` `#070605`.
- Icona dell'app e splash dell'app Android: lampada arancione su nero (rigenerati con `capacitor-assets`).
- Versione `0.11.0` (config.yaml, DOCS).

## 6. Fuori da questo lavoro

- **Moveo** e **WardApp**: stesso tema vetro + argilla (§2), senza lampada, in un lavoro a parte che riusa gli stessi token CSS (WardApp 0.3.0 insieme alla vista tablet, Moveo 0.7.0).
- **Hub Hubitat**: riuserà `Lamp.tsx` + `lamp.css` quando verrà sviluppato.

## 7. Verifica

- Calendary non ha test automatici per la webapp: `tsc --noEmit` + build. Prova a mano nel browser in tre larghezze (telefono, tablet orizzontale, PC):
  - ciclo con i tocchi;
  - accensione morbida senza lampeggi;
  - risparmio automatico simulato;
  - pagina notte con orologio a cifre, sveglia o evento, allenamento;
  - `prefers-reduced-motion`.
- I test del server restano verdi (non cambiano).
