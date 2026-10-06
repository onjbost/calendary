# Calendary 0.11.0 — Stile Hubitat e lampada ad arco

Data: 6 ottobre 2026 · Stato: in revisione
Origine: nota "Restyling ecosistema Hubitat" (cartella Hubitat in Calendary) e decisioni di Mattia del 6/10.

## 1. Obiettivo

Calendary passa allo stile comune dell'ecosistema Hubitat: **sfondo nero, arancione come colore e come luce**. Al centro c'è una **lampada da terra ad arco** che "illumina" l'app e che con un tocco passa tra le tre modalità **Normale → Risparmio energetico → Notte**.

Lo stesso componente lampada andrà poi nella homepage dell'hub Hubitat (progetto futuro): è scritto per essere copiato così com'è (un componente React + un file CSS, senza dipendenze da Calendary).

## 2. Un solo tema

- Il tema **Hubitat** sostituisce **Neon** e **Minimal**, che vengono eliminati (CSS, selettore nelle Impostazioni, `theme.ts`). Una preferenza salvata `neon`/`minimal` viene ignorata.
- Palette (token CSS):
  - sfondo `#070605`, superfici `#12100d` / `#1a1713`, bordi `#2b2620`;
  - testo `#f3ece4`, secondario `#a89c8f`;
  - arancione `#ff8a1f` e `#ffad5c` per testi accesi e titoli; luce `rgba(255,138,31,…)`.
- Effetto luce: titoli e numeri importanti (orologio, conto alla rovescia) hanno un leggero alone arancione; card e pulsanti principali prendono un riflesso arancione sul bordo **dal lato della lampada**.
- I colori dei calendari restano quelli scelti dall'utente (servono a distinguerli).
- Restano i caratteri attuali. Il fondo animato a macchie del Neon sparisce: il "movimento" è solo quello della luce.

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

- **Moveo**: stessa palette nero/arancione, senza lampada (lavoro a parte, "adattato" al suo stile).
- **WardApp**: palette già fatta nella 0.2.0, senza lampada.
- **Hub Hubitat**: riuserà `Lamp.tsx` + `lamp.css` quando verrà sviluppato.

## 7. Verifica

- Calendary non ha test automatici per la webapp: `tsc --noEmit` + build. Prova a mano nel browser in tre larghezze (telefono, tablet orizzontale, PC):
  - ciclo con i tocchi;
  - accensione morbida senza lampeggi;
  - risparmio automatico simulato;
  - pagina notte con orologio a cifre, sveglia o evento, allenamento;
  - `prefers-reduced-motion`.
- I test del server restano verdi (non cambiano).
