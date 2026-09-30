export type TipCategory = 'azione' | 'focus' | 'pianificazione' | 'studio' | 'benessere';

export interface Tip {
  id: string;
  title: string;
  author?: string;
  text: string;
  howTo: string;
  category: TipCategory;
  icon: string;
}

export const CATEGORY_LABEL: Record<TipCategory, string> = {
  azione: 'Passare all’azione',
  focus: 'Concentrazione',
  pianificazione: 'Pianificazione',
  studio: 'Studio',
  benessere: 'Energia e benessere',
};

export const TIPS: Tip[] = [
  {
    id: 'five-seconds',
    title: 'La regola dei 5 secondi',
    author: 'Mel Robbins',
    icon: '5️⃣',
    category: 'azione',
    text: 'Quando senti l’istinto di fare qualcosa di importante, hai circa 5 secondi prima che il cervello trovi una scusa per rimandare.',
    howTo: 'Conta all’indietro 5, 4, 3, 2, 1 e al “1” muoviti fisicamente: alzati, apri il libro, fai la telefonata. Il conto alla rovescia interrompe l’esitazione.',
  },
  {
    id: 'eat-the-frog',
    title: 'Mangia il ranocchio',
    author: 'Brian Tracy',
    icon: '🐸',
    category: 'azione',
    text: 'Il compito più difficile e importante della giornata va fatto per primo, quando hai più energia.',
    howTo: 'Stasera scegli il tuo “ranocchio” di domani e mettilo nel quadrante Urgente e Importante. Domattina è la prima cosa che fai.',
  },
  {
    id: 'two-minutes',
    title: 'La regola dei 2 minuti',
    author: 'David Allen',
    icon: '⏱️',
    category: 'azione',
    text: 'Se una cosa richiede meno di due minuti, farla subito costa meno che annotarla e ricordarsela.',
    howTo: 'Rispondi a quel messaggio, butta quella carta, archivia quel file adesso. Per le abitudini: inizia con una versione da 2 minuti.',
  },
  {
    id: 'pomodoro',
    title: 'Tecnica del Pomodoro',
    author: 'Francesco Cirillo',
    icon: '🍅',
    category: 'focus',
    text: 'Lavorare a blocchi brevi e protetti rende più facile iniziare e mantiene alta la concentrazione.',
    howTo: '25 minuti di lavoro senza distrazioni, 5 di pausa. Dopo quattro pomodori, una pausa lunga da 15-30 minuti.',
  },
  {
    id: 'parkinson',
    title: 'Legge di Parkinson',
    author: 'C. Northcote Parkinson',
    icon: '⏳',
    category: 'pianificazione',
    text: 'Il lavoro si espande fino a occupare tutto il tempo disponibile.',
    howTo: 'Dai a ogni attività un blocco di tempo preciso in calendario, un po’ più corto di quanto pensi di aver bisogno.',
  },
  {
    id: 'time-blocking',
    title: 'Time blocking',
    icon: '🧱',
    category: 'pianificazione',
    text: 'Ciò che ha un orario in calendario viene fatto; ciò che resta in una lista aspetta.',
    howTo: 'Trasforma le attività importanti ma non urgenti in eventi con inizio e fine. Proteggi quei blocchi come fossero appuntamenti.',
  },
  {
    id: 'pareto',
    title: 'Principio 80/20',
    author: 'Vilfredo Pareto',
    icon: '📊',
    category: 'pianificazione',
    text: 'Una piccola parte delle attività produce la maggior parte dei risultati.',
    howTo: 'Guarda la lista di oggi e chiediti: quali 2 cose, se fatte, renderebbero la giornata un successo? Parti da quelle.',
  },
  {
    id: 'eisenhower',
    title: 'Importante non vuol dire urgente',
    author: 'Dwight D. Eisenhower',
    icon: '🧭',
    category: 'pianificazione',
    text: 'Le cose urgenti gridano, quelle importanti costruiscono il futuro. La matrice ti aiuta a distinguerle.',
    howTo: 'Fai subito il quadrante 1, pianifica il 2, delega o riduci il 3, elimina il 4. Il quadrante 2 è quello che cambia la vita.',
  },
  {
    id: 'one-thing',
    title: 'Una cosa alla volta',
    icon: '🎯',
    category: 'focus',
    text: 'Il multitasking è in realtà un rapido cambio di attività, e ogni cambio costa concentrazione.',
    howTo: 'Chiudi le schede che non servono, telefono in un’altra stanza, una sola finestra aperta.',
  },
  {
    id: 'evening-plan',
    title: 'Pianifica la sera prima',
    icon: '🌙',
    category: 'pianificazione',
    text: 'Svegliarsi sapendo cosa fare elimina la prima e più pericolosa occasione di procrastinare.',
    howTo: 'Prima di dormire compila la matrice di domani con le 3 priorità. Al mattino non devi decidere, solo eseguire.',
  },
  {
    id: 'chain',
    title: 'Non spezzare la catena',
    icon: '⛓️',
    category: 'azione',
    text: 'La costanza batte l’intensità: un po’ ogni giorno supera tanto una volta ogni tanto.',
    howTo: 'Segna ogni giorno in cui hai studiato. Dopo qualche giorno la catena diventa una motivazione a sé.',
  },
  {
    id: 'if-then',
    title: 'Intenzioni “se… allora…”',
    author: 'Peter Gollwitzer',
    icon: '🔀',
    category: 'azione',
    text: 'Decidere in anticipo quando e dove farai qualcosa raddoppia le probabilità di farlo davvero.',
    howTo: '“Se sono le 18:30 e sono a casa, allora apro il modulo di inglese.” Scrivilo nella descrizione dell’evento.',
  },
  {
    id: 'friction',
    title: 'Riduci l’attrito',
    icon: '🧲',
    category: 'focus',
    text: 'L’ambiente vince sulla forza di volontà: rendi facile ciò che vuoi fare e difficile ciò che vuoi evitare.',
    howTo: 'Prepara scrivania, libri e acqua prima della sessione. Esci dai social sul computer.',
  },
  {
    id: 'spaced',
    title: 'Ripetizione dilazionata',
    icon: '🧠',
    category: 'studio',
    text: 'Ripassare a intervalli crescenti fissa i ricordi molto meglio di una lunga sessione unica.',
    howTo: 'Ripassa dopo 1 giorno, 3 giorni, 1 settimana. Il pianificatore distribuisce le sessioni apposta.',
  },
  {
    id: 'active-recall',
    title: 'Richiamo attivo',
    icon: '❓',
    category: 'studio',
    text: 'Rileggere dà l’illusione di sapere; provare a ricordare costruisce davvero la memoria.',
    howTo: 'Chiudi il libro e scrivi o ripeti ad alta voce ciò che ricordi. Poi controlla cosa hai dimenticato.',
  },
  {
    id: 'feynman',
    title: 'Tecnica di Feynman',
    author: 'Richard Feynman',
    icon: '👨‍🏫',
    category: 'studio',
    text: 'Se non sai spiegarlo in modo semplice, non l’hai ancora capito fino in fondo.',
    howTo: 'Spiega l’argomento come se parlassi a un bambino di 12 anni. Dove ti blocchi, torna sul materiale.',
  },
  {
    id: 'weekly-review',
    title: 'Revisione settimanale',
    icon: '🔁',
    category: 'pianificazione',
    text: 'Una volta a settimana guarda cosa hai fatto e cosa arriva: è il momento in cui riprendi il controllo.',
    howTo: 'Domenica, 20 minuti: svuota le note, guarda la settimana in calendario, sposta ciò che non è stato fatto.',
  },
  {
    id: 'one-percent',
    title: 'L’1% ogni giorno',
    author: 'James Clear',
    icon: '📈',
    category: 'azione',
    text: 'Piccoli miglioramenti costanti si sommano in grandi risultati nel tempo.',
    howTo: 'Non puntare alla sessione perfetta: punta a fare anche solo un po’ meglio di ieri.',
  },
  {
    id: '135',
    title: 'La regola 1-3-5',
    icon: '🪜',
    category: 'pianificazione',
    text: 'Una giornata realistica contiene 1 cosa grande, 3 medie e 5 piccole.',
    howTo: 'Usala per non sovraccaricare la matrice: se hai più di 9 attività, qualcosa va spostato.',
  },
  {
    id: 'deep-work',
    title: 'Deep work',
    author: 'Cal Newport',
    icon: '🌊',
    category: 'focus',
    text: 'Il lavoro di valore nasce da blocchi lunghi di concentrazione profonda, senza interruzioni.',
    howTo: 'Blocca 90 minuti in calendario, notifiche spente, un solo obiettivo chiaro per il blocco.',
  },
  {
    id: 'breaks',
    title: 'Pause attive',
    icon: '💧',
    category: 'benessere',
    text: 'Il cervello consuma molta energia: acqua, luce e movimento tengono alta la lucidità.',
    howTo: 'Ogni ora alzati, bevi un bicchiere d’acqua, guarda lontano per 20 secondi.',
  },
  {
    id: 'sleep',
    title: 'Il sonno è studio',
    icon: '😴',
    category: 'benessere',
    text: 'Durante il sonno il cervello consolida ciò che hai imparato durante il giorno.',
    howTo: 'Meglio un’ora di studio in meno che un’ora di sonno in meno prima di un esame.',
  },
  {
    id: 'celebrate',
    title: 'Celebra i progressi',
    icon: '🎉',
    category: 'benessere',
    text: 'Notare ciò che hai completato alimenta la motivazione per il passo successivo.',
    howTo: 'Spunta le attività nella matrice: ogni spunta è una piccola vittoria. Guardale a fine giornata.',
  },
  {
    id: 'temptation',
    title: 'Abbina un piacere',
    author: 'Katy Milkman',
    icon: '🎧',
    category: 'benessere',
    text: 'Associare un’attività noiosa a qualcosa che ti piace la rende più facile da iniziare.',
    howTo: 'La tua playlist preferita solo mentre fai gli esercizi, il caffè buono solo durante lo studio.',
  },
];

/** Stable "tip of the day" (changes at midnight), optionally shifted to rotate. */
export function tipOfTheDay(date = new Date(), shift = 0) {
  const dayIndex = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400e3);
  return TIPS[(((dayIndex + shift) % TIPS.length) + TIPS.length) % TIPS.length];
}
