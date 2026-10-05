// Visual themes: colors, background and fonts change, layouts don't. Saved per device (localStorage),
// like the other display preferences, so the tablet and the PC can look different.

export type ThemeId = 'neon' | 'minimal';

export const THEMES: { id: ThemeId; name: string; description: string; swatch: string[]; themeColor: string }[] = [
  { id: 'neon', name: 'Neon', description: 'Glassmorphism, sfondo animato e luci al neon', swatch: ['#05030f', '#00e5ff', '#ff2bd6', '#a66bff'], themeColor: '#05030f' },
  { id: 'minimal', name: 'Minimal', description: 'Nero e arancione, superfici piatte, font Inter', swatch: ['#000000', '#141414', '#ff7a00', '#f2f2f2'], themeColor: '#000000' },
];

const KEY = 'calendary.theme';

export function currentTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    if (THEMES.some((x) => x.id === t)) return t as ThemeId;
  } catch {
    /* storage unavailable */
  }
  return 'neon';
}

export function applyTheme(id: ThemeId = currentTheme()) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.themeColor);
}

export function setTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: applies to this session only */
  }
  applyTheme(id);
}
