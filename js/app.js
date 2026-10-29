/* =========================================================
   RESONA — APPLICATION ENTRY POINT
   File: js/app.js

   Responsibilities:
   - Initialize Resona modules
   - Coordinate navigation
   - Load music discovery sections
   - Connect search, library, and player
   - Render shared UI components
   - Handle global application events
   - Provide safe loading and error states

   Required modules:
   - js/api.js
   - js/player.js
   - js/discovery.js
   - js/search.js
   - js/library.js
   - js/ui.js

   This file does not replace your existing root app.js.
   ========================================================= */

(function (window, document) {
  "use strict";

  if (window.ResonaApp) {
    console.warn("[Resona App] Already initialized.");
    return;
  }

  const APP_VERSION = "1.0.0";

  const state = {
    initialized: false,
    initializing: false,
    currentPage: "home",
    lastPage: "home",
    isLoading: false,
    errors: [],
    activeSearch: "",
    searchTimer: null,
    currentSection: "featured",
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

  /* =========================================================
     UTILITIES
     ========================================================= */

  function log() {
    console.log.apply(console, [
      "[Resona App]"
    ].concat(Array.from(arguments)));
  }

  function warn() {
    console.warn.apply(console, [
      "[Resona App]"
    ].concat(Array.from(arguments)));
  }

  function getModule(name) {
    return window[name] || null;
  }

  function missingModules() {
    return MODULES.filter(function (name) {
      return !getModule(name);
    });
  }

  function getElement(selector, root) {
    return document.querySelector(selector, root || document);
  }

  function getElements(selector, root) {
    return Array.from(
      (root || document).querySelectorAll(selector)
    );
  }

  function escapeHTML(value) {
    if (window.ResonaUI) {
      return window.ResonaUI.escapeHTML(value);
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
    if (
      window.ResonaUI &&
      typeof window.ResonaUI.announce === "function"
    ) {
      window.ResonaUI.announce(message, options);
    }
  }

  function notify(message, type) {
    const ui = getModule("ResonaUI");

    if (!ui) {
      log(message);
      return;
    }

    const method = {
      success: ui.success,
      error: ui.error,
      warning: ui.warning,
      info: ui.info
    }[type || "info"];

    if (typeof method === "function") {
      method.call(ui, message);
    } else {
      ui.toast(message);
    }
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

  function addHandler(target, eventName, callback, options) {
    if (!target || typeof target.addEventListener !== "function") {
      return function () {};
    }

    target.addEventListener(eventName, callback, options);

    const cleanup = function () {
      target.removeEventListener(eventName, callback, options);
    };

    state.destroyHandlers.push(cleanup);

    return cleanup;
  }

  function getTrackId(track) {
    if (window.ResonaUI) {
      return window.ResonaUI.getTrackId(track);
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
    if (window.ResonaUI) {
      return window.ResonaUI.getTrackTitle(track);
    }

    return String(
      track && (track.title || track.name) ||
      "Untitled track"
    );
  }

  function getArtistName(track) {
    if (window.ResonaUI) {
      return window.ResonaUI.getArtistName(track);
    }

    return String(
      track && (
        track.artistName ||
        track.artist_name ||
        track.artist ||
        "Unknown artist"
      )
    );
  }

  function getArtwork(track) {
    if (window.ResonaUI) {
      return window.ResonaUI.getTrackArtwork(track);
    }

    return track && (
      track.artwork ||
      track.cover ||
      track.cover_url ||
      track.image_url ||
      ""
    );
  }

  function getTrackDuration(track) {
    if (!track) {
      return "0:00";
    }

    const duration = Number(
      track.duration ||
      track.duration_seconds ||
      track.durationSeconds ||
      0
    );

    if (window.ResonaUI) {
      return window.ResonaUI.formatDuration(duration);
    }

    const seconds = Math.max(0, Math.floor(duration));

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

      recordError(new Error(message), "module-validation");

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
    const elements = getElements("[data-page]");

    if (elements.length) {
      return elements;
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
      const pageName = normalizePage(
        element.dataset.page ||
        element.id.replace(/-page$/, "")
      );

      const visible = pageName === normalized;

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

    return matched;
  }

  function updateNavigationControls(page) {
    getElements(
      "[data-navigate], [data-page-link], .nav-link"
    ).forEach(function (element) {
      const destination = normalizePage(
        element.dataset.navigate ||
        element.dataset.pageLink ||
        element.dataset.page ||
        element.getAttribute("href")?.replace(/^#/, "")
      );

      const active = destination === page;

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

    announce("Opened " + normalized.replace(/-/g, " ") + " page.");

    loadPage(normalized).catch(function (error) {
      recordError(error, "page-loading:" + normalized);
    });

    if (!pageFound) {
      warn(
        "No matching page element was found for:",
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
    const link = event.target.closest(
      "[data-navigate], [data-page-link], a[href^='#']"
    );

    if (!link) {
      return;
    }

    const destination =
      link.dataset.navigate ||
      link.dataset.pageLink ||
      link.getAttribute("href")?.replace(/^#/, "");

    if (!destination) {
      return;
    }

    const page = normalizePage(destination);

    if (!VALID_PAGES.has(page)) {
      return;
    }

    event.preventDefault();

    navigate(page);
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
     DATA ACCESS
     ========================================================= */

  function getDiscovery() {
    return getModule("ResonaDiscovery");
  }

  function getLibrary() {
    return getModule("ResonaLibrary");
  }

  function getPlayer() {
    return getModule("ResonaPlayer");
  }

  function getSearch() {
    return getModule("ResonaSearch");
  }

  function getUI() {
    return getModule("ResonaUI");
  }

  function getAPI() {
    return getModule("ResonaAPI");
  }

  function callDiscovery(method, options) {
    const discovery = getDiscovery();

    if (!discovery || typeof discovery[method] !== "function") {
      return Promise.resolve([]);
    }

    try {
      return Promise.resolve(discovery[method](options));
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
    image.src = getArtwork(track);

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

      const liked = library &&
        typeof library.isLiked === "function" &&
        library.isLiked(trackId);

      like.textContent = liked ? "♥" : "♡";
      like.setAttribute("aria-pressed", liked ? "true" : "false");

      like.addEventListener("click", function () {
        if (!library || typeof library.toggleLike !== "function") {
          notify("Your library is unavailable.", "error");
          return;
        }

        const result = library.toggleLike(track);

        if (result.success) {
          like.textContent = result.liked ? "♥" : "♡";
          like.setAttribute(
            "aria-pressed",
            result.liked ? "true" : "false"
          );
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
          {
            onPlay: playTrack
          },
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

    const list = Array.isArray(tracks) ? tracks : [];
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
      },
      {
        name: "recently-played",
        selectors: [
          "#recently-played",
          "[data-section='recently-played']"
        ],
        method: "getRecentlyPlayed",
        title: "Recently played"
      }
    ];

    const jobs = sections.map(async function (section) {
      const container = findFirstElement(section.selectors);

      if (!container) {
        return;
      }

      const ui = getUI();

      if (ui) {
        ui.showLoading(container, {
          message: "Loading " + section.title.toLowerCase() + "..."
        });
      }

      try {
        let tracks;

        if (section.name === "recently-played") {
          tracks = getLibrary().getRecentlyPlayed(12);
        } else {
          tracks = await callDiscovery(section.method);
        }

        if (!Array.isArray(tracks)) {
          tracks = Array.isArray(tracks && tracks.items)
            ? tracks.items
            : [];
        }

        renderTracks(container, tracks, {
          showLike: true,
          emptyTitle: "No " + section.title.toLowerCase() + " yet"
        });
      } catch (error) {
        recordError(error, "home:" + section.name);

        if (ui) {
          ui.showErrorState(container, {
            message:
              "We couldn't load this section. Please try again.",
            onAction: function () {
              loadHome();
            }
          });
        }
      }
    });

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

    if (ui) {
      ui.showLoading(container, {
        message: "Discovering music..."
      });
    }

    try {
      let tracks = await callDiscovery("getTracks");

      if (!Array.isArray(tracks)) {
        tracks = Array.isArray(tracks && tracks.items)
          ? tracks.items
          : [];
      }

      renderTracks(container, tracks, {
        showLike: true,
        showSave: true,
        emptyTitle: "Your discovery starts here",
        emptyMessage:
          "When music is available, it will appear here."
      });
    } catch (error) {
      recordError(error, "explore");

      if (ui) {
        ui.showErrorState(container, {
          message: "We couldn't load Explore.",
          onAction: loadExplore
        });
      }
    }
  }

  /* =========================================================
     SEARCH PAGE
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

    return [];
  }

  async function performSearch(query) {
    const search = getSearch();
    const container = getSearchResultsContainer();
    const normalizedQuery = String(query || "").trim();

    state.activeSearch = normalizedQuery;

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

    if (ui) {
      ui.showLoading(container, {
        message: "Searching music..."
      });
    }

    try {
      let result;

      if (search && typeof search.search === "function") {
        result = await search.search(normalizedQuery);
      } else {
        const api = getAPI();

        if (!api || typeof api.search !== "function") {
          throw new Error("Search module is unavailable.");
        }

        result = await api.search(normalizedQuery);
      }

      // Don't render a stale response over a newer search.
      if (normalizedQuery !== state.activeSearch) {
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
      if (normalizedQuery !== state.activeSearch) {
        return {
          success: false,
          stale: true
        };
      }

      recordError(error, "search");

      if (ui) {
        ui.showErrorState(container, {
          message: "Search failed. Please try again.",
          onAction: function () {
            performSearch(normalizedQuery);
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
     LIBRARY PAGE
     ========================================================= */

  function renderLibrarySection(selectors, tracks, options) {
    const container = findFirstElement(selectors);

    if (!container) {
      return;
    }

    renderTracks(container, tracks, options);
  }

  function loadLibrary() {
    const library = getLibrary();

    if (!library) {
      return;
    }

    renderLibrarySection(
      ["#liked-tracks", "#library-liked", "[data-library='liked']"],
      library.getLiked(),
      {
        showLike: true,
        emptyTitle: "No liked music yet",
        emptyMessage: "Like tracks to find them here."
      }
    );

    renderLibrarySection(
      ["#saved-tracks", "#library-saved", "[data-library='saved']"],
      library.getSaved(),
      {
        showLike: true,
        showSave: true,
        emptyTitle: "No saved tracks yet",
        emptyMessage: "Save music to return to it later."
      }
    );

    const history = library.getHistory({
      tracksOnly: true
    });

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
      summary: library.getSummary()
    });
  }

  /* =========================================================
     ARTIST AND ALBUM PAGES
     ========================================================= */

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

    if (ui) {
      ui.showLoading(container, {
        message: "Loading artists..."
      });
    }

    try {
      let artists = await callDiscovery("getArtists");

      if (!Array.isArray(artists)) {
        artists = Array.isArray(artists && artists.items)
          ? artists.items
          : [];
      }

      renderSimpleEntityCards(container, artists, "artist");
    } catch (error) {
      recordError(error, "artists");

      if (ui) {
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

    if (ui) {
      ui.showLoading(container, {
        message: "Loading albums..."
      });
    }

    try {
      let albums = await callDiscovery("getAlbums");

      if (!Array.isArray(albums)) {
        albums = Array.isArray(albums && albums.items)
          ? albums.items
          : [];
      }

      renderSimpleEntityCards(container, albums, "album");
    } catch (error) {
      recordError(error, "albums");

      if (ui) {
        ui.showErrorState(container, {
          message: "We couldn't load albums.",
          onAction: loadAlbums
        });
      }
    }
  }

  function renderSimpleEntityCards(container, items, type) {
    container.replaceChildren();

    if (!items.length) {
      const ui = getUI();

      if (ui) {
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

    items.forEach(function (item) {
      if (!item || typeof item !== "object") {
        return;
      }

      const card = document.createElement("article");

      card.className = "resona-entity-card";

      const image = document.createElement("img");

      image.loading = "lazy";
      image.alt = String(
        item.name ||
        item.title ||
        type
      );

      const artwork =
        item.image ||
        item.image_url ||
        item.artwork ||
        item.cover ||
        item.cover_url;

      if (getUI()) {
        getUI().setSafeImage(image, artwork);
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

  /* =========================================================
     PLAYER INTEGRATION
     ========================================================= */

  async function playTrack(track, options) {
    const player = getPlayer();

    if (!player) {
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

    if (typeof player.playTrack !== "function") {
      notify("The player cannot play tracks yet.", "error");

      return {
        success: false,
        message: "Playback method unavailable."
      };
    }

    try {
      const result = await player.playTrack(
        track,
        options || {}
      );

      if (result && result.success === false) {
        notify(
          result.message || "Unable to play this track.",
          "warning"
        );

        return result;
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
      if (element.tagName === "IMG" && getUI()) {
        getUI().setSafeImage(element, artwork);
      }
    });
  }

  function bindPlayerEvents() {
    const player = getPlayer();

    if (!player || typeof player.on !== "function") {
      warn("Player event subscription is unavailable.");
      return;
    }

    const events = [
      "trackchange",
      "play",
      "pause",
      "ended",
      "timeupdate",
      "volumechange",
      "error"
    ];

    events.forEach(function (eventName) {
      const unsubscribe = player.on(eventName, function (detail) {
        emitAppEvent("player:" + eventName, detail);

        if (eventName === "trackchange" && detail) {
          updateNowPlaying(
            detail.track || detail
          );
        }
      });

      if (typeof unsubscribe === "function") {
        state.destroyHandlers.push(unsubscribe);
      }
    });
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
        return undefined;

      case "settings":
        return undefined;

      default:
        return undefined;
    }
  }

  function loadPlaylists() {
    const library = getLibrary();

    if (!library) {
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

    const playlists = library.getPlaylists();

    container.replaceChildren();

    if (!playlists.length) {
      const ui = getUI();

      if (ui) {
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
      const card = document.createElement("article");

      card.className = "resona-playlist-card";

      const title = document.createElement("h3");

      title.textContent = playlist.name;

      const description = document.createElement("p");

      description.textContent =
        playlist.description ||
        playlist.trackIds.length + " tracks";

      card.appendChild(title);
      card.appendChild(description);

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
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
      const button = event.target.closest(
        "[data-resona-action]"
      );

      if (!button) {
        return;
      }

      const action = button.dataset.resonaAction;

      switch (action) {
        case "play":
          if (button.dataset.trackId) {
            playTrackById(button.dataset.trackId);
          }
          break;

        case "pause":
          safeCall(function () {
            getPlayer().pause();
          });
          break;

        case "resume":
          safeCall(function () {
            getPlayer().resume();
          });
          break;

        case "next":
          safeCall(function () {
            getPlayer().next();
          });
          break;

        case "previous":
          safeCall(function () {
            getPlayer().previous();
          });
          break;

        case "shuffle":
          safeCall(function () {
            getPlayer().setShuffle(
              button.getAttribute("aria-pressed") !== "true"
            );

            button.setAttribute(
              "aria-pressed",
              button.getAttribute("aria-pressed") !== "true"
                ? "true"
                : "false"
            );
          });
          break;

        case "repeat":
          safeCall(function () {
            getPlayer().toggleRepeat();
          });
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

  async function playTrackById(trackId) {
    const id = String(trackId || "").trim();

    if (!id) {
      return;
    }

    const library = getLibrary();

    const candidates = [];

    if (library) {
      candidates.push.apply(candidates, library.getLiked());
      candidates.push.apply(candidates, library.getSaved());
      candidates.push.apply(
        candidates,
        library.getRecentlyPlayed(100)
      );
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

    notify("Track not found. Try opening it from Explore.", "warning");
  }

  async function clearHistoryWithConfirmation() {
    const library = getLibrary();
    const ui = getUI();

    if (!library) {
      return;
    }

    let confirmed = true;

    if (ui && typeof ui.confirm === "function") {
      confirmed = await ui.confirm({
        title: "Clear listening history?",
        message: "This will remove your locally saved listening history.",
        confirmLabel: "Clear history",
        cancelLabel: "Cancel"
      });
    } else {
      confirmed = window.confirm(
        "Clear your listening history?"
      );
    }

    if (confirmed) {
      library.clearHistory();
      loadLibrary();

      notify("Listening history cleared.", "success");
    }
  }

  async function clearLikedWithConfirmation() {
    const library = getLibrary();
    const ui = getUI();

    if (!library) {
      return;
    }

    let confirmed = true;

    if (ui && typeof ui.confirm === "function") {
      confirmed = await ui.confirm({
        title: "Clear liked tracks?",
        message: "This will remove all your liked tracks from this browser.",
        confirmLabel: "Clear liked tracks",
        cancelLabel: "Cancel"
      });
    } else {
      confirmed = window.confirm(
        "Clear all liked tracks?"
      );
    }

    if (confirmed) {
      library.clearLiked();
      loadLibrary();

      notify("Liked tracks cleared.", "success");
    }
  }

  /* =========================================================
     APPLICATION EVENTS
     ========================================================= */

  function emitAppEvent(name, detail) {
    try {
      window.dispatchEvent(
        new CustomEvent("resona:app:" + name, {
          detail: detail === undefined ? null : detail
        })
      );
    } catch (_) {
      // Optional event system.
    }
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
      const unsubscribe = library.on(eventName, function (detail) {
        emitAppEvent("library:" + eventName, detail);

        if (state.currentPage === "library") {
          loadLibrary();
        }

        if (state.currentPage === "playlists") {
          loadPlaylists();
        }
      });

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

      notify("Resona could not refresh. Please try again.", "error");

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
            "Initial catalogue refresh failed; the app will still open."
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

      log("Initialized successfully. Version:", APP_VERSION);

      return {
        success: true,
        version: APP_VERSION
      };
    } catch (error) {
      recordError(error, "initialization");

      const message =
        "Resona could not start. Check that all required JavaScript modules are loaded.";

      if (getUI()) {
        notify(message, "error");
      }

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
      } catch (_) {
        // Continue cleanup.
      }
    });

    state.destroyHandlers = [];

    clearTimeout(state.searchTimer);

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
