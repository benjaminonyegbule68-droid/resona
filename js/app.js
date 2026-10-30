/* =========================================================
   RESONA — APPLICATION ENTRY POINT
   File: js/app.js
   Version: 2.1.0

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

  const APP_VERSION = "2.1.0";

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
    destroyHandlers: [],
    playerUnsubscribers: [],
    libraryUnsubscribers: []
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

      if (element) {
        return element;
      }
    }

    return null;
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
      if (!active) return;

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
      if (typeof window.CustomEvent !== "function") {
        return;
      }

      window.dispatchEvent(
        new window.CustomEvent("resona:app:" + name, {
          detail: detail === undefined ? null : detail
        })
      );
    } catch (error) {
      warn("Could not dispatch event:", name);
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

  function announce(message) {
    const ui = getUI();

    if (ui && typeof ui.announce === "function") {
      safeCall(function () {
        ui.announce(message);
      });
    }
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
    if (Array.isArray(value)) return value;

    if (!value || typeof value !== "object") {
      return [];
    }

    for (const key of [
      "items",
      "results",
      "tracks",
      "data"
    ]) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }

    return [];
  }

  /* =========================================================
     TRACK UTILITIES
     ========================================================= */

  function getTrackId(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    const ui = getUI();

    if (ui && typeof ui.getTrackId === "function") {
      return String(ui.getTrackId(track) || "").trim();
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

    const ui = getUI();

    if (ui && typeof ui.getTrackTitle === "function") {
      return ui.getTrackTitle(track);
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

    const ui = getUI();

    if (ui && typeof ui.getArtistName === "function") {
      const result = ui.getArtistName(track);

      if (result) return result;
    }

    const artists = track.artists;

    if (Array.isArray(artists)) {
      return artists.map(function (artist) {
        return typeof artist === "string"
          ? artist
          : artist && artist.name
            ? artist.name
            : "";
      }).filter(Boolean).join(", ") || "Unknown artist";
    }

    const artist =
      track.artistName ||
      track.artist_name ||
      track.artist;

    if (typeof artist === "string") {
      return artist || "Unknown artist";
    }

    if (artist && typeof artist === "object") {
      return String(artist.name || "Unknown artist");
    }

    return "Unknown artist";
  }

  function getArtwork(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    const ui = getUI();

    if (ui && typeof ui.getTrackArtwork === "function") {
      return ui.getTrackArtwork(track) || "";
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
     PAGE DISCOVERY
     ========================================================= */

  function getPageElements() {
    const candidates = getElements(
      '[data-page], [id$="-page"]'
    );

    const pages = [];

    candidates.forEach(function (element) {
      const name = element.dataset.page ||
        element.id.replace(/-page$/, "");

      const normalized = normalizePage(name);

      if (
        VALID_PAGES.has(normalized) &&
        !pages.includes(element)
      ) {
        pages.push(element);
      }
    });

    return pages;
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

      element.classList.toggle("is-active", visible);
      element.classList.toggle("active", visible);

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
        (element.getAttribute("href") || "").replace(/^#/, "");

      const active =
        normalizePage(destination) === page;

      element.classList.toggle("is-active", active);
      element.classList.toggle("active", active);

      if (active) {
        element.setAttribute("aria-current", "page");
      } else {
        element.removeAttribute("aria-current");
      }
    });
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function navigate(page, options) {
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
      "Opened " +
      normalized.replace(/-/g, " ") +
      " page."
    );

    Promise.resolve(loadPage(normalized)).catch(function (error) {
      recordError(error, "page-loading:" + normalized);
    });

    if (!pageFound) {
      warn("No matching page element was found:", normalized);
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

    if (!link) return;

    const destination =
      link.dataset.navigate ||
      link.dataset.pageLink ||
      (link.getAttribute("href") || "").replace(/^#/, "");

    if (!destination) return;

    const normalized = String(destination)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

    if (!VALID_PAGES.has(normalized)) return;

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
     DISCOVERY
     ========================================================= */

  function callDiscovery(method, options) {
    const discovery = getDiscovery();

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

    image.className = "resona-track-card__artwork";
    image.alt = getTrackTitle(track) + " cover";
    image.loading = "lazy";

    const artwork = getArtwork(track);

    if (artwork) image.src = artwork;

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
          notify("Your library is unavailable.", "error");
          return;
        }

        try {
          const result = library.toggleLike(track);

          if (!result || result.success === false) {
            notify("Unable to update liked tracks.", "error");
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
          notify("Unable to update liked tracks.", "error");
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

    if (!element) return false;

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
      if (!track || typeof track !== "object") return;

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
      const container = findFirstElement(section.selectors);

      if (!container) return;

      const ui = getUI();

      if (ui && typeof ui.showLoading === "function") {
        ui.showLoading(container, {
          message: "Loading " +
            section.title.toLowerCase() + "..."
        });
      }

      try {
        const tracks = await callDiscovery(section.method);

        renderTracks(container, tracks, {
          showLike: true,
          emptyTitle: "No " +
            section.title.toLowerCase() + " yet"
        });
      } catch (error) {
        recordError(error, "home:" + section.name);

        if (ui && typeof ui.showErrorState === "function") {
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
        const library = getLibrary();

        const recent = library &&
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
        recordError(error, "home:recently-played");
      }
    }

    await Promise.allSettled(jobs);
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

    if (!container) return;

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
          "Catalogue music will appear here when available."
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

    /*
     * Also populate the Explore artists and albums sections.
     */
    const artistsContainer = getElement("#explore-artists");
    const albumsContainer = getElement("#explore-albums");

    if (artistsContainer) {
      callDiscovery("getArtists")
        .then(items =>
          renderSimpleEntityCards(
            artistsContainer,
            items,
            "artist"
          )
        )
        .catch(error =>
          recordError(error, "explore-artists")
        );
    }

    if (albumsContainer) {
      callDiscovery("getAlbums")
        .then(items =>
          renderSimpleEntityCards(
            albumsContainer,
            items,
            "album"
          )
        )
        .catch(error =>
          recordError(error, "explore-albums")
        );
    }
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  function getSearchInput() {
    if (state.currentPage === "explore") {
      return findFirstElement([
        "#explore-search-input",
        "[data-explore-search-input]",
        "#search-input",
        "[data-resona-search-input]"
      ]);
    }

    return findFirstElement([
      "#search-input",
      "#music-search",
      "[data-resona-search-input]",
      "input[type='search']"
    ]);
  }

  function getSearchResultsContainer() {
    if (state.currentPage === "explore") {
      return findFirstElement([
        "#explore-search-results",
        "#explore-tracks",
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
      if (!value || typeof value !== "object") break;

      if (
        Array.isArray(value.tracks) ||
        Array.isArray(value.artists) ||
        Array.isArray(value.albums) ||
        Array.isArray(value.playlists)
      ) {
        return value;
      }

      if (Array.isArray(value.items)) {
        return { tracks: value.items };
      }

      if (Array.isArray(value.results)) {
        return { tracks: value.results };
      }

      if (value.data && typeof value.data === "object") {
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
    if (Array.isArray(result)) return result;

    const value = unwrapSearchResponse(result);

    if (!value || typeof value !== "object") {
      return [];
    }

    return normalizeList(value.tracks || value);
  }

  function renderSearchCategories(result) {
    const normalized = unwrapSearchResponse(result) || {};

    const tracks = normalizeSearchTracks(normalized);
    const artists = normalizeList(normalized.artists);
    const albums = normalizeList(normalized.albums);
    const playlists = normalizeList(normalized.playlists);

    const mainContainer = getSearchResultsContainer();

    if (mainContainer) {
      renderTracks(mainContainer, tracks, {
        showLike: true,
        showSave: true,
        emptyTitle: "No tracks found",
        emptyMessage:
          "Try another song, artist, album, or genre."
      });
    }

    const artistsContainer = getElement("#search-artists");
    const albumsContainer = getElement("#search-albums");
    const playlistsContainer = getElement("#search-playlists");

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
        message: "Searching Resona..."
      });
    }

    try {
      const search = getSearch();
      let result;

      if (search && typeof search.search === "function") {
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

      const categories = renderSearchCategories(result);

      const total =
        categories.tracks.length +
        categories.artists.length +
        categories.albums.length +
        categories.playlists.length;

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

  function handleSearchInput(event) {
    const input = event.currentTarget;

    if (!input) return;

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

    if (!library) return;

    const liked = typeof library.getLiked === "function"
      ? library.getLiked()
      : [];

    const saved = typeof library.getSaved === "function"
      ? library.getSaved()
      : [];

    const history = typeof library.getHistory === "function"
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
        emptyMessage: "Like tracks to find them here."
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
      summary:
        typeof library.getSummary === "function"
          ? library.getSummary()
          : null
    });
  }

  /* =========================================================
     ARTISTS, ALBUMS AND PLAYLISTS
     ========================================================= */

  function renderSimpleEntityCards(container, items, type) {
    if (!container) return;

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
      } else {
        const message = document.createElement("p");

        message.textContent = "Nothing to show yet.";

        container.appendChild(message);
      }

      return;
    }

    const fragment = document.createDocumentFragment();

    list.forEach(function (item) {
      if (!item || typeof item !== "object") return;

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

    if (!container) return;

    try {
      const artists = await callDiscovery("getArtists");

      renderSimpleEntityCards(
        container,
        artists,
        "artist"
      );
    } catch (error) {
      recordError(error, "artists");
    }
  }

  async function loadAlbums() {
    const container = findFirstElement([
      "#albums-list",
      "#albums-grid",
      "[data-section='albums']"
    ]);

    if (!container) return;

    try {
      const albums = await callDiscovery("getAlbums");

      renderSimpleEntityCards(
        container,
        albums,
        "album"
      );
    } catch (error) {
      recordError(error, "albums");
    }
  }

  function loadPlaylists() {
    const library = getLibrary();

    if (
      !library ||
      typeof library.getPlaylists !== "function"
    ) {
      return;
    }

    const container = findFirstElement([
      "#playlists-list",
      "#playlists-grid",
      "#library-playlists",
      "[data-section='playlists']"
    ]);

    if (!container) return;

    let playlists = [];

    try {
      playlists = library.getPlaylists();
    } catch (error) {
      recordError(error, "load-playlists");
    }

    container.replaceChildren();

    if (!Array.isArray(playlists) || !playlists.length) {
      const ui = getUI();

      if (ui && typeof ui.showEmpty === "function") {
        ui.showEmpty(container, {
          icon: "♫",
          title: "No playlists yet",
          message:
            "Your playlists will appear here when you create them."
        });
      }

      return;
    }

    const fragment = document.createDocumentFragment();

    playlists.forEach(function (playlist) {
      if (!playlist || typeof playlist !== "object") return;

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
        playlist.description || ids.length + " tracks";

      const openButton = document.createElement("button");

      openButton.type = "button";
      openButton.textContent = "View playlist";

      openButton.addEventListener("click", function () {
        openPlaylist(playlist.id);
      });

      card.appendChild(title);
      card.appendChild(description);
      card.appendChild(openButton);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function openPlaylist(playlistId) {
    const library = getLibrary();

    if (
      !library ||
      typeof library.getPlaylistTracks !== "function"
    ) {
      notify("Playlist access is unavailable.", "error");
      return [];
    }

    try {
      const tracks = library.getPlaylistTracks(playlistId);

      if (!Array.isArray(tracks) || !tracks.length) {
        notify("This playlist has no available tracks.", "info");
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
     PLAYER AND NOW PLAYING
     ========================================================= */

  function updateImage(element, artwork) {
    if (!element || element.tagName !== "IMG") return;

    const ui = getUI();

    if (ui && typeof ui.setSafeImage === "function") {
      ui.setSafeImage(element, artwork);
    } else if (artwork) {
      element.src = artwork;
    } else {
      element.removeAttribute("src");
    }
  }

  function updateNowPlaying(track) {
    if (!track) return;

    const title = getTrackTitle(track);
    const artist = getArtistName(track);
    const artwork = getArtwork(track);

    getElements([
      "[data-now-playing-title]",
      "#now-playing-title",
      "#player-track-title",
      "#mini-player-title"
    ].join(",")).forEach(function (element) {
      element.textContent = title;
    });

    getElements([
      "[data-now-playing-artist]",
      "#now-playing-artist",
      "#player-track-artist",
      "#mini-player-artist"
    ].join(",")).forEach(function (element) {
      element.textContent = artist;
    });

    getElements([
      "[data-now-playing-artwork]",
      "#now-playing-artwork",
      "#player-track-artwork",
      "#now-playing-cover"
    ].join(",")).forEach(function (element) {
      updateImage(element, artwork);
    });
  }

  function formatTime(seconds) {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value < 0) {
      return "0:00";
    }

    const total = Math.floor(value);

    return (
      Math.floor(total / 60) +
      ":" +
      String(total % 60).padStart(2, "0")
    );
  }

  function updatePlaybackProgress(detail) {
    const current = Number(
      detail?.currentTime ??
      detail?.position ??
      0
    );

    const duration = Number(
      detail?.duration ??
      detail?.track?.duration ??
      0
    );

    const percentage = duration > 0
      ? Math.min(100, Math.max(0, current / duration * 100))
      : 0;

    const fill = getElement("#player-progress-fill");

    if (fill) {
      fill.style.width = percentage + "%";
    }

    const currentLabel = getElement("#player-current-time");

    if (currentLabel) {
      currentLabel.textContent = formatTime(current);
    }

    const durationLabel = getElement("#player-duration");

    if (durationLabel) {
      durationLabel.textContent = formatTime(duration);
    }

    const track = getElement("#player-progress-track");

    if (track) {
      track.setAttribute(
        "aria-valuenow",
        String(Math.round(percentage))
      );

      track.setAttribute(
        "aria-valuetext",
        formatTime(current) + " of " + formatTime(duration)
      );
    }
  }

  function updatePlaybackButtons(isPlaying) {
    const playing = Boolean(isPlaying);

    [
      "#player-toggle",
      "#mini-player-toggle",
      "[data-resona-action='pause']",
      "[data-resona-action='resume']"
    ].forEach(function (selector) {
      getElements(selector).forEach(function (button) {
        if (
          button.id === "player-toggle" ||
          button.id === "mini-player-toggle"
        ) {
          button.textContent = playing ? "Ⅱ" : "▶";

          button.setAttribute(
            "aria-label",
            playing ? "Pause playback" : "Resume playback"
          );
        }

        if (button.dataset.resonaAction === "pause") {
          button.hidden = !playing;
        }

        if (button.dataset.resonaAction === "resume") {
          button.hidden = playing;
        }
      });
    });
  }

  function handlePlayerEvent(eventName, detail) {
    emitAppEvent("player:" + eventName, detail);

    const track = detail && (
      detail.track ||
      detail.currentTrack ||
      detail
    );

    if (
      eventName === "trackchange" ||
      eventName === "play"
    ) {
      if (track && typeof track === "object") {
        updateNowPlaying(track);
      }
    }

    if (eventName === "play") {
      updatePlaybackButtons(true);
    }

    if (eventName === "pause" || eventName === "ended") {
      updatePlaybackButtons(false);
    }

    if (eventName === "timeupdate") {
      updatePlaybackProgress(detail || {});
    }

    if (eventName === "error") {
      notify(
        detail?.message || "Playback encountered an error.",
        "warning"
      );
    }
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
          handlePlayerEvent(eventName, detail);
        }
      );

      if (typeof unsubscribe === "function") {
        state.playerUnsubscribers.push(unsubscribe);
      }
    });
  }

  async function playTrack(track, options) {
    const player = getPlayer();

    if (
      !player ||
      typeof player.playTrack !== "function"
    ) {
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
       * Do not record history until the player confirms
       * successful playback.
       */
      if (
        result === false ||
        (
          result &&
          typeof result === "object" &&
          (
            result.success === false ||
            result.playing === false
          )
        )
      ) {
        const message = result?.message ||
          "Unable to play this track.";

        notify(message, "warning");

        return {
          success: false,
          message: message,
          result: result
        };
      }

      /*
       * Some player implementations return undefined
       * after starting playback. In that case, verify
       * the current player state when possible.
       */
      if (result === undefined && typeof player.getState === "function") {
        const playerState = player.getState();

        const currentId = getTrackId(
          playerState?.currentTrack
        );

        if (
          playerState?.error ||
          (
            currentId &&
            currentId !== id
          )
        ) {
          return {
            success: false,
            message: "The player did not confirm this track."
          };
        }
      }

      const library = getLibrary();

      if (
        library &&
        typeof library.addHistory === "function"
      ) {
        library.addHistory(track);
      }

      updateNowPlaying(track);

      emitAppEvent("track:play-requested", {
        trackId: id,
        track: track
      });

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

        if (typeof library[method] !== "function") return;

        try {
          const result = library[method].apply(
            library,
            entry[1]
          );

          if (Array.isArray(result)) {
            candidates.push.apply(candidates, result);
          }
        } catch (error) {
          recordError(error, "find-local-track:" + method);
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
     CONFIRMATION AND LIBRARY ACTIONS
     ========================================================= */

  async function confirmAction(options) {
    const ui = getUI();

    if (ui && typeof ui.confirm === "function") {
      return Boolean(await ui.confirm(options));
    }

    return window.confirm(
      options.message ||
      options.title ||
      "Are you sure?"
    );
  }

  async function clearHistoryWithConfirmation() {
    const library = getLibrary();

    if (
      !library ||
      typeof library.clearHistory !== "function"
    ) {
      notify("Listening history is unavailable.", "error");
      return;
    }

    try {
      const confirmed = await confirmAction({
        title: "Clear listening history?",
        message:
          "This removes listening history saved in this browser.",
        confirmLabel: "Clear history",
        cancelLabel: "Cancel"
      });

      if (!confirmed) return;

      library.clearHistory();
      loadLibrary();

      notify("Listening history cleared.", "success");
    } catch (error) {
      recordError(error, "clear-history");
    }
  }

  async function clearLikedWithConfirmation() {
    const library = getLibrary();

    if (
      !library ||
      typeof library.clearLiked !== "function"
    ) {
      notify("Liked tracks are unavailable.", "error");
      return;
    }

    try {
      const confirmed = await confirmAction({
        title: "Clear liked tracks?",
        message:
          "This removes liked tracks saved in this browser.",
        confirmLabel: "Clear liked tracks",
        cancelLabel: "Cancel"
      });

      if (!confirmed) return;

      library.clearLiked();
      loadLibrary();

      notify("Liked tracks cleared.", "success");
    } catch (error) {
      recordError(error, "clear-liked");
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
    const inputs = getElements(
      "#search-input, #explore-search-input, " +
      "#music-search, [data-resona-search-input]"
    );

    if (!inputs.length) {
      warn("No search input was found.");
      return;
    }

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

          clearTimeout(state.searchTimer);

          performSearch(input.value);
        });
      }
    });
  }

  function bindGlobalActions() {
    addHandler(document, "click", function (event) {
      const target = event.target;

      if (!target || typeof target.closest !== "function") {
        return;
      }

      const button = target.closest("[data-resona-action]");

      if (!button) return;

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

        case "close-now-playing":
          navigate(state.lastPage || "home");
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

    /*
     * These names match the event naming used by
     * the supplied library module.
     */
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
        state.libraryUnsubscribers.push(unsubscribe);
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

      if (
        discovery &&
        typeof discovery.refresh === "function"
      ) {
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

      const search = getSearch();

      if (search && typeof search.init === "function") {
        search.init();
      }

      const discovery = getDiscovery();

      if (
        discovery &&
        typeof discovery.refresh === "function"
      ) {
        try {
          await discovery.refresh();
        } catch (error) {
          recordError(error, "initial-discovery");

          warn(
            "Initial catalogue refresh failed; opening the application anyway."
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

  /* =========================================================
     DESTRUCTION
     ========================================================= */

  function destroy() {
    state.destroyHandlers.forEach(function (cleanup) {
      try {
        cleanup();
      } catch (error) {
        warn("Cleanup failed.", error);
      }
    });

    state.destroyHandlers = [];

    state.playerUnsubscribers.forEach(function (unsubscribe) {
      try {
        unsubscribe();
      } catch (error) {
        warn("Player cleanup failed.", error);
      }
    });

    state.playerUnsubscribers = [];

    state.libraryUnsubscribers.forEach(function (unsubscribe) {
      try {
        unsubscribe();
      } catch (error) {
        warn("Library cleanup failed.", error);
      }
    });

    state.libraryUnsubscribers = [];

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
    openPlaylist: openPlaylist,

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
