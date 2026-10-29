/* =========================================================
   RESONA — API MODULE
   File: js/api.js

   Responsibilities:
   - Communicate with the Resona backend.
   - Retrieve tracks, artists, albums, and playlists.
   - Search the music catalogue.
   - Retrieve individual catalogue records.
   - Handle network and HTTP errors consistently.
   - Support AbortController request cancellation.
   - Avoid inventing music catalogue data.

   This module does not provide a fake backend.
   ========================================================= */

"use strict";

(function (global) {
  const ResonaAPI = (() => {
    const DEFAULT_TIMEOUT = 15000;

    const DEFAULT_HEADERS = {
      Accept: "application/json"
    };

    const ENDPOINTS = Object.freeze({
      tracks: "/tracks",
      artists: "/artists",
      albums: "/albums",
      playlists: "/playlists",
      search: "/search"
    });

    let requestController = null;

    /* =====================================================
       CONFIGURATION
       ===================================================== */

    function getConfig() {
      const config = global.ResonaConfig || {};

      /*
       * Supports both:
       *
       * api: {
       *   baseUrl: "https://your-api.example.com"
       * }
       *
       * and the earlier app.js configuration:
       *
       * apiBase: "https://your-api.example.com"
       */

      const apiConfig = config.api || {};

      const baseUrl = String(
        apiConfig.baseUrl ||
        config.apiBase ||
        ""
      ).trim();

      return {
        baseUrl: baseUrl.replace(/\/+$/, ""),
        timeout: Number(config.apiTimeout) > 0
          ? Number(config.apiTimeout)
          : DEFAULT_TIMEOUT
      };
    }

    function isConfigured() {
      return Boolean(getConfig().baseUrl);
    }

    function getBaseUrl() {
      return getConfig().baseUrl;
    }

    /* =====================================================
       URL AND PARAMETER HELPERS
       ===================================================== */

    function buildUrl(endpoint, params = {}) {
      const config = getConfig();

      if (!config.baseUrl) {
        throw new Error(
          "Resona API is not configured. Set ResonaConfig.api.baseUrl."
        );
      }

      const cleanEndpoint = String(endpoint || "").replace(
        /^\/+/,
        ""
      );

      const url = new URL(
        cleanEndpoint,
        config.baseUrl + "/"
      );

      Object.entries(params || {}).forEach(([key, value]) => {
        if (
          value === undefined ||
          value === null ||
          value === ""
        ) {
          return;
        }

        if (Array.isArray(value)) {
          value.forEach(item => {
            if (
              item !== undefined &&
              item !== null &&
              item !== ""
            ) {
              url.searchParams.append(key, String(item));
            }
          });

          return;
        }

        url.searchParams.set(key, String(value));
      });

      return url;
    }

    function normalizeLimit(value, fallback = 20, maximum = 100) {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        return fallback;
      }

      return Math.min(
        maximum,
        Math.max(1, Math.floor(number))
      );
    }

    function normalizeOffset(value) {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        return 0;
      }

      return Math.max(0, Math.floor(number));
    }

    function normalizeId(id, label = "ID") {
      if (
        id === undefined ||
        id === null ||
        String(id).trim() === ""
      ) {
        throw new TypeError(label + " is required.");
      }

      return encodeURIComponent(String(id).trim());
    }

    /* =====================================================
       RESPONSE HELPERS
       ===================================================== */

    async function parseResponse(response) {
      const contentType = (
        response.headers.get("content-type") || ""
      ).toLowerCase();

      let data;

      if (contentType.includes("application/json")) {
        try {
          data = await response.json();
        } catch {
          throw new Error(
            "The Resona server returned invalid JSON."
          );
        }
      } else {
        const text = await response.text();

        data = text
          ? { message: text }
          : null;
      }

      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          (
            data.error ||
            data.message ||
            data.detail
          );

        const error = new Error(
          message ||
          "Resona API request failed with HTTP " +
            response.status +
            "."
        );

        error.status = response.status;
        error.data = data;

        throw error;
      }

      return data;
    }

    /* =====================================================
       CORE REQUEST FUNCTION
       ===================================================== */

    async function request(
      endpoint,
      options = {}
    ) {
      const config = getConfig();

      if (!config.baseUrl) {
        throw new Error(
          "Resona's backend URL has not been configured."
        );
      }

      const method = String(
        options.method || "GET"
      ).toUpperCase();

      const url = buildUrl(
        endpoint,
        method === "GET" ? options.params : undefined
      );

      const controller = new AbortController();

      const timeoutId = setTimeout(() => {
        controller.abort(
          new DOMException(
            "The request timed out.",
            "TimeoutError"
          )
        );
      }, config.timeout);

      const externalSignal = options.signal;

      let externalAbortHandler = null;

      if (externalSignal) {
        if (externalSignal.aborted) {
          clearTimeout(timeoutId);

          throw new DOMException(
            "The request was cancelled.",
            "AbortError"
          );
        }

        externalAbortHandler = () => {
          controller.abort(
            new DOMException(
              "The request was cancelled.",
              "AbortError"
            )
          );
        };

        externalSignal.addEventListener(
          "abort",
          externalAbortHandler,
          { once: true }
        );
      }

      const headers = {
        ...DEFAULT_HEADERS,
        ...(options.headers || {})
      };

      const fetchOptions = {
        method,
        headers,
        signal: controller.signal,
        credentials: options.credentials || "omit"
      };

      if (
        options.body !== undefined &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        headers["Content-Type"] =
          headers["Content-Type"] ||
          "application/json";

        fetchOptions.body =
          typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body);
      }

      try {
        const response = await fetch(
          url.toString(),
          fetchOptions
        );

        return await parseResponse(response);
      } catch (error) {
        if (
          error &&
          error.name === "AbortError"
        ) {
          throw error;
        }

        if (
          error &&
          error.name === "TimeoutError"
        ) {
          throw error;
        }

        if (
          error &&
          error.name === "TypeError"
        ) {
          throw new Error(
            "Unable to reach the Resona server. Check your internet connection, API URL, and server CORS settings."
          );
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);

        if (
          externalSignal &&
          externalAbortHandler
        ) {
          externalSignal.removeEventListener(
            "abort",
            externalAbortHandler
          );
        }
      }
    }

    /* =====================================================
       CATALOGUE HELPERS
       ===================================================== */

    function normalizeCollection(data) {
      if (Array.isArray(data)) {
        return data;
      }

      if (!data || typeof data !== "object") {
        return [];
      }

      if (Array.isArray(data.items)) {
        return data.items;
      }

      if (Array.isArray(data.results)) {
        return data.results;
      }

      if (Array.isArray(data.data)) {
        return data.data;
      }

      return [];
    }

    function normalizeRecord(data) {
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data)
      ) {
        if (
          data.data &&
          !Array.isArray(data.data) &&
          typeof data.data === "object"
        ) {
          return data.data;
        }

        return data;
      }

      return null;
    }

    async function getCollection(
      endpoint,
      options = {}
    ) {
      const params = {
        limit: normalizeLimit(options.limit),
        offset: normalizeOffset(options.offset),
        ...(options.params || {})
      };

      const data = await request(endpoint, {
        method: "GET",
        params,
        signal: options.signal
      });

      return {
        items: normalizeCollection(data),
        total:
          Number.isFinite(Number(data?.total))
            ? Number(data.total)
            : null,
        limit: params.limit,
        offset: params.offset,
        raw: data
      };
    }

    /* =====================================================
       TRACKS
       ===================================================== */

    async function getTracks(options = {}) {
      return getCollection(
        ENDPOINTS.tracks,
        options
      );
    }

    async function getTrack(id, options = {}) {
      const safeId = normalizeId(id, "Track ID");

      const data = await request(
        ENDPOINTS.tracks + "/" + safeId,
        {
          method: "GET",
          signal: options.signal
        }
      );

      return normalizeRecord(data);
    }

    /* =====================================================
       ARTISTS
       ===================================================== */

    async function getArtists(options = {}) {
      return getCollection(
        ENDPOINTS.artists,
        options
      );
    }

    async function getArtist(id, options = {}) {
      const safeId = normalizeId(id, "Artist ID");

      const data = await request(
        ENDPOINTS.artists + "/" + safeId,
        {
          method: "GET",
          signal: options.signal
        }
      );

      return normalizeRecord(data);
    }

    /* =====================================================
       ALBUMS
       ===================================================== */

    async function getAlbums(options = {}) {
      return getCollection(
        ENDPOINTS.albums,
        options
      );
    }

    async function getAlbum(id, options = {}) {
      const safeId = normalizeId(id, "Album ID");

      const data = await request(
        ENDPOINTS.albums + "/" + safeId,
        {
          method: "GET",
          signal: options.signal
        }
      );

      return normalizeRecord(data);
    }

    /* =====================================================
       PLAYLISTS
       ===================================================== */

    async function getPlaylists(options = {}) {
      return getCollection(
        ENDPOINTS.playlists,
        options
      );
    }

    async function getPlaylist(id, options = {}) {
      const safeId = normalizeId(id, "Playlist ID");

      const data = await request(
        ENDPOINTS.playlists + "/" + safeId,
        {
          method: "GET",
          signal: options.signal
        }
      );

      return normalizeRecord(data);
    }

    /* =====================================================
       SEARCH
       ===================================================== */

    async function search(query, options = {}) {
      const normalizedQuery = String(
        query || ""
      ).trim();

      if (!normalizedQuery) {
        return {
          tracks: [],
          artists: [],
          albums: [],
          playlists: [],
          total: 0
        };
      }

      const params = {
        q: normalizedQuery,
        limit: normalizeLimit(options.limit, 20),
        offset: normalizeOffset(options.offset)
      };

      if (options.type) {
        params.type = String(options.type);
      }

      if (options.region) {
        params.region = String(options.region);
      }

      if (options.genre) {
        params.genre = String(options.genre);
      }

      const data = await request(
        ENDPOINTS.search,
        {
          method: "GET",
          params,
          signal: options.signal
        }
      );

      if (Array.isArray(data)) {
        return {
          tracks: data,
          artists: [],
          albums: [],
          playlists: [],
          total: data.length
        };
      }

      const result = normalizeRecord(data) || {};

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
          : [],

        total: Number.isFinite(Number(result.total))
          ? Number(result.total)
          : null,

        raw: data
      };
    }

    /* =====================================================
       HEALTH CHECK
       ===================================================== */

    async function healthCheck(options = {}) {
      const config = getConfig();

      if (!config.baseUrl) {
        return {
          ok: false,
          configured: false,
          message: "Resona API URL is not configured."
        };
      }

      const endpoint = options.endpoint || "/health";

      try {
        const data = await request(endpoint, {
          method: "GET",
          signal: options.signal
        });

        return {
          ok: true,
          configured: true,
          data
        };
      } catch (error) {
        return {
          ok: false,
          configured: true,
          message: error.message
        };
      }
    }

    /* =====================================================
       CANCELLATION
       ===================================================== */

    function createRequestController() {
      return new AbortController();
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    return Object.freeze({
      isConfigured,
      getBaseUrl,

      request,
      buildUrl,
      createRequestController,

      getTracks,
      getTrack,

      getArtists,
      getArtist,

      getAlbums,
      getAlbum,

      getPlaylists,
      getPlaylist,

      search,
      healthCheck
    });
  })();

  global.ResonaAPI = ResonaAPI;
})(window);
