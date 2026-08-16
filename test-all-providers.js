// Comprehensive end-user verification — tests all providers with real Hindi content.
// Usage: node test-all-providers.js

var providers = {
  'desi-serials-to': require('./providers/desi-serials-to.js'),
  'desitvserials-se': require('./providers/desitvserials-se.js'),
  'desiruleztv-net': require('./providers/desiruleztv-net.js'),
  'mixdrop-desi': require('./providers/mixdrop-desi.js'),
  'streamtape-desi': require('./providers/streamtape-desi.js'),
  'filemoon-movieswatch': require('./providers/filemoon-movieswatch.js'),
  'streamwish-heymovies': require('./providers/streamwish-heymovies.js'),
  'dramavideo-desi': require('./providers/dramavideo-desi.js'),
  'yodesionline-net': require('./providers/yodesionline-net.js'),
};

// TV content — daily soaps + trending shows
// NOTE: Episode numbers calibrated to what's actually available on source sites.
// desitvserials-se/desiruleztv-net match by air date, not episode number.
// Anupamaa latest on sites: July 10, 2026 (TMDB E2075). Testing E2070 (July 3) for availability.
var tvContent = [
  { id: '116479', name: 'Anupamaa', season: 1, episode: 2070 },
  { id: '16413', name: 'Yeh Rishta Kya Kehlata Hai', season: 1, episode: 80 },
  { id: '111453', name: 'Ghum Hai Kisikey Pyaar Meiin', season: 3, episode: 1 },
  { id: '240293', name: 'Jhanak', season: 2, episode: 566 },
  { id: '248721', name: 'Udne Ki Aasha', season: 1, episode: 1 },
  { id: '237227', name: 'Bigg Boss', season: 19, episode: 106 },
  { id: '247769', name: 'The Great Indian Kapil Show', season: 5, episode: 1 },
  { id: '99918', name: "India's Best Dancer", season: 5, episode: 22 },
  { id: '101352', name: 'Panchayat', season: 3, episode: 8 },
  { id: '84105', name: 'Mirzapur', season: 3, episode: 10 },
  { id: '203832', name: 'Taaza Khabar', season: 2, episode: 6 },
];

// Movies
var movieContent = [
  { id: '1015981', name: 'Jolly LLB 3' },
  { id: '864692', name: 'Pathaan' },
  { id: '360814', name: 'Dangal' },
  { id: '20453', name: '3 Idiots' },
  { id: '690957', name: 'Pushpa: The Rise' },
  { id: '579974', name: 'RRR' },
  { id: '781732', name: 'Animal' },
  { id: '872906', name: 'Jawan' },
];

var tvProviders = ['desi-serials-to', 'desitvserials-se', 'desiruleztv-net', 'mixdrop-desi', 'streamtape-desi', 'dramavideo-desi', 'yodesionline-net'];
var movieProviders = ['mixdrop-desi', 'streamtape-desi', 'filemoon-movieswatch'];

var TIMEOUT = 45000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); })
  ]);
}

function testProvider(providerName, tmdbId, mediaType, season, episode) {
  var provider = providers[providerName];
  var start = Date.now();
  return withTimeout(provider.getStreams(tmdbId, mediaType, season, episode), TIMEOUT)
    .then(function (streams) {
      var elapsed = ((Date.now() - start) / 1000).toFixed(1);
      return { provider: providerName, streams: streams || [], elapsed: elapsed, error: null };
    })
    .catch(function (err) {
      var elapsed = ((Date.now() - start) / 1000).toFixed(1);
      return { provider: providerName, streams: [], elapsed: elapsed, error: err.message };
    });
}

function formatStream(s) {
  var parts = [];
  if (s.name) parts.push(s.name);
  if (s.quality) parts.push(s.quality);
  if (s.size) parts.push(s.size);
  if (s.url) {
    var urlShort = s.url.substring(0, 70);
    if (s.url.length > 70) urlShort += '...';
    parts.push(urlShort);
  }
  return parts.join(' | ');
}

