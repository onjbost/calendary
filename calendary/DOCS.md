# Hubitat (ex Calendary)

L'hub dell'ecosistema Hubitat. Calendario personale in stile vetro e argilla, nero e arancione: agenda mensile/settimanale/giornaliera, calendari iCal importati
(Google, Outlook, lavoro, master…), matrice di Eisenhower giornaliera, tips motivazionali,
notifiche push e un assistente che pianifica lo studio.

## Da Calendary a Hubitat (0.11.0)

Dalla 0.11.0 Calendary si chiama **Hubitat** ed è l'hub dell'ecosistema (Hubitat, Moveo, WardApp).
- **Cambia** ciò che si vede: nome dell'add-on, app, icona, notifiche, app Android.
- **Nuovo indirizzo** `https://hubitat.gattucciocloud.it`. Il vecchio `calendary.gattucciocloud.it` continua a funzionare: in Cloudflared tieni tutti e due gli hostname verso lo stesso servizio, poi metti `public_url: https://hubitat.gattucciocloud.it` nelle opzioni.
- **Non cambia nulla di tecnico**: slug `calendary` (i dati in `/data` restano), hostname interno `local-calendary`, repository `onjbost/calendary`, id dell'app Android, `calendary://`, rotte API e `api_token`. Moveo e WardApp si collegano come prima.
- **Skill Alexa** "AiCal": invariata. Per farla rispondere con il nuovo nome cambia il nome visualizzato nella Alexa Developer Console (il nome di invocazione può restare).
- **App Android**: carica ancora `calendary.gattucciocloud.it/kiosk`; quando il nuovo hostname funziona, cambia `server.url` in `tablet/capacitor.config.json` e ricompila.

## Configurazione

