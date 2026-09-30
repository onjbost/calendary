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
- **Vista tablet (kiosk)**: orologio, prossimo impegno con conto alla rovescia, agenda del giorno, prossimi giorni, matrice e tips a rotazione. Si aggiorna in tempo reale quando modifichi dal PC.

```
Calendary/
├── repository.yaml        ← repository di add-on per Home Assistant
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

## 6. Sviluppo in locale (PC)

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

Variabili utili: `CALENDARY_PASSWORD`, `DATA_DIR`, `PORT`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `CALENDARY_NO_AUTH=1` (solo sviluppo).

## Note

- I dati sono in un file SQLite nella cartella `/data` dell'add-on, quindi rientrano nei **backup di Home Assistant**.
- I link iCal segreti danno accesso ai calendari: trattali come password.
- Gli eventi importati da iCal sono in sola lettura: si modificano nel calendario di origine. Quelli creati in Calendary vivono nei calendari interni (*Personale*, *Studio*, o altri che crei).
