# Viaggi: modulo di Hubitat con valigia di WardApp — design

Data: 2026-10-06. Stato: approvato a voce sezione per sezione (brainstorming del 6/10).

## 1. Scopo

Pianificare i viaggi dentro Hubitat in una sezione separata ("🧳 Viaggi") che più avanti diventerà un'app a sé
dell'ecosistema (una sorta di agenzia di viaggi: mezzi, date, attività, consigli sul posto, noleggi, cose da vedere).
Per ora le funzioni di base:

- **pianificazione del viaggio**: destinazione, date, spostamenti (volo, treno, bus, auto, traghetto), programma giorno
  per giorno, note; scritto nel calendario **senza** una card lunga quanto il viaggio: ogni giorno appare "in viaggio";
- **promemoria**: check-in dei voli, la sera prima cosa preparare, al ritorno svuotare la valigia;
- **valigia**: preparata da WardApp con i capi veri dell'armadio, mostrata e spuntata dentro Viaggi.

Criteri di successo: il calendario resta pulito (solo gli orari veri come eventi, i giorni come strisce sottili);
il modulo si sposta in una nuova app senza toccare il resto di Hubitat; la valigia è coerente con gli outfit di WardApp
e sta nel bagaglio scelto; tutto funziona anche senza AI.

Fuori da questa versione: incolla-conferma con AI, ora di uscire, noleggi, consigli sul posto, cose da vedere,
condivisione del viaggio.

## 2. Divisione del lavoro

1. **Hubitat 0.12.0 — modulo Viaggi** (questo repo): tutto tranne la scheda Valigia (che mostra "in arrivo").
2. **WardApp 0.5.0 — motore e API della valigia**, poi **Hubitat 0.12.1** — scheda Valigia.

Ogni parte ha il suo piano in `docs/superpowers/plans/`.

## 3. Isolamento del modulo

- Server: `calendary/server/src/trips/` — `db.js` (tabelle `trip_*`), `trips.js` (viaggi, tratte, attività),
  `calendar-port.js` (unico punto che tocca il calendario e la modalità viaggio), `days.js` (strisce dei giorni),
  `weather.js` (Open-Meteo), `reminders.js`, `pack.js` (ponte verso WardApp, 0.12.1), `routes.js`.
- Web: `calendary/web/src/trips/` — `api.ts`, pagine, componenti, `trips.css`.
- Hubitat collega il modulo in pochi punti: registrazione delle rotte, voce di menu e rotte della webapp, strisce nelle
  viste del calendario, card in dashboard, controllo dei promemoria nel ciclo del notifier, ascolto delle modifiche agli
  eventi `trip:`, riga nel riepilogo del mattino.
- Quando nascerà l'app viaggi: `calendar-port.js` diventa client dell'API della suite (come Moveo, che scrive eventi
  con `planId: moveo:…`), le strisce arrivano da un endpoint dell'app, le cartelle e le tabelle si spostano.

## 4. Dati (Hubitat)

```sql
trips (id PK, name, place_name, place_country, lat, lon, start_date, end_date,   -- date YYYY-MM-DD, estremi inclusi
       bag TEXT  -- 'backpack_s' | 'backpack_l' | 'cabin' | 'suitcase'
       can_wash INT, quiet_alexa INT, notes TEXT,
       weather TEXT (JSON), weather_at TEXT, weather_kind TEXT  -- 'forecast' | 'last_year' | null
       weather_changed INT, source TEXT ('manual' | 'event'), created_at, updated_at)
trip_legs (id PK, trip_id FK cascade, mode TEXT  -- 'plane' | 'train' | 'bus' | 'car' | 'ferry'
           from_place, to_place, depart_at, arrive_at (ISO), code TEXT  -- numero volo/treno
           booking TEXT, notes TEXT, checkin_hours INT (voli, default 24), direction TEXT ('out' | 'back' | 'other'),
           event_id TEXT, created_at, updated_at)
trip_activities (id PK, trip_id FK cascade, day TEXT (YYYY-MM-DD o '' = da riprogrammare), tag TEXT, title,
                 time TEXT ('HH:mm' o ''), minutes INT (default 120), place TEXT, notes TEXT, event_id TEXT,
                 position INT, created_at, updated_at)
```

