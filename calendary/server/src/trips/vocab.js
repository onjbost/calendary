// Fixed vocabulary of the trips module. Ids are stable: stored in the DB and shared with WardApp (activity tags).

export const TAGS = {
  beach: { emoji: '🏖️', label: 'Mare' },
  hiking: { emoji: '⛰️', label: 'Montagna/escursione' },
  dinner: { emoji: '🍽️', label: 'Cena elegante' },
  work: { emoji: '💼', label: 'Lavoro' },
  sport: { emoji: '🏃', label: 'Sport' },
  city: { emoji: '🏙️', label: 'Città' },
  party: { emoji: '🎉', label: 'Serata' },
  other: { emoji: '📍', label: 'Altro' },
};

export const MODES = {
  plane: { emoji: '✈️', label: 'Volo' },
  train: { emoji: '🚆', label: 'Treno' },
  bus: { emoji: '🚌', label: 'Bus' },
  car: { emoji: '🚗', label: 'Auto' },
  ferry: { emoji: '⛴️', label: 'Traghetto' },
};

export const BAGS = ['backpack_s', 'backpack_l', 'cabin', 'suitcase'];

export const TRIP_COLOR = '#38bdf8';
