# Calendary ✦

Calendario e promemoria personale in stile **glassmorphism + neon**.
Si modifica da **PC via web**, mentre il **tablet** fa da bacheca sempre accesa.

- Vista **mensile**, **settimanale** e **giornaliera/oraria**, con inserimento, modifica ed eliminazione degli eventi.
- **Import di calendari iCal**: Google, Outlook/Microsoft 365, iCloud, lavoro, master… (sola lettura, sincronizzazione automatica).
- **Notifiche push** per le attività ⚡ importanti, più un riepilogo ogni mattina.
- **Matrice di Eisenhower giornaliera**: trascina tra i quadranti, recupera le attività non completate, trasforma un'attività in un blocco di calendario.
- **Obiettivi** (es. i goal annuali di lavoro): misure di tre tipi (spunta, valore/target, conteggio di evidenze per settimana/trimestre), andamento confrontato con il tempo trascorso, **evidenze** datate e **report Markdown** per MidYear/Year-End. Le **routine** ricorrenti (settimanali, ogni N settimane, mensili, trimestrali) compaiono nel calendario con promemoria e si spuntano da PC, tablet o telefono. Import/export in JSON.
- **Tips motivazionali**: regola dei 5 secondi (con conto alla rovescia a schermo intero), mangia il ranocchio, pomodoro, 2 minuti…
- **Assistente virtuale** con AI gratuita o quasi: pianifica lo studio, aggiunge impegni e riempie la matrice. **Ogni modifica va approvata.**
- **Pianificatore di studio** (funziona anche senza AI): *“corso di 15 ore in 5 moduli da 3 ore entro il 31/10”* → sessioni distribuite negli slot liberi, evitando gli impegni già presenti.
- **Note**: sticky note con titolo e descrizione, raggruppate in cartelle per progetto, anche nella vista tablet. **Claude** può aggiungerle (*“annotalo su Calendary”*) tramite il server MCP: vedi `calendary/DOCS.md`.
- **Pillole**: terapie con orari e giorni, notifica e sveglia su Alexa a ogni dose, pulsante **Presa ✓** in dashboard, storico completo dall'inizio della terapia (percentuale, serie di giorni, mappa per settimane) e registro mese per mese.
- **Temi**: *Neon* (predefinito) e *Minimal* nero e arancione, scelti per dispositivo in Impostazioni → Aspetto.
- **Alexa**: aggiungi promemoria, impegni e attività a voce con la skill *AiCal*, chiedi cosa hai in programma, e senti sugli Echo i promemoria e gli annunci che arrivano da Calendary.
- **Vista tablet (kiosk)**: orologio, prossimo impegno con conto alla rovescia, agenda del giorno, prossimi giorni, matrice e tips a rotazione. Si aggiorna in tempo reale quando modifichi dal PC.

```
Calendary/
├── repository.yaml        ← repository di add-on per Home Assistant
├── alexa/                 ← skill Alexa: modello vocale (it-IT) e manifest
├── calendary/             ← l'add-on
│   ├── config.yaml        ← opzioni dell'add-on
│   ├── Dockerfile
│   ├── server/            ← API Node.js (Fastify + SQLite integrato in Node)
│   └── web/               ← webapp React + Vite (PWA)
└── tablet/                ← wrapper Android (Capacitor) per la vista kiosk
```

---

## 1. Installazione su Home Assistant

### Opzione A: add-on locale (la più rapida)

1. Installa l'add-on **Samba share** oppure **Advanced SSH & Web Terminal** in Home Assistant.
2. Copia l'add-on nella cartella `addons` di Home Assistant con lo script, che copia solo i file necessari e verifica che siano arrivati tutti:
   ```bash
   powershell -ExecutionPolicy Bypass -File deploy.ps1
   ```
   Di default lo script copia in `\\192.168.1.47\addons\Calendary\calendary`; per un'altra destinazione usa `-Target`. Usalo anche per ogni aggiornamento.
   Evita la copia a mano: Samba di Home Assistant rifiuta i nomi che corrispondono a `veto_files`
   (ad esempio una cartella `icons`) e con `node_modules` la copia diventa lentissima.
