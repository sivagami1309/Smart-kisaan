// Rule-based Tamil/English voice commands (ported from the earlier project's voiceCommands.ts).

const CROP_WORDS = {
  tomato: ['தக்காளி', 'tomato', 'tomatoes', 'thakkali'],
  onion: ['வெங்காயம்', 'பெரிய வெங்காயம்', 'onion', 'onions', 'vengayam'],
  paddy: ['நெல்', 'அரிசி', 'பொன்னி', 'paddy', 'rice', 'nel'],
  banana: ['வாழை', 'வாழைத்தார்', 'வாழைப்பழம்', 'banana', 'bananas', 'vazhai'],
  groundnut: ['நிலக்கடலை', 'வேர்க்கடலை', 'கடலை', 'groundnut', 'groundnuts', 'peanut', 'peanuts'],
};
// A different crop that shares a word with ours (same rule as ingestion)
const NOT_OUR_CROP = ['சின்ன வெங்காயம்', 'small onion', 'shallot'];

// First match wins, so action words are checked before crops
const ACTIONS = [
  ['nearby', ['அருகில்', 'அருகிலுள்ள', 'பக்கத்தில்', 'nearby', 'near me', 'nearest']],
  ['weather', ['வானிலை', 'மழை', 'வெயில்', 'weather', 'rain', 'forecast']],
  ['together', ['சேர்ந்து', 'கூட்டு', 'together', 'share vehicle', 'pool']],
  ['sales', ['என் விற்பனை', 'விற்பனை பதிவு', 'my sales', 'sales']],
  ['tips', ['குறிப்பு', 'ஆலோசனை', 'tips', 'advice']],
  ['profit', ['லாபம்', 'லாப', 'profit']],
  ['home', ['முகப்பு', 'home', 'dashboard']],
];

// English words must match whole words ("price" must not match "rice"); Tamil matches as written
const has = (text, word) => /^[a-z ]+$/.test(word)
  ? new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(text)
  : text.includes(word);

function findCrop(text) {
  if (NOT_OUR_CROP.some(w => has(text, w))) return null;
  let best = null, len = 0;
  for (const [crop, words] of Object.entries(CROP_WORDS)) {
    for (const w of words) if (w.length > len && has(text, w)) { best = crop; len = w.length; }
  }
  return best;
}

export function parseVoice(raw) {
  const text = String(raw ?? '').toLowerCase().trim();
  if (!text) return { type: 'none' };
  const crop = findCrop(text);
  for (const [type, words] of ACTIONS) {
    if (words.some(w => has(text, w))) return crop ? { type, crop } : { type };
  }
  return crop ? { type: 'crop-prices', crop } : { type: 'none' };
}

const PAGES = { nearby: 'markets.html', weather: 'weather.html', together: 'together.html', sales: 'sales.html', tips: 'tips.html', profit: 'profit.html', home: 'home.html' };

export function hrefFor(cmd) {
  if (cmd.type === 'crop-prices') return `results.html?crop=${cmd.crop}`;
  const page = PAGES[cmd.type];
  if (!page) return null;
  return cmd.crop && (cmd.type === 'profit' || cmd.type === 'together') ? `${page}?crop=${cmd.crop}` : page;
}
