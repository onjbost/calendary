import type { Trip } from './api';
import { dayLabel, weatherIcon } from './logic';

/** The destination weather, day by day. */
export function WeatherStrip({ trip, compact = false }: { trip: Trip; compact?: boolean }) {
  if (!trip.place) return compact ? null : <div className="faint small">Aggiungi la destinazione per vedere il meteo.</div>;
  if (!trip.weather?.length) return compact ? null : <div className="faint small">Meteo non disponibile.</div>;
  const days = compact ? trip.weather.slice(0, 4) : trip.weather;
  return (
    <div className="trip-weather">
      {!compact && trip.weatherKind === 'last_year' && <div className="faint tiny">Come l’anno scorso: le previsioni arrivano 16 giorni prima.</div>}
      <div className="trip-weather-days">
        {days.map((d) => (
          <div key={d.date} className="trip-weather-day" title={d.rain !== null ? `Pioggia ${d.rain}%` : d.rainy ? 'Pioggia' : ''}>
            {!compact && <span className="tiny faint">{dayLabel(d.date)}</span>}
            <span className="trip-weather-ico">{weatherIcon(d.code, d.rainy)}</span>
            <span className="small mono">{d.max !== null ? Math.round(d.max) : '–'}° <span className="faint">{d.min !== null ? Math.round(d.min) : '–'}°</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