3. In Home Assistant apri **Impostazioni → Componenti aggiuntivi → Raccolta di componenti aggiuntivi**, poi **⋮ → Controlla aggiornamenti**.
4. In fondo compare **Componenti aggiuntivi locali → Calendary** → **Installa**. La prima build richiede qualche minuto, soprattutto su Raspberry Pi.
5. Nella scheda **Configurazione** imposta almeno `password` (e, se vuoi, `ai_api_key`) → **Salva** → **Avvia**.
6. Prova in locale: `http://IP-DI-HOME-ASSISTANT:8787`.

### Opzione B: repository GitHub

Pubblica questa cartella su un repository GitHub (anche privato, con un token) e aggiungilo in
**Raccolta → ⋮ → Repository**. Così gli aggiornamenti arrivano come per gli altri add-on: basta aumentare `version` in `calendary/config.yaml`.

## 2. Accesso dall'esterno con Cloudflare (`calendary.gattucciocloud.it`)

**Con l'add-on Cloudflared** (quello di brenner-tobias), aggiungi nella sua configurazione:

```yaml
additional_hosts:
  - hostname: calendary.gattucciocloud.it
    service: http://local-calendary:8787
```

e riavvia l'add-on Cloudflared. Il record DNS viene creato in automatico.

**Con un tunnel gestito dalla dashboard** (Zero Trust → Networks → Tunnels → il tuo tunnel → *Public Hostname* → *Add*):

- Subdomain: `calendary`, Domain: `gattucciocloud.it`
- Service: `HTTP` → `local-calendary:8787`

Se `local-calendary` non viene risolto (cloudflared fuori da Home Assistant), usa `IP-DI-HOME-ASSISTANT:8787`.