async function runTests() {
  console.log('============================================================');
  console.log('  COMPREHENSIVE PROVIDER VERIFICATION — v2.8.1');
  console.log('  Testing ' + Object.keys(providers).length + ' providers with real Hindi content');
  console.log('============================================================\n');

  // TV tests
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TV SHOWS (Daily Soaps + Trending)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  var tvResults = {};
  for (var content of tvContent) {
    console.log('▶ ' + content.name + ' (S' + content.season + 'E' + content.episode + ') [' + content.id + ']');
    var tests = tvProviders.map(function (p) {
      return testProvider(p, content.id, 'tv', content.season, content.episode);
    });
    var results = await Promise.all(tests);
    tvResults[content.name] = results;
    for (var r of results) {
      var status = r.error ? '✗ ' + r.error : (r.streams.length > 0 ? '✓ ' + r.streams.length + ' streams' : '○ no streams');
      console.log('  ' + r.provider.padEnd(22) + ' ' + status + ' (' + r.elapsed + 's)');
      if (r.streams.length > 0) {
        for (var s of r.streams.slice(0, 3)) {
          console.log('      ' + formatStream(s));
        }
      }
    }
    console.log('');
  }

  // Movie tests
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  MOVIES (Hindi)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  var movieResults = {};
  for (var content of movieContent) {
    console.log('▶ ' + content.name + ' [' + content.id + ']');
    var tests = movieProviders.map(function (p) {
      return testProvider(p, content.id, 'movie', null, null);
    });
    var results = await Promise.all(tests);
    movieResults[content.name] = results;
    for (var r of results) {
      var status = r.error ? '✗ ' + r.error : (r.streams.length > 0 ? '✓ ' + r.streams.length + ' streams' : '○ no streams');
      console.log('  ' + r.provider.padEnd(22) + ' ' + status + ' (' + r.elapsed + 's)');
      if (r.streams.length > 0) {
        for (var s of r.streams.slice(0, 3)) {
          console.log('      ' + formatStream(s));
        }
      }
    }
    console.log('');
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  var providerStats = {};
  var allProviderNames = Object.keys(providers);
  for (var pn of allProviderNames) {
    providerStats[pn] = { tested: 0, found: 0, errors: 0, totalTime: 0 };
  }

  for (var contentName in tvResults) {
    for (var r of tvResults[contentName]) {
      providerStats[r.provider].tested++;
      providerStats[r.provider].totalTime += parseFloat(r.elapsed);
      if (r.error) providerStats[r.provider].errors++;
      else if (r.streams.length > 0) providerStats[r.provider].found++;
    }
  }
  for (var contentName in movieResults) {
    for (var r of movieResults[contentName]) {
      providerStats[r.provider].tested++;
      providerStats[r.provider].totalTime += parseFloat(r.elapsed);
      if (r.error) providerStats[r.provider].errors++;
      else if (r.streams.length > 0) providerStats[r.provider].found++;
    }
  }

  console.log('Provider'.padEnd(24) + 'Tested'.padEnd(8) + 'Found'.padEnd(8) + 'Errors'.padEnd(8) + 'Avg Time');
  console.log('-'.repeat(60));
  for (var pn of allProviderNames) {
    var s = providerStats[pn];
    var avg = s.tested > 0 ? (s.totalTime / s.tested).toFixed(1) + 's' : '-';
    console.log(pn.padEnd(24) + String(s.tested).padEnd(8) + String(s.found).padEnd(8) + String(s.errors).padEnd(8) + avg);
  }

  var totalTested = 0, totalFound = 0, totalErrors = 0;
  for (var pn of allProviderNames) {
    totalTested += providerStats[pn].tested;
    totalFound += providerStats[pn].found;
    totalErrors += providerStats[pn].errors;
  }
  console.log('-'.repeat(60));
  console.log('TOTAL'.padEnd(24) + String(totalTested).padEnd(8) + String(totalFound).padEnd(8) + String(totalErrors).padEnd(8));
  console.log('\nSuccess rate: ' + (totalTested > 0 ? ((totalFound / totalTested) * 100).toFixed(1) : 0) + '% (' + totalFound + '/' + totalTested + ')');
}

runTests().catch(function(e) { console.error('Fatal:', e); process.exit(1); });
