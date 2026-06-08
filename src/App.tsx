import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Brain, Calendar, ExternalLink, Gauge, ImageOff, Info, Library, LinkIcon, Network, Search, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { localCatalog } from "./data/catalog";
import { CatalogApiProvider, JikanProvider, LocalCatalogProvider } from "./services/animeProvider";
import type { Anime, Recommendation, RecommendationFilters, RecommendationGraphData, RecommendationMode, RecommendationSortMode } from "./types";
import {
  filterAnimeCatalog,
  formatAnimeMetadata,
  getAnimeById,
  getAnimeDisplayTitle,
  getAnimeSubtitle,
  getUniqueFormats,
  getUniqueGenres,
  getUniqueYears,
  sortAnimeCatalog,
  type CatalogFilters,
  type CatalogSortMode,
} from "./utils/catalog";
import {
  applyRecommendationFilters,
  clearRecommendationFilters,
  extractMalId,
  factorPercent,
  findAnime,
  formatSimilarityScore,
  hasActiveRecommendationFilters,
  matchStrength,
  mergeMetadataAndVectorRecommendations,
  recommendAnime,
  relativePercent,
  sortRecommendationResults,
  strengthTone,
  vectorResultsToRecommendations,
} from "./utils/recommendation";

const localProvider = new LocalCatalogProvider();
const apiProvider = new CatalogApiProvider();
const jikanProvider = new JikanProvider();
const defaultQuery = "Fullmetal Alchemist: Brotherhood";
const defaultAnime = findAnime(defaultQuery, localCatalog)[0]?.anime ?? localCatalog[0] ?? null;

const titleFor = getAnimeDisplayTitle;

type ActiveView = "recommend" | "catalog" | "detail";

const defaultCatalogFilters: CatalogFilters = {
  query: "",
  genre: "",
  format: "",
  year: "",
  minScore: 0,
};

const defaultRecommendationFilters = clearRecommendationFilters();
const recommendationFormatOptions = ["TV", "Movie"];
const recommendationModeOptions: Array<{ value: RecommendationMode; label: string }> = [
  { value: "metadata", label: "Metadata" },
  { value: "semantic", label: "Semantic" },
  { value: "hybrid", label: "Hybrid" },
];
const graphSizeOptions = [5, 8, 12];

const clampPercentScore = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round((value ?? 0) * 100)));
};

const recommendationGraphId = (anime: Anime) => String(anime.malId ?? anime.id);

const graphScoreFor = (rec: Recommendation, mode: RecommendationMode) => {
  if (mode === "metadata") return rec.metadataScore ?? rec.score;
  if (mode === "semantic") return rec.vectorSimilarity ?? rec.score;
  return rec.hybridScore ?? rec.score;
};

const graphLabelFor = (rec: Recommendation, mode: RecommendationMode) => {
  const explicitReason = rec.explanation.topReasons[0] ?? rec.reasons[0];
  if (explicitReason && !/^Semantic similarity:/i.test(explicitReason)) {
    return explicitReason.length > 28 ? `${explicitReason.slice(0, 25)}...` : explicitReason;
  }
  if (mode === "metadata") return "metadata match";
  if (mode === "semantic") return "semantic match";
  return "hybrid match";
};

const buildRecommendationGraphData = (source: Anime, recommendations: Recommendation[], mode: RecommendationMode): RecommendationGraphData => {
  const sourceId = `source-${recommendationGraphId(source)}`;
  const recommendationNodes = recommendations.map((rec) => {
    const animeId = recommendationGraphId(rec.anime);
    return {
      id: `rec-${animeId}`,
      anime: rec.anime,
      role: "recommendation" as const,
      score: graphScoreFor(rec, mode),
    };
  });

  return {
    nodes: [
      {
        id: sourceId,
        anime: source,
        role: "source",
      },
      ...recommendationNodes,
    ],
    edges: recommendations.map((rec) => {
      const animeId = recommendationGraphId(rec.anime);
      return {
        id: `${sourceId}-rec-${animeId}`,
        sourceId,
        targetId: `rec-${animeId}`,
        score: graphScoreFor(rec, mode),
        mode,
        label: graphLabelFor(rec, mode),
      };
    }),
  };
};

