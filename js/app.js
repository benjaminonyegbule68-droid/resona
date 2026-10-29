/* =========================================================
   RESONA — APPLICATION ENTRY POINT
   File: js/app.js
   Version: 2.0.0

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

  const APP_VERSION = "2.0.0";

  const state = {
    initialized: false,
    initializing: false,
    currentPage: "home",
    lastPage: "home",
    isLoading: false,
    activeSearch: "",
    searchTimer: null,
    searchRequestId: 0,
    errors: [],
    destroyHandlers: []
  };

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
    "now-playing",
    "artists",
    "albums",
    "playlists",
    "settings"
  ]);

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

  function getModule(name) {
    return window[name] || null;
  }

  function getAPI() {
    return getModule("ResonaAPI");
  }

  function getPlayer() {
    return getModule("ResonaPlayer");
  }

  function getDiscovery() {
    return getModule("ResonaDiscovery");
  }

  function getSearch() {
    return getModule("ResonaSearch");
  }

  function getLibrary() {
    return getModule("ResonaLibrary");
  }

  function getUI() {
    return getModule("ResonaUI");
  }

  function missingModules() {
    return MODULES.filter(function (name) {
      return !getModule(name);
    });
  }

  /*
   * Correctly searches inside the requested root element.
   */
  function getElement(selector, root) {
    const scope = root || document;

    if (!scope || typeof scope.querySelector !== "function") {
      return null;
    }

    try {
      return scope.querySelector(selector);
    } catch (error) {
      warn("Invalid element selector:", selector, error);
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
      warn("Invalid element selector:", selector, error);
      return [];
    }
  }

  function escapeHTML(value) {
    const ui = getUI();

    if (ui && typeof ui.escapeHTML === "function") {
      return ui.escapeHTML(value);
    }

    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      function (character) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[character];
      }
    );
  }

  function announce(message, options) {
    const ui = getUI();

    if (ui && typeof ui.announce === "function") {
      try {
        ui.announce(message, options);
      } catch (error) {
        warn("Announcement failed.", error);
      }
    }
  }

  function notify(message, type) {
    const ui = getUI();

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
      ui[method](message);
      return;
    }

    if (typeof ui.toast === "function") {
      ui.toast(message);
      return;
    }

    log(message);
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
      return typeof callback === "function"
        ? callback()
        : fallback;
    } catch (error) {
      recordError(error);
      return fallback;
    }
  }

  function addHandler(target, eventName, callback, options) {
    if (!target || typeof target.addEventListener !== "function") {
      return function () {};
    }

    target.addEventListener(eventName, callback, options);

    let active = true;

    const cleanup = function () {
      if (!active) {
        return;
      }

      active = false;

      target.removeEventListener(
        eventName,
        callback,
        options
      );
    };

    state.destroyHandlers.push(cleanup);

    return cleanup;
  }

  function emitAppEvent(name, detail) {
    try {
      window.dispatchEvent(
        new CustomEvent("resona:app:" + name, {
          detail: detail === undefined ? null : detail
        })
      );
    } catch (error) {
      warn("Could not dispatch application event:", name);
    }
  }

  function getTrackId(track) {
    const ui = getUI();

    if (ui && typeof ui.getTrackId === "function") {
      return String(ui.getTrackId(track) || "").trim();
    }

    if (!track || typeof track !== "object") {
      return "";
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
    const ui = getUI();

    if (ui && typeof ui.getTrackTitle === "function") {
      return ui.getTrackTitle(track);
    }

    return String(
      track && (track.title || track.name) ||
      "Untitled track"
    );
  }

  function getArtistName(track) {
    const ui = getUI();

    if (ui && typeof ui.getArtistName === "function") {
      return ui.getArtistName(track);
    }

    if (!track || typeof track !== "object") {
      return "Unknown artist";
    }

    const artist = track.artistName ||
      track.artist_name ||
      track.artist;

    if (typeof artist === "string") {
      return artist;
    }

    if (artist && typeof artist === "object") {
      return String(artist.name || "Unknown artist");
    }

    return "Unknown artist";
  }

  function getArtwork(track) {
    const ui = getUI();

    if (ui && typeof ui.getTrackArtwork === "function") {
      return ui.getTrackArtwork(track);
    }

    return track && (
      track.artwork ||
      track.cover ||
      track.cover_url ||
      track.image_url ||
      track.image ||
      ""
    );
  }

  function getTrackDuration(track) {
    if (!track) {
      return "0:00";
    }

    const duration = Number(
      track.duration_seconds ??
      track.durationSeconds ??
      track.duration ??
      0
    );

    const ui = getUI();

    if (ui && typeof ui.formatDuration === "function") {
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

  function normalizeList(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (!value || typeof value !== "object") {
      return [];
    }

    if (Array.isArray(value.items)) {
      return value.items;
    }

    if (Array.isArray(value.results)) {
      return value.results;
    }

    if (Array.isArray(value.tracks)) {
      return value.tracks;
    }

    if (Array.isArray(value.data)) {
      return value.data;
    }

    return [];
  }

  function getLibraryMethod(method, fallback) {
    const library = getLibrary();

    if (!library || typeof library[method] !== "function") {
      return fallback;
    }

    try {
      return library[method]();
    } catch (error) {
      recordError(error, "library:" + method);
      return fallback;
    }
  }

  /* =========================================================
     MODULE VALIDATION
     ========================================================= */

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
     NAVIGATION
     ========================================================= */

  function normalizePage(page) {
    const normalized = String(page || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    return VALID_PAGES.has(normalized)
      ? normalized
      : "home";
  }

  function getPageElement(page) {
    const selectors = [
      '[data-page="' + page + '"]',
      "#" + page + "-page",
      "#" + page
    ];

    for (const selector of selectors) {
      const element = getElement(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }

  function getAllPageElements() {
    const declared = getElements("[data-page]");

    if (declared.length) {
      return declared;
    }

    return getElements(
      '[id$="-page"], main > section[id]'
    );
  }

  function setPageVisibility(page) {
    const normalized = normalizePage(page);
    const pages = getAllPageElements();

    let matched = false;

    pages.forEach(function (element) {
      const inferredName = element.dataset.page ||
        element.id.replace(/-page$/, "");

      const visible = normalizePage(inferredName) === normalized;

      element.hidden = !visible;

      element.setAttribute(
        "aria-hidden",
        visible ? "false" : "true"
      );

      element.classList.toggle("is-active", visible);
      element.classList.toggle("active", visible);

      if (visible) {
        matched = true;
      }
    });

    /*
     * If the HTML uses a single page container rather than
     * multiple page sections, don't hide unrelated content.
     */
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
        (
          element.getAttribute("href") || ""
        ).replace(/^#/, "");

      const active = normalizePage(destination) === page;

      element.classList.toggle("is-active", active);
      element.classList.toggle("active", active);

      if (active) {
        element.setAttribute("aria-current", "page");
      } else {
        element.removeAttribute("aria-current");
      }
    });
  }

  function navigate(page, options) {
    const settings = options || {};
    const normalized = normalizePage(page);

    if (normalized === state.currentPage && !settings.force) {
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

        window.history.replaceState(
          { resonaPage: normalized },
          "",
          url
        );
      } catch (error) {
        warn("Could not update navigation history.", error);
      }
    }

    emitAppEvent("page:changed", {
      previous: previous,
      current: normalized
    });

    announce(
      "Opened " + normalized.replace(/-/g, " ") + " page."
    );

    Promise.resolve(loadPage(normalized)).catch(function (error) {
      recordError(error, "page-loading:" + normalized);
    });

    if (!pageFound) {
      warn("No matching page element was found for:", normalized);
    }

    return {
      success: true,
      page: normalized,
      elementFound: pageFound
    };
  }

  function handleNavigationClick(event) {
    const target = event.target;

    if (!target || typeof target.closest !== "function") {
      return;
    }

    const link = target.closest(
      "[data-navigate], [data-page-link], a[href^='#']"
    );

    if (!link) {
      return;
    }

    const destination =
      link.dataset.navigate ||
      link.dataset.pageLink ||
      (link.getAttribute("href") || "").replace(/^#/, "");

    if (!destination) {
      return;
    }

    const normalized = String(destination)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    if (!VALID_PAGES.has(normalized)) {
      return;
    }

    event.preventDefault();
    navigate(normalized);
  }

  function handleHashChange() {
    const page = normalizePage(
      window.location.hash.replace(/^#/, "") || "home"
    );

    navigate(page, {
      updateHistory: false,
      force: true
    });
  }

  /* =========================================================
     DISCOVERY ACCESS
     ========================================================= */

  function callDiscovery(method, options) {
    const discovery = getDiscovery();

    if (!discovery || typeof discovery[method] !== "function") {
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
     TRACK RENDERING
     ========================================================= */

  function createFallbackTrackCard(track, options) {
    const settings = options || {};

    const card = document.createElement("article");

    card.className = "resona-track-card";

    const trackId = getTrackId(track);

    card.dataset.trackId = trackId;

    const artworkButton = document.createElement("button");

    artworkButton.type = "button";
    artworkButton.className = "resona-track-card__artwork-button";

    artworkButton.setAttribute(
      "aria-label",
      "Play " + getTrackTitle(track)
    );

    const image = document.createElement("img");

    image.className = "resona-track-card__artwork";
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

    artworkButton.addEventListener("click", function () {
      playTrack(track);
    });

    card.appendChild(artworkButton);

    const title = document.createElement("h3");

    title.className = "resona-track-card__title";
    title.textContent = getTrackTitle(track);

    const artist = document.createElement("p");

    artist.className = "resona-track-card__artist";
    artist.textContent = getArtistName(track);

    const duration = document.createElement("span");

    duration.className = "resona-track-card__duration";
    duration.textContent = getTrackDuration(track);

    card.appendChild(title);
    card.appendChild(artist);
    card.appendChild(duration);

    if (settings.showLike !== false) {
      const like = document.createElement("button");

      like.type = "button";
      like.className = "resona-track-card__like";

      const library = getLibrary();

      const liked = Boolean(
        library &&
        typeof library.isLiked === "function" &&
        library.isLiked(trackId)
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
        if (!library || typeof library.toggleLike !== "function") {
          notify("Your library is unavailable.", "error");
          return;
        }

        try {
          const result = library.toggleLike(track);

          if (!result || result.success === false) {
            notify("Unable to update your liked tracks.", "error");
            return;
          }

          const nowLiked = Boolean(result.liked);

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
          notify("Unable to update your liked tracks.", "error");
        }
      });

      card.appendChild(like);
    }

    return card;
  }

  function createTrackCard(track, options) {
    const ui = getUI();

    if (ui && typeof ui.renderTrackCard === "function") {
      return ui.renderTrackCard(
        track,
        Object.assign(
          { onPlay: playTrack },
          options || {}
        )
      );
    }

    return createFallbackTrackCard(track, options);
  }

  function renderTracks(container, tracks, options) {
    const element = typeof container === "string"
      ? getElement(container)
      : container;

    if (!element) {
      return false;
    }

    const list = normalizeList(tracks);
    const settings = options || {};

    element.replaceChildren();

    if (!list.length) {
      const ui = getUI();

      if (ui && typeof ui.showEmpty === "function") {
        ui.showEmpty(element, {
          icon: settings.emptyIcon || "♫",
          title: settings.emptyTitle || "No music available yet",
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

      if (card) {
        fragment.appendChild(card);
      }
    });

    element.appendChild(fragment);

    return true;
  }

  function findFirstElement(selectors) {
    for (const selector of selectors) {
      const element = getElement(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }

  /* =========================================================
     HOME PAGE
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
      const container = findFirstElement(section.selectors);

      if (!container) {
        return;
      }

      const ui = getUI();

      if (ui && typeof ui.showLoading === "function") {
        ui.showLoading(container, {
          message: "Loading " + section.title.toLowerCase() + "..."
        });
      }

      try {
        const tracks = await callDiscovery(section.method);

        renderTracks(container, tracks, {
          showLike: true,
          emptyTitle: "No " + section.title.toLowerCase() + " yet"
        });
      } catch (error) {
        recordError(error, "home:" + section.name);

        if (ui && typeof ui.showErrorState === "function") {
          ui.showErrorState(container, {
            message: "We couldn't load this section. Please try again.",
            onAction: function () {
              loadHome();
            }
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
        const library = getLibrary();

        const recent = library &&
          typeof library.getRecentlyPlayed === "function"
          ? library.getRecentlyPlayed(12)
          : [];

        renderTracks(recentContainer, recent, {
          showLike: true,
          emptyTitle: "Nothing played yet",
          emptyMessage: "Tracks you play will appear here."
        });
      } catch (error) {
        recordError(error, "home:recently-played");
      }
    }

    await Promise.allSettled(jobs);
  }

  /* =========================================================
     EXPLORE PAGE
     ========================================================= */

  async function loadExplore() {
    const container = findFirstElement([
      "#explore-tracks",
      "#explore-results",
      "[data-section='explore-tracks']"
    ]);

    if (!container) {
      return;
    }

    const ui = getUI();

    if (ui && typeof ui.showLoading === "function") {
      ui.showLoading(container, {
        message: "Discovering music..."
      });
    }

    try {
      const tracks = await callDiscovery("getTracks");

      renderTracks(container, tracks, {
        showLike: true,
        showSave: true,
        emptyTitle: "Your discovery starts here",
        emptyMessage:
          "When catalogue music is available, it will appear here."
      });
    } catch (error) {
      recordError(error, "explore");

      if (ui && typeof ui.showErrorState === "function") {
        ui.showErrorState(container, {
          message: "We couldn't load Explore.",
          onAction: loadExplore
        });
      }
    }
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  function getSearchInput() {
    return findFirstElement([
      "#search-input",
      "#music-search",
      "[data-resona-search-input]",
      "input[type='search']"
    ]);
  }

  function getSearchResultsContainer() {
    return findFirstElement([
      "#search-results",
      "#music-search-results",
      "[data-section='search-results']"
    ]);
  }

  function normalizeSearchTracks(result) {
    if (Array.isArray(result)) {
      return result;
    }

    if (!result || typeof result !== "object") {
      return [];
    }

    if (Array.isArray(result.tracks)) {
      return result.tracks;
    }

    if (Array.isArray(result.items)) {
      return result.items;
    }

    if (Array.isArray(result.results)) {
      return result.results;
    }

    if (result.data && typeof result.data === "object") {
      return normalizeSearchTracks(result.data);
    }

    return [];
  }

  async function performSearch(query, options) {
    const settings = options || {};
    const normalizedQuery = String(query || "").trim();
    const requestId = ++state.searchRequestId;

    state.activeSearch = normalizedQuery;

    const container = getSearchResultsContainer();

    if (!container) {
      return {
        success: false,
        message: "Search results container was not found."
      };
    }

    if (!normalizedQuery) {
      container.replaceChildren();

      return {
        success: true,
        results: []
      };
    }

    const ui = getUI();

    if (ui && typeof ui.showLoading === "function") {
      ui.showLoading(container, {
        message: "Searching music..."
      });
    }

    try {
      const search = getSearch();
      let result;

      if (search && typeof search.search === "function") {
        /*
         * The options object allows the search module to apply
         * supported filters without changing this coordinator.
         */
        result = await search.search(
          normalizedQuery,
          settings
        );
      } else {
        const api = getAPI();

        if (!api || typeof api.search !== "function") {
          throw new Error("Search module is unavailable.");
        }

        result = await api.search(
          normalizedQuery,
          settings
        );
      }

      if (requestId !== state.searchRequestId) {
        return {
          success: false,
          stale: true
        };
      }

      const tracks = normalizeSearchTracks(result);

      renderTracks(container, tracks, {
        showLike: true,
        showSave: true,
        emptyTitle: "No tracks found",
        emptyMessage:
          "Try another song, artist, album, or genre."
      });

      announce(
        tracks.length +
        (tracks.length === 1
          ? " track found."
          : " tracks found.")
      );

      return {
        success: true,
        results: tracks,
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

      if (ui && typeof ui.showErrorState === "function") {
        ui.showErrorState(container, {
          message: "Search failed. Please try again.",
          onAction: function () {
            performSearch(normalizedQuery, settings);
          }
        });
      }

      return {
        success: false,
        error: error
      };
    }
  }

  function handleSearchInput() {
    const input = getSearchInput();

    if (!input) {
      return;
    }

    clearTimeout(state.searchTimer);

    const query = input.value;

    state.searchTimer = setTimeout(function () {
      performSearch(query);
    }, 300);
  }

  /* =========================================================
     LIBRARY
     ========================================================= */

  function renderLibrarySection(selectors, tracks, options) {
    const container = findFirstElement(selectors);

    if (container) {
      renderTracks(container, tracks, options);
    }
  }

  function loadLibrary() {
    const library = getLibrary();

    if (!library) {
      return;
    }

    const liked = typeof library.getLiked === "function"
      ? library.getLiked()
      : [];

    const saved = typeof library.getSaved === "function"
      ? library.getSaved()
      : [];

    const history = typeof library.getHistory === "function"
      ? library.getHistory({ tracksOnly: true })
      : [];

    renderLibrarySection(
      ["#liked-tracks", "#library-liked", "[data-library='liked']"],
      liked,
      {
        showLike: true,
        emptyTitle: "No liked music yet",
        emptyMessage: "Like tracks to find them here."
      }
    );

    renderLibrarySection(
      ["#saved-tracks", "#library-saved", "[data-library='saved']"],
      saved,
      {
        showLike: true,
        showSave: true,
        emptyTitle: "No saved tracks yet",
        emptyMessage: "Save music to return to it later."
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
        emptyTitle: "Your listening history is empty",
        emptyMessage: "Tracks you play will appear here."
      }
    );

    emitAppEvent("library:rendered", {
      summary: typeof library.getSummary === "function"
        ? library.getSummary()
        : null
    });
  }

  /* =========================================================
     ARTISTS AND ALBUMS
     ========================================================= */

  function renderSimpleEntityCards(container, items, type) {
    container.replaceChildren();

    const list = normalizeList(items);

    if (!list.length) {
      const ui = getUI();

      if (ui && typeof ui.showEmpty === "function") {
        ui.showEmpty(container, {
          icon: type === "artist" ? "♫" : "◉",
          title: "Nothing to show yet",
          message:
            "This section will populate when catalogue data is available."
        });
      }

      return;
    }

    const fragment = document.createDocumentFragment();

    list.forEach(function (item) {
      if (!item || typeof item !== "object") {
        return;
      }

      const card = document.createElement("article");

      card.className = "resona-entity-card";

      const image = document.createElement("img");

      image.loading = "lazy";
      image.alt = String(item.name || item.title || type);

      const artwork =
        item.image ||
        item.image_url ||
        item.artwork ||
        item.cover ||
        item.cover_url ||
        "";

      const ui = getUI();

      if (ui && typeof ui.setSafeImage === "function") {
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
        const description = document.createElement("p");

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

    if (!container) {
      return;
    }

    const ui = getUI();

    if (ui && typeof ui.showLoading === "function") {
      ui.showLoading(container, {
        message: "Loading artists..."
      });
    }

    try {
      const artists = await callDiscovery("getArtists");

      renderSimpleEntityCards(container, artists, "artist");
    } catch (error) {
      recordError(error, "artists");

      if (ui && typeof ui.showErrorState === "function") {
        ui.showErrorState(container, {
          message: "We couldn't load artists.",
          onAction: loadArtists
        });
      }
    }
  }

  async function loadAlbums() {
    const container = findFirstElement([
      "#albums-list",
      "#albums-grid",
      "[data-section='albums']"
    ]);

    if (!container) {
      return;
    }

    const ui = getUI();

    if (ui && typeof ui.showLoading === "function") {
      ui.showLoading(container, {
        message: "Loading albums..."
      });
    }

    try {
      const albums = await callDiscovery("getAlbums");

      renderSimpleEntityCards(container, albums, "album");
    } catch (error) {
      recordError(error, "albums");

      if (ui && typeof ui.showErrorState === "function") {
        ui.showErrorState(container, {
          message: "We couldn't load albums.",
          onAction: loadAlbums
        });
      }
    }
  }

  /* =========================================================
     PLAYBACK
     ========================================================= */

  async function playTrack(track, options) {
    const player = getPlayer();

    if (!player || typeof player.playTrack !== "function") {
      notify("The music player is unavailable.", "error");

      return {
        success: false,
        message: "Player unavailable."
      };
    }

    const id = getTrackId(track);

    if (!id) {
      notify("This track is missing its ID.", "error");

      return {
        success: false,
        message: "Invalid track."
      };
    }

    try {
      const result = await player.playTrack(
        track,
        options || {}
      );

      /*
       * Recognize explicit failure in either common result format.
       */
      if (
        result === false ||
        (
          result &&
          typeof result === "object" &&
          result.success === false
        )
      ) {
        const message = result && result.message
          ? result.message
          : "Unable to play this track.";

        notify(message, "warning");

        return {
          success: false,
          message: message,
          result: result
        };
      }

      const library = getLibrary();

      if (library && typeof library.addHistory === "function") {
        library.addHistory(track);
      }

      emitAppEvent("track:play-requested", {
        trackId: id,
        track: track
      });

      updateNowPlaying(track);

      return {
        success: true,
        track: track,
        result: result
      };
    } catch (error) {
      recordError(error, "playback");

      notify(
        error.message || "Playback failed.",
        "error"
      );

      return {
        success: false,
        error: error
      };
    }
  }

  function updateNowPlaying(track) {
    if (!track) {
      return;
    }

    const title = getTrackTitle(track);
    const artist = getArtistName(track);
    const artwork = getArtwork(track);

    getElements([
      "[data-now-playing-title]",
      "#now-playing-title",
      "#player-track-title"
    ].join(",")).forEach(function (element) {
      element.textContent = title;
    });

    getElements([
      "[data-now-playing-artist]",
      "#now-playing-artist",
      "#player-track-artist"
    ].join(",")).forEach(function (element) {
      element.textContent = artist;
    });

    getElements([
      "[data-now-playing-artwork]",
      "#now-playing-artwork",
      "#player-track-artwork"
    ].join(",")).forEach(function (element) {
      if (element.tagName !== "IMG") {
        return;
      }

      const ui = getUI();

      if (ui && typeof ui.setSafeImage === "function") {
        ui.setSafeImage(element, artwork);
      } else if (artwork) {
        element.src = artwork;
      }
    });
  }

  function bindPlayerEvents() {
    const player = getPlayer();

    if (!player || typeof player.on !== "function") {
      warn("Player event subscription is unavailable.");
      return;
    }

    [
      "trackchange",
      "play",
      "pause",
      "ended",
      "timeupdate",
      "volumechange",
      "error"
    ].forEach(function (eventName) {
      const unsubscribe = player.on(
        eventName,
        function (detail) {
          emitAppEvent("player:" + eventName, detail);

          if (eventName === "trackchange" && detail) {
            updateNowPlaying(detail.track || detail);
          }
        }
      );

      if (typeof unsubscribe === "function") {
        state.destroyHandlers.push(unsubscribe);
      }
    });
  }

  /* =========================================================
     PLAY TRACK BY ID
     ========================================================= */

  async function playTrackById(trackId) {
    const id = String(trackId || "").trim();

    if (!id) {
      return {
        success: false,
        message: "Track ID is required."
      };
    }

    const library = getLibrary();
    const candidates = [];

    if (library) {
      [
        ["getLiked", []],
        ["getSaved", []],
        ["getRecentlyPlayed", [100]]
      ].forEach(function (entry) {
        const method = entry[0];
        const args = entry[1];

        if (typeof library[method] === "function") {
          try {
            const result = library[method].apply(library, args);

            if (Array.isArray(result)) {
              candidates.push.apply(candidates, result);
            }
          } catch (error) {
            recordError(error, "find-local-track:" + method);
          }
        }
      });
    }

    const localTrack = candidates.find(function (track) {
      return getTrackId(track) === id;
    });

    if (localTrack) {
      return playTrack(localTrack);
    }

    const api = getAPI();

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
        recordError(error, "load-track-by-id");
      }
    }

    notify(
      "Track not found. Try opening it from Explore.",
      "warning"
    );

    return {
      success: false,
      message: "Track not found."
    };
  }

  /* =========================================================
     PLAYLISTS
     ========================================================= */

  function loadPlaylists() {
    const library = getLibrary();

    if (!library || typeof library.getPlaylists !== "function") {
      return;
    }

    const container = findFirstElement([
      "#playlists-list",
      "#playlists-grid",
      "[data-section='playlists']"
    ]);

    if (!container) {
      return;
    }

    let playlists;

    try {
      playlists = library.getPlaylists();
    } catch (error) {
      recordError(error, "load-playlists");
      return;
    }

    container.replaceChildren();

    if (!Array.isArray(playlists) || !playlists.length) {
      const ui = getUI();

      if (ui && typeof ui.showEmpty === "function") {
        ui.showEmpty(container, {
          icon: "♫",
          title: "No playlists yet",
          message: "Your playlists will appear here when you create them."
        });
      }

      return;
    }

    const fragment = document.createDocumentFragment();

    playlists.forEach(function (playlist) {
      if (!playlist || typeof playlist !== "object") {
        return;
      }

      const card = document.createElement("article");

      card.className = "resona-playlist-card";

      const title = document.createElement("h3");

      title.textContent = String(playlist.name || "Untitled playlist");

      const description = document.createElement("p");

      const trackIds = Array.isArray(playlist.trackIds)
        ? playlist.trackIds
        : Array.isArray(playlist.track_ids)
          ? playlist.track_ids
          : [];

      description.textContent =
        playlist.description ||
        trackIds.length + " tracks";

      card.appendChild(title);
      card.appendChild(description);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  /* =========================================================
     PAGE LOADING
     ========================================================= */

  async function loadPage(page) {
    switch (normalizePage(page)) {
      case "home":
        return loadHome();

      case "explore":
        return loadExplore();

      case "search":
        return undefined;

      case "library":
        return loadLibrary();

      case "artists":
        return loadArtists();

      case "albums":
        return loadAlbums();

      case "playlists":
        return loadPlaylists();

      case "now-playing":
      case "settings":
      default:
        return undefined;
    }
  }

  /* =========================================================
     CLEAR LIBRARY ACTIONS
     ========================================================= */

  async function confirmAction(options) {
    const ui = getUI();

    if (ui && typeof ui.confirm === "function") {
      return Boolean(await ui.confirm(options));
    }

    return window.confirm(
      options.message || options.title || "Are you sure?"
    );
  }

  async function clearHistoryWithConfirmation() {
    const library = getLibrary();

    if (!library || typeof library.clearHistory !== "function") {
      notify("Listening history is unavailable.", "error");
      return;
    }

    try {
      const confirmed = await confirmAction({
        title: "Clear listening history?",
        message: "This removes listening history saved in this browser.",
        confirmLabel: "Clear history",
        cancelLabel: "Cancel"
      });

      if (!confirmed) {
        return;
      }

      library.clearHistory();
      loadLibrary();

      notify("Listening history cleared.", "success");
    } catch (error) {
      recordError(error, "clear-history");
      notify("Could not clear listening history.", "error");
    }
  }

  async function clearLikedWithConfirmation() {
    const library = getLibrary();

    if (!library || typeof library.clearLiked !== "function") {
      notify("Liked tracks are unavailable.", "error");
      return;
    }

    try {
      const confirmed = await confirmAction({
        title: "Clear liked tracks?",
        message: "This removes liked tracks saved in this browser.",
        confirmLabel: "Clear liked tracks",
        cancelLabel: "Cancel"
      });

      if (!confirmed) {
        return;
      }

      library.clearLiked();
      loadLibrary();

      notify("Liked tracks cleared.", "success");
    } catch (error) {
      recordError(error, "clear-liked");
      notify("Could not clear liked tracks.", "error");
    }
  }

  /* =========================================================
     EVENT BINDING
     ========================================================= */

  function bindNavigation() {
    addHandler(
      document,
      "click",
      handleNavigationClick
    );

    addHandler(
      window,
      "hashchange",
      handleHashChange
    );
  }

  function bindSearch() {
    const input = getSearchInput();

    if (!input) {
      warn("Search input was not found in the HTML.");
      return;
    }

    addHandler(
      input,
      "input",
      handleSearchInput
    );

    const form = input.closest("form");

    if (form) {
      addHandler(form, "submit", function (event) {
        event.preventDefault();

        clearTimeout(state.searchTimer);

        performSearch(input.value);
      });
    }
  }

  function bindGlobalActions() {
    addHandler(document, "click", function (event) {
      const target = event.target;

      if (!target || typeof target.closest !== "function") {
        return;
      }

      const button = target.closest("[data-resona-action]");

      if (!button) {
        return;
      }

      const player = getPlayer();
      const action = button.dataset.resonaAction;

      switch (action) {
        case "play":
          if (button.dataset.trackId) {
            playTrackById(button.dataset.trackId);
          }
          break;

        case "pause":
          if (player && typeof player.pause === "function") {
            safeCall(function () {
              player.pause();
            });
          }
          break;

        case "resume":
          if (player && typeof player.resume === "function") {
            safeCall(function () {
              player.resume();
            });
          } else if (player && typeof player.play === "function") {
            safeCall(function () {
              player.play();
            });
          }
          break;

        case "next":
          if (player && typeof player.next === "function") {
            safeCall(function () {
              player.next();
            });
          } else if (player && typeof player.playNext === "function") {
            safeCall(function () {
              player.playNext();
            });
          }
          break;

        case "previous":
          if (player && typeof player.previous === "function") {
            safeCall(function () {
              player.previous();
            });
          } else if (player && typeof player.playPrevious === "function") {
            safeCall(function () {
              player.playPrevious();
            });
          }
          break;

        case "shuffle":
          if (player && typeof player.setShuffle === "function") {
            const nextValue =
              button.getAttribute("aria-pressed") !== "true";

            safeCall(function () {
              player.setShuffle(nextValue);
            });

            button.setAttribute(
              "aria-pressed",
              nextValue ? "true" : "false"
            );
          }
          break;

        case "repeat":
          if (player && typeof player.toggleRepeat === "function") {
            safeCall(function () {
              player.toggleRepeat();
            });
          }
          break;

        case "clear-history":
          clearHistoryWithConfirmation();
          break;

        case "clear-liked":
          clearLikedWithConfirmation();
          break;

        case "refresh":
          refresh();
          break;

        default:
          break;
      }
    });
  }

  function bindLibraryEvents() {
    const library = getLibrary();

    if (!library || typeof library.on !== "function") {
      return;
    }

    [
      "track:liked",
      "track:unliked",
      "track:saved",
      "track:unsaved",
      "history:added",
      "history:cleared",
      "liked:cleared",
      "saved:cleared",
      "playlist:created",
      "playlist:deleted",
      "imported"
    ].forEach(function (eventName) {
      const unsubscribe = library.on(
        eventName,
        function (detail) {
          emitAppEvent("library:" + eventName, detail);

          if (state.currentPage === "library") {
            loadLibrary();
          }

          if (state.currentPage === "playlists") {
            loadPlaylists();
          }
        }
      );

      if (typeof unsubscribe === "function") {
        state.destroyHandlers.push(unsubscribe);
      }
    });
  }

  /* =========================================================
     REFRESH
     ========================================================= */

  async function refresh() {
    if (state.isLoading) {
      return {
        success: false,
        message: "A refresh is already in progress."
      };
    }

    state.isLoading = true;

    try {
      const discovery = getDiscovery();

      if (discovery && typeof discovery.refresh === "function") {
        await discovery.refresh();
      }

      await loadPage(state.currentPage);

      emitAppEvent("refreshed", {
        page: state.currentPage
      });

      return {
        success: true
      };
    } catch (error) {
      recordError(error, "refresh");

      notify(
        "Resona could not refresh. Please try again.",
        "error"
      );

      return {
        success: false,
        error: error
      };
    } finally {
      state.isLoading = false;
    }
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function init() {
    if (state.initialized) {
      return {
        success: true,
        alreadyInitialized: true
      };
    }

    if (state.initializing) {
      return {
        success: false,
        message: "Resona is already initializing."
      };
    }

    state.initializing = true;

    try {
      const validation = validateModules();

      if (!validation.success) {
        throw new Error(validation.message);
      }

      const ui = getUI();

      if (ui && typeof ui.init === "function") {
        ui.init();
      }

      const library = getLibrary();

      if (library && typeof library.init === "function") {
        library.init();
      }

      const discovery = getDiscovery();

      if (discovery && typeof discovery.refresh === "function") {
        try {
          await discovery.refresh();
        } catch (error) {
          recordError(error, "initial-discovery");

          warn(
            "Initial catalogue refresh failed; the application will still open."
          );
        }
      }

      bindNavigation();
      bindSearch();
      bindGlobalActions();
      bindPlayerEvents();
      bindLibraryEvents();

      const initialPage = normalizePage(
        window.location.hash.replace(/^#/, "") || "home"
      );

      state.initialized = true;

      navigate(initialPage, {
        updateHistory: false,
        force: true
      });

      emitAppEvent("initialized", {
        version: APP_VERSION
      });

      log(
        "Initialized successfully. Version:",
        APP_VERSION
      );

      return {
        success: true,
        version: APP_VERSION
      };
    } catch (error) {
      recordError(error, "initialization");

      notify(
        "Resona could not start. Check that all required JavaScript modules are loaded.",
        "error"
      );

      return {
        success: false,
        error: error
      };
    } finally {
      state.initializing = false;
    }
  }

  function destroy() {
    state.destroyHandlers.forEach(function (cleanup) {
      try {
        cleanup();
      } catch (error) {
        warn("Cleanup failed.", error);
      }
    });

    state.destroyHandlers = [];

    clearTimeout(state.searchTimer);

    state.searchTimer = null;
    state.searchRequestId++;
    state.activeSearch = "";
    state.initialized = false;

    emitAppEvent("destroyed", {
      version: APP_VERSION
    });

    return true;
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.ResonaApp = {
    version: APP_VERSION,

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

    renderTracks: renderTracks,
    createTrackCard: createTrackCard,

    getState: function () {
      return {
        initialized: state.initialized,
        initializing: state.initializing,
        currentPage: state.currentPage,
        lastPage: state.lastPage,
        isLoading: state.isLoading,
        activeSearch: state.activeSearch,
        errors: state.errors.slice()
      };
    },

    getErrors: function () {
      return state.errors.slice();
    },

    clearErrors: function () {
      state.errors = [];
    }
  };

  /* =========================================================
     AUTO START
     ========================================================= */

  function startApplication() {
    init().catch(function (error) {
      recordError(error, "startup");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startApplication,
      { once: true }
    );
  } else {
    startApplication();
  }

})(window, document);