`travel_periods` riceve la colonna `trip_id` (periodo di modalità viaggio creato da un viaggio).

Etichette delle attività (id stabili, uguali in WardApp): `beach` 🏖️ Mare, `hiking` ⛰️ Montagna/escursione,
`dinner` 🍽️ Cena elegante, `work` 💼 Lavoro, `sport` 🏃 Sport, `city` 🏙️ Città, `party` 🎉 Serata, `other` 📍 Altro.

Mezzi: `plane` ✈️, `train` 🚆, `bus` 🚌, `car` 🚗, `ferry` ⛴️.

## 5. Pagine (web)

- Menu: **🧳 Viaggi** (`/viaggi`) dopo Calendario. Lista: in corso, prossimi, passati; card con destinazione, date,
  mezzi, meteo, valigia. **＋ Nuovo viaggio**.
- Nuovo viaggio: nome, destinazione (ricerca città), date, bagaglio (4 riquadri), "posso lavare", "Alexa in silenzio".
- Pagina del viaggio (`/viaggi/:id`), schede:
  1. **Programma**: meteo per giorno; giorni con attività e tratte in ordine d'orario; ＋ Attività per giorno, ＋ Tratta;
     gruppo "Da riprogrammare" se ci sono attività senza giorno valido.
  2. **Spostamenti**: tratte con dettagli; codice di prenotazione copiabile.
  3. **Valigia**: (0.12.1) lista di WardApp; in 0.12.0 "in arrivo".
  4. **Note**: testo libero (markdown come le Note).
  In alto: modifica del viaggio, elimina, "Sono tornato" (0.12.1).
- **Trasforma in viaggio**: nella scheda di un evento locale lungo almeno 2 giorni (anche giornata intera), non `trip:`.
  Crea il viaggio con titolo, date e località dell'evento; poi chiede conferma ed elimina l'evento originale. Eventi
  iCal importati: il pulsante c'è, ma l'evento non viene eliminato (avviso).
