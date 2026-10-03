// Episode-post discovery helpers shared by site providers.
// Matches WordPress post links to the requested episode. Ordering by confidence:
//   1. exact air-date slug ("19th-september-2026") — requires TMDB air_date
//   2. numeric "-episode-N" suffix in the post slug (yodesionline convention)
//   3. chronological position among the show's dated episode posts — works with
//      no TMDB episode data at all (new seasons, TMDB gaps)
import { dedupe } from "./html.js";
import { episodeDateSlug } from "./tmdb.js";

var MONTH_NUM = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  // Abbreviated forms (tellynagari-style slugs: "27th-sep-2026")
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11,
};

var NON_EPISODE_RE = /promo|trailer|teaser|preview|spoiler|coming-soon|written-update|review/i;

// Extract an air-date from a post slug: "19th-september-2026" or
// "september-19-2026" → UTC ms. 0 when the slug carries no date.
export function slugTimestamp(href) {
  var lower = String(href || "").toLowerCase();
  var m = lower.match(/(\d{1,2})(?:st|nd|rd|th)-([a-z]+)-(\d{4})/);
  if (m && MONTH_NUM[m[2]] !== undefined) {
    return Date.UTC(Number(m[3]), MONTH_NUM[m[2]], Number(m[1]));
  }
  m = lower.match(/([a-z]+)-(\d{1,2})(?:st|nd|rd|th)-(\d{4})/);
  if (m && MONTH_NUM[m[1]] !== undefined) {
    return Date.UTC(Number(m[3]), MONTH_NUM[m[1]], Number(m[2]));
  }
  return 0;
}

// Slug variants used to match post links: the request's slugCandidates plus a
// year-stripped variant for year-suffixed titles (sites like desiruleztv.net
// drop "2026" from post slugs) and the WordPress possessive fix ("-s" → "s").
export function postSlugVariants(request) {
  var candidates = request.slugCandidates || [];
  var extra = [];
  for (var i = 0; i < candidates.length; i++) {
    var stripped = candidates[i].replace(/-\d{4}$/, "");
    if (stripped !== candidates[i]) {
      extra.push(stripped);
    }
    extra.push(candidates[i].replace(/-s(?=-|$)/g, "s"));
  }
  return dedupe(candidates.concat(extra));
}

function hasYearSuffix(slugCandidates) {
  return (slugCandidates || []).some(function (slug) {
    return /-\d{4}$/.test(slug);
  });
}

function showYear(slugCandidates) {
  for (var i = 0; i < (slugCandidates || []).length; i++) {
    var m = slugCandidates[i].match(/-(\d{4})$/);
    if (m) return m[1];
  }
  return "";
}

// Pick episode post URLs from links found on a search/archive page.
//   request   — buildMediaRequest result (airDate, episode, slugCandidates)
//   hostRe    — limits matches to the provider's own domain
//   rejectRe  — optional extra exclusion (e.g. /\/category\// archives)
// Returns an ordered candidate list; only the first (confident) group is used
// by callers — see each provider for how many links it resolves.
export function episodePostCandidates(hrefs, request, hostRe, rejectRe, slugVariants) {
  slugVariants = slugVariants || postSlugVariants(request);
  var dateSlug = episodeDateSlug(request.airDate);
  var ep = Number(request.episode || 0);
  var links = dedupe(
    (hrefs || []).filter(function (href) {
      if (!hostRe.test(href)) return false;
      if (rejectRe && rejectRe.test(href)) return false;
      if (NON_EPISODE_RE.test(href)) return false;
      var lower = href.toLowerCase();
      return slugVariants.some(function (slug) {
        return lower.indexOf(slug) !== -1;
      });
    }),
  );

  // When the show title carries a year ("…-2026") but a link only matched via
  // the year-stripped variant, require the post to signal the same year —
  // either literally or through its slug date — so older seasons of the same
  // show can't poison date-less fallbacks.
  var year = showYear(request.slugCandidates);
  if (year && hasYearSuffix(request.slugCandidates)) {
    var fullSlug = (request.slugCandidates || []).filter(function (s) {
      return s.indexOf("-" + year) !== -1;
    });
    var strict = links.filter(function (href) {
      var lower = href.toLowerCase();
      return fullSlug.some(function (slug) {
        return lower.indexOf(slug) !== -1;
      });
    });
    if (strict.length === 0) {
      strict = links.filter(function (href) {
        var lower = href.toLowerCase();
        if (lower.indexOf(year) !== -1) return true;
        var ts = slugTimestamp(href);
        return ts > 0 && new Date(ts).getUTCFullYear() === Number(year);
      });
    }
    links = strict;
  }

  // 1. Exact air-date slug — highest confidence, keeps multi-post episodes.
  //    Accept abbreviated months too ("27th-sep-2026" == "27th-september-2026").
  if (dateSlug) {
    var dateVariants = [dateSlug];
    var dm = dateSlug.match(/^(\d+\w{2})-([a-z]+)-(\d{4})$/);
    if (dm) dateVariants.push(dm[1] + "-" + dm[2].slice(0, 3) + "-" + dm[3]);
    var dated = links.filter(function (href) {
      var lower = href.toLowerCase();
      return dateVariants.some(function (v) { return lower.indexOf(v) !== -1; });
    });
    if (dated.length > 0) return dated;
  }

  // 2. Numeric "-episode-N" suffix (e.g. "-full-episode-46/").
  if (ep > 0) {
    var epRe = new RegExp("episode-" + ep + "(?:[/-]|$)");
    var numbered = links.filter(function (href) {
      return epRe.test(href.toLowerCase());
    });
    if (numbered.length > 0) return numbered;
  }

  // 3. Chronological position among the show's dated posts (new seasons where
  //    TMDB only has early episodes — posts appear in air order).
  if (ep > 0) {
    var byTs = {};
    links.forEach(function (href) {
      var ts = slugTimestamp(href);
      if (ts > 0) {
        if (!byTs[ts]) byTs[ts] = [];
        byTs[ts].push(href);
      }
    });
    var dates = Object.keys(byTs).map(Number).sort(function (a, b) { return a - b; });
    var target = dates[ep - 1];
    if (target) {
      // When TMDB knows the air date but no slug matched it (branches 1-2
      // failed), a site that keeps only its latest post would otherwise hand
      // the newest episode's streams to an older request. Verify the picked
      // post is within ~2 days of the requested air date.
      if (request.airDate) {
        var airTs = Date.parse(request.airDate + "T00:00:00Z");
        if (isNaN(airTs) || Math.abs(target - airTs) > 2 * 24 * 60 * 60 * 1000) {
          return [];
        }
      }
      return byTs[target];
    }
  }

  return [];
}
