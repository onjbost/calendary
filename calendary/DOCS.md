# Calendary

Calendario personale con stile neon: agenda mensile/settimanale/giornaliera, calendari iCal importati
(Google, Outlook, lavoro, master…), matrice di Eisenhower giornaliera, tips motivazionali,
notifiche push e un assistente che pianifica lo studio.

## Configurazione

| Opzione | Descrizione |
|---|---|
| `password` | **Obbligatoria.** Password per accedere da web e dal tablet. Cambiarla disconnette tutti i dispositivi. |
| `public_url` | Indirizzo pubblico (es. `https://calendary.gattucciocloud.it`). Serve per le notifiche push. |
| `timezone` | Fuso orario, default `Europe/Rome`. |
| `ics_sync_minutes` | Ogni quanti minuti riscaricare i calendari iCal (default 15). |
| `morning_summary` | Ora del riepilogo push mattutino, es. `07:30`. Vuoto = disattivato. |
| `ai_base_url` | Endpoint compatibile OpenAI dell'assistente. Default: Google Gemini. |
| `ai_api_key` | Chiave API dell'assistente. Vuota = assistente AI spento (il pianificatore di studio funziona comunque). |
| `ai_model` | Modello, default `gemini-2.5-flash`. |
| `alexa_skill_id` | ID della skill Alexa *Calendary* (`amzn1.ask.skill…`). Vuoto = integrazione Alexa spenta. |
| `alexa_client_id` / `alexa_client_secret` | Credenziali *Alexa Skill Messaging* (console Alexa → Permissions). Servono per mandare i promemoria su Alexa in automatico. |
| `alexa_reminders` | Quali eventi suonano sugli Echo come promemoria Alexa: `important` (eventi ⚡ e promemoria dettati ad Alexa, default), `all` (tutti quelli con promemoria), `off`. |
| `alexa_announce_service` | Servizio di Home Assistant che parla sull'Echo, es. `notify.alexa_media_echo_cucina` (più servizi separati da virgola). Vuoto = nessun annuncio. |
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

- **Alexa → Calendary** (skill personale *Calendary*): *“Alexa, chiedi a Calendary di ricordarmi di chiamare Marco domani alle 18”*,
  *“…aggiungi dentista giovedì alle 15:30”*, *“…cosa ho domani?”*, *“…qual è il prossimo impegno?”*, *“…aggiungi fare la spesa alla matrice”*.
- **Calendary → Alexa**: i promemoria degli eventi importanti (e quelli dettati ad Alexa) diventano **promemoria Alexa** e suonano su tutti gli Echo,
  anche se modifichi il calendario dal PC o dal tablet. Con *Alexa Media Player* gli eventi importanti e il riepilogo del mattino vengono anche **annunciati a voce**.

La guida passo passo è nel README del repository (sezione *Alexa*). Il modello vocale da importare è in `alexa/skill-package/`.

## Accesso da internet

Esponi la porta `8787` con il tuo Cloudflare Tunnel sul sottodominio scelto.
Le istruzioni complete sono nel README del repository.

I dati (SQLite) sono in `/data` dell'add-on e sono inclusi nei backup di Home Assistant.
