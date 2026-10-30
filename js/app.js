/* =========================================================
   RESONA — APPLICATION ENTRY POINT
   File: js/app.js
   Version: 2.1.2

   Coordinates:
   - api.js
   - player.js
   - discovery.js
   - search.js
   - library.js
   - ui.js

   This file does not replace the root app.js.
   ========================================================= */

(function (window, document) {
  "use strict";

  if (window.ResonaApp) {
    console.warn("[Resona App] Already initialized.");
    return;
  }

  const VERSION = "2.1.2";

  /* =========================================================
     MODULE REFERENCES
     ========================================================= */

  const api = window.ResonaAPI || null;
  const player = window.ResonaPlayer || null;
  const discovery = window.ResonaDiscovery || null;
  const search = window.ResonaSearch || null;
  const library = window.ResonaLibrary || null;
  const ui = window.ResonaUI || null;

  const MODULES = [
    "ResonaAPI",
    "ResonaPlayer",
    "ResonaDiscovery",
    "ResonaSearch",
    "ResonaLibrary",
    "ResonaUI"
  ];

  const VALID_PAGES = new Set([
    "home",
    "explore",
    "search",
    "library",
    "artists",
    "albums",
    "playlists",
    "settings"
  ]);

  const state = {
    initialized: false,
    initializing: false,

    currentPage: "home",
    lastPage: "home",

    activeSearch: "",
    searchTimer: null,
    searchRequestId: 0,

    errors: [],

    cleanup: [],
    unsubscribers: [],

    currentTrack: null
  };

  /* =========================================================
     UTILITIES
     ========================================================= */

  function log() {
    console.log.apply(
      console,
      ["[Resona App]"].concat(Array.from(arguments))
    );
  }

  function warn() {
    console.warn.apply(
      console,
      ["[Resona App]"].concat(Array.from(arguments))
    );
  }

  function recordError(error, context) {
    const entry = {
      message: error && error.message
        ? error.message
        : String(error),
      context: context || "application",
      timestamp: new Date().toISOString()
    };

    state.errors.push(entry);

    if (state.errors.length > 50) {
      state.errors.shift();
    }

    console.error(
      "[Resona App]",
      entry.context,
      error
    );

    return entry;
  }

  function safeCall(callback, fallback) {
    try {
      if (typeof callback === "function") {
        return callback();
      }

      return fallback;
    } catch (error) {
      recordError(error, "safe-call");
      return fallback;
    }
  }

  function getElement(selector, root) {
    const scope = root || document;

    if (!scope || typeof scope.querySelector !== "function") {
      return null;
    }

    try {
      return scope.querySelector(selector);
    } catch (error) {
      warn("Invalid selector:", selector, error);
      return null;
    }
  }

  function getElements(selector, root) {
    const scope = root || document;

    if (!scope || typeof scope.querySelectorAll !== "function") {
      return [];
    }

    try {
      return Array.from(scope.querySelectorAll(selector));
    } catch (error) {
      warn("Invalid selector:", selector, error);
      return [];
    }
  }

  function findFirstElement(selectors, root) {
    for (const selector of selectors) {
      const element = getElement(selector, root);

      if (element) return element;
    }

    return null;
  }

  function addHandler(target, eventName, callback, options) {
    if (
      !target ||
      typeof target.addEventListener !== "function"
    ) {
      return function () {};
    }

    target.addEventListener(
      eventName,
      callback,
      options
    );

    let active = true;

    const cleanup = function () {
      if (!active) return;

      active = false;

      target.removeEventListener(
        eventName,
        callback,
        options
      );
    };

    state.cleanup.push(cleanup);

    return cleanup;
  }

  function addUnsubscriber(unsubscribe) {
    if (typeof unsubscribe === "function") {
      state.unsubscribers.push(unsubscribe);
    }
  }

  function emitAppEvent(name, detail) {
    try {
      window.dispatchEvent(
        new window.CustomEvent(
          "resona:app:" + name,
          {
            detail: detail === undefined ? null : detail
          }
        )
      );
    } catch (error) {
      warn("Could not dispatch event:", name, error);
    }
  }

  function notify(message, type) {
    if (!ui) {
      log(message);
      return;
    }

    const methods = {
      success: "success",
      error: "error",
      warning: "warning",
      info: "info"
    };

    const method = methods[type || "info"];

    if (typeof ui[method] === "function") {
      safeCall(function () {
        ui[method](message);
      });

      return;
    }

    if (typeof ui.toast === "function") {
      safeCall(function () {
        ui.toast(message);
      });

      return;
    }

    log(message);
  }

  function announce(message) {
    if (!ui || typeof ui.announce !== "function") {
      return;
    }

    safeCall(function () {
      ui.announce(message);
    });
  }

  function normalizePage(page) {
    const normalized = String(page || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    return VALID_PAGES.has(normalized)
      ? normalized
      : "home";
  }

  function normalizeList(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (!value || typeof value !== "object") {
      return [];
    }

    const keys = [
      "items",
      "results",
      "tracks",
      "artists",
      "albums",
      "playlists"
    ];

    for (const key of keys) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }

    if (Array.isArray(value.data)) {
      return value.data;
    }

    if (
      value.data &&
      typeof value.data === "object"
    ) {
      return normalizeList(value.data);
    }

    return [];
  }

  function getEventTargetElement(event) {
    const target = event && event.target;

    if (!target) return null;

    if (target.nodeType === 1) {
      return target;
    }

    return target.parentElement || null;
  }

  /* =========================================================
     TRACK UTILITIES
     ========================================================= */

  function getTrackId(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    if (ui && typeof ui.getTrackId === "function") {
      const result = safeCall(function () {
        return ui.getTrackId(track);
      }, "");

      if (result) return String(result).trim();
    }

    return String(
      track.id ||
      track.track_id ||
      track.trackId ||
      track.uuid ||
      ""
    ).trim();
  }

  function getTrackTitle(track) {
    if (!track || typeof track !== "object") {
      return "Untitled track";
    }

    if (ui && typeof ui.getTrackTitle === "function") {
      const result = safeCall(function () {
        return ui.getTrackTitle(track);
      }, "");

      if (result) return String(result);
    }

    return String(
      track.title ||
      track.name ||
      "Untitled track"
    );
  }

  function getArtistName(track) {
    if (!track || typeof track !== "object") {
      return "Unknown artist";
    }

    if (ui && typeof ui.getArtistName === "function") {
      const result = safeCall(function () {
        return ui.getArtistName(track);
      }, "");

      if (result) return String(result);
    }

    if (Array.isArray(track.artists)) {
      const names = track.artists.map(function (artist) {
        if (typeof artist === "string") {
          return artist;
        }

        return artist && artist.name
          ? artist.name
          : "";
      }).filter(Boolean);

      return names.join(", ") || "Unknown artist";
    }

    const artist =
      track.artistName ||
      track.artist_name ||
      track.artist;

    if (typeof artist === "string") {
      return artist || "Unknown artist";
    }

    if (artist && typeof artist === "object") {
      return String(
        artist.name || "Unknown artist"
      );
    }

    return "Unknown artist";
  }

  function getArtwork(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    if (ui && typeof ui.getTrackArtwork === "function") {
      const result = safeCall(function () {
        return ui.getTrackArtwork(track);
      }, "");

      if (result) return result;
    }

    return (
      track.artwork ||
      track.cover ||
      track.cover_url ||
      track.image_url ||
      track.image ||
      ""
    );
  }

  function getTrackDuration(track) {
    if (!track) return "0:00";

    const raw =
      track.duration_seconds ??
      track.durationSeconds ??
      track.duration ??
      0;

    if (
      typeof raw === "string" &&
      raw.includes(":")
    ) {
      return raw;
    }

    const duration = Number(raw);

    if (
      ui &&
      typeof ui.formatDuration === "function" &&
      Number.isFinite(duration)
    ) {
      return ui.formatDuration(duration);
    }

    const seconds = Number.isFinite(duration)
      ? Math.max(0, Math.floor(duration))
      : 0;

    return (
      Math.floor(seconds / 60) +
      ":" +
      String(seconds % 60).padStart(2, "0")
    );
  }

  /* =========================================================
     MODULE VALIDATION
     ========================================================= */

  function missingModules() {
    return MODULES.filter(function (name) {
      return !window[name];
    });
  }

  function validateModules() {
    const missing = missingModules();

    if (missing.length) {
      const message =
        "Required Resona modules are missing: " +
        missing.join(", ");

      recordError(
        new Error(message),
        "module-validation"
      );

      return {
        success: false,
        missing: missing,
        message: message
      };
    }

    return {
      success: true,
      missing: []
    };
  }

  /* =========================================================
     PAGE DISCOVERY AND VISIBILITY
     ========================================================= */

  function getPageElements() {
    const knownIds = [
      "home-page",
      "explore-page",
      "search-page",
      "library-page",
      "artists-page",
      "albums-page",
      "playlists-page",
      "settings-page"
    ];

    const pages = [];

    knownIds.forEach(function (id) {
      const element = document.getElementById(id);

      if (element && !pages.includes(element)) {
        pages.push(element);
      }
    });

    if (pages.length) {
      return pages;
    }

    return getElements("[id$='-page']").filter(
      function (element) {
        return !element.closest("nav, header, footer");
      }
    );
  }

  function setPageVisibility(page) {
    const normalized = normalizePage(page);
    const pages = getPageElements();

    let matched = false;

    pages.forEach(function (element) {
      const name = normalizePage(
        element.dataset.page ||
        element.id.replace(/-page$/, "")
      );

      const visible = name === normalized;

      element.hidden = !visible;

      element.setAttribute(
        "aria-hidden",
        visible ? "false" : "true"
      );

      element.classList.toggle(
        "is-active",
        visible
      );

      element.classList.toggle(
        "active",
        visible
      );

      if (visible) matched = true;
    });

    return matched;
  }

  function updateNavigationControls(page) {
    getElements(
      "[data-navigate], [data-page-link], .nav-link"
    ).forEach(function (element) {
      const destination =
        element.dataset.navigate ||
        element.dataset.pageLink ||
        element.dataset.page ||
        (element.getAttribute("href") || "")
          .replace(/^#\/?/, "");

      const active =
        normalizePage(destination) === page;

      element.classList.toggle(
        "is-active",
        active
      );

      element.classList.toggle(
        "active",
        active
      );

      if (active) {
        element.setAttribute("aria-current", "page");
      } else {
        element.removeAttribute("aria-current");
      }
    });
  }

  /* =========================================================
     PAGE LOADING
     ========================================================= */

  async function loadPage(page) {
    const normalized = normalizePage(page);

    switch (normalized) {
      case "home":
        return loadHome();

      case "explore":
        return loadExplore();

      case "search": {
        const input = findFirstElement([
          "#search-input",
          "#music-search"
        ]);

        if (input && input.value.trim()) {
          return performSearch(input.value);
        }

        return true;
      }

      case "library":
        return loadLibrary();

      case "artists":
        return loadArtists();

      case "albums":
        return loadAlbums();

      case "playlists":
        return loadPlaylists();

      case "settings":
        emitAppEvent("page:settings", {});
        return true;

      default:
        return false;
    }
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  async function navigate(page, options) {
    const settings = options || {};
    const normalized = normalizePage(page);

    if (
      normalized === state.currentPage &&
      !settings.force
    ) {
      return {
        success: true,
        page: normalized,
        unchanged: true
      };
    }

    const previous = state.currentPage;

    state.lastPage = previous;
    state.currentPage = normalized;

    const pageFound = setPageVisibility(normalized);

    updateNavigationControls(normalized);

    if (settings.updateHistory !== false) {
      try {
        const url = new URL(window.location.href);

        url.hash = normalized;

        window.history.pushState(
          { resonaPage: normalized },
          "",
          url
        );
      } catch (error) {
        recordError(error, "navigation-history");
      }
    }

    emitAppEvent("page:changed", {
      previous: previous,
      current: normalized
    });

    announce(
      "Opened " +
      normalized.replace(/-/g, " ") +
      " page."
    );

    try {
      await loadPage(normalized);
    } catch (error) {
      recordError(
        error,
        "page-loading:" + normalized
      );
    }

    if (!pageFound) {
      warn(
        "No matching page element was found:",
        normalized
      );
    }

    return {
      success: true,
      page: normalized,
      elementFound: pageFound
    };
  }

  function handleNavigationClick(event) {
    const target = getEventTargetElement(event);

    if (!target || typeof target.closest !== "function") {
      return;
    }

    const link = target.closest(
      "[data-navigate], [data-page-link], a[href^='#']"
    );

    if (!link) return;

    const destination =
      link.dataset.navigate ||
      link.dataset.pageLink ||
      link.dataset.page ||
      (link.getAttribute("href") || "")
        .replace(/^#\/?/, "");

    const normalized = String(destination || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    if (!VALID_PAGES.has(normalized)) {
      return;
    }

    event.preventDefault();
    navigate(normalized);
  }

  function handlePopState() {
    const page = normalizePage(
      String(window.location.hash || "")
        .replace(/^#\/?/, "")
    );

    navigate(page, {
      updateHistory: false,
      force: true
    });
  }

  function bindNavigation() {
    addHandler(
      document,
      "click",
      handleNavigationClick
    );

    addHandler(
      window,
      "popstate",
      handlePopState
    );
  }

  /* =========================================================
     DISCOVERY
     ========================================================= */

  function callDiscovery(method, options) {
    if (
      !discovery ||
      typeof discovery[method] !== "function"
    ) {
      return Promise.resolve([]);
    }

    try {
      return Promise.resolve(
        discovery[method](options)
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /* =========================================================
     TRACK CARD RENDERING
     ========================================================= */

  function createFallbackTrackCard(track, options) {
    const settings = options || {};

    const card = document.createElement("article");

    card.className = "resona-track-card";
    card.dataset.trackId = getTrackId(track);

    const artworkButton = document.createElement("button");

    artworkButton.type = "button";
    artworkButton.className =
      "resona-track-card__artwork-button";

    artworkButton.setAttribute(
      "aria-label",
      "Play " + getTrackTitle(track)
    );

    const image = document.createElement("img");

    image.className =
      "resona-track-card__artwork";

    image.alt = getTrackTitle(track) + " cover";
    image.loading = "lazy";

    const artwork = getArtwork(track);

    if (artwork) {
      image.src = artwork;
    }

    image.onerror = function () {
      image.onerror = null;
      image.removeAttribute("src");
    };

    artworkButton.appendChild(image);

    artworkButton.addEventListener(
      "click",
      function () {
        playTrack(track);
      }
    );

    card.appendChild(artworkButton);

    const title = document.createElement("h3");

    title.className = "resona-track-card__title";
    title.textContent = getTrackTitle(track);

    const artist = document.createElement("p");

    artist.className = "resona-track-card__artist";
    artist.textContent = getArtistName(track);

    const duration = document.createElement("span");

    duration.className =
      "resona-track-card__duration";

    duration.textContent = getTrackDuration(track);

    card.appendChild(title);
    card.appendChild(artist);
    card.appendChild(duration);

    if (settings.showLike !== false) {
      const like = document.createElement("button");

      like.type = "button";
      like.className = "resona-track-card__like";

      const liked = Boolean(
        library &&
        typeof library.isLiked === "function" &&
        library.isLiked(getTrackId(track))
      );

      like.textContent = liked ? "♥" : "♡";

      like.setAttribute(
        "aria-pressed",
        liked ? "true" : "false"
      );

      like.setAttribute(
        "aria-label",
        liked ? "Unlike track" : "Like track"
      );

      like.addEventListener("click", function () {
        if (
          !library ||
          typeof library.toggleLike !== "function"
        ) {
          notify(
            "Your library is unavailable.",
            "error"
          );

          return;
        }

        try {
          library.toggleLike(track);

          const nowLiked =
            typeof library.isLiked === "function"
              ? Boolean(
                  library.isLiked(getTrackId(track))
                )
              : !liked;

          like.textContent = nowLiked ? "♥" : "♡";

          like.setAttribute(
            "aria-pressed",
            nowLiked ? "true" : "false"
          );

          like.setAttribute(
            "aria-label",
            nowLiked ? "Unlike track" : "Like track"
          );
        } catch (error) {
          recordError(error, "like-track");

          notify(
            "Unable to update liked tracks.",
            "error"
          );
        }
      });

      card.appendChild(like);
    }

    return card;
  }

  function createTrackCard(track, options) {
    if (
      ui &&
      typeof ui.renderTrackCard === "function"
    ) {
      try {
        return ui.renderTrackCard(
          track,
          Object.assign(
            { onPlay: playTrack },
            options || {}
          )
        );
      } catch (error) {
        recordError(error, "ui-track-card");
      }
    }

    return createFallbackTrackCard(track, options);
  }

  function renderTracks(container, tracks, options) {
    const element = typeof container === "string"
      ? getElement(container)
      : container;

    if (!element) return false;

    const list = normalizeList(tracks);
    const settings = options || {};

    element.replaceChildren();

    if (!list.length) {
      if (ui && typeof ui.showEmpty === "function") {
        ui.showEmpty(element, {
          icon: settings.emptyIcon || "♫",
          title:
            settings.emptyTitle ||
            "No music available yet",
          message:
            settings.emptyMessage ||
            "Try another section or check back later."
        });
      } else {
        const message = document.createElement("p");

        message.textContent =
          settings.emptyMessage ||
          "No music available yet.";

        element.appendChild(message);
      }

      return true;
    }

    const fragment = document.createDocumentFragment();

    list.forEach(function (track) {
      if (!track || typeof track !== "object") {
        return;
      }

      const card = createTrackCard(track, settings);

      if (card && card.nodeType) {
        fragment.appendChild(card);
      }
    });

    element.appendChild(fragment);

    return true;
  }

  /* =========================================================
     HOME
     ========================================================= */

  async function loadHome() {
    const sections = [
      {
        name: "featured",
        selectors: [
          "#featured-tracks",
          "[data-section='featured']",
          "#home-featured"
        ],
        method: "getFeatured",
        title: "Featured music"
      },
      {
        name: "trending",
        selectors: [
          "#trending-tracks",
          "[data-section='trending']",
          "#home-trending"
        ],
        method: "getTrending",
        title: "Trending music"
      }
    ];

    const jobs = sections.map(async function (section) {
      const container = findFirstElement(
        section.selectors
      );

      if (!container) return;

      if (ui && typeof ui.showLoading === "function") {
        ui.showLoading(container, {
          message:
            "Loading " +
            section.title.toLowerCase() +
            "..."
        });
      }

      try {
        const tracks = await callDiscovery(
          section.method
        );

        renderTracks(container, tracks, {
          showLike: true,
          emptyTitle:
            "No " +
            section.title.toLowerCase() +
            " yet"
        });
      } catch (error) {
        recordError(error, "home:" + section.name);

        if (
          ui &&
          typeof ui.showErrorState === "function"
        ) {
          ui.showErrorState(container, {
            message:
              "We couldn't load this section. Please try again.",
            onAction: loadHome
          });
        }
      }
    });

    const recentContainer = findFirstElement([
      "#recently-played",
      "[data-section='recently-played']"
    ]);

    if (recentContainer) {
      try {
        const recent =
          library &&
          typeof library.getRecentlyPlayed === "function"
            ? library.getRecentlyPlayed(12)
            : [];

        renderTracks(recentContainer, recent, {
          showLike: true,
          emptyTitle: "Nothing played yet",
          emptyMessage:
            "Tracks you play will appear here."
        });
      } catch (error) {
        recordError(
          error,
          "home:recently-played"
        );
      }
    }

    await Promise.allSettled(jobs);

    return true;
  }

  /* =========================================================
     EXPLORE
     ========================================================= */

  async function loadExplore() {
    const container = findFirstElement([
      "#explore-tracks",
      "#explore-results",
      "[data-section='explore-tracks']"
    ]);

    if (
      container &&
      ui &&
      typeof ui.showLoading === "function"
    ) {
      ui.showLoading(container, {
        message: "Discovering music..."
      });
    }

    if (container) {
      try {
        const tracks = await callDiscovery(
          "getTracks"
        );

        renderTracks(container, tracks, {
          showLike: true,
          showSave: true,
          emptyTitle: "Your discovery starts here",
          emptyMessage:
            "Catalogue music will appear here when available."
        });
      } catch (error) {
        recordError(error, "explore");

        if (
          ui &&
          typeof ui.showErrorState === "function"
        ) {
          ui.showErrorState(container, {
            message: "We couldn't load Explore.",
            onAction: loadExplore
          });
        }
      }
    }

    const artistsContainer =
      getElement("#explore-artists");

    const albumsContainer =
      getElement("#explore-albums");

    if (artistsContainer) {
      try {
        const items = await callDiscovery(
          "getArtists"
        );

        renderSimpleEntityCards(
          artistsContainer,
          items,
          "artist"
        );
      } catch (error) {
        recordError(error, "explore-artists");
      }
    }

    if (albumsContainer) {
      try {
        const items = await callDiscovery(
          "getAlbums"
        );

        renderSimpleEntityCards(
          albumsContainer,
          items,
          "album"
        );
      } catch (error) {
        recordError(error, "explore-albums");
      }
    }

    return true;
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  function getSearchResultsContainer() {
    if (state.currentPage === "explore") {
      return findFirstElement([
        "#explore-search-results",
        "#search-results"
      ]);
    }

    return findFirstElement([
      "#search-results",
      "#music-search-results",
      "[data-section='search-results']"
    ]);
  }

  function unwrapSearchResponse(result) {
    let value = result;

    for (let i = 0; i < 5; i++) {
      if (!value || typeof value !== "object") {
        break;
      }

      if (
        Array.isArray(value.tracks) ||
        Array.isArray(value.artists) ||
        Array.isArray(value.albums) ||
        Array.isArray(value.playlists)
      ) {
        return value;
      }

      if (Array.isArray(value.items)) {
        return {
          tracks: value.items,
          artists: [],
          albums: [],
          playlists: []
        };
      }

      if (Array.isArray(value.results)) {
        return {
          tracks: value.results,
          artists: [],
          albums: [],
          playlists: []
        };
      }

      if (
        value.data &&
        typeof value.data === "object"
      ) {
        value = value.data;
        continue;
      }

      if (
        value.results &&
        typeof value.results === "object"
      ) {
        value = value.results;
        continue;
      }

      break;
    }

    return value;
  }

  function normalizeSearchTracks(result) {
    if (Array.isArray(result)) {
      return result;
    }

    const value = unwrapSearchResponse(result);

    if (!value || typeof value !== "object") {
      return [];
    }

    return normalizeList(value.tracks || value);
  }

  function updateSearchStatus(message) {
    const status = getElement("#search-status");

    if (status) {
      status.textContent = message || "";
    }
  }

  function renderSearchCategories(result) {
    const normalized =
      unwrapSearchResponse(result) || {};

    const tracks = normalizeSearchTracks(normalized);
    const artists = normalizeList(normalized.artists);
    const albums = normalizeList(normalized.albums);
    const playlists = normalizeList(normalized.playlists);

    const mainContainer =
      getSearchResultsContainer();

    if (mainContainer) {
      renderTracks(mainContainer, tracks, {
        showLike: true,
        showSave: true,
        emptyTitle: "No tracks found",
        emptyMessage:
          "Try another song, artist, album, or genre."
      });
    }

    const artistsContainer =
      getElement("#search-artists");

    const albumsContainer =
      getElement("#search-albums");

    const playlistsContainer =
      getElement("#search-playlists");

    if (artistsContainer) {
      renderSimpleEntityCards(
        artistsContainer,
        artists,
        "artist"
      );
    }

    if (albumsContainer) {
      renderSimpleEntityCards(
        albumsContainer,
        albums,
        "album"
      );
    }

    if (playlistsContainer) {
      renderSimpleEntityCards(
        playlistsContainer,
        playlists,
        "playlist"
      );
    }

    return {
      tracks: tracks,
      artists: artists,
      albums: albums,
      playlists: playlists
    };
  }

  function readSearchFilters() {
    const container = getElement("#search-filters");

    if (!container) return {};

    const filters = {};

    [
      "type",
      "genre",
      "country",
      "language"
    ].forEach(function (name) {
      const field = getElement(
        '[name="' + name + '"]',
        container
      );

      if (field && field.value) {
        filters[name] = field.value;
      }
    });

    return filters;
  }

  async function performSearch(query, options) {
    const settings = Object.assign(
      {},
      readSearchFilters(),
      options || {}
    );

    const normalizedQuery =
      String(query || "").trim();

    const requestId = ++state.searchRequestId;

    state.activeSearch = normalizedQuery;

    const container =
      getSearchResultsContainer();

    if (!container) {
      return {
        success: false,
        message:
          "Search results container was not found."
      };
    }

    if (!normalizedQuery) {
      container.replaceChildren();

      updateSearchStatus("");

      return {
        success: true,
        results: []
      };
    }

    updateSearchStatus("Searching...");

    if (
      ui &&
      typeof ui.showLoading === "function"
    ) {
      ui.showLoading(container, {
        message: "Searching Resona..."
      });
    }

    try {
      let result;

      if (search && typeof search.search === "function") {
        if (typeof search.setFilters === "function") {
          search.setFilters(settings);
        }

        result = await search.search(
          normalizedQuery,
          settings
        );
      } else if (
        api &&
        typeof api.search === "function"
      ) {
        result = await api.search(
          normalizedQuery,
          settings
        );
      } else {
        throw new Error(
          "Search functionality is unavailable."
        );
      }

      if (requestId !== state.searchRequestId) {
        return {
          success: false,
          stale: true
        };
      }

      const categories =
        renderSearchCategories(result);

      const total =
        categories.tracks.length +
        categories.artists.length +
        categories.albums.length +
        categories.playlists.length;

      updateSearchStatus(
        total === 0
          ? "No results found."
          : total +
            (total === 1
              ? " result found."
              : " results found.")
      );

      announce(
        total +
        (total === 1
          ? " search result found."
          : " search results found.")
      );

      return {
        success: true,
        results: categories.tracks,
        categories: categories,
        total: total,
        raw: result
      };
    } catch (error) {
      if (requestId !== state.searchRequestId) {
        return {
          success: false,
          stale: true
        };
      }

      recordError(error, "search");

      updateSearchStatus("Search failed.");

      if (
        ui &&
        typeof ui.showErrorState === "function"
      ) {
        ui.showErrorState(container, {
          message:
            "Search failed. Please try again.",
          onAction: function () {
            performSearch(
              normalizedQuery,
              settings
            );
          }
        });
      }

      return {
        success: false,
        error: error
      };
    }
  }

  function handleSearchInput(event) {
    const input = event.currentTarget;

    if (!input) return;

    if (state.searchTimer) {
      window.clearTimeout(state.searchTimer);
    }

    const query = input.value;

    state.searchTimer = window.setTimeout(
      function () {
        performSearch(query);
      },
      300
    );
  }

  function bindSearchInputs() {
    const selectors = [
      "#search-input",
      "#music-search",
      "#explore-search-input"
    ];

    const inputs = [];

    selectors.forEach(function (selector) {
      const element = getElement(selector);

      if (element && !inputs.includes(element)) {
        inputs.push(element);
      }
    });

    inputs.forEach(function (input) {
      addHandler(
        input,
        "input",
        handleSearchInput
      );

      const form = input.closest("form");

      if (form) {
        addHandler(form, "submit", function (event) {
          event.preventDefault();

          if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
            state.searchTimer = null;
          }

          performSearch(input.value);
        });
      }
    });
  }

  function bindSearchFilters() {
    const container = getElement("#search-filters");

    if (!container) return;

    addHandler(container, "change", function () {
      const input = findFirstElement([
        "#search-input",
        "#music-search",
        "#explore-search-input"
      ]);

      if (input && input.value.trim()) {
        performSearch(input.value);
      }
    });
  }

  /* =========================================================
     LIBRARY
     ========================================================= */

  function renderLibrarySection(
    selectors,
    tracks,
    options
  ) {
    const container = findFirstElement(selectors);

    if (container) {
      renderTracks(
        container,
        tracks,
        options
      );
    }
  }

  async function loadLibrary() {
    if (!library) return false;

    try {
      const liked =
        typeof library.getLiked === "function"
          ? library.getLiked()
          : [];

      const saved =
        typeof library.getSaved === "function"
          ? library.getSaved()
          : [];

      const history =
        typeof library.getHistory === "function"
          ? library.getHistory()
          : [];

      renderLibrarySection(
        [
          "#liked-tracks",
          "#library-liked",
          "[data-library='liked']"
        ],
        liked,
        {
          showLike: true,
          emptyTitle: "No liked music yet",
          emptyMessage:
            "Like tracks to find them here."
        }
      );

      renderLibrarySection(
        [
          "#saved-tracks",
          "#library-saved",
          "[data-library='saved']"
        ],
        saved,
        {
          showLike: true,
          showSave: true,
          emptyTitle: "No saved tracks yet",
          emptyMessage:
            "Save music to return to it later."
        }
      );

      renderLibrarySection(
        [
          "#listening-history",
          "#library-history",
          "[data-library='history']"
        ],
        history,
        {
          showLike: true,
          emptyTitle:
            "Your listening history is empty",
          emptyMessage:
            "Tracks you play will appear here."
        }
      );

      renderPlaylistCards(
        getElement("#library-playlists"),
        typeof library.getPlaylists === "function"
          ? library.getPlaylists()
          : []
      );

      emitAppEvent("library:rendered", {
        summary:
          typeof library.getSummary === "function"
            ? library.getSummary()
            : null
      });

      return true;
    } catch (error) {
      recordError(error, "load-library");
      return false;
    }
  }

  /* =========================================================
     ARTISTS AND ALBUMS
     ========================================================= */

  function renderSimpleEntityCards(
    container,
    items,
    type
  ) {
    if (!container) return;

    container.replaceChildren();

    const list = normalizeList(items);

    if (!list.length) {
      if (
        ui &&
        typeof ui.showEmpty === "function"
      ) {
        ui.showEmpty(container, {
          icon: type === "artist" ? "♫" : "◉",
          title: "Nothing to show yet",
          message:
            "This section will populate when catalogue data is available."
        });
      } else {
        const message = document.createElement("p");

        message.textContent = "Nothing to show yet.";

        container.appendChild(message);
      }

      return;
    }

    const fragment =
      document.createDocumentFragment();

    list.forEach(function (item) {
      if (!item || typeof item !== "object") {
        return;
      }

      const card = document.createElement("article");

      card.className = "resona-entity-card";

      const image = document.createElement("img");

      image.loading = "lazy";
      image.alt = String(
        item.name || item.title || type
      );

      const artwork =
        item.image ||
        item.image_url ||
        item.artwork ||
        item.cover ||
        item.cover_url ||
        "";

      if (
        ui &&
        typeof ui.setSafeImage === "function"
      ) {
        ui.setSafeImage(image, artwork);
      } else if (artwork) {
        image.src = artwork;
      }

      const title = document.createElement("h3");

      title.textContent = String(
        item.name ||
        item.title ||
        "Unknown " + type
      );

      card.appendChild(image);
      card.appendChild(title);

      if (item.description || item.bio) {
        const description =
          document.createElement("p");

        description.textContent = String(
          item.description || item.bio
        );

        card.appendChild(description);
      }

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  async function loadArtists() {
    const container = findFirstElement([
      "#artists-list",
      "#artists-grid",
      "[data-section='artists']"
    ]);

    if (!container) return false;

    try {
      const artists = await callDiscovery(
        "getArtists"
      );

      renderSimpleEntityCards(
        container,
        artists,
        "artist"
      );

      return true;
    } catch (error) {
      recordError(error, "artists");
      return false;
    }
  }

  async function loadAlbums() {
    const container = findFirstElement([
      "#albums-list",
      "#albums-grid",
      "[data-section='albums']"
    ]);

    if (!container) return false;

    try {
      const albums = await callDiscovery(
        "getAlbums"
      );

      renderSimpleEntityCards(
        container,
        albums,
        "album"
      );

      return true;
    } catch (error) {
      recordError(error, "albums");
      return false;
    }
  }

  /* =========================================================
     PLAYLISTS
     ========================================================= */

  function renderPlaylistCards(container, playlists) {
    if (!container) return;

    container.replaceChildren();

    const list = normalizeList(playlists);

    if (!list.length) {
      if (
        ui &&
        typeof ui.showEmpty === "function"
      ) {
        ui.showEmpty(container, {
          icon: "♫",
          title: "No playlists yet",
          message:
            "Your playlists will appear here when you create them."
        });
      } else {
        const message = document.createElement("p");

        message.textContent = "No playlists yet.";

        container.appendChild(message);
      }

      return;
    }

    const fragment =
      document.createDocumentFragment();

    list.forEach(function (playlist) {
      if (!playlist || typeof playlist !== "object") {
        return;
      }

      const card = document.createElement("article");

      card.className = "resona-playlist-card";

      const title = document.createElement("h3");

      title.textContent = String(
        playlist.name || "Untitled playlist"
      );

      const ids = Array.isArray(playlist.trackIds)
        ? playlist.trackIds
        : Array.isArray(playlist.track_ids)
          ? playlist.track_ids
          : [];

      const description = document.createElement("p");

      description.textContent =
        playlist.description ||
        ids.length + " tracks";

      const openButton =
        document.createElement("button");

      openButton.type = "button";
      openButton.textContent = "View playlist";

      openButton.addEventListener(
        "click",
        function () {
          openPlaylist(
            playlist.id ||
            playlist.playlist_id
          );
        }
      );

      card.appendChild(title);
      card.appendChild(description);
      card.appendChild(openButton);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  async function loadPlaylists() {
    if (
      !library ||
      typeof library.getPlaylists !== "function"
    ) {
      return false;
    }

    try {
      const playlists = library.getPlaylists();

      renderPlaylistCards(
        getElement("#playlists-list") ||
        getElement("#playlists-grid"),
        playlists
      );

      renderPlaylistCards(
        getElement("#library-playlists"),
        playlists
      );

      return true;
    } catch (error) {
      recordError(error, "load-playlists");
      return false;
    }
  }

  function openPlaylist(playlistId) {
    if (
      !library ||
      typeof library.getPlaylistTracks !== "function"
    ) {
      notify(
        "Playlist access is unavailable.",
        "error"
      );

      return [];
    }

    try {
      const tracks =
        library.getPlaylistTracks(playlistId);

      if (!Array.isArray(tracks) || !tracks.length) {
        notify(
          "This playlist has no available tracks.",
          "info"
        );

        return [];
      }

      const container = findFirstElement([
        "#playlist-tracks",
        "#playlist-detail-tracks",
        "#library-playlist-tracks"
      ]);

      if (container) {
        renderTracks(container, tracks, {
          showLike: true,
          emptyTitle: "Playlist is empty"
        });
      }

      emitAppEvent("playlist:opened", {
        playlistId: playlistId,
        tracks: tracks
      });

      return tracks;
    } catch (error) {
      recordError(error, "open-playlist");
      return [];
    }
  }

  /* =========================================================
     PLAYER STATE AND NOW PLAYING
     ========================================================= */

  function getPlayerState() {
    if (
      !player ||
      typeof player.getState !== "function"
    ) {
      return {};
    }

    try {
      return player.getState() || {};
    } catch (error) {
      recordError(error, "player-state");
      return {};
    }
  }

  function formatTime(seconds) {
    const value = Number(seconds);

    if (
      !Number.isFinite(value) ||
      value < 0
    ) {
      return "0:00";
    }

    const total = Math.floor(value);
    const minutes = Math.floor(total / 60);
    const remaining = total % 60;

    return (
      minutes +
      ":" +
      String(remaining).padStart(2, "0")
    );
  }

  function openNowPlaying() {
    const overlay = getElement("#now-playing");

    if (!overlay) return false;

    const current =
      getPlayerState().currentTrack ||
      state.currentTrack;

    if (current) {
      state.currentTrack = current;
      updateNowPlaying(current);
    }

    overlay.hidden = false;

    overlay.setAttribute(
      "aria-hidden",
      "false"
    );

    overlay.classList.add(
      "active",
      "is-open"
    );

    const closeButton =
      getElement("#now-playing-close");

    if (
      closeButton &&
      typeof closeButton.focus === "function"
    ) {
      closeButton.focus();
    }

    return true;
  }

  function closeNowPlaying() {
    const overlay = getElement("#now-playing");

    if (!overlay) return false;

    overlay.hidden = true;

    overlay.setAttribute(
      "aria-hidden",
      "true"
    );

    overlay.classList.remove(
      "active",
      "is-open"
    );

    return true;
  }

  function updatePlaybackButtons(isPlaying) {
    const buttons = [
      getElement("#mini-player-toggle"),
      getElement("#player-toggle")
    ].filter(Boolean);

    buttons.forEach(function (button) {
      button.setAttribute(
        "aria-label",
        isPlaying ? "Pause" : "Play"
      );

      button.setAttribute(
        "aria-pressed",
        isPlaying ? "true" : "false"
      );

      const icon = button.querySelector(
        "[data-play-icon]"
      );

      if (icon) {
        icon.textContent = isPlaying ? "Ⅱ" : "▶";
      }
    });
  }

  function updateNowPlaying(track) {
    if (!track) return;

    state.currentTrack = track;

    const title = getTrackTitle(track);
    const artist = getArtistName(track);
    const artwork = getArtwork(track);

    const titleTargets = [
      "#mini-player-title",
      "#player-title",
      "#now-playing-title"
    ];

    const artistTargets = [
      "#mini-player-artist",
      "#player-artist",
      "#now-playing-artist"
    ];

    titleTargets.forEach(function (selector) {
      const element = getElement(selector);

      if (element) {
        element.textContent = title;
      }
    });

    artistTargets.forEach(function (selector) {
      const element = getElement(selector);

      if (element) {
        element.textContent = artist;
      }
    });

    const cover = getElement("#now-playing-cover");

    if (cover) {
      if (artwork) {
        cover.src = artwork;
      } else {
        cover.removeAttribute("src");
      }

      cover.alt = title + " artwork";
    }

    const miniPlayer = getElement("#mini-player");

    if (miniPlayer) {
      miniPlayer.hidden = false;

      miniPlayer.classList.add(
        "active",
        "is-visible"
      );

      miniPlayer.setAttribute(
        "aria-hidden",
        "false"
      );
    }

    const message = getElement("#player-message");

    if (message) {
      message.textContent = "";
    }
  }

  function updatePlaybackProgress(detail) {
    detail = detail || {};

    const playerState =
      detail.player || getPlayerState();

    let currentTime = Number(
      detail.currentTime !== undefined
        ? detail.currentTime
        : playerState.currentTime
    );

    let duration = Number(
      detail.duration !== undefined
        ? detail.duration
        : playerState.duration
    );

    if (
      !Number.isFinite(currentTime) ||
      currentTime < 0
    ) {
      currentTime = 0;
    }

    if (
      !Number.isFinite(duration) ||
      duration < 0
    ) {
      duration = 0;
    }

    const progress = duration > 0
      ? Math.min(
          1,
          Math.max(0, currentTime / duration)
        )
      : 0;

    const fill = getElement(
      "#player-progress-fill"
    );

    if (fill) {
      fill.style.width =
        progress * 100 + "%";
    }

    const currentLabel = getElement(
      "#player-current-time"
    );

    const durationLabel = getElement(
      "#player-duration"
    );

    if (currentLabel) {
      currentLabel.textContent =
        formatTime(currentTime);
    }

    if (durationLabel) {
      durationLabel.textContent =
        formatTime(duration);
    }

    const progressTrack = getElement(
      "#player-progress-track"
    );

    if (progressTrack) {
      progressTrack.setAttribute(
        "aria-valuemin",
        "0"
      );

      progressTrack.setAttribute(
        "aria-valuemax",
        "100"
      );

      progressTrack.setAttribute(
        "aria-valuenow",
        String(Math.round(progress * 100))
      );

      progressTrack.setAttribute(
        "aria-valuetext",
        formatTime(currentTime) +
        " of " +
        formatTime(duration)
      );
    }
  }

  /* =========================================================
     PLAYER CONTROLS
     ========================================================= */

  async function seekFromProgress(event) {
    if (!player) return false;

    const progressTrack = getElement(
      "#player-progress-track"
    );

    if (!progressTrack) return false;

    const playerState = getPlayerState();
    const duration = Number(playerState.duration);

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return false;
    }

    const bounds =
      progressTrack.getBoundingClientRect();

    if (!bounds.width) return false;

    const position = event.clientX - bounds.left;

    const fraction = Math.min(
      1,
      Math.max(0, position / bounds.width)
    );

    try {
      if (
        typeof player.seekToProgress === "function"
      ) {
        await player.seekToProgress(fraction);
      } else if (
        typeof player.seek === "function"
      ) {
        await player.seek(fraction * duration);
      } else {
        return false;
      }

      return true;
    } catch (error) {
      recordError(error, "player-seek");

      notify(
        "Unable to seek in this track.",
        "error"
      );

      return false;
    }
  }

  async function togglePlayback() {
    if (!player) {
      notify(
        "The player is unavailable.",
        "error"
      );

      return false;
    }

    try {
      if (
        typeof player.togglePlayback === "function"
      ) {
        return await player.togglePlayback();
      }

      const current = getPlayerState();

      if (
        current.playing &&
        typeof player.pause === "function"
      ) {
        return await player.pause();
      }

      if (typeof player.resume === "function") {
        return await player.resume();
      }

      return false;
    } catch (error) {
      recordError(error, "player-toggle");

      notify(
        "Playback could not be changed.",
        "error"
      );

      return false;
    }
  }

  async function playNext() {
    if (!player) return false;

    try {
      if (typeof player.playNext === "function") {
        return await player.playNext();
      }

      if (typeof player.next === "function") {
        return await player.next();
      }
    } catch (error) {
      recordError(error, "player-next");

      notify(
        "Could not play the next track.",
        "error"
      );
    }

    return false;
  }

  async function playPrevious() {
    if (!player) return false;

    try {
      if (
        typeof player.playPrevious === "function"
      ) {
        return await player.playPrevious();
      }

      if (typeof player.previous === "function") {
        return await player.previous();
      }
    } catch (error) {
      recordError(error, "player-previous");

      notify(
        "Could not play the previous track.",
        "error"
      );
    }

    return false;
  }

  /* =========================================================
     PLAY TRACK
     ========================================================= */

  async function playTrack(track, options) {
    if (
      !player ||
      typeof player.playTrack !== "function"
    ) {
      notify(
        "The music player is unavailable.",
        "error"
      );

      return false;
    }

    if (!track || !getTrackId(track)) {
      notify(
        "This track is missing valid track information.",
        "error"
      );

      return false;
    }

    try {
      const result = await player.playTrack(
        track,
        options || {}
      );

      if (result !== true) {
        return false;
      }

      state.currentTrack = track;

      updateNowPlaying(track);

      if (
        library &&
        typeof library.addHistory === "function"
      ) {
        try {
          library.addHistory(track);
        } catch (historyError) {
          recordError(
            historyError,
            "history-add"
          );
        }
      }

      emitAppEvent("track:played", {
        track: track
      });

      return true;
    } catch (error) {
      recordError(error, "play-track");

      const message = error && error.message
        ? error.message
        : "Playback failed.";

      notify(message, "error");

      const playerMessage =
        getElement("#player-message");

      if (playerMessage) {
        playerMessage.textContent = message;
      }

      return false;
    }
  }

  async function playTrackById(trackId) {
    const id = String(trackId || "").trim();

    if (!id) return false;

    const collections = [];

    if (library) {
      if (typeof library.getLiked === "function") {
        collections.push(library.getLiked());
      }

      if (typeof library.getSaved === "function") {
        collections.push(library.getSaved());
      }

      if (typeof library.getHistory === "function") {
        collections.push(library.getHistory());
      }
    }

    if (
      discovery &&
      typeof discovery.getTracks === "function"
    ) {
      collections.push(discovery.getTracks());
    }

    for (const collection of collections) {
      if (!Array.isArray(collection)) continue;

      const found = collection.find(
        function (track) {
          return getTrackId(track) === id;
        }
      );

      if (found) {
        return playTrack(found);
      }
    }

    if (api && typeof api.getTrack === "function") {
      try {
        const response = await api.getTrack(id);

        const track = response && (
          response.track ||
          response.data ||
          response
        );

        if (track && getTrackId(track)) {
          return playTrack(track);
        }
      } catch (error) {
        recordError(error, "get-track");
      }
    }

    notify(
      "That track could not be found.",
      "error"
    );

    return false;
  }

  /* =========================================================
     PLAYER EVENTS
     ========================================================= */

  function handlePlayerEvent(type, detail) {
    detail = detail || {};

    const playerState =
      detail.player || getPlayerState();

    const track =
      detail.track ||
      detail.currentTrack ||
      playerState.currentTrack ||
      null;

    if (track) {
      state.currentTrack = track;
      updateNowPlaying(track);
    }

    if (type === "play") {
      updatePlaybackButtons(true);
    }

    if (type === "pause" || type === "ended") {
      updatePlaybackButtons(false);
    }

    if (
      type === "timeupdate" ||
      type === "statechange"
    ) {
      updatePlaybackProgress(detail);
    }

    if (type === "statechange") {
      updatePlaybackButtons(
        Boolean(playerState.playing)
      );

      if (!playerState.currentTrack) {
        state.currentTrack = null;

        const miniPlayer =
          getElement("#mini-player");

        if (miniPlayer) {
          miniPlayer.hidden = true;

          miniPlayer.classList.remove(
            "active",
            "is-visible"
          );

          miniPlayer.setAttribute(
            "aria-hidden",
            "true"
          );
        }
      }
    }

    if (type === "error") {
      const errorMessage =
        detail.message ||
        (
          detail.error &&
          detail.error.message
        ) ||
        (
          playerState.lastError &&
          playerState.lastError.message
        ) ||
        "A playback error occurred.";

      const message =
        getElement("#player-message");

      if (message) {
        message.textContent = errorMessage;
      }

      notify(errorMessage, "error");

      updatePlaybackButtons(false);
    }

    if (type === "buffering") {
      const message =
        getElement("#player-message");

      if (message) {
        message.textContent = "Buffering…";
      }
    }

    if (type === "play" || type === "pause") {
      const message =
        getElement("#player-message");

      if (message) {
        message.textContent = "";
      }
    }

    emitAppEvent("player:" + type, detail);
  }

  function bindPlayerEvents() {
    if (
      !player ||
      typeof player.on !== "function"
    ) {
      return;
    }

    const events = player.EVENTS || {};

    const bindings = [
      [events.TRACK_CHANGE, "trackchange"],
      [events.PLAY, "play"],
      [events.PAUSE, "pause"],
      [events.ENDED, "ended"],
      [events.TIME_UPDATE, "timeupdate"],
      [events.VOLUME_CHANGE, "volumechange"],
      [events.ERROR, "error"],
      [events.STATE_CHANGE, "statechange"],
      [events.BUFFERING, "buffering"]
    ];

    bindings.forEach(function (binding) {
      const eventName = binding[0];
      const shortName = binding[1];

      if (!eventName) return;

      const callback = function (detail) {
        handlePlayerEvent(shortName, detail);
      };

      try {
        const unsubscribe = player.on(
          eventName,
          callback
        );

        if (typeof unsubscribe === "function") {
          addUnsubscriber(unsubscribe);
        } else if (
          typeof player.off === "function"
        ) {
          addUnsubscriber(function () {
            player.off(eventName, callback);
          });
        }
      } catch (error) {
        recordError(
          error,
          "player-event-" + shortName
        );
      }
    });
  }

  /* =========================================================
     PLAYER CONTROL BINDINGS
     ========================================================= */

  function bindPlayerControls() {
    const openButton =
      getElement("#mini-player-open");

    if (openButton) {
      addHandler(
        openButton,
        "click",
        openNowPlaying
      );
    }

    const closeButton =
      getElement("#now-playing-close");

    if (closeButton) {
      addHandler(
        closeButton,
        "click",
        closeNowPlaying
      );
    }

    const toggleButtons = [
      getElement("#mini-player-toggle"),
      getElement("#player-toggle")
    ].filter(Boolean);

    toggleButtons.forEach(function (button) {
      addHandler(
        button,
        "click",
        togglePlayback
      );
    });

    const nextButtons = [
      getElement("#mini-player-next"),
      getElement("#player-next")
    ].filter(Boolean);

    nextButtons.forEach(function (button) {
      addHandler(
        button,
        "click",
        playNext
      );
    });

    const previousButtons = [
      getElement("#mini-player-previous"),
      getElement("#player-previous")
    ].filter(Boolean);

    previousButtons.forEach(function (button) {
      addHandler(
        button,
        "click",
        playPrevious
      );
    });

    const progressTrack = getElement(
      "#player-progress-track"
    );

    if (progressTrack) {
      addHandler(
        progressTrack,
        "click",
        function (event) {
          seekFromProgress(event);
        }
      );

      addHandler(
        progressTrack,
        "keydown",
        function (event) {
          if (
            event.key !== "ArrowLeft" &&
            event.key !== "ArrowRight" &&
            event.key !== "Home" &&
            event.key !== "End"
          ) {
            return;
          }

          event.preventDefault();

          const current = getPlayerState();
          const duration = Number(current.duration);

          if (
            !Number.isFinite(duration) ||
            duration <= 0
          ) {
            return;
          }

          let fraction =
            Number(current.progress) || 0;

          if (event.key === "ArrowLeft") {
            fraction -= 0.05;
          }

          if (event.key === "ArrowRight") {
            fraction += 0.05;
          }

          if (event.key === "Home") {
            fraction = 0;
          }

          if (event.key === "End") {
            fraction = 1;
          }

          fraction = Math.min(
            1,
            Math.max(0, fraction)
          );

          if (
            typeof player.seekToProgress === "function"
          ) {
            player.seekToProgress(fraction);
          } else if (
            typeof player.seek === "function"
          ) {
            player.seek(fraction * duration);
          }
        }
      );
    }

    const overlay = getElement("#now-playing");

    if (overlay) {
      addHandler(
        overlay,
        "click",
        function (event) {
          if (event.target === overlay) {
            closeNowPlaying();
          }
        }
      );
    }
  }

  /* =========================================================
     LIBRARY BACKUP
     ========================================================= */

  function exportLibrary() {
    if (
      !library ||
      typeof library.exportLibrary !== "function"
    ) {
      notify(
        "Library backup is unavailable.",
        "error"
      );

      return false;
    }

    try {
      const exported = library.exportLibrary();

      if (
        exported === null ||
        exported === undefined
      ) {
        notify(
          "There is no library backup to export.",
          "error"
        );

        return false;
      }

      const content =
        typeof exported === "string"
          ? exported
          : JSON.stringify(exported, null, 2);

      if (!content) {
        notify(
          "The library backup is empty.",
          "error"
        );

        return false;
      }

      const blob = new Blob(
        [content],
        {
          type: "application/json;charset=utf-8"
        }
      );

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");

      link.href = url;
      link.download = "resona-library-backup.json";
      link.style.display = "none";

      document.body.appendChild(link);

      link.click();
      link.remove();

      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);

      notify(
        "Your library backup is ready.",
        "success"
      );

      return true;
    } catch (error) {
      recordError(error, "library-export");

      notify(
        "Could not export your library.",
        "error"
      );

      return false;
    }
  }

  /* =========================================================
     CONFIRMATION AND LIBRARY ACTIONS
     ========================================================= */

  async function confirmAction(title, message) {
    if (ui && typeof ui.confirm === "function") {
      try {
        return Boolean(
          await ui.confirm({
            title: title,
            message: message,
            confirmText: "Continue",
            cancelText: "Cancel"
          })
        );
      } catch (error) {
        recordError(error, "confirm");
      }
    }

    if (typeof window.confirm === "function") {
      return window.confirm(
        title + "\n\n" + message
      );
    }

    return false;
  }

  async function clearHistory() {
    if (
      !library ||
      typeof library.clearHistory !== "function"
    ) {
      return false;
    }

    const confirmed = await confirmAction(
      "Clear listening history?",
      "This will remove your saved listening history from this device."
    );

    if (!confirmed) return false;

    try {
      library.clearHistory();

      notify(
        "Listening history cleared.",
        "success"
      );

      await loadLibrary();

      return true;
    } catch (error) {
      recordError(error, "clear-history");

      notify(
        "Could not clear listening history.",
        "error"
      );

      return false;
    }
  }

  async function clearLiked() {
    if (
      !library ||
      typeof library.clearLiked !== "function"
    ) {
      return false;
    }

    const confirmed = await confirmAction(
      "Clear liked tracks?",
      "This will remove all liked tracks from your library on this device."
    );

    if (!confirmed) return false;

    try {
      library.clearLiked();

      notify(
        "Liked tracks cleared.",
        "success"
      );

      await loadLibrary();

      return true;
    } catch (error) {
      recordError(error, "clear-liked");

      notify(
        "Could not clear liked tracks.",
        "error"
      );

      return false;
    }
  }

  /* =========================================================
     GLOBAL ACTIONS
     ========================================================= */

  async function handleGlobalAction(action, element) {
    switch (action) {
      case "play":
      case "resume":
        if (
          element &&
          element.dataset.trackId
        ) {
          return playTrackById(
            element.dataset.trackId
          );
        }

        if (
          player &&
          typeof player.resume === "function"
        ) {
          try {
            return await player.resume();
          } catch (error) {
            recordError(error, "player-resume");

            notify(
              "Unable to resume playback.",
              "error"
            );

            return false;
          }
        }

        return false;

      case "pause":
        if (
          player &&
          typeof player.pause === "function"
        ) {
          return player.pause();
        }

        return false;

      case "toggle-playback":
        return togglePlayback();

      case "next":
        return playNext();

      case "previous":
        return playPrevious();

      case "shuffle":
        if (
          player &&
          typeof player.setShuffle === "function"
        ) {
          const current = getPlayerState();

          return player.setShuffle(
            !current.shuffle
          );
        }

        return false;

      case "repeat":
        if (
          player &&
          typeof player.cycleRepeat === "function"
        ) {
          return player.cycleRepeat();
        }

        if (
          player &&
          typeof player.toggleRepeat === "function"
        ) {
          return player.toggleRepeat();
        }

        return false;

      case "clear-history":
        return clearHistory();

      case "clear-liked":
        return clearLiked();

      case "refresh":
        return refresh();

      case "close-now-playing":
        return closeNowPlaying();

      case "open-now-playing":
        return openNowPlaying();

      default:
        return false;
    }
  }

  function bindGlobalActions() {
    addHandler(
      document,
      "click",
      function (event) {
        const target =
          getEventTargetElement(event);

        if (
          !target ||
          typeof target.closest !== "function"
        ) {
          return;
        }

        const actionElement = target.closest(
          "[data-resona-action]"
        );

        if (!actionElement) return;

        const action =
          actionElement.dataset.resonaAction;

        if (!action) return;

        event.preventDefault();

        handleGlobalAction(
          action,
          actionElement
        );
      }
    );

    const exportButton = getElement(
      "#export-library-button"
    );

    if (exportButton) {
      addHandler(
        exportButton,
        "click",
        exportLibrary
      );
    }
  }

  /* =========================================================
     LIBRARY EVENTS
     ========================================================= */

  function bindLibraryEvents() {
    if (
      !library ||
      typeof library.on !== "function"
    ) {
      return;
    }

    const eventNames = [
      "track:liked",
      "track:unliked",
      "track:saved",
      "track:unsaved",
      "history:added",
      "history:cleared",
      "liked:cleared",
      "saved:cleared",
      "playlist:created",
      "playlist:updated",
      "playlist:deleted",
      "imported"
    ];

    eventNames.forEach(function (eventName) {
      const callback = function (detail) {
        emitAppEvent(
          "library:" + eventName,
          detail || {}
        );

        if (
          state.currentPage === "library" ||
          state.currentPage === "playlists"
        ) {
          loadPage(state.currentPage);
        }
      };

      try {
        const unsubscribe = library.on(
          eventName,
          callback
        );

        if (typeof unsubscribe === "function") {
          addUnsubscriber(unsubscribe);
        } else if (
          typeof library.off === "function"
        ) {
          addUnsubscriber(function () {
            library.off(eventName, callback);
          });
        }
      } catch (error) {
        recordError(
          error,
          "library-event-" + eventName
        );
      }
    });
  }

  /* =========================================================
     REFRESH
     ========================================================= */

  async function refresh() {
    try {
      if (
        discovery &&
        typeof discovery.refresh === "function"
      ) {
        await discovery.refresh();
      }

      await loadPage(state.currentPage);

      emitAppEvent("refresh", {
        page: state.currentPage
      });

      return true;
    } catch (error) {
      recordError(error, "refresh");

      notify(
        "Resona could not refresh its content.",
        "error"
      );

      return false;
    }
  }

  /* =========================================================
     INITIAL PAGE
     ========================================================= */

  function getInitialPage() {
    const hash = String(window.location.hash || "")
      .replace(/^#\/?/, "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    return VALID_PAGES.has(hash)
      ? hash
      : "home";
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function init() {
    if (
      state.initialized ||
      state.initializing
    ) {
      return state.initialized;
    }

    state.initializing = true;

    try {
      const validation = validateModules();

      if (!validation.success) {
        notify(
          validation.message,
          "error"
        );

        return false;
      }

      if (ui && typeof ui.init === "function") {
        ui.init();
      }

      if (
        library &&
        typeof library.init === "function"
      ) {
        library.init();
      }

      if (
        search &&
        typeof search.init === "function"
      ) {
        search.init();
      }

      bindNavigation();
      bindSearchInputs();
      bindSearchFilters();
      bindGlobalActions();
      bindPlayerControls();
      bindPlayerEvents();
      bindLibraryEvents();

      if (
        player &&
        typeof player.init === "function"
      ) {
        try {
          await player.init();
        } catch (error) {
          recordError(
            error,
            "player-initialization"
          );
        }
      }

      if (
        discovery &&
        typeof discovery.refresh === "function"
      ) {
        try {
          await discovery.refresh();
        } catch (error) {
          recordError(
            error,
            "initial-discovery-refresh"
          );
        }
      }

      state.initialized = true;

      const initialPage = getInitialPage();

      await navigate(
        initialPage,
        {
          updateHistory: false,
          force: true
        }
      );

      const playerState = getPlayerState();

      if (playerState.currentTrack) {
        state.currentTrack =
          playerState.currentTrack;

        updateNowPlaying(
          playerState.currentTrack
        );
      }

      updatePlaybackButtons(
        Boolean(playerState.playing)
      );

      updatePlaybackProgress({
        player: playerState,
        currentTime: playerState.currentTime,
        duration: playerState.duration
      });

      emitAppEvent("ready", {
        version: VERSION,
        page: state.currentPage
      });

      log(
        "Initialized successfully. Version:",
        VERSION
      );

      return true;
    } catch (error) {
      recordError(error, "init");

      notify(
        "Resona could not initialize completely.",
        "error"
      );

      return false;
    } finally {
      state.initializing = false;
    }
  }

  /* =========================================================
     CLEANUP
     ========================================================= */

  function destroy() {
    state.cleanup.forEach(function (cleanup) {
      try {
        cleanup();
      } catch (error) {
        recordError(error, "cleanup");
      }
    });

    state.cleanup = [];

    state.unsubscribers.forEach(
      function (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          recordError(error, "unsubscribe");
        }
      }
    );

    state.unsubscribers = [];

    if (state.searchTimer) {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }

    state.searchRequestId += 1;

    state.initialized = false;
    state.initializing = false;

    emitAppEvent("destroy", {});

    return true;
  }

  /* =========================================================
     PUBLIC APP API
     ========================================================= */

  function getState() {
    return {
      version: VERSION,
      initialized: state.initialized,
      initializing: state.initializing,
      currentPage: state.currentPage,
      lastPage: state.lastPage,
      currentTrack: state.currentTrack,
      activeSearch: state.activeSearch,
      searchRequestId: state.searchRequestId,
      errors: state.errors.slice()
    };
  }

  function getErrors() {
    return state.errors.slice();
  }

  function clearErrors() {
    state.errors = [];
    return true;
  }

  const ResonaApp = {
    version: VERSION,

    init: init,
    destroy: destroy,
    refresh: refresh,

    navigate: navigate,
    getCurrentPage: function () {
      return state.currentPage;
    },

    loadPage: loadPage,
    loadHome: loadHome,
    loadExplore: loadExplore,
    loadLibrary: loadLibrary,
    loadArtists: loadArtists,
    loadAlbums: loadAlbums,
    loadPlaylists: loadPlaylists,

    performSearch: performSearch,

    playTrack: playTrack,
    playTrackById: playTrackById,
    playNext: playNext,
    playPrevious: playPrevious,
    togglePlayback: togglePlayback,

    openPlaylist: openPlaylist,

    openNowPlaying: openNowPlaying,
    closeNowPlaying: closeNowPlaying,

    renderTracks: renderTracks,
    createTrackCard: createTrackCard,

    exportLibrary: exportLibrary,
    clearHistory: clearHistory,
    clearLiked: clearLiked,

    getState: getState,
    getErrors: getErrors,
    clearErrors: clearErrors
  };

  window.ResonaApp = ResonaApp;

  /* =========================================================
     AUTO START
     ========================================================= */

  function startApp() {
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startApp,
      { once: true }
    );
  } else {
    startApp();
  }

})(window, document);
