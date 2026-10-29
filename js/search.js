/* =========================================================
   RESONA — SEARCH MODULE
   File: js/search.js

   Features:
   - Search tracks, artists, albums, and playlists
   - Debounced live search
   - Search history
   - Search filters
   - Local catalogue fallback
   - API integration
   - Cancellation of outdated requests
   - Keyboard-friendly search events
   - No fabricated results

   Exposes: window.ResonaSearch
   ========================================================= */

"use strict";

(function (global) {
  const ResonaSearch = (() => {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const DEBOUNCE_DELAY = 300;
    const MAX_SEARCH_HISTORY = 20;

    let debounceTimer = null;
    let activeController = null;
    let requestNumber = 0;

    const state = {
      query: "",
      loading: false,
      error: null,
      results: {
        tracks: [],
        artists: [],
        albums: [],
        playlists: []
      },
      filters: {
        type: "all",
        genre: "",
        country: "",
        language: ""
      },
      history: []
    };

    const listeners = new Map();

    const EVENTS = Object.freeze({
      QUERY_CHANGE: "resona:search-query-change",
      LOADING: "resona:search-loading",
      RESULTS: "resona:search-results",
      ERROR: "resona:search-error",
      HISTORY_CHANGE: "resona:search-history-change",
      FILTER_CHANGE: "resona:search-filter-change"
    });

    /* =====================================================
       EVENTS
       ===================================================== */

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
              "[Resona Search] Listener error:",
              error
            );
          }
        });
      }
    }

    function on(name, callback) {
      if (typeof callback !== "function") {
        throw new TypeError(
          "Search listener must be a function."
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
      return String(value ?? "").trim();
    }

    function normalizeLimit(value) {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        return DEFAULT_LIMIT;
      }

      return Math.max(
        1,
        Math.min(MAX_LIMIT, Math.floor(number))
      );
    }

    function emptyResults() {
      return {
        tracks: [],
        artists: [],
        albums: [],
        playlists: []
      };
    }

    function normalizeResults(data) {
      if (Array.isArray(data)) {
        return {
          tracks: data,
          artists: [],
          albums: [],
          playlists: []
        };
      }

      const result =
        data?.data &&
        !Array.isArray(data.data) &&
        typeof data.data === "object"
          ? data.data
          : data || {};

      return {
        tracks: Array.isArray(result.tracks)
          ? result.tracks
          : [],

        artists: Array.isArray(result.artists)
          ? result.artists
          : [],

        albums: Array.isArray(result.albums)
          ? result.albums
          : [],

        playlists: Array.isArray(result.playlists)
          ? result.playlists
          : []
      };
    }

    function getItemId(item) {
      return String(
        item?.id ||
        item?.track_id ||
        item?.artist_id ||
        item?.album_id ||
        item?.playlist_id ||
        ""
      ).trim();
    }

    function getItemName(item) {
      return normalizeText(
        item?.title ||
        item?.name ||
        item?.artist_name ||
        item?.album_title ||
        ""
      );
    }

    function getItemArtist(item) {
      if (Array.isArray(item?.artists)) {
        return item.artists
          .map(artist => {
            return typeof artist === "string"
              ? artist
              : artist?.name || "";
          })
          .filter(Boolean)
          .join(" ");
      }

      if (
        item?.artist &&
        typeof item.artist === "object"
      ) {
        return normalizeText(item.artist.name);
      }

      return normalizeText(
        item?.artist ||
        item?.artist_name ||
        ""
      );
    }

    function getSearchableText(item) {
      return [
        item?.title,
        item?.name,
        item?.artist,
        item?.artist_name,
        item?.album,
        item?.album_title,
        item?.description,
        item?.genre,
        item?.language,
        item?.country,
        item?.region,
        ...(Array.isArray(item?.genres)
          ? item.genres
          : [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }

    function deduplicate(items) {
      const seen = new Set();

      return items.filter(item => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const id = getItemId(item);

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

    /* =====================================================
       SEARCH HISTORY
       ===================================================== */

    function getStorageKey() {
      const config = global.ResonaConfig || {};

      const configuredKey =
        config.storage?.keys?.searchHistory;

      if (configuredKey) {
        return String(configuredKey);
      }

      const prefix =
        config.storage?.prefix ||
        config.storagePrefix ||
        "resona_";

      return prefix + "search_history";
    }

    function loadHistory() {
      try {
        const storageKey = getStorageKey();

        let saved = null;

        if (
          global.ResonaUtils &&
          typeof global.ResonaUtils.readStorage === "function"
        ) {
          saved = global.ResonaUtils.readStorage(
            storageKey,
            []
          );
        } else {
          saved = JSON.parse(
            global.localStorage.getItem(storageKey) || "[]"
          );
        }

        state.history = Array.isArray(saved)
          ? saved
              .filter(item => typeof item === "string")
              .map(normalizeText)
              .filter(Boolean)
              .slice(0, MAX_SEARCH_HISTORY)
          : [];
      } catch {
        state.history = [];
      }

      return getHistory();
    }

    function saveHistory() {
      try {
        const storageKey = getStorageKey();

        if (
          global.ResonaUtils &&
          typeof global.ResonaUtils.writeStorage === "function"
        ) {
          global.ResonaUtils.writeStorage(
            storageKey,
            state.history
          );
        } else {
          global.localStorage.setItem(
            storageKey,
            JSON.stringify(state.history)
          );
        }
      } catch (error) {
        console.warn(
          "[Resona Search] Search history could not be saved.",
          error
        );
      }
    }

    function addToHistory(query) {
      const value = normalizeText(query);

      if (!value) {
        return getHistory();
      }

      state.history = [
        value,
        ...state.history.filter(
          item => item.toLowerCase() !== value.toLowerCase()
        )
      ].slice(0, MAX_SEARCH_HISTORY);

      saveHistory();

      emit(EVENTS.HISTORY_CHANGE, {
        history: getHistory()
      });

      return getHistory();
    }

    function getHistory() {
      return state.history.slice();
    }

    function removeFromHistory(query) {
      const value = normalizeText(query).toLowerCase();

      state.history = state.history.filter(
        item => item.toLowerCase() !== value
      );

      saveHistory();

      emit(EVENTS.HISTORY_CHANGE, {
        history: getHistory()
      });

      return getHistory();
    }

    function clearHistory() {
      state.history = [];

      saveHistory();

      emit(EVENTS.HISTORY_CHANGE, {
        history: []
      });

      return [];
    }

    /* =====================================================
       FILTERS
       ===================================================== */

    function setFilters(filters = {}) {
      const next = {
        ...state.filters
      };

      ["type", "genre", "country", "language"].forEach(
        key => {
          if (key in filters) {
            next[key] = normalizeText(filters[key]);
          }
        }
      );

      const allowedTypes = [
        "all",
        "tracks",
        "artists",
        "albums",
        "playlists"
      ];

      if (!allowedTypes.includes(next.type)) {
        next.type = "all";
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
        type: "all",
        genre: "",
        country: "",
        language: ""
      };

      emit(EVENTS.FILTER_CHANGE, {
        filters: getFilters()
      });

      return getFilters();
    }

    function matchesFilters(item) {
      const filters = state.filters;

      if (filters.genre) {
        const genres = Array.isArray(item?.genres)
          ? item.genres
          : String(item?.genre || "").split(",");

        if (
          !genres.some(
            genre =>
              normalizeText(genre).toLowerCase() ===
              filters.genre.toLowerCase()
          )
        ) {
          return false;
        }
      }

      if (
        filters.country &&
        normalizeText(
          item?.country ||
          item?.origin_country ||
          item?.artist_country
        ).toLowerCase() !== filters.country.toLowerCase()
      ) {
        return false;
      }

      if (
        filters.language &&
        normalizeText(
          item?.language ||
          item?.language_code
        ).toLowerCase() !== filters.language.toLowerCase()
      ) {
        return false;
      }

      return true;
    }

    function applyFilters(results) {
      const filtered = {
        tracks: results.tracks.filter(matchesFilters),
        artists: results.artists.filter(matchesFilters),
        albums: results.albums.filter(matchesFilters),
        playlists: results.playlists.filter(matchesFilters)
      };

      if (state.filters.type === "all") {
        return filtered;
      }

      return {
        ...emptyResults(),
        [state.filters.type]: filtered[state.filters.type]
      };
    }

    /* =====================================================
       LOCAL CATALOGUE FALLBACK
       ===================================================== */

    function getLocalCollection(key) {
      const appState = global.ResonaState || {};

      const possibleKeys = {
        tracks: ["tracks", "allTracks", "catalogue"],
        artists: ["artists", "allArtists"],
        albums: ["albums", "allAlbums"],
        playlists: ["playlists", "allPlaylists"]
      };

      for (const candidate of possibleKeys[key] || []) {
        if (Array.isArray(appState[candidate])) {
          return appState[candidate];
        }
      }

      return [];
    }

    function searchLocal(query, limit) {
      const normalizedQuery = query.toLowerCase();

      const result = {
        tracks: [],
        artists: [],
        albums: [],
        playlists: []
      };

      Object.keys(result).forEach(type => {
        result[type] = getLocalCollection(type)
          .filter(item => {
            return getSearchableText(item).includes(
              normalizedQuery
            );
          })
          .slice(0, limit);
      });

      return result;
    }

    /* =====================================================
       BACKEND SEARCH
       ===================================================== */

    async function searchBackend(query, options = {}) {
      const api = global.ResonaAPI;

      if (!api || typeof api.search !== "function") {
        return null;
      }

      const result = await api.search(query, {
        limit: normalizeLimit(options.limit),
        offset: Math.max(
          0,
          Number(options.offset) || 0
        ),
        type: state.filters.type === "all"
          ? undefined
          : state.filters.type,
        genre: state.filters.genre || undefined,
        region: state.filters.country || undefined,
        signal: options.signal
      });

      return normalizeResults(result);
    }

    /* =====================================================
       MAIN SEARCH
       ===================================================== */

    async function search(query, options = {}) {
      const normalizedQuery = normalizeText(query);

      state.query = normalizedQuery;
      state.error = null;

      emit(EVENTS.QUERY_CHANGE, {
        query: normalizedQuery
      });

      if (!normalizedQuery) {
        state.results = emptyResults();
        state.loading = false;

        emit(EVENTS.RESULTS, {
          query: "",
          results: emptyResults(),
          total: 0
        });

        return emptyResults();
      }

      const currentRequest = ++requestNumber;

      if (activeController) {
        activeController.abort();
      }

      activeController = new AbortController();

      const controller = activeController;

      if (options.signal) {
        if (options.signal.aborted) {
          controller.abort();
        } else {
          options.signal.addEventListener(
            "abort",
            () => controller.abort(),
            { once: true }
          );
        }
      }

      state.loading = true;

      emit(EVENTS.LOADING, {
        loading: true,
        query: normalizedQuery
      });

      try {
        let results;

        try {
          results = await searchBackend(
            normalizedQuery,
            {
              ...options,
              signal: controller.signal
            }
          );
        } catch (error) {
          if (
            error?.name === "AbortError" ||
            controller.signal.aborted
          ) {
            return state.results;
          }

          /*
           * Do not silently disguise a failed backend
           * request as a successful catalogue search.
           */
          throw error;
        }

        if (results === null) {
          results = searchLocal(
            normalizedQuery,
            normalizeLimit(options.limit)
          );
        }

        if (currentRequest !== requestNumber) {
          return state.results;
        }

        const deduplicated = {
          tracks: deduplicate(results.tracks),
          artists: deduplicate(results.artists),
          albums: deduplicate(results.albums),
          playlists: deduplicate(results.playlists)
        };

        state.results = applyFilters(deduplicated);

        if (options.saveHistory !== false) {
          addToHistory(normalizedQuery);
        }

        emit(EVENTS.RESULTS, {
          query: normalizedQuery,
          results: getResults(),
          total: getTotal()
        });

        return getResults();
      } catch (error) {
        if (
          error?.name === "AbortError" ||
          controller.signal.aborted
        ) {
          return state.results;
        }

        state.error = {
          message: error?.message ||
            "Search could not be completed."
        };

        emit(EVENTS.ERROR, {
          query: normalizedQuery,
          error: state.error
        });

        throw error;
      } finally {
        if (currentRequest === requestNumber) {
          state.loading = false;

          emit(EVENTS.LOADING, {
            loading: false,
            query: normalizedQuery
          });
        }
      }
    }

    /* =====================================================
       DEBOUNCED SEARCH
       ===================================================== */

    function searchDebounced(query, options = {}) {
      clearTimeout(debounceTimer);

      return new Promise((resolve, reject) => {
        debounceTimer = setTimeout(() => {
          search(query, options)
            .then(resolve)
            .catch(reject);
        }, Math.max(
          0,
          Number(options.delay ?? DEBOUNCE_DELAY)
        ));
      });
    }

    function cancelSearch() {
      clearTimeout(debounceTimer);

      debounceTimer = null;
      requestNumber++;

      if (activeController) {
        activeController.abort();
        activeController = null;
      }

      state.loading = false;
    }

    /* =====================================================
       RESULTS AND STATE
       ===================================================== */

    function getResults() {
      return {
        tracks: state.results.tracks.slice(),
        artists: state.results.artists.slice(),
        albums: state.results.albums.slice(),
        playlists: state.results.playlists.slice()
      };
    }

    function getTotal() {
      return (
        state.results.tracks.length +
        state.results.artists.length +
        state.results.albums.length +
        state.results.playlists.length
      );
    }

    function getState() {
      return {
        query: state.query,
        loading: state.loading,
        error: state.error
          ? { ...state.error }
          : null,
        results: getResults(),
        total: getTotal(),
        filters: getFilters(),
        history: getHistory()
      };
    }

    function clearResults() {
      cancelSearch();

      state.query = "";
      state.error = null;
      state.results = emptyResults();

      emit(EVENTS.RESULTS, {
        query: "",
        results: getResults(),
        total: 0
      });

      return getResults();
    }

    /* =====================================================
       INITIALIZATION
       ===================================================== */

    function init() {
      loadHistory();

      return getState();
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    return Object.freeze({
      EVENTS,

      init,
      on,

      search,
      searchDebounced,
      cancelSearch,
      clearResults,

      getResults,
      getTotal,
      getState,

      setFilters,
      getFilters,
      resetFilters,

      getHistory,
      addToHistory,
      removeFromHistory,
      clearHistory
    });
  })();

  global.ResonaSearch = ResonaSearch;
})(window);