Note:
- Le notifiche push richiedono HTTPS: Cloudflare lo fornisce in automatico.
- Gli aggiornamenti in tempo reale usano Server-Sent Events, che passano senza problemi dal tunnel (c'è un heartbeat ogni 25 s).
- L'app ha già una sua password. Se aggiungi anche **Cloudflare Access**, dovrai fare il login Access anche sul tablet.

## 3. Primo utilizzo

1. Apri `https://calendary.gattucciocloud.it` ed entra con la password.
2. **Impostazioni → Aggiungi calendario → Importa iCal**: incolla il link `.ics` del calendario di lavoro, del master, di Google o di Outlook. Nell'app, sotto il campo, ci sono le istruzioni per trovare il link.
3. **Impostazioni → Notifiche → Attiva su questo dispositivo** (su PC e telefono). Su iPhone/iPad devi prima aggiungere l'app alla Home (Condividi → Aggiungi alla schermata Home).
4. Segna come **⚡ Importante** gli eventi per cui vuoi l'avviso: arriva 30 minuti prima, oppure con il promemoria che scegli.

## 4. Tablet

### Senza compilare nulla (PWA)

Sul tablet apri `https://calendary.gattucciocloud.it/kiosk` con Chrome → ⋮ → **Aggiungi a schermata Home** / **Installa app**.
La vista tablet tiene lo schermo acceso finché è aperta (Wake Lock API). Per una bacheca fissa attiva anche **Blocco app su schermo** (Impostazioni Android → Sicurezza).

### App Android nativa (Capacitor)

In più rispetto alla PWA: schermo sempre acceso a livello di sistema, modalità immersiva senza barre e notifiche locali anche a schermo spento.

Servono **Android Studio** (per l'Android SDK) e un **JDK 21 completo**, per esempio Eclipse Temurin 21 (`winget install EclipseAdoptium.Temurin.21.JDK`).
Il JDK 25 incluso in Android Studio e quello di IntelliJ **non vanno bene**: il primo è troppo nuovo per Gradle 8.14, al secondo manca `jlink`.

Da riga di comando (PowerShell):

```bash
cd tablet; npm install; npx cap sync android; cd android; $env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"; .\gradlew.bat assembleDebug
```

L'APK viene creato in `tablet/android/app/build/outputs/apk/debug/app-debug.apk`. Oppure da Android Studio: apri `tablet/android`, imposta
*Settings → Build Tools → Gradle → Gradle JDK = Temurin 21* e usa **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.

Per installarlo sul tablet puoi copiare l'APK (via USB o Google Drive) e aprirlo dal tablet. Android chiederà di consentire l'installazione da quella app una sola volta.
In alternativa, con il *Debug USB* attivo: `adb install -r app-debug.apk`.
L'app carica direttamente `https://calendary.gattucciocloud.it/kiosk`: ogni aggiornamento della webapp arriva sul tablet senza ricompilare l'APK.
Se cambi dominio, modifica `server.url` in `tablet/capacitor.config.json` e rifai `npx cap sync android`.

La vista tablet:
- permette di **aggiungere, modificare ed eliminare eventi**: tocca un evento per aprirlo, oppure tocca uno spazio vuoto nella vista *Giorno* o *Settimana* (o usa **＋ Evento**) per crearne uno. Nelle viste calendario scorri a destra o a sinistra per cambiare giorno, settimana o mese;
- nella scheda *Matrice* si aggiungono e si spuntano le attività; per cambiare quadrante col dito si usa l'icona ⊞ accanto a ogni attività;
- il pulsante ☰ apre l'app completa (assistente, tips, impostazioni);
- torna da sola su **Oggi** dopo 2 minuti senza tocchi, a meno che non ci sia un editor aperto;
- di notte (23:00–6:30) si scurisce se nessuno la tocca;
- quando si avvicina un evento ⚡ importante mostra un avviso a tutto schermo con segnale acustico e il pulsante **5·4·3·2·1·VAI**.

### Smartphone

Apri `https://calendary.gattucciocloud.it` e installala nella schermata Home (Chrome: ⋮ → *Installa app*; iPhone: Condividi → *Aggiungi alla schermata Home*).
Sul telefono il calendario si apre nella vista *Giorno* e si cambia giorno con uno swipe. Il pulsante ＋ crea un evento; l'editor si apre dal basso e **Salva / Elimina** restano sempre visibili.

## 5. Assistente AI

Di default usa **Google Gemini Flash** (chiave gratuita da https://aistudio.google.com/apikey). Incollala in `ai_api_key`.
In alternativa puoi usare Groq, OpenRouter o Ollama in locale: vedi la tabella in [`calendary/DOCS.md`](calendary/DOCS.md).

Consuma pochissimo perché il modello interpreta soltanto la richiesta, mentre il calcolo degli orari lo fa il pianificatore interno. Esempi:

- *Vorrei fare un corso di inglese di 15 ore diviso in 5 moduli da 3 ore, da finire entro il 31 ottobre*
- *Cosa ho domani?*
- *Aggiungi dentista giovedì alle 15:30, importante*
- *Riempi la matrice di oggi: consegnare la tesina, fare la spesa, rispondere alle mail*
- *Cancella gli eventi di studio di sabato*

Per nuove funzioni dell'assistente si aggiunge uno strumento in `calendary/server/src/assistant.js` (array `tools` + `runTool`).

## 6. Alexa

L'integrazione ha due direzioni, indipendenti tra loro:

| | Cosa fa | Cosa serve |
|---|---|---|
| **Alexa → Calendary** | *“Alexa, chiedi ad AiCal di ricordarmi di chiamare Marco domani alle 18”*, *“…aggiungi dentista giovedì alle 15:30, importante”*, *“…cosa ho domani?”*, *“…qual è il prossimo impegno?”*, *“…aggiungi consegnare la tesina alla matrice come urgente e importante”* | una skill personale (gratuita) nella console Alexa |
| **Calendary → Alexa: promemoria** | gli eventi ⚡ importanti e i promemoria dettati ad Alexa diventano **promemoria Alexa**: suonano su tutti gli Echo e arrivano nell'app Alexa, anche se l'evento l'hai creato dal PC o dal tablet | la stessa skill + il permesso *Promemoria* + le credenziali *Skill Messaging* |
| **Calendary → Alexa: annunci** | gli eventi importanti e il riepilogo del mattino vengono **annunciati a voce** sull'Echo | Home Assistant con l'integrazione ufficiale *Alexa Devices* |

> Amazon non permette alle skill di creare **sveglie**: i promemoria Alexa sono l'equivalente più vicino (suonano con il loro segnale e leggono il testo).
> Un evento già gestito come promemoria Alexa non viene annunciato una seconda volta.

### Creare la skill (una volta sola, ~10 minuti)

1. Vai su <https://developer.amazon.com/alexa/console/ask> con lo **stesso account Amazon dei tuoi Echo** → **Create Skill**:
   nome `AiCal`, lingua **Italian (IT)**, tipo **Other → Custom**, hosting **Provision your own**, template *Start from scratch*.
2. **Build → Interaction Model → JSON Editor**: incolla il contenuto di [`alexa/skill-package/interactionModels/custom/it-IT.json`](alexa/skill-package/interactionModels/custom/it-IT.json) → **Save** → **Build skill**.
   La frase di attivazione è `a. i. cal` (si dice *AiCal*, in italiano come si legge): “calendary” veniva confuso con “calendario”,
   Amazon vuole almeno due parole e non accetta “ai” (preposizione), mentre accetta le sigle scritte “a. i.”.
3. **Endpoint** → **HTTPS** → Default Region: `https://calendary.gattucciocloud.it/api/alexa`,
   certificato: *My development endpoint has a certificate from a trusted certificate authority* (quello di Cloudflare va bene) → **Save**.
4. Copia lo **Skill ID** (`amzn1.ask.skill.…`, in alto nella pagina Endpoint) nell'opzione `alexa_skill_id` dell'add-on.
5. **Permissions**: attiva **Reminders**. In fondo alla stessa pagina, in *Alexa Skill Messaging*, copia **Alexa Client Id** e **Alexa Client Secret**
   in `alexa_client_id` e `alexa_client_secret`. *(Senza queste due chiavi i promemoria arrivano su Alexa solo quando parli con la skill.)*
6. *(Facoltativo)* Con l'[ASK CLI](https://developer.amazon.com/docs/smapi/quick-start-alexa-skills-kit-command-line-interface.html) puoi caricare tutto in un colpo
   con il manifest [`alexa/skill-package/skill.json`](alexa/skill-package/skill.json): include endpoint, permessi e gli *eventi della skill*
   (permesso concesso/revocato, skill disattivata), che dalla console web non si possono attivare. Senza eventi va bene lo stesso:
   Calendary legge lo stato del permesso a ogni richiesta di Alexa.
7. **Salva** le opzioni dell'add-on e **riavvialo**.
8. Scheda **Test** della console → *Skill testing is enabled in*: **Development**. La skill compare subito sui tuoi Echo (solo sul tuo account).
9. Nell'app Alexa: **Altro → Skill e giochi → Le tue skill → Sviluppatore → AiCal → Impostazioni → Gestisci autorizzazioni** → attiva **Promemoria**.
   In alternativa di' *“Alexa, apri AiCal”*: se il permesso manca ti arriva una scheda nell'app per concederlo.
10. Di' *“Alexa, apri AiCal”* almeno una volta: da quel momento Calendary sa a chi mandare i promemoria.
    In **Impostazioni → Alexa** della webapp vedi lo stato, quanti promemoria sono programmati e il pulsante **Sincronizza promemoria**.

> **Limite di Amazon:** i promemoria Alexa si possono creare **solo mentre parli con la skill**. Calendary programma quelli dei
> prossimi 3 giorni ogni volta che usi AiCal: basta dire *“Alexa, chiedi ad AiCal di aggiornare i promemoria”* (anche una volta al giorno).
> Per avvisi del tutto automatici usa gli **annunci** con Alexa Devices (`alexa_announce_service`): Calendary annuncia
> gli eventi con la spunta Alexa e le pillole che non sono già programmati come promemoria.

Cosa suona sugli Echo si decide **dall'app**: nell'editor di un evento attiva *🔊 Riproduci notifica su Alexa* e scegli quanti minuti prima;
le **pillole** con *Sveglia su Alexa* suonano all'orario di ogni dose finché non le segni come prese. Con `alexa_reminders: all` suonano anche
tutti gli altri eventi con un promemoria, con `off` nulla. Calendary tiene programmati i promemoria dei prossimi 3 giorni e li aggiorna da solo
quando sposti o cancelli un evento.

**Sicurezza**: `/api/alexa` è l'unico indirizzo raggiungibile senza password, perché lo chiama Amazon. Il server accetta solo richieste **firmate da Amazon**
(certificato `echo-api.amazon.com`, firma del corpo, timestamp entro 150 s) e con il **tuo Skill ID**.
Se proteggi il dominio con **Cloudflare Access**, aggiungi un'applicazione *Bypass* per il percorso `calendary.gattucciocloud.it/api/alexa`.

### Annunci vocali con Home Assistant (facoltativo)

1. Aggiungi l'integrazione ufficiale **Alexa Devices** (Impostazioni → Dispositivi e servizi) e collegala al tuo account Amazon.
2. Apri il tuo Echo: tra le entità c'è *Annuncia* (es. `notify.echo_dot_announce`). Copia l'ID entità.
3. Scrivilo in `alexa_announce_service` (più Echo separati da virgola) e riavvia l'add-on.
4. **Impostazioni → Alexa → Prova annuncio**.

Calendary chiama `notify.send_message` con quell'entità e il testo da leggere.
Fuori da Home Assistant (Docker o PC) imposta `HA_URL` e `HA_TOKEN` (token di lunga durata).

## 7. Sviluppo in locale (PC)

```bash
cd calendary/server && npm install
cd ../web && npm install && npm run build
```

Avvio (PowerShell), con dati in `calendary/server/data`:

```bash
$env:CALENDARY_PASSWORD="demo"; node --disable-warning=ExperimentalWarning calendary/server/src/index.js
```

Poi apri http://localhost:8787. Per lavorare sull'interfaccia con hot reload: `npm run dev` in `calendary/web`
(http://localhost:5173, fa da proxy verso il server sulla porta 8787).

Variabili utili: `CALENDARY_PASSWORD`, `DATA_DIR`, `PORT`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `CALENDARY_NO_AUTH=1` (solo sviluppo),
`ALEXA_SKILL_ID`, `ALEXA_CLIENT_ID`, `ALEXA_CLIENT_SECRET`, `ALEXA_REMINDERS`, `ALEXA_ANNOUNCE_SERVICE`, `HA_URL`, `HA_TOKEN`,
`ALEXA_SKIP_VERIFY=1` (solo sviluppo: accetta richieste Alexa non firmate, per provarle con curl).

Test del server: `cd calendary/server && npm test`.

## Note

- I dati sono in un file SQLite nella cartella `/data` dell'add-on, quindi rientrano nei **backup di Home Assistant**.
- I link iCal segreti danno accesso ai calendari: trattali come password.
- Gli eventi importati da iCal sono in sola lettura: si modificano nel calendario di origine. Quelli creati in Calendary vivono nei calendari interni (*Personale*, *Studio*, o altri che crei).

## 7. Suite con Moveo e API per altre app

[Moveo](https://github.com/onjbost/moveo) è l'app di allenamento che si integra con Calendary. Le due app restano separate e condividono un solo segreto: `api_token` di Calendary = `calendary_token` di Moveo.

- **Da Moveo a Calendary**: le sessioni pianificate diventano eventi del calendario *Allenamento*, con il pulsante **▶ Avvia allenamento**.
- **Da Calendary a Moveo**: la card *Allenamento* nella dashboard e nel kiosk mostra la sessione di oggi e le pause, con **▶ Avvia** e **Pausa adesso**. Imposta `moveo_url` e `moveo_public_url`.
- **Accesso unico** in entrambe le direzioni: ticket firmati, monouso, validi 2 minuti.
- **Tablet**: due app Android separate che si aprono a vicenda (`calendary://` e `moveo://`). Dopo l'aggiornamento ricompila l'APK di Calendary (`cd tablet; npm install; npx cap sync android; ...`): è stato aggiunto il plugin `@capacitor/app` per ricevere i link.

API per altre app:

- `api_token` (almeno 16 caratteri), inviato come `Authorization: Bearer <token>`;
- eventi con `linkUrl` e `linkLabel` (pulsante **▶** nell'evento; la notifica push apre il link);
- `POST /api/notify` `{ title, body, url, tag, important }`;
- `DELETE /api/plans/:planId` per eliminare gli eventi creati insieme.

Dettagli in [`calendary/DOCS.md`](calendary/DOCS.md).
