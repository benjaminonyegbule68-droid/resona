/* =========================================================
   RESONA — MUSIC DISCOVERY MODULE
   File: js/discovery.js
   Version: 2.0.0

   Responsibilities:
   - Music discovery and catalogue loading
   - Featured and trending tracks
   - Genre, mood, country, region and language filters
   - Personalized recommendations
   - Recently played tracks
   - Artist, album and playlist discovery
   - Resilient API integration
   - Consistent response normalization
   - Discovery events and state reporting

   No fabricated catalogue data is generated.
   ========================================================= */

"use strict";

(function (global) {
  const ResonaDiscovery = (() => {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;

    const state = {
      initialized: false,
      loading: false,
      error: null,

      tracks: [],
      artists: [],
      albums: [],
      playlists: [],

      featured: [],
      trending: [],
      recommendations: [],
      recentlyPlayed: [],

      filters: {
        genre: "",
        mood: "",
        country: "",
        region: "",
        language: "",
        explicit: null
      },

      lastUpdated: null
    };

    const listeners = new Map();

    const EVENTS = Object.freeze({
      READY: "resona:discovery-ready",
      LOADING: "resona:discovery-loading",
      UPDATED: "resona:discovery-updated",
      FILTER_CHANGE: "resona:discovery-filter-change",
      ERROR: "resona:discovery-error"
    });

    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(name, detail = {}) {
      const payload = {
        ...detail,
        state: getState()
      };

      try {
        if (typeof global.CustomEvent === "function") {
          global.dispatchEvent(
            new global.CustomEvent(name, {
              detail: payload
            })
          );
        }
      } catch (error) {
        console.warn(
          "[Resona Discovery] Event dispatch failed:",
          error
        );
      }

      const callbacks = listeners.get(name);

      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(payload);
          } catch (error) {
            console.error(
              "[Resona Discovery] Listener error:",
              error
            );
          }
        }
      }
    }

    function on(name, callback) {
      if (typeof callback !== "function") {
        throw new TypeError(
          "Discovery listener must be a function."
        );
      }

      if (!listeners.has(name)) {
        listeners.set(name, new Set());
      }

      listeners.get(name).add(callback);

      return function unsubscribe() {
        listeners.get(name)?.delete(callback);
      };
    }

    /* =====================================================
       NORMALIZATION UTILITIES
       ===================================================== */

    function normalizeText(value) {
      if (value === null || value === undefined) {
        return "";
      }

      return String(value)
        .normalize("NFKC")
        .trim()
        .toLowerCase();
    }

    function normalizeLimit(
      value,
      fallback = DEFAULT_LIMIT
    ) {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        return fallback;
      }

      return Math.max(
        1,
        Math.min(MAX_LIMIT, Math.floor(number))
      );
    }

    function normalizeOffset(value) {
      const number = Number(value);

      return Number.isFinite(number)
        ? Math.max(0, Math.floor(number))
        : 0;
    }

    function normalizeArray(value) {
      return Array.isArray(value)
        ? value.filter(item => (
            item !== null &&
            item !== undefined
          ))
        : [];
    }

    function normalizeCollection(response) {
      if (Array.isArray(response)) {
        return response;
      }

      if (!response || typeof response !== "object") {
        return [];
      }

      const possibleCollections = [
        response.items,
        response.results,
        response.tracks,
        response.artists,
        response.albums,
        response.playlists,
        response.data
      ];

      for (const collection of possibleCollections) {
        if (Array.isArray(collection)) {
          return collection;
        }
      }

      if (
        response.data &&
        typeof response.data === "object"
      ) {
        const nested = normalizeCollection(response.data);

        if (nested.length) {
          return nested;
        }
      }

      return [];
    }

    function getEntityId(item) {
      if (!item || typeof item !== "object") {
        return "";
      }

      return String(
        item.id ??
        item.track_id ??
        item.trackId ??
        item.artist_id ??
        item.artistId ??
        item.album_id ??
        item.albumId ??
        item.playlist_id ??
        item.playlistId ??
        item.uuid ??
        ""
      ).trim();
    }

    function uniqueById(items) {
      const seen = new Set();

      return normalizeArray(items).filter(item => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const id = getEntityId(item);

        /*
         * Keep entities without IDs rather than silently
         * discarding potentially valid API records.
         */
        if (!id) {
          return true;
        }

        if (seen.has(id)) {
          return false;
        }

        seen.add(id);

        return true;
      });
    }

    function getTrackId(track) {
      return getEntityId(track);
    }

    function getTrackTitle(track) {
      return String(
        track?.title ||
        track?.name ||
        ""
      ).trim();
    }

    function getArtistName(track) {
      if (Array.isArray(track?.artists)) {
        return track.artists
          .map(artist => (
            typeof artist === "string"
              ? artist
              : artist?.name || ""
          ))
          .filter(Boolean)
          .join(", ");
      }

      if (
        track?.artist &&
        typeof track.artist === "object"
      ) {
        return String(
          track.artist.name || ""
        );
      }

      return String(
        track?.artist ||
        track?.artist_name ||
        ""
      );
    }

    function normalizeStringList(value) {
      if (Array.isArray(value)) {
        return value
          .flatMap(item => {
            if (typeof item === "string") {
              return item.split(",");
            }

            if (item && typeof item === "object") {
              return [
                item.name ||
                item.title ||
                item.value ||
                ""
              ];
            }

            return [];
          })
          .map(normalizeText)
          .filter(Boolean);
      }

      return String(value || "")
        .split(",")
        .map(normalizeText)
        .filter(Boolean);
    }

    function getTrackGenres(track) {
      return normalizeStringList(
        track?.genres ??
        track?.genre
      );
    }

    function getTrackMoods(track) {
      return normalizeStringList(
        track?.moods ??
        track?.mood
      );
    }

    function getTrackCountry(track) {
      return normalizeText(
        track?.country ||
        track?.origin_country ||
        track?.artist_country ||
        track?.country_code ||
        ""
      );
    }

    function getTrackRegion(track) {
      return normalizeText(
        track?.region ||
        track?.continent ||
        track?.music_region ||
        ""
      );
    }

    function getTrackLanguage(track) {
      return normalizeText(
        track?.language ||
        track?.language_code ||
        ""
      );
    }

    function getPopularity(track) {
      const value = Number(
        track?.popularity ??
        track?.popularity_score ??
        track?.play_count ??
        track?.plays ??
        0
      );

      return Number.isFinite(value)
        ? Math.max(0, value)
        : 0;
    }

    function getReleaseTimestamp(track) {
      const value =
        track?.release_date ||
        track?.released_at ||
        track?.created_at ||
        "";

      const timestamp = Date.parse(value);

      return Number.isFinite(timestamp)
        ? timestamp
        : 0;
    }

    function isFeatured(track) {
      return (
        track?.featured === true ||
        track?.is_featured === true
      );
    }

    function isTrending(track) {
      return (
        track?.trending === true ||
        track?.is_trending === true
      );
    }

    /* =====================================================
       BACKEND ACCESS
       ===================================================== */

    function getAPI() {
      return global.ResonaAPI || null;
    }

    function getLocalTracks() {
      const appState = global.ResonaState || {};

      return normalizeArray(
        appState.tracks ||
        appState.allTracks ||
        appState.catalogue ||
        []
      );
    }

    async function fetchCollection(
      methodName,
      options = {}
    ) {
      const api = getAPI();

      if (
        !api ||
        typeof api[methodName] !== "function"
      ) {
        return [];
      }

      const response = await api[methodName]({
        limit: normalizeLimit(
          options.limit,
          DEFAULT_LIMIT
        ),
        offset: normalizeOffset(options.offset),
        signal: options.signal
      });

      return uniqueById(
        normalizeCollection(response)
      );
    }

    async function loadTracks(options = {}) {
      const api = getAPI();

      if (api && typeof api.getTracks === "function") {
        const response = await api.getTracks({
          limit: normalizeLimit(
            options.limit,
            DEFAULT_LIMIT
          ),
          offset: normalizeOffset(options.offset),
          signal: options.signal
        });

        return uniqueById(
          normalizeCollection(response)
        );
      }

      /*
       * Migration support for the original Resona app.
       * No demo catalogue is created here.
       */
      return uniqueById(getLocalTracks());
    }

    async function loadSearchResults(query, options = {}) {
      const api = getAPI();

      if (
        !api ||
        typeof api.search !== "function"
      ) {
        return [];
      }

      const response = await api.search(query, options);

      return normalizeCollection(response);
    }

    /* =====================================================
       FILTERING
       ===================================================== */

    function matchesFilters(track, filters = state.filters) {
      if (!track || typeof track !== "object") {
        return false;
      }

      if (
        filters.genre &&
        !getTrackGenres(track).includes(
          normalizeText(filters.genre)
        )
      ) {
        return false;
      }

      if (
        filters.mood &&
        !getTrackMoods(track).includes(
          normalizeText(filters.mood)
        )
      ) {
        return false;
      }

      if (
        filters.country &&
        getTrackCountry(track) !==
          normalizeText(filters.country)
      ) {
        return false;
      }

      if (
        filters.region &&
        getTrackRegion(track) !==
          normalizeText(filters.region)
      ) {
        return false;
      }

      if (
        filters.language &&
        getTrackLanguage(track) !==
          normalizeText(filters.language)
      ) {
        return false;
      }

      if (filters.explicit !== null) {
        const explicitValue =
          track.explicit ??
          track.is_explicit ??
          false;

        const explicit =
          explicitValue === true ||
          explicitValue === 1 ||
          normalizeText(explicitValue) === "true";

        if (explicit !== filters.explicit) {
          return false;
        }
      }

      return true;
    }

    function filterTracks(
      tracks,
      filters = state.filters
    ) {
      return normalizeArray(tracks)
        .filter(track => matchesFilters(track, filters));
    }

    function setFilters(filters = {}) {
      const next = {
        ...state.filters
      };

      [
        "genre",
        "mood",
        "country",
        "region",
        "language"
      ].forEach(key => {
        if (key in filters) {
          next[key] = String(
            filters[key] || ""
          ).trim();
        }
      });

      if ("explicit" in filters) {
        next.explicit =
          filters.explicit === true
            ? true
            : filters.explicit === false
              ? false
              : null;
      }

      state.filters = next;

      emit(EVENTS.FILTER_CHANGE, {
        filters: getFilters()
      });

      return getFilters();
    }

    function getFilters() {
      return {
        ...state.filters
      };
    }

    function resetFilters() {
      state.filters = {
        genre: "",
        mood: "",
        country: "",
        region: "",
        language: "",
        explicit: null
      };

      emit(EVENTS.FILTER_CHANGE, {
        filters: getFilters()
      });

      return getFilters();
    }

    /* =====================================================
       DISCOVERY REFRESH
       ===================================================== */

    async function refresh(options = {}) {
      if (state.loading) {
        return getState();
      }

      state.loading = true;
      state.error = null;

      emit(EVENTS.LOADING, {
        loading: true
      });

      try {
        /*
         * Tracks are the core discovery collection.
         * If this request fails, report the error.
         *
         * Artist, album and playlist requests are handled
         * separately so one optional endpoint cannot break
         * the entire discovery screen.
         */
        const tracks = await loadTracks({
          limit: normalizeLimit(
            options.limit,
            MAX_LIMIT
          ),
          offset: options.offset || 0,
          signal: options.signal
        });

        state.tracks = uniqueById(tracks);

        state.featured = state.tracks
          .filter(isFeatured);

        state.trending = state.tracks
          .filter(isTrending)
          .sort((a, b) => {
            return getPopularity(b) - getPopularity(a);
          });

        const optionalCollections = [
          {
            key: "artists",
            method: "getArtists"
          },
          {
            key: "albums",
            method: "getAlbums"
          },
          {
            key: "playlists",
            method: "getPlaylists"
          }
        ];

        const results = await Promise.all(
          optionalCollections.map(async item => {
            try {
              return {
                key: item.key,
                items: await fetchCollection(
                  item.method,
                  {
                    limit: normalizeLimit(
                      options.limit,
                      50
                    ),
                    signal: options.signal
                  }
                ),
                error: null
              };
            } catch (error) {
              console.warn(
                `[Resona Discovery] ${item.key} unavailable:`,
                error
              );

              return {
                key: item.key,
                items: [],
                error
              };
            }
          })
        );

        results.forEach(result => {
          state[result.key] = result.items;
        });

        state.lastUpdated = new Date().toISOString();
        state.initialized = true;

        emit(EVENTS.UPDATED, {
          trackCount: state.tracks.length,
          artistCount: state.artists.length,
          albumCount: state.albums.length,
          playlistCount: state.playlists.length
        });

        emit(EVENTS.READY);

        return getState();
      } catch (error) {
        state.error = {
          message:
            error?.message ||
            "Unable to load music discovery data."
        };

        emit(EVENTS.ERROR, {
          error: state.error
        });

        throw error;
      } finally {
        state.loading = false;

        emit(EVENTS.LOADING, {
          loading: false
        });
      }
    }

    /* =====================================================
       COLLECTION GETTERS
       ===================================================== */

    function getTracks(options = {}) {
      const limit = normalizeLimit(options.limit);
      const offset = normalizeOffset(options.offset);

      let tracks = filterTracks(state.tracks);

      if (options.sort === "popular") {
        tracks = tracks.slice().sort(
          (a, b) => getPopularity(b) - getPopularity(a)
        );
      } else if (options.sort === "recent") {
        tracks = tracks.slice().sort(
          (a, b) => getReleaseTimestamp(b) -
            getReleaseTimestamp(a)
        );
      }

      return tracks.slice(offset, offset + limit);
    }

    function getFeatured(options = {}) {
      const limit = normalizeLimit(options.limit);

      return filterTracks(state.featured)
        .slice(0, limit);
    }

    function getTrending(options = {}) {
      const limit = normalizeLimit(options.limit);

      return filterTracks(state.trending)
        .slice(0, limit);
    }

    function getArtists(options = {}) {
      return state.artists.slice(
        normalizeOffset(options.offset),
        normalizeOffset(options.offset) +
          normalizeLimit(options.limit)
      );
    }

    function getAlbums(options = {}) {
      return state.albums.slice(
        normalizeOffset(options.offset),
        normalizeOffset(options.offset) +
          normalizeLimit(options.limit)
      );
    }

    function getPlaylists(options = {}) {
      return state.playlists.slice(
        normalizeOffset(options.offset),
        normalizeOffset(options.offset) +
          normalizeLimit(options.limit)
      );
    }

    /* =====================================================
       PERSONALIZED RECOMMENDATIONS
       ===================================================== */

    function getLikedTracks() {
      const library = global.ResonaLibrary;

      if (
        library &&
        typeof library.getLiked === "function"
      ) {
        try {
          return normalizeArray(
            library.getLiked()
          );
        } catch {
          return [];
        }
      }

      const appState = global.ResonaState || {};

      return normalizeArray(
        appState.likedTracks
      );
    }

    function getListeningHistory() {
      const library = global.ResonaLibrary;

      if (
        library &&
        typeof library.getHistory === "function"
      ) {
        try {
          return normalizeArray(
            library.getHistory({
              tracksOnly: true
            })
          );
        } catch {
          try {
            return normalizeArray(
              library.getHistory()
            );
          } catch {
            return [];
          }
        }
      }

      const appState = global.ResonaState || {};

      return normalizeArray(
        appState.history
      );
    }

    function getRecommendations(options = {}) {
      const limit = normalizeLimit(options.limit);

      const liked = getLikedTracks();
      const history = getListeningHistory();

      const preferenceCounts = new Map();

      /*
       * Liked tracks receive greater weight than tracks
       * merely present in listening history.
       */
      liked.forEach(track => {
        getTrackGenres(track).forEach(genre => {
          preferenceCounts.set(
            genre,
            (preferenceCounts.get(genre) || 0) + 3
          );
        });
      });

      history.forEach(track => {
        getTrackGenres(track).forEach(genre => {
          preferenceCounts.set(
            genre,
            (preferenceCounts.get(genre) || 0) + 1
          );
        });
      });

      const likedIds = new Set(
        liked.map(getTrackId).filter(Boolean)
      );

      const historyCounts = new Map();

      history.forEach(track => {
        const id = getTrackId(track);

        if (id) {
          historyCounts.set(
            id,
            (historyCounts.get(id) || 0) + 1
          );
        }
      });

      const candidates = filterTracks(
        state.tracks
      );

      const ranked = candidates.map(track => {
        const id = getTrackId(track);

        const genreScore = getTrackGenres(track)
          .reduce((total, genre) => {
            return total +
              (preferenceCounts.get(genre) || 0);
          }, 0);

        const likedScore = id && likedIds.has(id)
          ? 20
          : 0;

        /*
         * Slightly favor familiar tracks, but do not exclude
         * them entirely. Recommendations can include tracks
         * the listener has heard before.
         */
        const familiarityScore = id
          ? Math.min(
              10,
              (historyCounts.get(id) || 0) * 2
            )
          : 0;

        const popularityScore = Math.min(
          getPopularity(track),
          100
        );

        return {
          track,
          score:
            genreScore * 10 +
            likedScore +
            familiarityScore +
            popularityScore
        };
      });

      ranked.sort((a, b) => b.score - a.score);

      state.recommendations = ranked
        .slice(0, limit)
        .map(item => item.track);

      return state.recommendations.slice();
    }

    /* =====================================================
       RECENTLY PLAYED
       ===================================================== */

    function getRecentlyPlayed(options = {}) {
      const limit = normalizeLimit(options.limit);

      state.recentlyPlayed = getListeningHistory();

      return state.recentlyPlayed.slice(0, limit);
    }

    /* =====================================================
       AVAILABLE FILTER VALUES
       ===================================================== */

    function collectAvailableValues(getter) {
      const values = new Set();

      state.tracks.forEach(track => {
        const result = getter(track);

        if (Array.isArray(result)) {
          result.forEach(value => {
            if (value) {
              values.add(value);
            }
          });
        } else if (result) {
          values.add(result);
        }
      });

      return [...values].sort();
    }

    function getAvailableGenres() {
      return collectAvailableValues(getTrackGenres);
    }

    function getAvailableMoods() {
      return collectAvailableValues(getTrackMoods);
    }

    function getAvailableCountries() {
      return collectAvailableValues(getTrackCountry);
    }

    function getAvailableRegions() {
      return collectAvailableValues(getTrackRegion);
    }

    function getAvailableLanguages() {
      return collectAvailableValues(getTrackLanguage);
    }

    /* =====================================================
       SEARCH HELPERS
       ===================================================== */

    async function search(query, options = {}) {
      const normalizedQuery = String(
        query || ""
      ).trim();

      if (!normalizedQuery) {
        return [];
      }

      try {
        const backendResults = await loadSearchResults(
          normalizedQuery,
          options
        );

        if (backendResults.length) {
          return backendResults;
        }
      } catch (error) {
        console.warn(
          "[Resona Discovery] Backend search failed:",
          error
        );
      }

      /*
       * Local search only uses tracks already received
       * from the real catalogue. It does not invent results.
       */
      const term = normalizeText(normalizedQuery);

      return state.tracks.filter(track => {
        const searchable = [
          getTrackTitle(track),
          getArtistName(track),
          ...getTrackGenres(track),
          ...getTrackMoods(track),
          getTrackCountry(track),
          getTrackRegion(track),
          getTrackLanguage(track)
        ]
          .join(" ")
          .toLowerCase();

        return searchable.includes(term);
      });
    }

    /* =====================================================
       STATE
       ===================================================== */

    function getState() {
      return {
        initialized: state.initialized,
        loading: state.loading,

        error: state.error
          ? { ...state.error }
          : null,

        trackCount: state.tracks.length,
        artistCount: state.artists.length,
        albumCount: state.albums.length,
        playlistCount: state.playlists.length,

        featuredCount: state.featured.length,
        trendingCount: state.trending.length,

        lastUpdated: state.lastUpdated,
        filters: getFilters()
      };
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    return Object.freeze({
      EVENTS,

      on,
      refresh,
      getState,

      getTracks,
      getFeatured,
      getTrending,

      getArtists,
      getAlbums,
      getPlaylists,

      getRecommendations,
      getRecentlyPlayed,

      setFilters,
      getFilters,
      resetFilters,
      filterTracks,

      getAvailableGenres,
      getAvailableMoods,
      getAvailableCountries,
      getAvailableRegions,
      getAvailableLanguages,

      search
    });
  })();

  global.ResonaDiscovery = ResonaDiscovery;
})(window);