| Opzione | Descrizione |
|---|---|
| `password` | **Obbligatoria.** Password per accedere da web e dal tablet. Cambiarla disconnette tutti i dispositivi. |
| `api_token` | Facoltativo. Token (min. 16 caratteri) per l'accesso da altri add-on, es. **Moveo**: header `Authorization: Bearer <token>`. Vuoto = disattivato. |
| `mcp_token` | Password (min. 24 caratteri) del collegamento con **Claude** (server MCP per le note). Vuoto = spento. |
| `moveo_url` | Indirizzo interno di **Moveo** per la card *Allenamento* (`http://local-moveo:8788`). Vuoto = card nascosta. |
| `moveo_public_url` | Indirizzo pubblico di Moveo, usato nei link (`https://moveo.gattucciocloud.it`). |
| `wardapp_url` | Indirizzo interno di **WardApp** per la card *Oggi indosso* (`http://local-wardapp:8789`). Vuoto = card nascosta. |
| `wardapp_public_url` | Indirizzo pubblico di WardApp, usato nei link (`https://wardapp.gattucciocloud.it`). |
| `weather_entity` | Entità meteo di Home Assistant per il widget della modalità notte (default `weather.forecast_home`, creata da Met.no con l'installazione). Vuoto = niente meteo. |
| `public_url` | Indirizzo pubblico (es. `https://calendary.gattucciocloud.it`). Serve per le notifiche push. |
| `timezone` | Fuso orario, default `Europe/Rome`. |
| `ics_sync_minutes` | Ogni quanti minuti riscaricare i calendari iCal (default 15). |
| `morning_summary` | Ora del riepilogo push mattutino, es. `07:30`. Vuoto = disattivato. |
| `ai_base_url` | Endpoint compatibile OpenAI dell'assistente. Default: Google Gemini. |
| `ai_api_key` | Chiave API dell'assistente. Vuota = assistente AI spento (il pianificatore di studio funziona comunque). |
| `ai_model` | Modello, default `gemini-2.5-flash`. |
| `alexa_skill_id` | ID della skill Alexa *Calendary* (`amzn1.ask.skill…`). Vuoto = integrazione Alexa spenta. |
| `alexa_client_id` / `alexa_client_secret` | Credenziali *Alexa Skill Messaging* (console Alexa → Permissions). Servono per mandare i promemoria su Alexa in automatico. |
| `alexa_reminders` | Quali eventi suonano sugli Echo come promemoria Alexa: `important` (default: gli eventi con la spunta *🔊 Riproduci notifica su Alexa*, le pillole con *Sveglia su Alexa* e i promemoria dettati ad Alexa), `all` (tutti quelli con promemoria), `off`. |
| `alexa_announce_service` | Entità *Annuncia* dell'integrazione ufficiale **Alexa Devices** di Home Assistant, es. `notify.echo_dot_announce` (più Echo separati da virgola). Vuoto = nessun annuncio. |
| `ai_fallback_models` | Modelli di riserva, separati da virgola, provati quando quello principale è sovraccarico o ha finito la quota gratuita. Default `gemini-2.5-flash-lite`. |

### Assistente AI a costo (quasi) zero

| Servizio | `ai_base_url` | `ai_model` | Note |
|---|---|---|---|
| Google Gemini (default) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | Chiave gratuita su aistudio.google.com. Nel piano gratuito Google può usare i dati per migliorare i modelli. |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Piano gratuito con limiti giornalieri. |
| OpenRouter | `https://openrouter.ai/api/v1` | un modello con suffisso `:free` | Modelli gratuiti a rotazione. |
| Ollama (in locale) | `http://IP-DEL-PC:11434/v1` | es. `qwen2.5:7b` | Gratis e privato, serve un PC acceso con Ollama. |

L'assistente non scrive mai direttamente: propone eventi o attività, e tu li approvi.

## Alexa

Due direzioni, configurabili separatamente:

- **Alexa → Calendary** (skill personale *AiCal*): *“Alexa, chiedi ad AiCal di ricordarmi di chiamare Marco domani alle 18”*,
  *“…aggiungi dentista giovedì alle 15:30”*, *“…cosa ho domani?”*, *“…qual è il prossimo impegno?”*, *“…aggiungi fare la spesa alla matrice”*.
- **Calendary → Alexa**: i promemoria degli eventi importanti (e quelli dettati ad Alexa) diventano **promemoria Alexa** e suonano su tutti gli Echo,
  anche se modifichi il calendario dal PC o dal tablet. Con l'integrazione *Alexa Devices* di Home Assistant gli eventi importanti e il riepilogo del mattino vengono anche **annunciati a voce**.

La guida passo passo è nel README del repository (sezione *Alexa*). Il modello vocale da importare è in `alexa/skill-package/`.

## Accesso da internet

Esponi la porta `8787` con il tuo Cloudflare Tunnel sul sottodominio scelto.
Le istruzioni complete sono nel README del repository.

I dati (SQLite) sono in `/data` dell'add-on e sono inclusi nei backup di Home Assistant.

## Integrazione con altri add-on (API)

Dalla 0.3.0 Calendary può essere usato da altre app di casa (ad esempio **Moveo**, l'app di allenamento):

- `api_token` abilita l'accesso server-to-server con `Authorization: Bearer <token>`.
- Gli eventi hanno i campi facoltativi `linkUrl` e `linkLabel`: nell'app compare il pulsante **▶ linkLabel** e la notifica push apre direttamente quel link.
- `POST /api/notify` `{ title, body, url, tag, important }` invia una notifica push a tutti i dispositivi iscritti.
- Gli eventi creati in blocco con lo stesso `planId` si eliminano insieme con `DELETE /api/plans/:planId`.

## Suite con WardApp (0.9.1)

WardApp, l'armadio digitale, usa lo stesso `api_token` (in WardApp: `calendary_token`).

- **Card *Oggi indosso*** nella dashboard: Calendary legge `GET <wardapp_url>/api/suite/today` (Bearer `api_token`), che restituisce `{ logged, items: [{ id, name, thumbUrl }], url }`. Le miniature hanno un link firmato. Il pulsante **Registra** apre WardApp già autenticato su *Oggi ho messo*.
- **Accesso unico** nei due sensi: `POST /api/suite/link` con `app: "wardapp"` firma il link verso WardApp; `/sso` accetta i ticket di Moveo e di WardApp.
- **Notifiche**: WardApp invia la notifica serale "Cosa hai messo oggi?" con `POST /api/notify`.
- **👕 Cosa mi metto?** (0.10.0): nella finestra di un evento e accanto agli eventi dell'agenda (non quelli di tutto il giorno, non gli allenamenti di Moveo, non quelli già passati) apre WardApp già autenticato su `/ask?date=…&start=…&end=…&title=…&location=…`: WardApp sceglie la categoria di outfit dall'evento e propone 3 outfit con il meteo di quella fascia oraria. Il pulsante compare solo se `wardapp_url` è impostato.

## Suite con Moveo (0.4.0)

Calendary e Moveo restano due app distinte, collegate da un **segreto condiviso**: `api_token` di Calendary = `calendary_token` di Moveo.

- **Card "Allenamento"** nella dashboard e nella vista tablet: mostra la sessione di oggi (o la prossima), le pause della giornata e la serie di giorni attivi, con i pulsanti **▶ Avvia** e **Pausa adesso**.
- **Accesso unico**: i link verso Moveo (card, pulsante ▶ degli eventi, voce *Moveo ↗* nel menu) contengono un ticket firmato, monouso e valido 2 minuti, quindi Moveo ti riconosce senza chiederti la password. Vale anche al contrario, dal pulsante *Calendary* di Moveo. Il ticket può portare solo a pagine della stessa app.
- **App Android**: nell'app Calendary i link verso Moveo aprono l'app Moveo (`moveo://`); dall'app Moveo il pulsante Calendary apre questa app (`calendary://`). Se l'altra app non è installata, il link si apre nel browser.

## Modalità notte, sveglia e risparmio energetico (0.5.0)

Si regolano in **Impostazioni → Questo dispositivo**: valgono solo per il tablet o il telefono su cui le imposti, perché sono salvate nel browser.

**Modalità notte** (come StandBy di iPhone). È un orologio a schermo intero su fondo nero, con tre viste da sfogliare:
1. orologio con meteo, prossimo impegno e allenamento di Moveo;
2. solo orologio gigante;
3. calendario del mese con gli impegni di oggi e di domani.

- Si apre da sola dalla vista tablet dopo qualche secondo senza tocchi, scegliendo tra:
  - *in carica e in orizzontale* (predefinito);
  - *nelle ore notturne*;
  - *solo a mano* con il pulsante 🌙.
- Si apre anche dall'indirizzo `/notte`.
- Si chiude con un tocco.
- Nelle ore impostate (default 22:30-6:30) diventa **rossa e scura**.
- Il contenuto si sposta di pochi pixel ogni minuto, per non stampare l'immagine sullo schermo.

**Sveglia**: ora, giorni e suono (dolce o classico), con volume crescente e i pulsanti *Posticipa 9 min* e *Ferma*.
- Suona dalla pagina, quindi Calendary deve restare aperto, per esempio il tablet in carica sul comodino.
- Dopo aver aperto la pagina basta toccare lo schermo una volta: i browser bloccano l'audio finché non c'è stato un tocco.
- Nell'app Android viene programmata anche una notifica di riserva.

**Risparmio energetico**: *automatico* (sotto il 20% di batteria e senza carica), *sempre* o *mai*. Quando è attivo:
- spegne sfocature, bagliori e animazioni e usa il nero pieno;
- aggiorna orologio e widget meno spesso;
- nell'app abbassa la luminosità;
- lontano dal caricatore lascia spegnere lo schermo (disattivabile).

**Batteria e luminosità.** Lo stato della batteria arriva dal browser (Chrome e la WebView di Android lo forniscono; Safari e Firefox no). La luminosità reale dello schermo si può cambiare solo nell'app Android, che dalla 0.3.0 include i plugin `@capacitor-community/screen-brightness` e `@capacitor/device`. Per averli bisogna ricompilare l'APK:

```powershell
cd tablet
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Nel browser la modalità notte scurisce solo la pagina.

## Claude e le note (0.8.0)

Le **note** sono raggruppate in **cartelle**, una per progetto (es. *Calendary*, *Moveo*), e hanno **titolo** e **descrizione**.
Calendary espone un server **MCP** (Model Context Protocol) che permette a Claude di leggere e scrivere **solo le note**:
quando gli dici *“annotalo su Calendary”* crea la nota nella cartella del progetto, creando la cartella se manca.

1. Imposta `mcp_token` (una stringa casuale di almeno 24 caratteri) e riavvia l'add-on.
2. Su claude.ai: **Impostazioni → Connettori → Aggiungi connettore personalizzato**, URL `https://calendary.gattucciocloud.it/api/mcp/<mcp_token>`.
   Da Claude Code: `claude mcp add --transport http calendary https://calendary.gattucciocloud.it/api/mcp --header "Authorization: Bearer <mcp_token>"`.

Strumenti: `list_note_folders`, `create_note_folder`, `list_notes`, `add_note`, `update_note`. Le note aggiunte da Claude hanno il simbolo ✦.

## Vista tablet: menu e schede (0.8.0)

Menu: **Dashboard · Pillole · Moveo · Calendario · Matrice · Obiettivi · Note**. In *Calendario* si sceglie *Giorno / Settimana / Mese*.

- **Pillole**: dosi di oggi, terapie, storico e registro. **Presa ✓** registra l'orario attuale; con 🕐 (o toccando l'orario già registrato) si sceglie un altro orario o si segna *Non presa*.
- **Moveo**: prossimi allenamenti con ▶, pulsante **Fai una pausa**, ultimi allenamenti, programmi. Gli ultimi allenamenti e l'elenco dei
  programmi arrivano da `GET <moveo_url>/api/suite/overview` (Bearer `api_token`), che deve restituire
  `{ recent: [{ title, category, emoji?, finishedAt, durationSec? }], upcoming: [sessioni come in /api/suite/today], programs: [{ id, title, category, emoji?, level?, minutes?, weeks?, path?, planned? }] }`.
  Con versioni di Moveo che non lo hanno la scheda usa i dati di `/api/suite/today` e mostra i collegamenti alle pagine di Moveo.

## Modalità viaggio (0.8.5)

In **Impostazioni → Modalità viaggio** programmi i giorni di partenza e ritorno (inclusi): in quei giorni sugli Echo non suonano
promemoria e non arrivano annunci. Le notifiche push sul telefono restano attive. I promemoria Alexa già programmati per quei giorni
vengono tolti alla prossima sincronizzazione (cioè la prossima volta che usi AiCal).

## Magazzino pillole (0.9.0)

Nella terapia indica **compresse per dose** (anche 1,5), **compresse per scatola**, **compresse che hai adesso** e con quanti giorni di
anticipo vuoi l'avviso (default 7). Calendary scala le compresse a ogni **Presa ✓** (e le rimette con *Non presa*), calcola il consumo
giornaliero e per quanti giorni bastano.

- **Alexa** lo annuncia una volta al giorno, la mattina (dopo il riepilogo, o alle 8:00), finché la scorta è sotto la soglia.
- **Push** a ogni dose presa di una pillola in esaurimento: giorni rimasti e invito a riordinarla.
- Sotto le **15 compresse** nella scheda *Pillole di oggi* compare **📦 Aggiorna magazzino** (aggiungi scatole o scrivi il totale).

## Note formattate (0.9.1)

Le note sono **card** ad altezza fissa con l'anteprima del testo; un tocco apre la nota **a tutta pagina**, **✎ Modifica** apre l'editor.
Il testo è in **Markdown**, con i pulsanti della barra: titoli (`#`, `##`, `###`), **grassetto**, *corsivo*, ~~barrato~~, elenchi puntati
e numerati, **checklist** (`- [ ]`, spuntabili anche in lettura), citazioni, linee, blocchi di codice e **tablature** (blocco ```` ```tab ````).
