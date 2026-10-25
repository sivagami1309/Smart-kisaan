// Pilot configuration: Tamil Nadu, 5 crops, mandis near Manapparai.
// feedNames are matched (case-insensitive, contains) against the data.gov.in "market" field.
// The real feed's market names are not yet verified; unmapped names are logged by ingestion.

export const STATE = 'Tamil Nadu';

export const CROPS = {
  tomato: { ta: 'தக்காளி', en: 'Tomato', ico: '🍅', code: 'TOM', keyword: 'tomato' },
  onion: { ta: 'வெங்காயம்', en: 'Onion', ico: '🧅', code: 'ONI', keyword: 'onion' },
  paddy: { ta: 'நெல்', en: 'Paddy', ico: '🌾', code: 'PAD', keyword: 'paddy' },
  banana: { ta: 'வாழை', en: 'Banana', ico: '🍌', code: 'BAN', keyword: 'banana' },
  groundnut: { ta: 'நிலக்கடலை', en: 'Groundnut', ico: '🥜', code: 'GNT', keyword: 'groundnut' },
};

export const MANDIS = {
  trichy: { ta: 'திருச்சி', en: 'Trichy (Gandhi Market)', lat: 10.8295, lon: 78.695, feedNames: ['gandhi market', 'trichy', 'tiruchirappalli'] },
  manapparai: { ta: 'மணப்பாறை', en: 'Manapparai', lat: 10.607, lon: 78.425, feedNames: ['manapparai'] },
  dindigul: { ta: 'திண்டுக்கல்', en: 'Dindigul', lat: 10.3624, lon: 77.9695, feedNames: ['dindigul'] },
  oddanchatram: { ta: 'ஒட்டன்சத்திரம்', en: 'Oddanchatram', lat: 10.4867, lon: 77.7514, feedNames: ['oddanchatram', 'ottanchatram'] },
  karur: { ta: 'கரூர்', en: 'Karur', lat: 10.9601, lon: 78.0766, feedNames: ['karur'] },
};

// Road distances (km) measured for the pilot village; other places fall back to straight line × 1.3
export const PLACES = {
  manapparai: { ta: 'மணப்பாறை', en: 'Manapparai', lat: 10.607, lon: 78.425, roadKm: { trichy: 42, manapparai: 6, dindigul: 48, oddanchatram: 92, karur: 70 } },
  trichy: { ta: 'திருச்சி', en: 'Trichy', lat: 10.8295, lon: 78.695 },
  dindigul: { ta: 'திண்டுக்கல்', en: 'Dindigul', lat: 10.3624, lon: 77.9695 },
  karur: { ta: 'கரூர்', en: 'Karur', lat: 10.9601, lon: 78.0766 },
};

export const DEFAULT_COST = { rate: 25, load: 500, comm: 8 };

// data.gov.in "Current Daily Price of Various Commodities from Various Markets (Mandi)"
export const RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
