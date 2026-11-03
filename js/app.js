/* =========================================================
   RESONA — APPLICATION CORE
   js/app.js
   Compatible with player.js v3 + shell-bridge.js
   Does NOT create Audio() or overwrite ResonaPlayer
   ========================================================= */

"use strict";

(function (window, document) {
  if (window.__ResonaAppCoreLoaded) {
    console.warn("[Resona App] Already loaded.");
    return;
  }

  window.__ResonaAppCoreLoaded = true;

  /* =========================================================
     1. SAFE MODULE REFERENCES
     ========================================================= */

  const config = window.ResonaConfig || {};
  const api = window.ResonaAPI || null;
  const player = window.ResonaPlayer || null;
  const bridge = window.ResonaShellBridge || null;
  const ui = window.ResonaUI || null;

  /* =========================================================
     2. APPLICATION STATE
     ========================================================= */

  const state = {
    initialized: false,
    currentPage: "home",
    tracks: [],
    likedTracks: [],
    history: [],
    searchQuery: "",
    libraryTab: "liked",
    selectedContinent: "",
    selectedCountry: ""
  };

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

  const PAGE_MAP = {
    home: "home-page",
    explore: "explore-page",
    search: "search-page",
    library: "library-page",
    artists: "artists-page",
    albums: "albums-page",
    playlists: "playlists-page",
    settings: "settings-page"
  };

  /* =========================================================
     3. UTILITIES
     ========================================================= */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from(
      (root || document).querySelectorAll(selector)
    );
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c];
    });
  }

  function storageKey(key) {
    const prefix =
      (config.storage && config.storage.prefix) || "resona_";

    return prefix + key;
  }

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(key));

      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(
        storageKey(key),
        JSON.stringify(value)
      );

      return true;
    } catch (error) {
      console.warn("[Resona] Storage write failed:", error);
      return false;
    }
  }

  function toast(message) {
    if (ui && typeof ui.showToast === "function") {
      ui.showToast(message);
      return;
    }

    let element =
      $("#resona-toast") || $("#toast");

    if (!element) {
      element = document.createElement("div");
      element.id = "resona-toast";
      element.setAttribute("role", "status");
      document.body.appendChild(element);
    }

    element.textContent = String(message);
    element.classList.add("show");
    element.style.display = "block";

    clearTimeout(element._timer);

    element._timer = setTimeout(function () {
      element.classList.remove("show");
      element.style.display = "";
    }, 2800);
  }

  function normalizeTrack(input) {
    if (!input || typeof input !== "object") {
      return null;
    }

    const id = String(
      input.id ?? input.track_id ?? ""
    ).trim();

    const title = String(
      input.title ?? input.name ?? ""
    ).trim();

    const artist = String(
      input.artist ?? input.artist_name ?? ""
    ).trim();

    if (!id || !title) {
      return null;
    }

    return {
      ...input,

      id: id,
      title: title,
      artist: artist || "Unknown artist",

      album: String(
        input.album ?? input.album_title ?? ""
      ),

      artwork: String(
        input.artwork ??
        input.cover_url ??
        input.artwork_url ??
        ""
      ),

      audioUrl: String(
        input.audioUrl ??
        input.audio_url ??
        input.stream_url ??
        ""
      ),

      duration: Number(
        input.duration ??
        input.duration_seconds ??
        0
      ) || 0,

      country: String(input.country ?? ""),

      continent: String(
        input.continent ?? ""
      ).toLowerCase(),

      genre: String(input.genre ?? ""),

      featured: input.featured === true,

      rightsConfirmed:
        input.rightsConfirmed === true ||
        input.rights_confirmed === true
    };
  }

  function getTrackById(id) {
    return state.tracks.find(function (track) {
      return String(track.id) === String(id);
    }) || null;
  }

  function getPageFromHash() {
    return String(window.location.hash || "")
      .replace(/^#\/?/, "")
      .split("?")[0]
      .toLowerCase();
  }

  /* =========================================================
     4. NAVIGATION
     ========================================================= */

  function showPage(pageName, button, options) {
    const target = String(
      pageName || "home"
    ).toLowerCase();

    if (!VALID_PAGES.has(target)) {
      toast("That page is not available.");
      return false;
    }

    const pageId = PAGE_MAP[target];
    const pageElement = $("#" + pageId);

    if (!pageElement) {
      console.error(
        "[Resona] Page missing:",
        pageId
      );

      toast("Page could not be opened.");
      return false;
    }

    // Hide all application pages.

    Object.keys(PAGE_MAP).forEach(function (name) {
      const element = $("#" + PAGE_MAP[name]);

      if (!element) return;

      element.classList.remove("active");
      element.setAttribute("aria-hidden", "true");
      element.hidden = true;
      element.style.display = "none";
    });

    // Display requested page.

    pageElement.hidden = false;
    pageElement.style.display = "";
    pageElement.classList.add("active");
    pageElement.setAttribute("aria-hidden", "false");

    state.currentPage = target;

    writeStorage("last_page", target);

    // Support all navigation attributes used by Resona.

    $$(
      "[data-navigate], [data-page-target], [data-page], .nav-button"
    ).forEach(function (element) {
      const buttonPage =
        element.dataset.navigate ||
        element.dataset.pageTarget ||
        element.dataset.page ||
        "";

      element.classList.remove("active", "on");
      element.removeAttribute("aria-current");

      if (buttonPage === target) {
        element.classList.add("active", "on");
        element.setAttribute("aria-current", "page");
      }
    });

    if (button && button instanceof Element) {
      button.classList.add("active", "on");
      button.setAttribute("aria-current", "page");
    }

    // Update browser navigation.

    if (!options || !options.fromHistory) {
      try {
        const newHash = "#" + target;

        if (window.location.hash !== newHash) {
          window.history.pushState(
            { page: target },
            "",
            newHash
          );
        }
      } catch (error) {
        console.warn("[Resona] Navigation history warning:", error);
      }
    }

    renderCurrentPage();

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });

    return true;
  }

  function renderCurrentPage() {
    switch (state.currentPage) {
      case "home":
        renderHome();
        break;

      case "library":
        renderLibrary();
        break;

      case "explore":
        renderExplore();
        break;

      case "search":
        renderSearch();
        break;

      case "artists":
        renderArtists();
        break;

      case "albums":
        renderAlbums();
        break;

      case "playlists":
        renderPlaylists();
        break;

      default:
        break;
    }
  }

  /* =========================================================
     5. LIBRARY
     ========================================================= */

  function loadLibrary() {
    const liked = readStorage("liked_tracks", []);
    const history = readStorage("history", []);

    state.likedTracks = Array.isArray(liked)
      ? liked
      : [];

    state.history = Array.isArray(history)
      ? history
      : [];
  }

  function isLiked(trackId) {
    return state.likedTracks.some(function (id) {
      return String(id) === String(trackId);
    });
  }

  function toggleLike(trackId) {
    const id = String(trackId);

    if (isLiked(id)) {
      state.likedTracks =
        state.likedTracks.filter(function (item) {
          return String(item) !== id;
        });

      writeStorage(
        "liked_tracks",
        state.likedTracks
      );

      toast("Removed from liked songs.");

      return false;
    }

    state.likedTracks.push(id);

    writeStorage(
      "liked_tracks",
      state.likedTracks
    );

    toast("Added to liked songs.");

    return true;
  }

  function addHistory(track) {
    if (!track || !track.id) return;

    state.history = state.history.filter(
      function (item) {
        return String(item.id) !== String(track.id);
      }
    );

    state.history.unshift({
      id: track.id,
      title: track.title,
      artist: track.artist,
      playedAt: new Date().toISOString()
    });

    state.history = state.history.slice(0, 100);

    writeStorage("history", state.history);
  }

  function clearLiked() {
    state.likedTracks = [];

    writeStorage("liked_tracks", []);

    renderLibrary();

    toast("Liked songs cleared.");
  }

  function clearHistory() {
    state.history = [];

    writeStorage("history", []);

    renderLibrary();

    toast("Listening history cleared.");
  }

  /* =========================================================
     6. CATALOGUE
     ========================================================= */

  async function loadCatalogue() {
    if (!api) {
      console.warn("[Resona] API module unavailable.");
      return false;
    }

    try {
      let response = null;

      if (typeof api.getTracks === "function") {
        response = await api.getTracks();
      } else if (typeof api.request === "function") {
        response = await api.request("/tracks");
      } else if (typeof api.get === "function") {
        response = await api.get("/tracks");
      } else {
        console.warn(
          "[Resona] No supported catalogue API method found."
        );

        return false;
      }

      let list = [];

      if (Array.isArray(response)) {
        list = response;
      } else if (response && Array.isArray(response.tracks)) {
        list = response.tracks;
      } else if (response && Array.isArray(response.data)) {
        list = response.data;
      }

      state.tracks = list
        .map(normalizeTrack)
        .filter(Boolean);

      console.info(
        "[Resona] Catalogue loaded:",
        state.tracks.length,
        "tracks"
      );

      return true;

    } catch (error) {
      console.error(
        "[Resona] Catalogue error:",
        error
      );

      toast("Could not load music catalogue.");

      return false;
    }
  }

  /* =========================================================
     7. PLAYER INTEGRATION
     ========================================================= */

  function playTrackById(trackId) {
    if (!player || typeof player.playTrack !== "function") {
      toast("Player is not available.");
      return;
    }

    const track = getTrackById(trackId);

    if (!track) {
      toast("Track not found in catalogue.");
      return;
    }

    // The player receives a queue array, not an options object.

    const queue = state.tracks.slice();

    Promise.resolve(
      player.playTrack(track, queue)
    ).then(function (result) {
      if (result !== false) {
        addHistory(track);
        updatePlayerUI();
      }
    }).catch(function (error) {
      console.error(
        "[Resona] Playback error:",
        error
      );

      toast("Unable to start playback.");
    });
  }

  function togglePlayback() {
    if (!player) return;

    if (typeof player.toggle === "function") {
      player.toggle();
    } else if (typeof player.togglePlayback === "function") {
      player.togglePlayback();
    }
  }

  function playNext() {
    if (!player) return;

    if (typeof player.next === "function") {
      player.next();
    } else if (typeof player.playNext === "function") {
      player.playNext();
    }
  }

  function playPrevious() {
    if (!player) return;

    if (typeof player.previous === "function") {
      player.previous();
    } else if (typeof player.playPrevious === "function") {
      player.playPrevious();
    }
  }

  function updatePlayerUI() {
    if (!player || typeof player.getState !== "function") {
      return;
    }

    const playerState = player.getState() || {};
    const track = playerState.currentTrack || null;
    const playing = Boolean(playerState.playing);

    function setText(selector, value) {
      const element = $(selector);

      if (element) {
        element.textContent = value || "";
      }
    }

    setText(
      "#mini-player-title",
      track ? track.title : "Nothing playing"
    );

    setText(
      "#mini-player-artist",
      track ? track.artist : "Choose a track"
    );

    setText(
      "#now-playing-title",
      track ? track.title : "Nothing playing"
    );

    setText(
      "#now-playing-artist",
      track ? track.artist : "Choose a track to begin"
    );

    // Update artwork.

    const artwork =
      track && (track.artwork || track.cover_url);

    const miniCover = $("#mini-player-cover");
    const nowPlayingCover = $("#now-playing-cover");

    if (miniCover && artwork) {
      miniCover.src = artwork;
    }

    if (nowPlayingCover && artwork) {
      nowPlayingCover.src = artwork;
    }

    // Update play/pause buttons.

    const label = playing ? "❚❚" : "▶";

    [
      "#mini-player-toggle",
      "#player-toggle"
    ].forEach(function (selector) {
      const button = $(selector);

      if (!button) return;

      button.textContent = label;

      button.setAttribute(
        "aria-label",
        playing ? "Pause" : "Play"
      );
    });

    // Update player visibility.

    const miniPlayer = $("#mini-player");

    if (miniPlayer && track) {
      miniPlayer.hidden = false;
      miniPlayer.removeAttribute("hidden");
    }

    // Update progress.

    const duration = Number(playerState.duration || 0);
    const currentTime = Number(playerState.currentTime || 0);

    const progressFill = $("#player-progress-fill");

    if (progressFill && duration > 0) {
      progressFill.style.width =
        Math.min(100, (currentTime / duration) * 100) + "%";
    }

    const currentTimeElement = $("#player-current-time");
    const durationElement = $("#player-duration");

    if (currentTimeElement) {
      currentTimeElement.textContent =
        formatTime(currentTime);
    }

    if (durationElement) {
      durationElement.textContent =
        formatTime(duration);
    }
  }

  function formatTime(seconds) {
    const value = Math.max(
      0,
      Math.floor(Number(seconds) || 0)
    );

    const minutes = Math.floor(value / 60);
    const remaining = value % 60;

    return minutes + ":" + String(remaining).padStart(2, "0");
  }

  function bindPlayerEvents() {
    if (!player || typeof player.on !== "function") {
      return;
    }

    [
      "resona:play",
      "resona:pause",
      "resona:track-change",
      "resona:player-state-change",
      "resona:time-update"
    ].forEach(function (eventName) {
      try {
        player.on(eventName, updatePlayerUI);
      } catch (error) {
        console.warn(
          "[Resona] Player event binding warning:",
          eventName,
          error
        );
      }
    });
  }

  /* =========================================================
     8. TRACK RENDERING
     ========================================================= */

  function trackRow(track) {
    const liked = isLiked(track.id);

    const artwork = track.artwork
      ? '<img class="track-artwork" src="' +
        escapeHtml(track.artwork) +
        '" alt="" loading="lazy">'
      : '<span class="track-artwork-placeholder">♫</span>';

    return (
      '<article class="row resona-track-row">' +

        '<button type="button" class="m resona-track-info" ' +
          'data-action="play" ' +
          'data-track-id="' + escapeHtml(track.id) + '">' +

          artwork +

          '<span class="track-text">' +
            '<span class="tt">' +
              escapeHtml(track.title) +
            '</span>' +

            '<span class="tag">' +
              escapeHtml(track.artist) +
            '</span>' +
          '</span>' +

        '</button>' +

        '<button type="button" class="icon-button" ' +
          'data-action="like" ' +
          'data-track-id="' + escapeHtml(track.id) + '" ' +
          'aria-pressed="' + liked + '">' +

          (liked ? "♥" : "♡") +

        '</button>' +

        '<button type="button" class="icon-button" ' +
          'data-action="play" ' +
          'data-track-id="' + escapeHtml(track.id) + '">' +

          "▶" +

        '</button>' +

      '</article>'
    );
  }

  function renderTrackList(selector, tracks, emptyMessage) {
    const container = $(selector);

    if (!container) return;

    if (!tracks.length) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">♫</div>' +
          '<p>' + escapeHtml(emptyMessage) + '</p>' +
        '</div>';

      return;
    }

    container.innerHTML = tracks
      .map(trackRow)
      .join("");
  }

  /* =========================================================
     9. PAGE RENDERING
     ========================================================= */

  function renderHome() {
    const featured = state.tracks.filter(function (track) {
      return track.featured;
    });

    const list = featured.length
      ? featured
      : state.tracks.slice(0, 12);

    renderTrackList(
      "#featured-tracks",
      list,
      "No featured music available yet."
    );

    renderTrackList(
      "#trending-tracks",
      state.tracks.slice(0, 12),
      "Trending tracks will appear here."
    );

    const recent = state.history
      .map(function (item) {
        return getTrackById(item.id);
      })
      .filter(Boolean)
      .slice(0, 8);

    renderTrackList(
      "#recently-played",
      recent,
      "Your recently played music will appear here."
    );
  }

  function renderLibrary() {
    const liked = state.likedTracks
      .map(getTrackById)
      .filter(Boolean);

    const history = state.history
      .map(function (item) {
        return getTrackById(item.id);
      })
      .filter(Boolean);

    renderTrackList(
      "#liked-tracks",
      liked,
      "Your liked songs will appear here."
    );

    renderTrackList(
      "#listening-history",
      history,
      "Your listening history is empty."
    );

    renderTrackList(
      "#saved-tracks",
      [],
      "Your saved downloads will appear here."
    );
  }

  function renderExplore() {
    renderTrackList(
      "#explore-tracks",
      state.tracks,
      "No music is available yet."
    );
  }

  function renderSearch() {
    const query = String(state.searchQuery || "")
      .trim()
      .toLowerCase();

    const results = !query
      ? []
      : state.tracks.filter(function (track) {
          return (
            track.title.toLowerCase().includes(query) ||
            track.artist.toLowerCase().includes(query) ||
            track.album.toLowerCase().includes(query) ||
            track.genre.toLowerCase().includes(query) ||
            track.country.toLowerCase().includes(query)
          );
        });

    renderTrackList(
      "#search-results",
      results,
      query
        ? "No matching tracks found."
        : "Search for songs, artists, albums or genres."
    );
  }

  function renderArtists() {
    const artists = new Map();

    state.tracks.forEach(function (track) {
      const name = track.artist;

      if (!artists.has(name)) {
        artists.set(name, []);
      }

      artists.get(name).push(track);
    });

    const container = $("#artists-list");

    if (!container) return;

    if (!artists.size) {
      container.innerHTML =
        '<div class="empty-state">Artists will appear here.</div>';

      return;
    }

    container.innerHTML = Array.from(artists.entries())
      .map(function (entry) {
        return (
          '<article class="row">' +
            '<button type="button" data-action="artist-search" ' +
              'data-artist="' + escapeHtml(entry[0]) + '">' +
              '<strong>' + escapeHtml(entry[0]) + '</strong>' +
              '<span>' + entry[1].length + ' tracks</span>' +
            '</button>' +
          '</article>'
        );
      })
      .join("");
  }

  function renderAlbums() {
    const albums = new Map();

    state.tracks.forEach(function (track) {
      if (!track.album) return;

      if (!albums.has(track.album)) {
        albums.set(track.album, []);
      }

      albums.get(track.album).push(track);
    });

    const container = $("#albums-list");

    if (!container) return;

    if (!albums.size) {
      container.innerHTML =
        '<div class="empty-state">Albums will appear here.</div>';

      return;
    }

    container.innerHTML = Array.from(albums.entries())
      .map(function (entry) {
        return (
          '<article class="row">' +
            '<button type="button" data-action="album-search" ' +
              'data-album="' + escapeHtml(entry[0]) + '">' +
              '<strong>' + escapeHtml(entry[0]) + '</strong>' +
              '<span>' + entry[1].length + ' tracks</span>' +
            '</button>' +
          '</article>'
        );
      })
      .join("");
  }

  function renderPlaylists() {
    const container = $("#playlists-list");

    if (!container) return;

    const playlists = readStorage("playlists", []);

    if (!Array.isArray(playlists) || !playlists.length) {
      container.innerHTML =
        '<div class="empty-state">' +
          'Your playlists will appear here.' +
        '</div>';

      return;
    }

    container.innerHTML = playlists
      .map(function (playlist, index) {
        return (
          '<article class="row">' +
            '<button type="button" data-action="open-playlist" ' +
              'data-playlist-index="' + index + '">' +
              escapeHtml(playlist.name || "Untitled playlist") +
            '</button>' +
          '</article>'
        );
      })
      .join("");
  }

  /* =========================================================
     10. EVENT HANDLING
     ========================================================= */

  function bindEvents() {
    // Main navigation and track actions.

    document.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const pageButton = target.closest(
        "[data-navigate], [data-page-target], [data-page]"
      );

      if (pageButton) {
        const page =
          pageButton.dataset.navigate ||
          pageButton.dataset.pageTarget ||
          pageButton.dataset.page ||
          "";

        if (page && VALID_PAGES.has(page)) {
          event.preventDefault();
          showPage(page, pageButton);
          return;
        }
      }

      const actionButton = target.closest("[data-action]");

      if (!actionButton) return;

      const action = actionButton.dataset.action;
      const trackId = actionButton.dataset.trackId;

      if (action === "play" && trackId) {
        event.preventDefault();
        playTrackById(trackId);
        return;
      }

      if (action === "like" && trackId) {
        event.preventDefault();

        toggleLike(trackId);

        renderCurrentPage();

        return;
      }

      if (action === "artist-search") {
        event.preventDefault();

        state.searchQuery =
          actionButton.dataset.artist || "";

        showPage("search");

        const input = $("#search-input");

        if (input) {
          input.value = state.searchQuery;
        }

        renderSearch();

        return;
      }

      if (action === "album-search") {
        event.preventDefault();

        state.searchQuery =
          actionButton.dataset.album || "";

        showPage("search");

        const input = $("#search-input");

        if (input) {
          input.value = state.searchQuery;
        }

        renderSearch();
      }
    });

    // Search fields.

    [
      "#search-input",
      "#explore-search-input"
    ].forEach(function (selector) {
      const input = $(selector);

      if (!input) return;

      input.addEventListener("input", function () {
        state.searchQuery = input.value || "";

        if (selector === "#search-input") {
          renderSearch();
        } else {
          renderExploreSearch();
        }
      });
    });

    // Player controls.

    document.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const control = target.closest(
        "#mini-player-toggle, #player-toggle, " +
        "#mini-player-next, #player-next, " +
        "#mini-player-previous, #player-previous, " +
        "#mini-player-open, #now-playing-close, " +
        "#player-progress-track"
      );

      if (!control) return;

      const id = control.id;

      if (
        id === "mini-player-toggle" ||
        id === "player-toggle"
      ) {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
      }

      if (
        id === "mini-player-next" ||
        id === "player-next"
      ) {
        event.preventDefault();
        playNext();
      }

      if (
        id === "mini-player-previous" ||
        id === "player-previous"
      ) {
        event.preventDefault();
        playPrevious();
      }

      if (id === "now-playing-close") {
        event.preventDefault();

        const overlay = $("#now-playing");

        if (overlay) {
          overlay.hidden = true;
          overlay.classList.remove("open");
        }
      }

      if (id === "mini-player-open") {
        event.preventDefault();

        const overlay = $("#now-playing");

        if (overlay) {
          overlay.hidden = false;
          overlay.classList.add("open");
        }
      }

      if (id === "player-progress-track") {
        if (!player || typeof player.seek !== "function") {
          return;
        }

        const rect = control.getBoundingClientRect();

        const ratio = Math.max(
          0,
          Math.min(
            1,
            (event.clientX - rect.left) / rect.width
          )
        );

        const playerState = player.getState
          ? player.getState()
          : {};

        const duration = Number(
          playerState.duration || 0
        );

        if (duration > 0) {
          player.seek(ratio * duration);
        }
      }
    });

    // Other existing Resona actions.

    document.addEventListener("click", function (event) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const action = target.closest("[data-resona-action]");

      if (!action) return;

      switch (action.dataset.resonaAction) {
        case "clear-liked":
          event.preventDefault();
          clearLiked();
          break;

        case "clear-history":
          event.preventDefault();
          clearHistory();
          break;

        case "refresh":
          event.preventDefault();
          loadCatalogue().then(function () {
            renderCurrentPage();
            toast("Catalogue refreshed.");
          });
          break;

        case "shuffle":
          event.preventDefault();

          if (bridge && typeof bridge.setShuffle === "function") {
            const ps = player && player.getState
              ? player.getState()
              : {};

            bridge.setShuffle(!ps.shuffle);
          }

          break;

        case "repeat":
          event.preventDefault();

          if (bridge && typeof bridge.setRepeat === "function") {
            const ps = player && player.getState
              ? player.getState()
              : {};

            bridge.setRepeat(!ps.repeat);
          }

          break;
      }
    });

    // Browser back and forward navigation.

    window.addEventListener("popstate", function () {
      const page = getPageFromHash();

      if (VALID_PAGES.has(page)) {
        showPage(page, null, {
          fromHistory: true
        });
      } else {
        showPage("home", null, {
          fromHistory: true
        });
      }
    });

    window.addEventListener("hashchange", function () {
      const page = getPageFromHash();

      if (
        VALID_PAGES.has(page) &&
        page !== state.currentPage
      ) {
        showPage(page, null, {
          fromHistory: true
        });
      }
    });
  }

  function renderExploreSearch() {
    const input = $("#explore-search-input");

    if (!input) return;

    const query = input.value.trim().toLowerCase();

    const results = !query
      ? state.tracks
      : state.tracks.filter(function (track) {
          return (
            track.title.toLowerCase().includes(query) ||
            track.artist.toLowerCase().includes(query) ||
            track.album.toLowerCase().includes(query) ||
            track.genre.toLowerCase().includes(query)
          );
        });

    renderTrackList(
      "#explore-tracks",
      results,
      "No matching music found."
    );
  }

  /* =========================================================
     11. INITIALIZATION
     ========================================================= */

  async function init() {
    if (state.initialized) return;

    state.initialized = true;

    loadLibrary();

    bindEvents();

    // Initialize the existing shell-aware player.

    if (player && typeof player.init === "function") {
      try {
        await Promise.resolve(player.init());
      } catch (error) {
        console.warn(
          "[Resona] Player initialization warning:",
          error
        );
      }
    }

    bindPlayerEvents();

    await loadCatalogue();

    const hashPage = getPageFromHash();
    const savedPage = readStorage("last_page", "home");

    const startPage = VALID_PAGES.has(hashPage)
      ? hashPage
      : VALID_PAGES.has(savedPage)
        ? savedPage
        : "home";

    showPage(startPage, null, {
      fromHistory: true
    });

    updatePlayerUI();

    console.info(
      "[Resona App] Initialized.",
      "Tracks:",
      state.tracks.length
    );

    if (player) {
      console.info(
        "[Resona App] Existing ResonaPlayer connected."
      );
    } else {
      console.warn(
        "[Resona App] ResonaPlayer unavailable."
      );
    }
  }

  /* =========================================================
     12. PUBLIC APPLICATION API
     ========================================================= */

  window.ResonaApp = {
    init: init,
    showPage: showPage,
    playTrackById: playTrackById,
    toggleLike: toggleLike,
    loadCatalogue: loadCatalogue,

    getState: function () {
      return Object.assign({}, state, {
        tracks: state.tracks.slice(),
        likedTracks: state.likedTracks.slice(),
        history: state.history.slice()
      });
    },

    getTracks: function () {
      return state.tracks.slice();
    }
  };

  // Legacy compatibility helpers.

  window.showPage = showPage;
  window.togglePlay = togglePlayback;
  window.nextSong = playNext;
  window.prevSong = playPrevious;

  // Auto-start.

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }

})(window, document);
