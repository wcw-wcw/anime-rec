import { FormEvent, useEffect, useMemo, useState } from "react";
import { Calendar, ExternalLink, Gauge, ImageOff, Library, LinkIcon, Search, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { localCatalog } from "./data/catalog";
import { CatalogApiProvider, JikanProvider, LocalCatalogProvider } from "./services/animeProvider";
import type { Anime, Recommendation } from "./types";
import {
  filterAnimeCatalog,
  getAnimeDisplayTitle,
  getUniqueFormats,
  getUniqueGenres,
  getUniqueYears,
  sortAnimeCatalog,
  type CatalogFilters,
  type CatalogSortMode,
} from "./utils/catalog";
import { extractMalId, factorPercent, findAnime, matchStrength, recommendAnime, relativePercent, strengthTone } from "./utils/recommendation";

const localProvider = new LocalCatalogProvider();
const apiProvider = new CatalogApiProvider();
const jikanProvider = new JikanProvider();
const defaultQuery = "Fullmetal Alchemist: Brotherhood";
const defaultAnime = findAnime(defaultQuery, localCatalog)[0]?.anime ?? localCatalog[0] ?? null;

const titleFor = getAnimeDisplayTitle;

type ActiveView = "recommend" | "catalog";

const defaultCatalogFilters: CatalogFilters = {
  query: "",
  genre: "",
  format: "",
  year: "",
  minScore: 0,
};

const SourcePill = ({ source }: { source: Anime["source"] }) => (
  <span className={`source source-${source}`}>{source === "mal" ? "MAL" : source === "jikan" ? "Jikan" : "Local"}</span>
);

const FactorBar = ({ label, value }: { label: string; value: number }) => (
  <div className="factor-row">
    <span>{label}</span>
    <div className="factor-track">
      <span style={{ width: `${factorPercent(value)}%` }} />
    </div>
    <strong>{factorPercent(value)}</strong>
  </div>
);

const EmptyState = () => (
  <section className="empty-state">
    <Sparkles size={24} />
    <h2>Start with a show you already like.</h2>
    <p>Try “Attack on Titan”, “Your Name”, “Haikyu!!”, or paste a MyAnimeList anime URL that exists in the current seed catalog.</p>
  </section>
);

const AnimePoster = ({ anime, className = "" }: { anime: Anime; className?: string }) => {
  const [failed, setFailed] = useState(!anime.imageUrl);

  useEffect(() => {
    setFailed(!anime.imageUrl);
  }, [anime.imageUrl]);

  if (failed) {
    return (
      <div className={`poster-fallback ${className}`} aria-label={`No poster available for ${titleFor(anime)}`}>
        <ImageOff size={24} />
      </div>
    );
  }

  return <img className={className} src={anime.imageUrl} alt="" onError={() => setFailed(true)} />;
};

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>("recommend");
  const [query, setQuery] = useState(defaultQuery);
  const [count, setCount] = useState(8);
  const [catalog, setCatalog] = useState<Anime[]>(localCatalog);
  const [catalogLoadState, setCatalogLoadState] = useState<"loading" | "ready" | "error">(localCatalog.length ? "ready" : "loading");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(defaultCatalogFilters);
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>("popularity");
  const [selected, setSelected] = useState<Anime | null>(defaultAnime);
  const [recommendations, setRecommendations] = useState<Recommendation[]>(() => (defaultAnime ? recommendAnime(defaultAnime, localCatalog, 8) : []));
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "ready" | "error">("ready");
  const [message, setMessage] = useState("Using local catalog data. Start the local API to fetch and store missing MAL entries.");
  const [providerName, setProviderName] = useState(localProvider.name);

  useEffect(() => {
    localProvider.setCatalog(catalog);
  }, [catalog]);

  useEffect(() => {
    apiProvider
      .getCatalog()
      .then((remoteCatalog) => {
        if (!remoteCatalog.length) {
          setCatalogLoadState("ready");
          return;
        }
        setCatalog(remoteCatalog);
        localProvider.setCatalog(remoteCatalog);
        setProviderName(apiProvider.name);
        const refreshedDefault = findAnime(query, remoteCatalog)[0]?.anime;
        if (refreshedDefault) {
          setSelected(refreshedDefault);
          setRecommendations(recommendAnime(refreshedDefault, remoteCatalog, count));
        }
        setMessage(`Loaded ${remoteCatalog.length} anime from local JSON storage.`);
        setCatalogLoadState("ready");
      })
      .catch(() => {
        setCatalogLoadState(localCatalog.length ? "ready" : "error");
        setMessage(`Using bundled fallback catalog with ${localCatalog.length} anime. Start npm run dev:api for persistent MAL lookups.`);
      });
  }, []);

  const matches = useMemo(() => findAnime(query, catalog).slice(0, 5), [catalog, query]);
  const genres = useMemo(() => getUniqueGenres(catalog), [catalog]);
  const formats = useMemo(() => getUniqueFormats(catalog), [catalog]);
  const years = useMemo(() => getUniqueYears(catalog), [catalog]);
  const catalogResults = useMemo(() => sortAnimeCatalog(filterAnimeCatalog(catalog, catalogFilters), catalogSort), [catalog, catalogFilters, catalogSort]);
  const grouped = useMemo(() => {
    return recommendations.reduce<Record<string, Recommendation[]>>((acc, rec) => {
      acc[rec.cluster] = [...(acc[rec.cluster] ?? []), rec];
      return acc;
    }, {});
  }, [recommendations]);
  const topScore = recommendations[0]?.score ?? 0;
  const topStoryScore = Math.max(0, ...recommendations.map((rec) => rec.breakdown.synopsis));

  const runRecommendation = async (event?: FormEvent) => {
    event?.preventDefault();
    setLookupState("loading");

    try {
      const looksLikeUrl = /^https?:\/\//i.test(query);
      let target: Anime | null = null;
      let activeCatalog = catalog;
      let messageWasSet = false;

      try {
        setProviderName(apiProvider.name);
        const result = await apiProvider.lookup(query);
        if (result) {
          target = result.anime;
          activeCatalog = result.catalog;
          setCatalog(result.catalog);
          setMessage(
            result.stored && result.persisted !== false
              ? `Fetched ${titleFor(result.anime)} from MAL and saved it to local JSON storage.`
              : result.stored
                ? `Fetched ${titleFor(result.anime)} from MAL for this session. Add a database to persist new runtime lookups after deploy.`
              : `Matched ${titleFor(result.anime)} from local JSON storage.`,
          );
          messageWasSet = true;
        }
      } catch {
        setProviderName(localProvider.name);
      }

      if (!target) {
        const localMatches = findAnime(query, activeCatalog);
        target = localMatches[0]?.anime ?? null;
      }

      if (!target && looksLikeUrl) {
        setProviderName(jikanProvider.name);
        target = await jikanProvider.getByUrl(query);
      }

      if (!target && !looksLikeUrl) {
        setProviderName(jikanProvider.name);
        const remoteMatches = await jikanProvider.search(query);
        target = remoteMatches[0] ?? null;
      }

      if (!target) {
        setLookupState("error");
        setMessage("No anime matched that input yet. Try a simpler title or a MyAnimeList anime URL.");
        return;
      }

      const mergedCatalog = [target, ...activeCatalog.filter((anime) => anime.malId !== target?.malId && anime.id !== target?.id)];
      setSelected(target);
      setRecommendations(recommendAnime(target, mergedCatalog, count));
      setLookupState("ready");

      const malId = extractMalId(query);
      if (!messageWasSet) {
        setMessage(
          malId
            ? `Matched MAL anime #${malId}. Results are ranked against ${activeCatalog.length} stored titles.`
            : `Matched ${titleFor(target)}. Results are ranked against ${activeCatalog.length} stored titles.`,
        );
      }
    } catch (error) {
      setLookupState("error");
      setProviderName(localProvider.name);
      const fallback = findAnime(query, catalog)[0]?.anime;
      if (fallback) {
        setSelected(fallback);
        setRecommendations(recommendAnime(fallback, catalog, count));
        setLookupState("ready");
        setMessage("Remote lookup was unavailable, so the app used the local catalog.");
      } else {
        setMessage(error instanceof Error ? error.message : "Lookup failed.");
      }
    }
  };

  const pickSuggestion = (anime: Anime) => {
    setQuery(titleFor(anime));
    setSelected(anime);
    setRecommendations(recommendAnime(anime, catalog, count));
    setProviderName(localProvider.name);
    setLookupState("ready");
    setMessage(`Matched ${titleFor(anime)} from local storage.`);
  };

  const refreshCount = (nextCount: number) => {
    setCount(nextCount);
    if (selected) setRecommendations(recommendAnime(selected, catalog, nextCount));
  };

  const updateCatalogFilter = <Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) => {
    setCatalogFilters((current) => ({ ...current, [key]: value }));
  };

  const recommendFromCatalog = (anime: Anime) => {
    const title = titleFor(anime);
    setQuery(title);
    setSelected(anime);
    setRecommendations(recommendAnime(anime, catalog, count));
    setProviderName(localProvider.name);
    setLookupState("ready");
    setActiveView("recommend");
    setMessage(`Matched ${title} from the catalog. Recommendations are ready below.`);
  };

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Primary">
        <button type="button" className={activeView === "recommend" ? "active" : ""} onClick={() => setActiveView("recommend")}>
          <Sparkles size={17} />
          Recommend
        </button>
        <button type="button" className={activeView === "catalog" ? "active" : ""} onClick={() => setActiveView("catalog")}>
          <Library size={17} />
          Catalog
        </button>
      </nav>

      {activeView === "recommend" && (
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Library size={16} /> AnimeRec</span>
            <h1>Find the next anime that sits near what you already love.</h1>
            <p>
              Search by title or paste a MyAnimeList URL.
            </p>
          </div>

          <form className="search-panel" onSubmit={runRecommendation}>
            <label htmlFor="anime-query">Anime title or database link</label>
            <div className="search-row">
              <Search size={20} />
              <input
                id="anime-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Steins;Gate or https://myanimelist.net/anime/9253"
              />
              <button type="submit" disabled={lookupState === "loading"}>
                {lookupState === "loading" ? "Searching" : "Recommend"}
              </button>
            </div>

            <div className="controls-row">
              <label className="count-control" htmlFor="count">
                <SlidersHorizontal size={18} />
                <span>{count} results</span>
                <input id="count" type="range" min="3" max="50" value={count} onChange={(event) => refreshCount(Number(event.target.value))} />
              </label>
              <div className="provider-chip">
                <Gauge size={18} />
                <span>{providerName}</span>
              </div>
            </div>

            {matches.length > 0 && (
              <div className="suggestions">
                {matches.map(({ anime }) => (
                  <button key={anime.id} type="button" onClick={() => pickSuggestion(anime)}>
                    {titleFor(anime)}
                  </button>
                ))}
              </div>
            )}
          </form>
        </section>
      )}

      <section className={`status-strip status-${lookupState}`}>
        <span>{message}</span>
        <a href="https://myanimelist.net/apiconfig/references/api/v2" target="_blank" rel="noreferrer">
          API reference <ExternalLink size={14} />
        </a>
      </section>

      {activeView === "catalog" ? (
        <section className="catalog-page">
          <div className="catalog-heading">
            <div>
              <span className="eyebrow"><Library size={16} /> Browse catalog</span>
              <h1>Explore every loaded anime.</h1>
            </div>
            <span className="catalog-count">{catalogResults.length} of {catalog.length} titles</span>
          </div>

          <section className="catalog-tools" aria-label="Catalog filters">
            <label className="catalog-search" htmlFor="catalog-query">
              <Search size={19} />
              <input
                id="catalog-query"
                value={catalogFilters.query}
                onChange={(event) => updateCatalogFilter("query", event.target.value)}
                placeholder="Search titles or synopses"
              />
            </label>

            <label>
              Genre
              <select value={catalogFilters.genre} onChange={(event) => updateCatalogFilter("genre", event.target.value)}>
                <option value="">All genres</option>
                {genres.map((genre) => (
                  <option key={genre} value={genre}>{genre}</option>
                ))}
              </select>
            </label>

            <label>
              Format
              <select value={catalogFilters.format} onChange={(event) => updateCatalogFilter("format", event.target.value)}>
                <option value="">All formats</option>
                {formats.map((format) => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </label>

            <label>
              Year
              <select value={catalogFilters.year} onChange={(event) => updateCatalogFilter("year", event.target.value)}>
                <option value="">Any year</option>
                {years.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>

            <label>
              Min score
              <select value={catalogFilters.minScore} onChange={(event) => updateCatalogFilter("minScore", Number(event.target.value))}>
                <option value={0}>Any score</option>
                <option value={6}>6.0+</option>
                <option value={7}>7.0+</option>
                <option value={8}>8.0+</option>
                <option value={9}>9.0+</option>
              </select>
            </label>

            <label>
              Sort
              <select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as CatalogSortMode)}>
                <option value="popularity">Popularity</option>
                <option value="score">Score</option>
                <option value="year">Year</option>
                <option value="title">Title</option>
                <option value="rank">Rank</option>
              </select>
            </label>
          </section>

          {catalogLoadState === "loading" && !catalog.length ? (
            <section className="empty-state catalog-state">
              <Sparkles size={24} />
              <h2>Loading the catalog.</h2>
              <p>The app is checking the current anime source before filling this view.</p>
            </section>
          ) : catalog.length === 0 || catalogLoadState === "error" ? (
            <section className="empty-state catalog-state">
              <Library size={24} />
              <h2>No catalog data is available yet.</h2>
              <p>Once local or API-loaded anime are available, they will appear here.</p>
            </section>
          ) : catalogResults.length === 0 ? (
            <section className="empty-state catalog-state">
              <Search size={24} />
              <h2>No anime match those filters.</h2>
              <p>Try a broader title search, a different genre, or a lower score threshold.</p>
            </section>
          ) : (
            <div className="catalog-grid">
              {catalogResults.map((anime) => (
                <article key={`${anime.source}-${anime.id}-${anime.malId ?? "local"}`} className="catalog-card">
                  <div className="catalog-poster">
                    <AnimePoster anime={anime} />
                  </div>
                  <div className="catalog-card-body">
                    <div className="card-topline">
                      <SourcePill source={anime.source} />
                      <span>{anime.format} {anime.year ? `· ${anime.year}` : ""}</span>
                    </div>
                    <h2>{titleFor(anime)}</h2>
                    <div className="catalog-stats">
                      <span><Star size={14} /> {anime.score ? anime.score.toFixed(2) : "No score"}</span>
                      <span><Gauge size={14} /> {anime.popularity ? `#${anime.popularity}` : anime.rank ? `Rank #${anime.rank}` : "Unranked"}</span>
                      <span><Calendar size={14} /> {anime.episodes ? `${anime.episodes} eps` : "Episodes TBD"}</span>
                    </div>
                    <p>{anime.synopsis || "No synopsis is available for this title yet."}</p>
                    <div className="catalog-tags">
                      {(anime.genres ?? []).slice(0, 4).map((genre) => (
                        <span key={genre}>{genre}</span>
                      ))}
                    </div>
                    <button type="button" onClick={() => recommendFromCatalog(anime)}>
                      <Sparkles size={16} />
                      Recommend from this
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : selected ? (
        <section className="workspace">
          <aside className="selected-panel">
            <div className="poster-frame">
              <AnimePoster anime={selected} />
            </div>
            <div className="selected-copy">
              <SourcePill source={selected.source} />
              <h2>{titleFor(selected)}</h2>
              <p>{selected.synopsis}</p>
              <div className="meta-grid">
                <span>{selected.format}</span>
                <span>{selected.year ?? "Unknown year"}</span>
                <span>{selected.score ? `${selected.score.toFixed(2)} score` : "No score"}</span>
                <span>{selected.episodes ? `${selected.episodes} eps` : "Episodes TBD"}</span>
              </div>
              <div className="tag-cloud">
                {[...selected.genres, ...selected.themes, ...selected.demographics].map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </aside>

          <section className="results-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Similarity graph</span>
                <h2>Recommended neighbors</h2>
              </div>
              <span className="catalog-count">{catalog.length} stored titles</span>
            </div>

            <div className="score-explainer">
              <div>
                <h3>How matches are scored</h3>
                <p>
                  Ranking uses MAL genres, any available theme/demographic tags, metadata, title wording, and a local TF-IDF vector comparison of MAL synopses. Story bars are scaled against the strongest story match in the current results, so they show useful spread without pretending to be neural semantic embeddings.
                </p>
              </div>
              <div className="weight-list" aria-label="Similarity factor weights">
                <span><strong>34%</strong> genres</span>
                <span><strong>24%</strong> extra tags</span>
                <span><strong>23%</strong> synopsis text</span>
                <span><strong>14%</strong> format/year/studio</span>
                <span><strong>5%</strong> title</span>
              </div>
            </div>

            <div className="graph-card">
              <div className="graph-legend">
                <span><i className="tone-strong" /> Very close</span>
                <span><i className="tone-good" /> Good fit</span>
                <span><i className="tone-moderate" /> Similar</span>
                <span><i className="tone-light" /> Looser</span>
              </div>
              {recommendations.map((rec, index) => {
                const strength = matchStrength(rec.score, topScore);
                const tone = strengthTone(strength);
                return (
                  <div
                    key={rec.anime.id}
                    className={`graph-node graph-node-${tone}`}
                    style={{
                      left: `${12 + ((index * 19) % 76)}%`,
                      top: `${22 + ((index * 31) % 54)}%`,
                      width: `${48 + strength * 0.62}px`,
                      height: `${48 + strength * 0.62}px`,
                    }}
                    title={`${titleFor(rec.anime)}: ${strength} match strength`}
                  >
                    {strength}
                  </div>
                );
              })}
              <div className="graph-caption">
                Bigger circles are stronger matches. Color shows closeness tier. Position is a loose spread to make clusters readable, not a map coordinate.
              </div>
            </div>

            <div className="cluster-stack">
              {Object.entries(grouped).map(([cluster, items]) => (
                <article key={cluster} className="cluster-group">
                  <h3>{cluster}</h3>
                  <div className="card-grid">
                    {items.map((rec) => (
                      <article key={rec.anime.id} className="anime-card">
                        <AnimePoster anime={rec.anime} />
                        <div className="card-body">
                          <div className="card-topline">
                            <SourcePill source={rec.anime.source} />
                            <span className={`match-pill match-${strengthTone(matchStrength(rec.score, topScore))}`}>
                              {matchStrength(rec.score, topScore)} match
                            </span>
                          </div>
                          <h4>{titleFor(rec.anime)}</h4>
                          <p>{rec.anime.synopsis}</p>
                          <div className="factor-list">
                            <FactorBar label="Genres" value={rec.breakdown.genres} />
                            <FactorBar label="Tags" value={Math.max(rec.breakdown.themes, rec.breakdown.genres * 0.55)} />
                            <FactorBar label="Story" value={relativePercent(rec.breakdown.synopsis, topStoryScore) / 100} />
                            <FactorBar label="Meta" value={rec.breakdown.metadata} />
                          </div>
                          <div className="reason-list">
                            {rec.reasons.map((reason) => (
                              <span key={reason}>{reason}</span>
                            ))}
                          </div>
                          {rec.anime.malId && (
                            <div className="card-footer">
                              <a href={`https://myanimelist.net/anime/${rec.anime.malId}`} target="_blank" rel="noreferrer" className="mal-link">
                                <LinkIcon size={14} /> MAL
                              </a>
                              <span className="mal-score">{rec.anime.score ? `${rec.anime.score.toFixed(2)} MAL` : "No MAL score"}</span>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      ) : (
        <EmptyState />
      )}
    </main>
  );
}
