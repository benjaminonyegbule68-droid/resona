/* =========================================================
   RESONA — SEARCH MODULE
   File: js/search.js
   Version: 2.0.0

   Features:
   - Search tracks, artists, albums, and playlists
   - Debounced live search with settled promises
   - Search history with local persistence
   - Search filters
   - API search with local catalogue fallback
   - Cancellation of outdated requests
   - Duplicate-result protection
   - Keyboard-friendly search events
   - Safe handling of missing browser APIs
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
    let pendingDebouncedSearch = null;
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
          "[Resona Search] Event dispatch failed:",
          error
        );
      }

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

      return function unsubscribe() {
        listeners.get(name)?.delete(callback);
      };
    }

    /* =====================================================
       UTILITIES
       ===================================================== */

    function normalizeText(value) {
      return String(value ?? "")
        .normalize("NFKC")
        .trim();
    }

    function normalizeForSearch(value) {
      return normalizeText(value).toLowerCase();
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

    function normalizeOffset(value) {
      const number = Number(value);

      return Number.isFinite(number)
        ? Math.max(0, Math.floor(number))
        : 0;
    }

    function emptyResults() {
      return {
        tracks: [],
        artists: [],
        albums: [],
        playlists: []
      };
    }

    function isObject(value) {
      return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      );
    }

    function normalizeCollection(value) {
      if (Array.isArray(value)) {
        return value;
      }

      if (!isObject(value)) {
        return [];
      }

      const collectionKeys = [
        "items",
        "results",
        "tracks",
        "artists",
        "albums",
        "playlists"
      ];

      for (const key of collectionKeys) {
        if (Array.isArray(value[key])) {
          return value[key];
        }
      }

      if (Array.isArray(value.data)) {
        return value.data;
      }

      if (isObject(value.data)) {
        return normalizeCollection(value.data);
      }

      return [];
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

      if (!isObject(data)) {
        return emptyResults();
      }

      let result = data;

      if (isObject(data.data)) {
        result = data.data;
      }

      const output = emptyResults();

      for (const type of Object.keys(output)) {
        if (Array.isArray(result[type])) {
          output[type] = result[type];
        } else if (type === "tracks") {
          const fallback = normalizeCollection(result);

          if (fallback.length) {
            output.tracks = fallback;
          }
        }
      }

      return output;
    }

    function getItemId(item) {
      if (!isObject(item)) {
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

      if (isObject(item?.artist)) {
        return normalizeText(item.artist.name);
      }

      return normalizeText(
        item?.artist ||
        item?.artist_name ||
        ""
      );
    }

    function normalizeValues(value) {
      if (Array.isArray(value)) {
        return value
          .flatMap(item => {
            if (typeof item === "string") {
              return item.split(",");
            }

            if (isObject(item)) {
              return [
                item.name ||
                item.title ||
                item.value ||
                ""
              ];
            }

            return [];
          })
          .map(normalizeForSearch)
          .filter(Boolean);
      }

      return String(value ?? "")
        .split(",")
        .map(normalizeForSearch)
        .filter(Boolean);
    }

    function getSearchableText(item) {
      if (!isObject(item)) {
        return "";
      }

      const values = [
        item.title,
        item.name,
        item.artist,
        item.artist_name,
        item.album,
        item.album_title,
        item.description,
        item.genre,
        item.language,
        item.language_code,
        item.country,
        item.origin_country,
        item.artist_country,
        item.region,
        item.continent,
        item.music_region,
        item.mood,
        item.label
      ];

      for (const key of [
        "artists",
        "genres",
        "moods",
        "tags"
      ]) {
        const value = item[key];

        if (Array.isArray(value)) {
          value.forEach(entry => {
            if (typeof entry === "string") {
              values.push(entry);
            } else if (isObject(entry)) {
              values.push(
                entry.name ||
                entry.title ||
                entry.value ||
                ""
              );
            }
          });
        } else if (value) {
          values.push(value);
        }
      }

      return values
        .filter(Boolean)
        .map(value => {
          if (typeof value === "object") {
            return value.name || value.title || "";
          }

          return String(value);
        })
        .join(" ")
        .toLowerCase();
    }

    function deduplicate(items) {
      const seen = new Set();

      return (Array.isArray(items) ? items : [])
        .filter(item => {
          if (!isObject(item)) {
            return false;
          }

          const id = getItemId(item);

          /*
           * ID-less entities are retained because the
           * backend may legitimately omit their IDs.
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

    /* =====================================================
       STORAGE
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

        let saved;

        if (
          global.ResonaUtils &&
          typeof global.ResonaUtils.readStorage === "function"
        ) {
          saved = global.ResonaUtils.readStorage(
            storageKey,
            []
          );
        } else {
          saved = global.localStorage
            ? JSON.parse(
                global.localStorage.getItem(storageKey) || "[]"
              )
            : [];
        }

        state.history = Array.isArray(saved)
          ? saved
              .filter(item => typeof item === "string")
              .map(normalizeText)
              .filter(Boolean)
              .slice(0, MAX_SEARCH_HISTORY)
          : [];
      } catch (error) {
        console.warn(
          "[Resona Search] Could not load history.",
          error
        );

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

          return;
        }

        if (global.localStorage) {
          global.localStorage.setItem(
            storageKey,
            JSON.stringify(state.history)
          );
        }
      } catch (error) {
        console.warn(
          "[Resona Search] History could not be saved.",
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
          item =>
            normalizeForSearch(item) !==
            normalizeForSearch(value)
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
      const value = normalizeForSearch(query);

      state.history = state.history.filter(
        item => normalizeForSearch(item) !== value
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

      [
        "type",
        "genre",
        "country",
        "language"
      ].forEach(key => {
        if (key in filters) {
          next[key] = normalizeText(filters[key]);
        }
      });

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
        const genres = normalizeValues(
          item?.genres ?? item?.genre
        );

        if (
          !genres.includes(
            normalizeForSearch(filters.genre)
          )
        ) {
          return false;
        }
      }

      if (filters.country) {
        const country = normalizeForSearch(
          item?.country ||
          item?.origin_country ||
          item?.artist_country ||
          ""
        );

        if (
          country !== normalizeForSearch(filters.country)
        ) {
          return false;
        }
      }

      if (filters.language) {
        const language = normalizeForSearch(
          item?.language ||
          item?.language_code ||
          ""
        );

        if (
          language !== normalizeForSearch(filters.language)
        ) {
          return false;
        }
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
        [state.filters.type]:
          filtered[state.filters.type]
      };
    }

    /* =====================================================
       LOCAL CATALOGUE
       ===================================================== */

    function getLocalCollection(key) {
      const appState = global.ResonaState || {};

      const possibleKeys = {
        tracks: [
          "tracks",
          "allTracks",
          "catalogue"
        ],
        artists: [
          "artists",
          "allArtists"
        ],
        albums: [
          "albums",
          "allAlbums"
        ],
        playlists: [
          "playlists",
          "allPlaylists"
        ]
      };

      for (const candidate of possibleKeys[key] || []) {
        if (Array.isArray(appState[candidate])) {
          return appState[candidate];
        }
      }

      /*
       * Also accept collections exposed by discovery.
       */
      const discovery = global.ResonaDiscovery;

      if (discovery) {
        const getterNames = {
          tracks: "getTracks",
          artists: "getArtists",
          albums: "getAlbums",
          playlists: "getPlaylists"
        };

        const getter = discovery[getterNames[key]];

        if (typeof getter === "function") {
          try {
            return getter.call(discovery, {
              limit: MAX_LIMIT
            });
          } catch (error) {
            console.warn(
              "[Resona Search] Discovery fallback failed.",
              error
            );
          }
        }
      }

      return [];
    }

    function searchLocal(query, limit) {
      const normalizedQuery = normalizeForSearch(query);

      const result = emptyResults();

      for (const type of Object.keys(result)) {
        result[type] = deduplicate(
          getLocalCollection(type)
        )
          .filter(item => {
            return getSearchableText(item)
              .includes(normalizedQuery);
          })
          .slice(0, limit);
      }

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

      const filters = state.filters;

      const requestOptions = {
        limit: normalizeLimit(options.limit),
        offset: normalizeOffset(options.offset),
        signal: options.signal
      };

      if (filters.type !== "all") {
        requestOptions.type = filters.type;
      }

      if (filters.genre) {
        requestOptions.genre = filters.genre;
      }

      /*
       * Keep country and region separate.
       * The backend can ignore unsupported fields, but
       * we must not send a country as a region.
       */
      if (filters.country) {
        requestOptions.country = filters.country;
      }

      if (filters.language) {
        requestOptions.language = filters.language;
      }

      const response = await api.search(
        query,
        requestOptions
      );

      return normalizeResults(response);
    }

    /* =====================================================
       REQUEST MANAGEMENT
       ===================================================== */

    function abortActiveRequest() {
      if (activeController) {
        try {
          activeController.abort();
        } catch {
          // Ignore abort errors.
        }

        activeController = null;
      }
    }

    function settlePendingDebouncedSearch(
      action,
      value
    ) {
      if (!pendingDebouncedSearch) {
        return;
      }

      const pending = pendingDebouncedSearch;

      pendingDebouncedSearch = null;

      if (action === "resolve") {
        pending.resolve(value);
      } else {
        pending.reject(value);
      }
    }

    function cancelDebounceOnly() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      /*
       * Resolve the superseded promise with the current
       * results instead of leaving it pending forever.
       */
      settlePendingDebouncedSearch(
        "resolve",
        getResults()
      );
    }

    /* =====================================================
       MAIN SEARCH
       ===================================================== */

    async function search(query, options = {}) {
      const normalizedQuery = normalizeText(query);

      /*
       * Every direct search supersedes any pending
       * debounced search.
       */
      cancelDebounceOnly();

      const currentRequest = ++requestNumber;

      abortActiveRequest();

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
          results: getResults(),
          total: 0
        });

        emit(EVENTS.LOADING, {
          loading: false,
          query: ""
        });

        return getResults();
      }

      const controller = new AbortController();

      activeController = controller;

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
        let results = null;
        let backendError = null;

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
            return getResults();
          }

          backendError = error;

          console.warn(
            "[Resona Search] Backend search failed; trying local catalogue.",
            error
          );
        }

        /*
         * Do not let an outdated request alter current
         * results or state.
         */
        if (
          currentRequest !== requestNumber ||
          controller.signal.aborted
        ) {
          return getResults();
        }

        /*
         * A missing API or failed API uses only catalogue
         * entries already available in the browser.
         */
        if (
          results === null ||
          (
            backendError &&
            getTotalResults(results) === 0
          )
        ) {
          results = searchLocal(
            normalizedQuery,
            normalizeLimit(options.limit)
          );
        }

        const deduplicated = {
          tracks: deduplicate(results.tracks),
          artists: deduplicate(results.artists),
          albums: deduplicate(results.albums),
          playlists: deduplicate(results.playlists)
        };

        state.results = applyFilters(deduplicated);

        /*
         * Keep the failure visible when the backend failed
         * and no local results could be found.
         */
        if (
          backendError &&
          getTotalResults(state.results) === 0
        ) {
          state.error = {
            message:
              "Online search is unavailable, and no matching local results were found."
          };
        }

        if (options.saveHistory !== false) {
          addToHistory(normalizedQuery);
        }

        emit(EVENTS.RESULTS, {
          query: normalizedQuery,
          results: getResults(),
          total: getTotal(),
          offlineFallback: Boolean(backendError)
        });

        if (state.error) {
          emit(EVENTS.ERROR, {
            query: normalizedQuery,
            error: state.error
          });
        }

        return getResults();
      } catch (error) {
        if (
          error?.name === "AbortError" ||
          controller.signal.aborted ||
          currentRequest !== requestNumber
        ) {
          return getResults();
        }

        state.error = {
          message:
            error?.message ||
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

          if (activeController === controller) {
            activeController = null;
          }

          emit(EVENTS.LOADING, {
            loading: false,
            query: normalizedQuery
          });
        }
      }
    }

    function getTotalResults(results) {
      if (!results) {
        return 0;
      }

      return [
        results.tracks,
        results.artists,
        results.albums,
        results.playlists
      ].reduce((total, collection) => {
        return total + (
          Array.isArray(collection)
            ? collection.length
            : 0
        );
      }, 0);
    }

    /* =====================================================
       DEBOUNCED SEARCH
       ===================================================== */

    function searchDebounced(query, options = {}) {
      cancelDebounceOnly();

      return new Promise((resolve, reject) => {
        pendingDebouncedSearch = {
          resolve,
          reject
        };

        const delay = Math.max(
          0,
          Math.min(
            5000,
            Number(options.delay ?? DEBOUNCE_DELAY) || 0
          )
        );

        debounceTimer = setTimeout(async () => {
          debounceTimer = null;

          const pending = pendingDebouncedSearch;

          pendingDebouncedSearch = null;

          try {
            const result = await search(query, options);

            pending?.resolve(result);
          } catch (error) {
            pending?.reject(error);
          }
        }, delay);
      });
    }

    /* =====================================================
       CANCEL AND CLEAR
       ===================================================== */

    function cancelSearch() {
      cancelDebounceOnly();

      requestNumber++;

      abortActiveRequest();

      state.loading = false;

      emit(EVENTS.LOADING, {
        loading: false,
        query: state.query,
        cancelled: true
      });
    }

    function clearResults() {
      cancelSearch();

      state.query = "";
      state.error = null;
      state.results = emptyResults();

      emit(EVENTS.QUERY_CHANGE, {
        query: ""
      });

      emit(EVENTS.RESULTS, {
        query: "",
        results: getResults(),
        total: 0
      });

      return getResults();
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
      return getTotalResults(state.results);
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
