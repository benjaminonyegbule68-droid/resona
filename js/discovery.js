/* =========================================================
   RESONA — MUSIC DISCOVERY MODULE
   File: js/discovery.js

   Responsibilities:
   - Global music discovery
   - Genre and mood filtering
   - Regional and country discovery
   - Trending and featured tracks
   - Personalized recommendations
   - Recently played discovery
   - Artist and album discovery
   - Safe integration with ResonaAPI
   - Graceful handling of missing backend endpoints

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

    /* =====================================================
       EVENTS
       ===================================================== */

    const EVENTS = Object.freeze({
      READY: "resona:discovery-ready",
      LOADING: "resona:discovery-loading",
      UPDATED: "resona:discovery-updated",
      FILTER_CHANGE: "resona:discovery-filter-change",
      ERROR: "resona:discovery-error"
    });

    function emit(name, detail = {}) {
      const payload = {
        ...detail,
        state: getState()
      };

      global.dispatchEvent(
        new CustomEvent(name, {
          detail: payload
        })
      );

      const callbacks = listeners.get(name);

      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(payload);
          } catch (error) {
            console.error(
              "[Resona Discovery] Listener error:",
              error
            );
          }
        });
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

      return () => {
        listeners.get(name)?.delete(callback);
      };
    }

    /* =====================================================
       UTILITIES
       ===================================================== */

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase();
    }

    function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        return fallback;
      }

      return Math.max(
        1,
        Math.min(MAX_LIMIT, Math.floor(number))
      );
    }

    function normalizeArray(value) {
      return Array.isArray(value)
        ? value.filter(Boolean)
        : [];
    }

    function uniqueById(items) {
      const seen = new Set();

      return normalizeArray(items).filter(item => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const id = String(
          item.id ||
          item.track_id ||
          item.artist_id ||
          item.album_id ||
          ""
        ).trim();

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
      return String(
        track?.id ||
        track?.track_id ||
        track?.trackId ||
        ""
      ).trim();
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
          .map(artist => {
            return typeof artist === "string"
              ? artist
              : artist?.name || "";
          })
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

    function getTrackGenres(track) {
      const genres = track?.genres ??
        track?.genre ??
        [];

      if (Array.isArray(genres)) {
        return genres.map(normalizeText);
      }

      return String(genres)
        .split(",")
        .map(normalizeText)
        .filter(Boolean);
    }

    function getTrackMoods(track) {
      const moods = track?.moods ??
        track?.mood ??
        [];

      if (Array.isArray(moods)) {
        return moods.map(normalizeText);
      }

      return String(moods)
        .split(",")
        .map(normalizeText)
        .filter(Boolean);
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
        0
      );

      return Number.isFinite(value)
        ? value
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

    async function fetchCollection(methodName, options = {}) {
      const api = getAPI();

      if (
        !api ||
        typeof api[methodName] !== "function"
      ) {
        return [];
      }

      const response = await api[methodName](options);

      if (Array.isArray(response)) {
        return response;
      }

      if (Array.isArray(response?.items)) {
        return response.items;
      }

      if (Array.isArray(response?.results)) {
        return response.results;
      }

      if (Array.isArray(response?.data)) {
        return response.data;
      }

      return [];
    }

    async function loadTracks(options = {}) {
      const api = getAPI();

      if (api && typeof api.getTracks === "function") {
        const result = await api.getTracks({
          limit: normalizeLimit(options.limit),
          offset: Math.max(
            0,
            Number(options.offset) || 0
          ),
          signal: options.signal
        });

        return normalizeArray(
          Array.isArray(result)
            ? result
            : result?.items ||
              result?.results ||
              result?.data
        );
      }

      /*
       * Supports migration from the original app.js.
       * Existing in-memory tracks remain usable.
       */

      return getLocalTracks();
    }

    async function loadSearchResults(query, options = {}) {
      const api = getAPI();

      if (
        !api ||
        typeof api.search !== "function"
      ) {
        return [];
      }

      const results = await api.search(query, options);

      if (Array.isArray(results)) {
        return results;
      }

      return [
        ...normalizeArray(results?.tracks),
        ...normalizeArray(results?.artists),
        ...normalizeArray(results?.albums),
        ...normalizeArray(results?.playlists)
      ];
    }

    /* =====================================================
       GLOBAL MUSIC FILTERING
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
        const explicit = Boolean(
          track.explicit ??
          track.is_explicit ??
          false
        );

        if (explicit !== filters.explicit) {
          return false;
        }
      }

      return true;
    }

    function filterTracks(tracks, filters = state.filters) {
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
        filters: {
          ...state.filters
        }
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
       DISCOVERY COLLECTIONS
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
          .filter(track => {
            return (
              track.featured === true ||
              track.is_featured === true
            );
          });

        state.trending = state.tracks
          .filter(track => {
            return (
              track.trending === true ||
              track.is_trending === true
            );
          })
          .sort((a, b) => {
            return getPopularity(b) - getPopularity(a);
          });

        state.artists = uniqueById(
          await fetchCollection("getArtists", {
            limit: normalizeLimit(options.limit, 50),
            signal: options.signal
          })
        );

        state.albums = uniqueById(
          await fetchCollection("getAlbums", {
            limit: normalizeLimit(options.limit, 50),
            signal: options.signal
          })
        );

        state.playlists = uniqueById(
          await fetchCollection("getPlaylists", {
            limit: normalizeLimit(options.limit, 50),
            signal: options.signal
          })
        );

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
          message: error?.message ||
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

    function getFeatured(options = {}) {
      const limit = normalizeLimit(options.limit);

      return filterTracks(
        state.featured
      ).slice(0, limit);
    }

    function getTrending(options = {}) {
      const limit = normalizeLimit(options.limit);

      return filterTracks(
        state.trending
      ).slice(0, limit);
    }

    function getTracks(options = {}) {
      const limit = normalizeLimit(options.limit);
      const offset = Math.max(
        0,
        Number(options.offset) || 0
      );

      return filterTracks(
        state.tracks
      ).slice(offset, offset + limit);
    }

    function getArtists(options = {}) {
      const limit = normalizeLimit(options.limit);

      return state.artists.slice(0, limit);
    }

    function getAlbums(options = {}) {
      const limit = normalizeLimit(options.limit);

      return state.albums.slice(0, limit);
    }

    function getPlaylists(options = {}) {
      const limit = normalizeLimit(options.limit);

      return state.playlists.slice(0, limit);
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
            library.getHistory()
          );
        } catch {
          return [];
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

      [...liked, ...history].forEach(track => {
        getTrackGenres(track).forEach(genre => {
          preferenceCounts.set(
            genre,
            (preferenceCounts.get(genre) || 0) + 1
          );
        });
      });

      const excluded = new Set(
        [...liked, ...history]
          .map(getTrackId)
          .filter(Boolean)
      );

      const candidates = filterTracks(
        state.tracks
      ).filter(track => {
        const id = getTrackId(track);

        return !id || !excluded.has(id);
      });

      const ranked = candidates.map(track => {
        const genreScore = getTrackGenres(track)
          .reduce((total, genre) => {
            return total +
              (preferenceCounts.get(genre) || 0);
          }, 0);

        const popularityScore = getPopularity(track);

        return {
          track,
          score: genreScore * 10 +
            Math.min(popularityScore, 100)
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
       GENRES, MOODS, REGIONS AND LANGUAGES
       ===================================================== */

    function getAvailableGenres() {
      const genres = new Set();

      state.tracks.forEach(track => {
        getTrackGenres(track).forEach(genre => {
          if (genre) {
            genres.add(genre);
          }
        });
      });

      return [...genres].sort();
    }

    function getAvailableMoods() {
      const moods = new Set();

      state.tracks.forEach(track => {
        getTrackMoods(track).forEach(mood => {
          if (mood) {
            moods.add(mood);
          }
        });
      });

      return [...moods].sort();
    }

    function getAvailableCountries() {
      const countries = new Set();

      state.tracks.forEach(track => {
        const country = getTrackCountry(track);

        if (country) {
          countries.add(country);
        }
      });

      return [...countries].sort();
    }

    function getAvailableRegions() {
      const regions = new Set();

      state.tracks.forEach(track => {
        const region = getTrackRegion(track);

        if (region) {
          regions.add(region);
        }
      });

      return [...regions].sort();
    }

    function getAvailableLanguages() {
      const languages = new Set();

      state.tracks.forEach(track => {
        const language = getTrackLanguage(track);

        if (language) {
          languages.add(language);
        }
      });

      return [...languages].sort();
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
      getAvailableLanguages
    });
  })();

  global.ResonaDiscovery = ResonaDiscovery;
})(window);