const SourcePill = ({ source }: { source: Anime["source"] }) => (
  <span className={`source source-${source}`}>{source === "mal" ? "MAL" : source === "jikan" ? "Jikan" : "Local"}</span>
);

const FactorBar = ({ label, value, displayPercent }: { label: string; value: number; displayPercent?: number }) => (
  <div className="factor-row">
    <span>{label}</span>
    <div className="factor-track">
      <span style={{ width: `${displayPercent ?? factorPercent(value)}%` }} />
    </div>
    <strong>{displayPercent ?? factorPercent(value)}</strong>
  </div>
);

const RecommendationReasons = ({ rec }: { rec: Recommendation }) => {
  const reasons = rec.explanation.topReasons.length ? rec.explanation.topReasons : rec.reasons;

  return (
    <div className="recommendation-explanation">
      <div className="explanation-heading">
        <span>Why this matches</span>
        <strong>{formatSimilarityScore(rec.explanation.totalScore)} {rec.mode === "semantic" ? "semantic" : rec.mode === "hybrid" ? "hybrid" : "similar"}</strong>
      </div>
      <p>{rec.explanation.summary}</p>
      <div className="reason-list">
        {reasons.slice(0, 3).map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
    </div>
  );
};

const RecommendationScoreList = ({ rec }: { rec: Recommendation }) => (
  <div className="score-chip-list" aria-label="Recommendation scores">
    {rec.metadataScore !== undefined && <span>Metadata {formatSimilarityScore(rec.metadataScore)}</span>}
    {rec.vectorSimilarity !== undefined && <span>Semantic {formatSimilarityScore(rec.vectorSimilarity)}</span>}
    {rec.hybridScore !== undefined && <span>Hybrid {formatSimilarityScore(rec.hybridScore)}</span>}
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

const RecommendationNetwork = ({
  source,
  recommendations,
  mode,
  limit,
  isLoading,
  onLimitChange,
  onPickRecommendation,
}: {
  source: Anime;
  recommendations: Recommendation[];
  mode: RecommendationMode;
  limit: number;
  isLoading: boolean;
  onLimitChange: (limit: number) => void;
  onPickRecommendation: (anime: Anime) => void;
}) => {
  const graphRecommendations = recommendations.slice(0, limit);
  const graph = useMemo(
    () => buildRecommendationGraphData(source, graphRecommendations, mode),
    [graphRecommendations, mode, source],
  );
  const recommendationNodes = graph.nodes.filter((node) => node.role === "recommendation");
  const sourceNode = graph.nodes.find((node) => node.role === "source");
  const center = { x: 450, y: 172 };
  const radiusX = 318;
  const radiusY = 112;
  const nodePositions = new Map<string, { x: number; y: number }>();

  recommendationNodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(recommendationNodes.length, 1)) * Math.PI * 2;
    nodePositions.set(node.id, {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    });
  });

  return (
    <section className="network-section" aria-label="Recommendation network visualization">
      <div className="network-heading">
        <div>
          <span className="eyebrow"><Network size={16} /> Network</span>
          <h3>{recommendationModeOptions.find((option) => option.value === mode)?.label ?? "Active"} recommendation graph</h3>
        </div>
        <div className="network-size-control" aria-label="Graph size">
          {graphSizeOptions.map((option) => (
            <button key={option} type="button" className={limit === option ? "active" : ""} onClick={() => onLimitChange(option)}>
              Top {option}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="network-state">
          <Brain size={18} />
          <span>Loading graph from stored semantic similarity.</span>
        </div>
      ) : recommendationNodes.length === 0 || !sourceNode ? (
        <div className="network-state">
          <Search size={18} />
          <span>No visible recommendations are available for the graph.</span>
        </div>
      ) : (
        <div className="network-canvas">
          <svg className="network-svg" viewBox="0 0 900 344" role="img" aria-label={`${titleFor(source)} connected to ${recommendationNodes.length} recommendations`}>
            <defs>
              <marker id="edge-dot" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5">
                <circle cx="3.5" cy="3.5" r="2.5" fill="#25766f" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const target = nodePositions.get(edge.targetId);
              if (!target) return null;
              const scorePercent = clampPercentScore(edge.score);
              const width = 1.5 + (scorePercent / 100) * 5.5;
              const labelX = center.x + (target.x - center.x) * 0.58;
              const labelY = center.y + (target.y - center.y) * 0.58;
              return (
                <g key={edge.id} className={`network-edge network-edge-${edge.mode}`}>
                  <line
                    x1={center.x}
                    y1={center.y}
                    x2={target.x}
                    y2={target.y}
                    strokeWidth={width}
                    markerEnd="url(#edge-dot)"
                  />
                  <text x={labelX} y={labelY}>
                    {scorePercent}% · {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="network-source-node" style={{ left: `${(center.x / 900) * 100}%`, top: `${(center.y / 344) * 100}%` }}>
            <AnimePoster anime={source} />
            <span>{titleFor(source)}</span>
          </div>

          {recommendationNodes.map((node) => {
            const position = nodePositions.get(node.id);
            if (!position) return null;
            const scorePercent = clampPercentScore(node.score);
            return (
              <button
                key={node.id}
                type="button"
                className="network-rec-node"
                style={{ left: `${(position.x / 900) * 100}%`, top: `${(position.y / 344) * 100}%` }}
                onClick={() => onPickRecommendation(node.anime)}
                title={`Recommend from ${titleFor(node.anime)}`}
              >
                <AnimePoster anime={node.anime} />
                <span>{titleFor(node.anime)}</span>
                <strong>{scorePercent}%</strong>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

const ChipList = ({ items, emptyLabel = "Unknown" }: { items: string[] | undefined; emptyLabel?: string }) => {
  const values = items?.filter(Boolean) ?? [];
  if (!values.length) return <span className="muted-chip">{emptyLabel}</span>;

  return (
    <>
      {values.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </>
  );
};

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>("recommend");
  const [detailBackView, setDetailBackView] = useState<Exclude<ActiveView, "detail">>("catalog");
  const [query, setQuery] = useState(defaultQuery);
  const [count, setCount] = useState(8);
  const [catalog, setCatalog] = useState<Anime[]>(localCatalog);
  const [catalogLoadState, setCatalogLoadState] = useState<"loading" | "ready" | "error">(localCatalog.length ? "ready" : "loading");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(defaultCatalogFilters);
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>("popularity");
  const [recommendationFilters, setRecommendationFilters] = useState<RecommendationFilters>(defaultRecommendationFilters);
  const [recommendationSort, setRecommendationSort] = useState<RecommendationSortMode>("similarity_desc");
  const [recommendationMode, setRecommendationMode] = useState<RecommendationMode>("metadata");
  const [recommendationGraphLimit, setRecommendationGraphLimit] = useState(8);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selected, setSelected] = useState<Anime | null>(defaultAnime);
  const [metadataRecommendations, setMetadataRecommendations] = useState<Recommendation[]>(() =>
    defaultAnime ? recommendAnime(defaultAnime, localCatalog, localCatalog.length) : [],
  );
  const [semanticRecommendations, setSemanticRecommendations] = useState<Recommendation[]>([]);
  const [semanticState, setSemanticState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [semanticMessage, setSemanticMessage] = useState("");
  const [selectedDetailAnime, setSelectedDetailAnime] = useState<Anime | null>(null);
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
          setMetadataRecommendations(recommendAnime(refreshedDefault, remoteCatalog, remoteCatalog.length));
          setSemanticRecommendations([]);
          setSemanticState("idle");
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
  const hybridRecommendations = useMemo(
    () => mergeMetadataAndVectorRecommendations(metadataRecommendations, semanticRecommendations),
    [metadataRecommendations, semanticRecommendations],
  );
  const recommendations = useMemo(() => {
    if (recommendationMode === "semantic") return semanticRecommendations;
    if (recommendationMode === "hybrid") return semanticRecommendations.length ? hybridRecommendations : metadataRecommendations;
    return metadataRecommendations;
  }, [hybridRecommendations, metadataRecommendations, recommendationMode, semanticRecommendations]);
  const filteredRecommendationPool = useMemo(() => applyRecommendationFilters(recommendations, recommendationFilters), [recommendations, recommendationFilters]);
  const sortedRecommendationPool = useMemo(
    () => sortRecommendationResults(filteredRecommendationPool, recommendationSort),
    [filteredRecommendationPool, recommendationSort],
  );
  const visibleRecommendations = useMemo(() => sortedRecommendationPool.slice(0, count), [sortedRecommendationPool, count]);
  const activeRecommendationFilterCount = useMemo(() => {
    const scalarFilters = [
      recommendationFilters.format,
      recommendationFilters.minYear,
      recommendationFilters.maxYear,
      recommendationFilters.minScore,
      recommendationFilters.maxScore,
    ].filter((value) => value !== undefined && value !== "").length;
    return scalarFilters;
  }, [recommendationFilters]);
  const detailAnime = useMemo(() => {
    if (!selectedDetailAnime) return null;
    return getAnimeById(catalog, selectedDetailAnime.id) ?? selectedDetailAnime;
  }, [catalog, selectedDetailAnime]);
  const similarAnime = useMemo(() => {
    if (!detailAnime) return [];
    const comparisonCatalog = [detailAnime, ...catalog.filter((anime) => anime.id !== detailAnime.id && anime.malId !== detailAnime.malId)];
    return recommendAnime(detailAnime, comparisonCatalog, 6);
  }, [catalog, detailAnime]);
  const grouped = useMemo(() => {
    return visibleRecommendations.reduce<Record<string, Recommendation[]>>((acc, rec) => {
      acc[rec.cluster] = [...(acc[rec.cluster] ?? []), rec];
      return acc;
    }, {});
  }, [visibleRecommendations]);
  const topScore = visibleRecommendations.reduce((max, rec) => Math.max(max, rec.score), 0);
  const topSynopsisScore = visibleRecommendations.reduce((max, rec) => Math.max(max, rec.breakdown.synopsis), 0);
  const isRecommendationGraphLoading = recommendationMode !== "metadata" && semanticState === "loading";

  useEffect(() => {
    if (!selected || recommendationMode === "metadata") return;

    const animeId = selected.malId ?? selected.id;
    if (!animeId) {
      setSemanticState("error");
      setSemanticMessage("Semantic similarity is unavailable. Metadata recommendations are still available.");
      return;
    }

    let active = true;
    setSemanticState("loading");
    setSemanticMessage("");

    apiProvider
      .getVectorSimilar(animeId, Math.max(count, 20))
      .then((response) => {
        if (!active) return;
        setSemanticRecommendations(vectorResultsToRecommendations(response.similar ?? []));
        setSemanticState("ready");
        setSemanticMessage("");
      })
      .catch(() => {
        if (!active) return;
        setSemanticRecommendations([]);
        setSemanticState("error");
        setSemanticMessage("Semantic similarity is unavailable. Metadata recommendations are still available.");
      });

    return () => {
      active = false;
    };
  }, [count, recommendationMode, selected]);

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
      setMetadataRecommendations(recommendAnime(target, mergedCatalog, mergedCatalog.length));
      setSemanticRecommendations([]);
      setSemanticState("idle");
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
        setMetadataRecommendations(recommendAnime(fallback, catalog, catalog.length));
        setSemanticRecommendations([]);
        setSemanticState("idle");
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
    setMetadataRecommendations(recommendAnime(anime, catalog, catalog.length));
    setSemanticRecommendations([]);
    setSemanticState("idle");
    setProviderName(localProvider.name);
    setLookupState("ready");
    setMessage(`Matched ${titleFor(anime)} from local storage.`);
  };

  const refreshCount = (nextCount: number) => {
    setCount(nextCount);
  };

  const updateCatalogFilter = <Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) => {
    setCatalogFilters((current) => ({ ...current, [key]: value }));
  };

  const updateRecommendationFilter = <Key extends keyof RecommendationFilters>(key: Key, value: RecommendationFilters[Key]) => {
    setRecommendationFilters((current) => ({ ...current, [key]: value }));
  };

  const updateRecommendationNumberFilter = (key: "minYear" | "maxYear" | "minScore" | "maxScore", value: string) => {
    const parsed = value === "" ? undefined : Number(value);
    updateRecommendationFilter(key, Number.isFinite(parsed) ? parsed : undefined);
  };

  const recommendFromCatalog = (anime: Anime) => {
    const title = titleFor(anime);
    setQuery(title);
    setSelected(anime);
    setMetadataRecommendations(recommendAnime(anime, catalog, catalog.length));
    setSemanticRecommendations([]);
    setSemanticState("idle");
    setProviderName(localProvider.name);
    setLookupState("ready");
    setActiveView("recommend");
    setMessage(`Matched ${title} from the catalog. Recommendations are ready below.`);
  };

  const openAnimeDetail = (anime: Anime) => {
    setSelectedDetailAnime(anime);
    setDetailBackView(activeView === "detail" ? detailBackView : activeView);
    setActiveView("detail");
  };

  const goBackFromDetail = () => {
    setActiveView(detailBackView);
  };

  const recommendFromAnime = (anime: Anime) => {
    const title = titleFor(anime);
    const comparisonCatalog = [anime, ...catalog.filter((item) => item.id !== anime.id && item.malId !== anime.malId)];
    setQuery(title);
    setSelected(anime);
    setMetadataRecommendations(recommendAnime(anime, comparisonCatalog, comparisonCatalog.length));
    setSemanticRecommendations([]);
    setSemanticState("idle");
    setProviderName(localProvider.name);
    setLookupState("ready");
    setActiveView("recommend");
    setMessage(`Matched ${title}. Recommendations are ready below.`);
  };

  return (
    <main className="app-shell">
      <nav className="app-nav" aria-label="Primary">
        <button type="button" className={activeView === "recommend" || (activeView === "detail" && detailBackView === "recommend") ? "active" : ""} onClick={() => setActiveView("recommend")}>
          <Sparkles size={17} />
          Recommend
        </button>
        <button type="button" className={activeView === "catalog" || (activeView === "detail" && detailBackView === "catalog") ? "active" : ""} onClick={() => setActiveView("catalog")}>
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
              <div className="count-control">
                <label htmlFor="count">{count} results</label>
                <input id="count" type="range" min="3" max="50" value={count} onChange={(event) => refreshCount(Number(event.target.value))} />
                <div className="filter-popover-wrap">
                  <button
                    type="button"
                    className={`filter-toggle ${hasActiveRecommendationFilters(recommendationFilters) ? "active" : ""}`}
                    onClick={() => setIsFilterOpen((current) => !current)}
                    aria-expanded={isFilterOpen}
                    aria-controls="recommendation-filter-popover"
                    title="Filter recommendations"
                  >
                    <SlidersHorizontal size={19} />
                    {activeRecommendationFilterCount > 0 && <span>{activeRecommendationFilterCount}</span>}
                  </button>

                  {isFilterOpen && (
                    <section id="recommendation-filter-popover" className="filter-popover" aria-label="Recommendation filters">
                      <div className="filter-popover-heading">
                        <strong>Filter results</strong>
                        <button
                          type="button"
                          onClick={() => setRecommendationFilters(clearRecommendationFilters())}
                          disabled={!hasActiveRecommendationFilters(recommendationFilters)}
                        >
                          Clear
                        </button>
                      </div>

                      <label>
                        Format
                        <select value={recommendationFilters.format ?? ""} onChange={(event) => updateRecommendationFilter("format", event.target.value)}>
                          <option value="">All formats</option>
                          {recommendationFormatOptions.map((format) => (
                            <option key={format} value={format}>{format}</option>
                          ))}
                        </select>
                      </label>

                      <div className="filter-field-pair">
                        <label>
                          Min score
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.1"
                            placeholder="Any"
                            value={recommendationFilters.minScore ?? ""}
                            onChange={(event) => updateRecommendationNumberFilter("minScore", event.target.value)}
                          />
                        </label>

                        <label>
                          Max score
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.1"
                            placeholder="Any"
                            value={recommendationFilters.maxScore ?? ""}
                            onChange={(event) => updateRecommendationNumberFilter("maxScore", event.target.value)}
                          />
                        </label>
                      </div>

                      <div className="filter-field-pair">
                        <label>
                          From year
                          <input
                            type="number"
                            min="1900"
                            max="2100"
                            placeholder="Any"
                            value={recommendationFilters.minYear ?? ""}
                            onChange={(event) => updateRecommendationNumberFilter("minYear", event.target.value)}
                          />
                        </label>

                        <label>
                          To year
                          <input
                            type="number"
                            min="1900"
                            max="2100"
                            placeholder="Any"
                            value={recommendationFilters.maxYear ?? ""}
                            onChange={(event) => updateRecommendationNumberFilter("maxYear", event.target.value)}
                          />
                        </label>
                      </div>
                    </section>
                  )}
                </div>
              </div>
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

      {activeView === "recommend" && (
        <section className={`status-strip status-${lookupState}`}>
          <span>{message}</span>
          <a href="https://myanimelist.net/apiconfig/references/api/v2" target="_blank" rel="noreferrer">
            API reference <ExternalLink size={14} />
          </a>
        </section>
      )}

      {activeView === "detail" ? (
        detailAnime ? (
          <section className="detail-page">
            <button type="button" className="back-button" onClick={goBackFromDetail}>
              <ArrowLeft size={18} />
              Back to {detailBackView === "catalog" ? "Catalog" : "Recommend"}
            </button>

            <article className="detail-hero">
              <aside className="detail-poster-panel">
                <div className="detail-poster-frame">
                  <AnimePoster anime={detailAnime} />
                </div>
                <button type="button" className="primary-action" onClick={() => recommendFromAnime(detailAnime)}>
                  <Sparkles size={17} />
                  Recommend from this anime
                </button>
                {detailAnime.malId && (
                  <a href={`https://myanimelist.net/anime/${detailAnime.malId}`} target="_blank" rel="noreferrer" className="secondary-action">
                    <LinkIcon size={16} />
                    View on MyAnimeList
                  </a>
                )}
              </aside>

              <div className="detail-content">
                <div className="detail-title-block">
                  <div className="card-topline">
                    <SourcePill source={detailAnime.source} />
                    <span>{formatAnimeMetadata(detailAnime).format} {detailAnime.year ? `· ${detailAnime.year}` : ""}</span>
                  </div>
                  <h1>{detailAnime.title.romaji || titleFor(detailAnime)}</h1>
                  {getAnimeSubtitle(detailAnime) && <p className="detail-subtitle">{getAnimeSubtitle(detailAnime)}</p>}
                  {detailAnime.title.native && <p className="native-title">{detailAnime.title.native}</p>}
                </div>

                <div className="detail-stat-grid" aria-label="Anime metadata">
                  {Object.entries(formatAnimeMetadata(detailAnime)).map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>

                <section className="detail-section">
                  <h2>Synopsis</h2>
                  <p>{detailAnime.synopsis || "No synopsis is available for this title yet."}</p>
                </section>

                <div className="detail-taxonomy">
                  <section className="detail-section">
                    <h2>Genres</h2>
                    <div className="tag-cloud">
                      <ChipList items={detailAnime.genres} />
                    </div>
                  </section>
                  <section className="detail-section">
                    <h2>Themes and tags</h2>
                    <div className="tag-cloud">
                      <ChipList items={detailAnime.themes} />
                    </div>
                  </section>
                  <section className="detail-section">
                    <h2>Demographics</h2>
                    <div className="tag-cloud">
                      <ChipList items={detailAnime.demographics} />
                    </div>
                  </section>
                </div>

                <section className="detail-section source-section">
                  <h2>Source info</h2>
                  <div className="source-info-list">
                    <span><Info size={15} /> {detailAnime.source === "mal" ? "MyAnimeList API" : detailAnime.source === "jikan" ? "Jikan fallback" : "Loaded catalog"}</span>
                    <span>{detailAnime.malId ? `MAL ID #${detailAnime.malId}` : "No MAL ID available"}</span>
                    <span>{detailAnime.rankingTypes?.length ? detailAnime.rankingTypes.join(", ") : "No ranking type metadata"}</span>
                  </div>
                </section>
              </div>
            </article>

            <section className="similar-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Similar anime</span>
                  <h2>Nearby recommendations</h2>
                </div>
                <span className="catalog-count">{similarAnime.length} matches</span>
              </div>
              {similarAnime.length ? (
                <div className="similar-grid">
                  {similarAnime.map((rec) => (
                    <article key={rec.anime.id} className="similar-card">
                      <div className="similar-media">
                        <AnimePoster anime={rec.anime} />
                        <div className="card-topline">
                          <SourcePill source={rec.anime.source} />
                          <span className={`match-pill match-${strengthTone(matchStrength(rec.score, similarAnime[0]?.score ?? 0))}`}>
                            {formatSimilarityScore(rec.score)}
                          </span>
                        </div>
                      </div>
                      <div className="similar-card-body">
                        <h3>{titleFor(rec.anime)}</h3>
                        <p>{rec.explanation.summary || rec.reasons[0] || "Recommended based on overall metadata similarity."}</p>
                        <div className="detail-card-actions">
                          <button type="button" className="secondary-button" onClick={() => openAnimeDetail(rec.anime)}>
                            <Info size={15} />
                            View details
                          </button>
                          <button type="button" className="primary-button" onClick={() => recommendFromAnime(rec.anime)}>
                            <Sparkles size={15} />
                            Recommend
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className="empty-state catalog-state">
                  <Sparkles size={24} />
                  <h2>No similar anime found yet.</h2>
                  <p>The current catalog needs more nearby titles before this section can fill in.</p>
                </section>
              )}
            </section>
          </section>
        ) : (
          <section className="empty-state catalog-state">
            <Library size={24} />
            <h2>That anime is not available.</h2>
            <p>The detail record could not be found in the current loaded catalog.</p>
            <button type="button" className="primary-action inline-action" onClick={() => setActiveView("catalog")}>
              Back to Catalog
            </button>
          </section>
        )
      ) : activeView === "catalog" ? (
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
                    <div className="catalog-card-actions">
                      <button type="button" className="secondary-button" onClick={() => openAnimeDetail(anime)}>
                        <Info size={15} />
                        View details
                      </button>
                      <button type="button" className="primary-button" onClick={() => recommendFromCatalog(anime)}>
                        <Sparkles size={16} />
                        Recommend
                      </button>
                    </div>
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
                {[...(selected.genres ?? []), ...(selected.themes ?? []), ...(selected.demographics ?? [])].map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <button type="button" className="secondary-action selected-detail-action" onClick={() => openAnimeDetail(selected)}>
                <Info size={16} />
                View details
              </button>
            </div>
          </aside>

          <section className="results-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Similarity graph</span>
                <h2>Recommended neighbors</h2>
              </div>
              <span className="catalog-count">Showing {visibleRecommendations.length} of {filteredRecommendationPool.length} matches</span>
            </div>

            <div className="score-explainer">
              <div>
                <h3>How matches are scored</h3>
                {recommendationMode === "metadata" ? (
                  <p>
                    Ranking uses MAL genres, available theme and demographic tags, metadata, title wording, and a local TF-IDF comparison of MAL synopses. These explanations show the strongest deterministic metadata reasons for each match; they are not AI or embedding judgments.
                  </p>
                ) : recommendationMode === "semantic" ? (
                  <p>
                    Ranking uses stored pgvector nearest neighbors from server-side anime embeddings. The browser does not receive raw embeddings or see database details.
                  </p>
                ) : (
                  <p>
                    Ranking blends the current explainable metadata score with stored semantic similarity. Metadata reasons remain deterministic, and semantic scores come from server-side embedding neighbors.
                  </p>
                )}
              </div>
              {recommendationMode === "metadata" ? (
                <div className="weight-list" aria-label="Similarity factor weights">
                  <span><strong>34%</strong> genres</span>
                  <span><strong>24%</strong> themes and audience</span>
                  <span><strong>23%</strong> synopsis similarity</span>
                  <span><strong>14%</strong> format/year/studio</span>
                  <span><strong>5%</strong> title</span>
                </div>
              ) : recommendationMode === "hybrid" ? (
                <div className="weight-list" aria-label="Hybrid factor weights">
                  <span><strong>65%</strong> metadata</span>
                  <span><strong>35%</strong> semantic</span>
                </div>
              ) : (
                <div className="weight-list" aria-label="Semantic factor weights">
                  <span><strong>100%</strong> semantic</span>
                  <span><strong>pgvector</strong> nearest</span>
                </div>
              )}
            </div>

            <div className="recommendation-toolbar">
              <div className="mode-control" aria-label="Recommendation mode">
                {recommendationModeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={recommendationMode === option.value ? "active" : ""}
                    onClick={() => setRecommendationMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span>{hasActiveRecommendationFilters(recommendationFilters) ? `${visibleRecommendations.length} filtered recommendations` : `${visibleRecommendations.length} recommendations`}</span>
              <label>
                Sort
                <select value={recommendationSort} onChange={(event) => setRecommendationSort(event.target.value as RecommendationSortMode)}>
                  <option value="similarity_desc">Similarity</option>
                  <option value="year_desc">Age</option>
                  <option value="score_desc">Score</option>
                </select>
              </label>
            </div>

            {recommendationMode !== "metadata" && semanticState === "loading" && (
              <section className="semantic-status semantic-loading">
                <Brain size={18} />
                <span>Loading semantic similarity from stored embeddings.</span>
              </section>
            )}

            {recommendationMode !== "metadata" && semanticState === "error" && (
              <section className="semantic-status semantic-error">
                <Brain size={18} />
                <span>{semanticMessage || "Semantic similarity is unavailable. Metadata recommendations are still available."}</span>
              </section>
            )}

            {visibleRecommendations.length === 0 ? (
              <section className="empty-state catalog-state recommendation-empty">
                <Search size={24} />
                <h2>No recommendations match these filters.</h2>
                <p>Try widening the score range, changing format, or clearing the year filters.</p>
              </section>
            ) : (
              <>
                <RecommendationNetwork
                  source={selected}
                  recommendations={visibleRecommendations}
                  mode={recommendationMode}
                  limit={recommendationGraphLimit}
                  isLoading={isRecommendationGraphLoading}
                  onLimitChange={setRecommendationGraphLimit}
                  onPickRecommendation={recommendFromAnime}
                />

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
                                  {formatSimilarityScore(rec.score)} {rec.mode === "semantic" ? "semantic" : rec.mode === "hybrid" ? "hybrid" : "match"}
                                </span>
                              </div>
                              <h4>{titleFor(rec.anime)}</h4>
                              <p>{rec.anime.synopsis}</p>
                              <RecommendationScoreList rec={rec} />
                              <RecommendationReasons rec={rec} />
                              {rec.showMetadataFactors !== false && (
                                <div className="factor-list">
                                  <FactorBar label="Genres" value={rec.breakdown.genres} />
                                  <FactorBar label="Synopsis" value={rec.breakdown.synopsis} displayPercent={relativePercent(rec.breakdown.synopsis, topSynopsisScore)} />
                                  <FactorBar label="Format" value={rec.breakdown.format} />
                                  <FactorBar label="Score" value={Math.max(rec.breakdown.score, rec.breakdown.popularity)} />
                                </div>
                              )}
                              <div className="detail-card-actions">
                                <button type="button" className="secondary-button" onClick={() => openAnimeDetail(rec.anime)}>
                                  <Info size={15} />
                                  View details
                                </button>
                                <button type="button" className="primary-button" onClick={() => recommendFromAnime(rec.anime)}>
                                  <Sparkles size={15} />
                                  Recommend
                                </button>
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
              </>
            )}
          </section>
        </section>
      ) : (
        <EmptyState />
      )}
    </main>
  );
}