- **Dashboard / tablet**: card del viaggio in corso o in partenza entro 7 giorni ("Cagliari tra 3 giorni" / "Giorno 3
  di 5" con il programma di oggi), meteo; striscia del giorno sotto la data.

## 6. Calendario

**Eventi veri** con `source: 'trip'`, `planId: 'trip:<id>'`, `linkUrl: '/viaggi/<id>'`, `linkLabel: 'Apri il viaggio'`,
nel primo calendario locale (o in quello scelto nelle impostazioni dei Viaggi, `trips_calendar_id`):

- tratta → "✈️ FR1234 Pisa → Cagliari" da partenza ad arrivo, luogo = partenza, descrizione = prenotazione e note;
- attività con orario → "🍽️ Cena da Su Gologone", durata `minutes`, luogo, note. Senza orario: nessun evento.

Sincronizzazione: ogni salvataggio di tratta/attività crea, aggiorna o elimina il suo evento; eliminare il viaggio
elimina tutti i suoi eventi (`deletePlan('trip:<id>')`). Le modifiche fatte dal calendario su un evento `trip:` tornano
al viaggio (titolo senza emoji, orari, luogo; l'eliminazione elimina la tratta/attività): `store.js` avvisa gli
ascoltatori registrati dopo `updateEvent` / `deleteEvent`; il modulo non si richiama da solo durante i propri
salvataggi.

**Strisce dei giorni** (calcolate, non salvate): `GET /api/trips/days?from=YYYY-MM-DD&to=YYYY-MM-DD` →
`[{ date, tripId, label, emoji, color, kind: 'start' | 'middle' | 'end' | 'single', index, total }]`.

| giorno | testo |
|---|---|
| partenza | 🧳 Si parte · Cagliari |
| in mezzo | 🌴 In viaggio · Cagliari · 3/5 |
| ritorno | 🏠 Rientro da Cagliari |
| un giorno solo | 🧳 Gita · Cagliari |

L'emoji di "in mezzo" segue il programma: 🏖️ se il viaggio ha attività mare, ⛰️ montagna, 💼 lavoro, altrimenti 🌴.
Colore dei viaggi: `#38bdf8` (azzurro). Le strisce si vedono: nel mese (barretta sopra gli eventi, non conta nei +N),
in settimana/giorno (nell'intestazione del giorno), nell'agenda (riga di intestazione del giorno), in dashboard.
Toccandole si apre il viaggio. Non sono eventi: Alexa, ICS, notifiche non le vedono. Il riepilogo del mattino di Alexa
aggiunge una riga: "Oggi sei in viaggio a Cagliari, giorno 3 di 5."

**Modalità viaggio**: con "Alexa in silenzio" il viaggio crea/aggiorna il suo periodo in `travel_periods` (colonna
`trip_id`), cancellato con il viaggio o togliendo la spunta. In `travel.js` le funzioni diventano
`listTravelPeriods`, `createTravelPeriod`, `deleteTravelPeriod`, `travelPeriodAt` (l'API HTTP `/api/travel` non
cambia).

## 7. Promemoria

Controllo `trips/reminders.js` chiamato ogni minuto dal notifier; chiavi uniche nella tabella `notified`
(`trip|<id>|checkin|<legId>|<departAt>` ecc.); notifica push e, se non in modalità viaggio, annuncio Alexa (`announce`).

| promemoria | quando | testo |
|---|---|---|
| ✈️ Check-in | `depart_at − checkin_hours` per ogni volo; se cade tra le 22 e le 8, alle 8 seguenti (mai dopo la partenza) | "Check-in aperto: FR1234 Pisa → Cagliari domani alle 10:30 · prenotazione ABC123" |
| 🧳 Sera prima | ore 20 (impostazione `trips_evening_time`) del giorno prima di ogni tratta di andata (`direction='out'`, o la prima tratta del viaggio) | per mezzo — volo: documento, carta d'imbarco, liquidi ≤ 100 ml nel bagaglio a mano; treno/bus: biglietto e posto; auto: pieno, pedaggi, patente e libretto; traghetto: biglietto e orario d'imbarco. In 0.12.1 anche "valigia: mancano N capi". |
| 🏠 Al ritorno | 1 ora dopo l'arrivo dell'ultima tratta di ritorno; senza tratte, alle 18 del giorno di rientro | "Bentornato! Svuota la valigia" (0.12.1: "metto i capi usati nel cesto di WardApp?") — apre il viaggio |

## 8. Meteo della destinazione (Open-Meteo, gratuito, senza chiave)

- Ricerca città: `GET /api/trips/geocode?q=` → primi 5 risultati (nome, regione, paese, lat, lon) da
  `geocoding-api.open-meteo.com/v1/search?language=it`.
- Previsioni se il viaggio inizia entro 16 giorni: `api.open-meteo.com/v1/forecast` daily
  (`temperature_2m_max`, `temperature_2m_min`, `precipitation_probability_max`, `weather_code`, timezone auto).
  I giorni oltre il 16° restano senza dato.
- Altrimenti l'anno scorso: `archive-api.open-meteo.com/v1/archive` stesse date −1 anno (max, min,
  `precipitation_sum` → pioggia "sì" se ≥ 1 mm), etichetta "Come l'anno scorso".
- Salvato nel viaggio; aggiornato all'apertura se più vecchio di 6 ore e ogni notte (03:30) per i viaggi entro 16
  giorni. `weather_changed` = 1 quando le previsioni sostituiscono l'anno scorso o un giorno cambia di ≥ 4° o di pioggia
  (≥ 50% ↔ < 50%); si azzera quando la valigia viene rigenerata (0.12.1).
- Senza rete: resta l'ultimo meteo; senza nessun dato, null (la pagina mostra "Meteo non disponibile").

## 9. Valigia (WardApp 0.5.0 + Hubitat 0.12.1)

WardApp prepara la lista con `packTrip(trip, items, categories)` (funzione pura):

1. **Giorni e meteo**: fascia di temperatura e pioggia per giorno (dal meteo inviato da Hubitat, altrimenti stagione).
2. **Outfit per attività**: ogni etichetta ha la categoria di outfit abbinata (impostabile; di default la più vicina per
   formalità: mare/città → casual, cena → elegante, lavoro → lavoro, sport/montagna → sport, serata → serata); le
   occorrenze si contano dal programma, i giorni senza attività valgono 🏙️ città. Per ciascuna `ruleOutfits` con
   meteo e capi utilizzabili (attivi, non nel cesto; i capi sporchi valgono se si parte tra più di 3 giorni, con
   l'avviso "lavalo prima di partire"). Bonus ai capi già scelti, così pochi capi coprono più outfit.
3. **Riuso e lavaggi**: un capo copre al più `wash_after` giorni (come il cesto); con "posso lavare" il ricambio si
   ferma a un ciclo di 4 giorni.
4. **Essenziali**: intimo e calze uno al giorno (o fino al ciclo) + 1, pigiama, costume (1 ogni 2 giorni di mare,
   max 3), telo e ciabatte per il mare, ombrello/impermeabile se piove, strato caldo se la minima < 12°. Dall'armadio se
   ci sono (rispettando `quantity`), altrimenti righe "da portare" senza foto.
5. **Addosso in partenza**: il capo più ingombrante per ruolo (giacca, scarpe, maglione) non conta nella capienza.
6. **Capienza** (somma `bulk × quantità`): zaino piccolo 14, zaino grande 24, trolley cabina 32, valigia grande 60
   (impostabili). Se non ci sta: più riuso → capi meno ingombranti → un paio di scarpe in meno → avviso "Non ci sta:
   ti servirebbe …".
7. **Consigli**: a regole ("3 costumi: stendili la sera", "lavatrice a metà viaggio", "pioggia giovedì: impermeabile
   addosso", "jeans sporchi: lavali prima di partire"); con l'AI una chiamata riscrive i consigli e può proporre al
   massimo 3 scambi, verificati dalle stesse regole. Se l'AI fallisce restano le regole.

Rigenera rifà 2-7 tenendo aggiunte, esclusioni e spunte manuali.

API della suite in WardApp (segreto condiviso): `PUT /api/suite/packs/:tripId` (prepara/rigenera con i dati del
viaggio), `GET /api/suite/packs/:tripId`, `PATCH /api/suite/packs/:tripId/items/:itemId` (spunta, togli),
`POST /api/suite/packs/:tripId/items` (aggiungi), `GET /api/suite/items?q=`, `POST /api/suite/packs/:tripId/return`
(capi nel cesto), `DELETE /api/suite/packs/:tripId`. Tabelle `trip_packs`, `trip_pack_items`. Miniature firmate come
nella card "Oggi indosso".

Hubitat passa per `/api/trips/:id/pack…`; senza WardApp collegato: "Collega WardApp per preparare la valigia";
WardApp che non risponde: ultima lista ricevuta in sola lettura con avviso.

## 10. Errori e casi particolari

- Date al contrario → 400; tratte e attività fuori dalle date del viaggio → 400 (la tratta di andata può partire il
  giorno prima, quella di ritorno arrivare il giorno dopo).
- Cambio delle date del viaggio: le attività fuori dalle nuove date vanno in "Da riprogrammare" (`day = ''`, evento
  eliminato), non si cancellano.
- Viaggi sovrapposti: ammessi; le strisce si impilano.
- Evento `trip:` eliminato dal calendario: si elimina la tratta/attività; il viaggio aperto si ricarica (broadcast).
- "Trasforma in viaggio" su un evento ricorrente o iCal: il viaggio si crea, l'evento resta (avviso).

## 11. Test (nessuna chiamata reale: Open-Meteo, WardApp e AI finti)

- Hubitat: viaggi/tratte/attività ed eventi `trip:` (crea, aggiorna, elimina, modifica dal calendario che torna al
  viaggio, cambio date → da riprogrammare); strisce (partenza, in mezzo, ritorno, gita, sovrapposti, emoji);
  modalità viaggio collegata; promemoria (orari, finestra 8-22, niente doppioni, Alexa zitta in modalità viaggio);
  meteo (previsioni o anno scorso, cambiato, senza rete); trasforma in viaggio; rotte HTTP.
- WardApp: `packTrip` (outfit per attività con riuso, `wash_after`, lavatrice, essenziali, addosso, capienza e avviso,
  scelte manuali conservate, armadio povero) e API della suite.
- Web: typecheck e build; prova nel browser del calendario con le strisce e della pagina del viaggio.
