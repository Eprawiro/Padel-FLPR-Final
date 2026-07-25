const cheerio = require('cheerio');

const ALLOWED_HOSTS = new Set(['americano-padel.com', 'www.americano-padel.com']);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(body)
  };
}

function canonicalize(raw) {
  const u = new URL(raw);
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) throw new Error('Only americano-padel.com URLs are allowed.');
  const match = u.pathname.match(/\/(?:r|print)\/([a-z0-9-]+)/i);
  if (!match) throw new Error('The URL does not contain a valid Americano tournament ID.');
  const id = match[1];
  return {
    id,
    sourceUrl: `https://americano-padel.com/print/${id}?ln=en`
  };
}

function cleanLines($) {
  $('script,style,noscript,svg').remove();
  const text = $('body').text().replace(/\r/g, '\n');
  return text.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function parseTournament(html, id, sourceUrl) {
  const $ = cheerio.load(html);
  const title = ($('h1').first().text() || $('title').text() || '').replace(/\s+/g, ' ').trim();
  const lines = cleanLines($);
  const rounds = [];
  let current = null;
  let court = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rm = line.match(/^Round\s+(\d+)/i);
    if (rm) {
      current = { round: Number(rm[1]), matches: [] };
      rounds.push(current);
      court = null;
      continue;
    }
    const cm = line.match(/^Court\s*([A-Za-z0-9-]+)?/i);
    if (cm && current) {
      court = cm[1] || null;
      continue;
    }
    // Common print layout: four player-name lines, optionally followed by a score pair.
    if (current && i + 3 < lines.length) {
      const chunk = lines.slice(i, i + 4);
      const reserved = /^(Round|Court|Toplist|Results?|Print|Americano|Mexicano|Share|Player|Points?|Games?|Sets?)\b/i;
      if (chunk.every(x => !reserved.test(x)) && chunk.every(x => x.length <= 60)) {
        let scoreA = null, scoreB = null, consumed = 4;
        const next = lines[i + 4] || '';
        const score = next.match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/);
        if (score) { scoreA = Number(score[1]); scoreB = Number(score[2]); consumed = 5; }
        current.matches.push({
          court,
          teamA: [chunk[0], chunk[1]],
          teamB: [chunk[2], chunk[3]],
          scoreA, scoreB
        });
        i += consumed - 1;
      }
    }
  }

  // Secondary structured extraction for tables/cards if line heuristic found nothing.
  if (!rounds.some(r => r.matches.length)) {
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('th,td').map((__, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
      if (cells.length >= 5) {
        const names = cells.filter(x => !/^\d+\s*[-:]\s*\d+$/.test(x) && !/^court/i.test(x));
        const sc = cells.find(x => /^\d+\s*[-:]\s*\d+$/.test(x));
        if (names.length >= 4) {
          if (!rounds.length) rounds.push({round: 1, matches: []});
          const sm = sc && sc.match(/^(\d+)\s*[-:]\s*(\d+)$/);
          rounds[0].matches.push({court: cells[0], teamA:names.slice(0,2), teamB:names.slice(2,4), scoreA:sm?Number(sm[1]):null, scoreB:sm?Number(sm[2]):null});
        }
      }
    });
  }

  const matches = rounds.flatMap(r => r.matches.map(m => ({...m, round:r.round})));
  const players = [...new Set(matches.flatMap(m => [...m.teamA, ...m.teamB]))].sort();
  const completed = matches.filter(m => Number.isFinite(m.scoreA) && Number.isFinite(m.scoreB)).length;
  return {
    externalTournamentId: id,
    source: 'Americano Padel',
    sourceUrl,
    title: title || `Americano Tournament ${id}`,
    importedAt: new Date().toISOString(),
    status: 'TEST',
    countTowardRating: false,
    players,
    rounds,
    summary: {rounds: rounds.length, matches: matches.length, completedMatches: completed, players: players.length},
    parserVersion: 'D2.2-alpha.1',
    rawTextPreview: lines.slice(0, 80)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {ok:true});
  if (event.httpMethod !== 'POST') return json(405, {ok:false, error:'POST required'});
  try {
    const payload = JSON.parse(event.body || '{}');
    if (!payload.url) return json(400, {ok:false, error:'Tournament URL is required.'});
    const {id, sourceUrl} = canonicalize(payload.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        'user-agent': 'FLPR-Integration-Test/1.0 (+Netlify Function)',
        'accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);
    if (!res.ok) return json(502, {ok:false, error:`Americano server returned HTTP ${res.status}.`, sourceUrl});
    const html = await res.text();
    if (!html || html.length < 100) return json(502, {ok:false, error:'The tournament page returned insufficient content.', sourceUrl});
    const tournament = parseTournament(html, id, sourceUrl);
    const warnings = [];
    if (!tournament.summary.matches) warnings.push('No matches were recognized. The page structure may differ from the current parser.');
    if (tournament.summary.completedMatches < tournament.summary.matches) warnings.push('Some matches do not have recognized scores.');
    return json(200, {ok:true, tournament, warnings});
  } catch (err) {
    return json(400, {ok:false, error: err.name === 'AbortError' ? 'Americano server request timed out.' : err.message});
  }
};
