/* =========================================================
   RESONA — APPLICATION CORE (js/app.js)
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
     1. SAFE REFERENCES (never overwrite existing modules)
     ========================================================= */

  const config = window.ResonaConfig || {};
  const api = window.ResonaAPI || null;
  const player = window.ResonaPlayer || null;   // real player from player.js
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
    "home", "explore", "search", "library",
    "artists", "albums", "playlists", "settings"
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

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function \[ (sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function storageKey(key) {
    const prefix = (config.storage && config.storage.prefix) || "resona_";
    return prefix + key;
  }

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function toast(message) {
    if (ui && typeof ui.showToast === "function") {
      ui.showToast(message);
      return;
    }
    let el = $("#resona-toast") || $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "resona-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = String(message);
    el.classList.add("show");
    el.style.display = "block";
    clearTimeout(el._timer);
    el._timer = setTimeout(function () {
      el.classList.remove("show");
      el.style.display = "";
    }, 2800);
  }

  function normalizeTrack(input) {
    if (!input || typeof input !== "object") return null;
    const id = String(input.id ?? input.track_id ?? "").trim();
    const title = String(input.title ?? input.name ?? "").trim();
    const artist = String(input.artist ?? input.artist_name ?? "").trim();
    if (!id || !title) return null;

    return {
      id: id,
      title: title,
      artist: artist || "Unknown artist",
      album: String(input.album ?? input.album_title ?? ""),
      artwork: String(input.artwork ?? input.cover_url ?? input.artwork_url ?? ""),
      audioUrl: String(input.audioUrl ?? input.audio_url ?? input.stream_url ?? ""),
      duration: Number(input.duration ?? input.duration_seconds ?? 0) || 0,
      country: String(input.country ?? ""),
      continent: String(input.continent ?? "").toLowerCase(),
      genre: String(input.genre ?? ""),
      featured: input.featured === true,
      rightsConfirmed: input.rightsConfirmed === true || input.rights_confirmed === true
    };
  }

  function getTrackById(id) {
    return state.tracks.find(function (t) {
      return String(t.id) === String(id);
    }) || null;
  }

  /* =========================================================
     4. NAVIGATION
     ========================================================= */

  function showPage(pageName, button) {
    const target = String(pageName || "home").toLowerCase();
    if (!VALID_PAGES.has(target)) {
      toast("That page is not available.");
      return false;
    }

    const pageId = PAGE_MAP[target] || (target + "-page");
    const pageEl = $("#" + pageId);

    if (!pageEl) {
      console.error("[Resona] Page missing:", pageId);
      toast("Page could not be opened.");
      return false;
    }

    // Hide all pages
    Object.keys(PAGE_MAP).forEach(function (name) {
      const el = $("#" + PAGE_MAP[name]);
      if (el) {
        el.classList.remove("active");
        el.setAttribute("aria-hidden", "true");
        el.hidden = true;
        el.style.display = "none";
      }
    });

    // Show target
    pageEl.classList.add("active");
    pageEl.setAttribute("aria-hidden", "false");
    pageEl.hidden = false;
    pageEl.style.display = "";

    state.currentPage = target;
    writeStorage("last_page", target);

    // Update nav buttons (supports data-page-target and data-page) \]("[data-page-target], [data-page], .nav-button").forEach(function (btn) {
      const btnPage = btn.dataset.pageTarget || btn.dataset.page || "";
      btn.classList.remove("active", "on");
      btn.removeAttribute("aria-current");
      if (btnPage === target) {
        btn.classList.add("active", "on");
        btn.setAttribute("aria-current", "page");
      }
    });

    if (button && button instanceof Element) {
      button.classList.add("active", "on");
      button.setAttribute("aria-current", "page");
    }

    // Update hash without triggering extra navigation
    try {
      const newHash = "#" + target;
      if (location.hash !== newHash) {
        history.replaceState(null, "", newHash);
      }
    } catch (e) {}

    renderCurrentPage();
    window.scrollTo({ top: 0, behavior: "auto" });
    return true;
  }

  function renderCurrentPage() {
    if (state.currentPage === "home") renderHome();
    if (state.currentPage === "library") renderLibrary();
    // explore / search keep existing HTML structure
  }

  /* =========================================================
     5. LIBRARY (local)
     ========================================================= */

  function loadLibrary() {
    state.likedTracks = readStorage("liked_tracks", []) || [];
    state.history = readStorage("history", []) || [];
  }

  function isLiked(trackId) {
    return state.likedTracks.some(function (id) {
      return String(id) === String(trackId);
    });
  }

  function toggleLike(trackId) {
    const id = String(trackId);
    if (isLiked(id)) {
      state.likedTracks = state.likedTracks.filter(function (x) {
        return String(x) !== id;
      });
      writeStorage("liked_tracks", state.likedTracks);
      toast("Removed from liked songs.");
      return false;
    }
    state.likedTracks.push(id);
    writeStorage("liked_tracks", state.likedTracks);
    toast("Added to liked songs.");
    return true;
  }

  function addHistory(track) {
    if (!track || !track.id) return;
    state.history = state.history.filter(function (item) {
      return String(item.id) !== String(track.id);
    });
    state.history.unshift({
      id: track.id,
      title: track.title,
      artist: track.artist,
      playedAt: new Date().toISOString()
    });
    state.history = state.history.slice(0, 100);
    writeStorage("history", state.history);
  }

  /* =========================================================
     6. CATALOGUE
     ========================================================= */

  async function loadCatalogue() {
    if (!api || typeof api.getTracks !== "function" && typeof api.request !== "function") {
      // Fallback: try common patterns
      if (api && typeof api.get === "function") {
        try {
          const data = await api.get("/tracks");
          const list = Array.isArray(data) ? data : (data && data.tracks) || [];
          state.tracks = list.map(normalizeTrack).filter(Boolean);
          return true;
        } catch (e) {
          console.warn("[Resona] Catalogue load failed:", e);
          return false;
        }
      }
      console.info("[Resona] API not configured or getTracks unavailable.");
      return false;
    }

    try {
      let list = [];
      if (typeof api.getTracks === "function") {
        list = await api.getTracks();
      } else if (typeof api.request === "function") {
        const res = await api.request("/tracks");
        list = Array.isArray(res) ? res : (res && res.tracks) || [];
      }
      state.tracks = (list || []).map(normalizeTrack).filter(Boolean);
      console.info("[Resona] Catalogue loaded:", state.tracks.length, "tracks");
      return true;
    } catch (error) {
      console.error("[Resona] Catalogue error:", error);
      toast("Could not load music catalogue.");
      return false;
    }
  }

  /* =========================================================
     7. PLAYER INTEGRATION (uses real ResonaPlayer only)
     ========================================================= */

  function playTrackById(trackId) {
    if (!player) {
      toast("Player is not available.");
      return;
    }

    const track = getTrackById(trackId);
    if (!track) {
      toast("Track not found in catalogue.");
      return;
    }

    // Real player expects a track OBJECT
    if (typeof player.playTrack === "function") {
      player.playTrack(track, { updateQueue: true }).then(function (ok) {
        if (ok) {
          addHistory(track);
          updatePlayerUI();
        }
      }).catch(function (err) {
        console.warn("[Resona] playTrack failed:", err);
        toast("Unable to start playback.");
      });
    } else {
      toast("Player API not ready.");
    }
  }

  function togglePlayback() {
    if (!player) return;
    if (typeof player.togglePlayback === "function") {
      player.togglePlayback();
    } else if (typeof player.toggle === "function") {
      player.toggle();
    }
  }

  function playNext() {
    if (!player) return;
    if (typeof player.next === "function") player.next();
    else if (typeof player.playNext === "function") player.playNext();
  }

  function playPrevious() {
    if (!player) return;
    if (typeof player.previous === "function") player.previous();
    else if (typeof player.playPrevious === "function") player.playPrevious();
  }

  function updatePlayerUI() {
    if (!player || typeof player.getState !== "function") return;

    const ps = player.getState() || {};
    const track = ps.currentTrack || null;
    const playing = Boolean(ps.playing);

    const setText = function (sel, value) {
      const el = $(sel);
      if (el) el.textContent = value || "";
    };

    setText("#mini-player-title", track ? track.title : "Nothing playing");
    setText("#mini-player-artist", track ? track.artist : "Choose a track");
    setText("#now-playing-title", track ? track.title : "Nothing playing");
    setText("#now-playing-artist", track ? track.artist : "Choose a track to begin");

    const label = playing ? "❚❚" : "▶";
    ["#mini-player-toggle", "#player-toggle"].forEach(function (sel) {
      const btn = $(sel);
      if (btn) {
        btn.textContent = label;
        btn.setAttribute("aria-label", playing ? "Pause" : "Play");
      }
    });

    const mini = $("#mini-player");
    if (mini) {
      if (track) {
        mini.hidden = false;
        mini.removeAttribute("hidden");
      }
    }
  }

  function bindPlayerEvents() {
    if (!player || typeof player.on !== "function") return;

    player.on("resona:play", updatePlayerUI);
    player.on("resona:pause", updatePlayerUI);
    player.on("resona:track-change", updatePlayerUI);
    player.on("resona:player-state-change", updatePlayerUI);
    player.on("resona:time-update", function () {
      // progress can be updated here if needed
    });
  }

  /* =========================================================
     8. RENDERING
     ========================================================= */

  function trackRow(track) {
    const liked = isLiked(track.id);
    return (
      '<article class="row resona-track-row">' +
        '<button type="button" class="m resona-track-info" data-action="play" data-track-id="' + escapeHtml(track.id) + '">' +
          '<span class="tt">' + escapeHtml(track.title) + '</span>' +
          '<span class="tag">' + escapeHtml(track.artist) + '</span>' +
        '</button>' +
        '<button type="button" class="icon-button" data-action="like" data-track-id="' + escapeHtml(track.id) + '" aria-pressed="' + liked + '">' +
          (liked ? "♥" : "♡") +
        '</button>' +
        '<button type="button" class="icon-button" data-action="play" data-track-id="' + escapeHtml(track.id) + '">▶</button>' +
      '</article>'
    );
  }

  function renderHome() {
    const container = $("#featured-tracks");
    if (!container) return;

    if (!state.tracks.length) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">♫</div>' +
          '<h3>No featured music yet</h3>' +
          '<p>Connect the catalogue API or add tracks to see music here.</p>' +
        '</div>';
      return;
    }

    const featured = state.tracks.filter(function (t) { return t.featured; });
    const list = featured.length ? featured : state.tracks.slice(0, 12);
    container.innerHTML = list.map(trackRow).join("");
  }

  function renderLibrary() {
    const likedContainer = $("#liked-tracks");
    const historyContainer = $("#listening-history");

    if (likedContainer) {
      const liked = state.likedTracks.map(getTrackById).filter(Boolean);
      likedContainer.innerHTML = liked.length
        ? liked.map(trackRow).join("")
        : '<div class="empty-state"><h3>Your favourites belong here</h3><p>Like tracks while exploring.</p></div>';
    }

    if (historyContainer) {
      const hist = state.history.map(function (item) {
        return getTrackById(item.id);
      }).filter(Boolean);
      historyContainer.innerHTML = hist.length
        ? hist.map(trackRow).join("")
        : '<div class="empty-state"><h3>No listening history yet</h3></div>';
    }
  }

  /* =========================================================
     9. EVENTS
     ========================================================= */

  function bindEvents() {
    // Navigation
    document.addEventListener("click", function (event) {
      const pageBtn = event.target.closest("[data-page-target], [data-page]");
      if (pageBtn) {
        event.preventDefault();
        const page = pageBtn.dataset.pageTarget || pageBtn.dataset.page || "";
        if (page) showPage(page, pageBtn);
        return;
      }

      const actionBtn = event.target.closest("[data-action]");
      if (!actionBtn) return;

      const action = actionBtn.dataset.action;
      const trackId = actionBtn.dataset.trackId;

      if (action === "play" && trackId) {
        event.preventDefault();
        playTrackById(trackId);
      } else if (action === "like" && trackId) {
        event.preventDefault();
        toggleLike(trackId);
        renderCurrentPage();
        updatePlayerUI();
      }
    });

    // Player controls (existing IDs)
    document.addEventListener("click", function (event) {
      const target = event.target.closest(
        "#mini-player-toggle, #player-toggle, " +
        "#mini-player-next, #player-next, " +
        "#mini-player-previous, #player-previous, " +
        "#mini-player-open, #now-playing-close"
      );
      if (!target) return;

      const id = target.id;
      if (id === "mini-player-toggle" || id === "player-toggle") {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
      } else if (id === "mini-player-next" || id === "player-next") {
        event.preventDefault();
        playNext();
      } else if (id === "mini-player-previous" || id === "player-previous") {
        event.preventDefault();
        playPrevious();
      } else if (id === "now-playing-close") {
        event.preventDefault();
        const np = $("#now-playing");
        if (np) {
          np.hidden = true;
          np.classList.remove("open");
        }
      } else if (id === "mini-player-open") {
        const np = $("#now-playing");
        if (np) {
          np.hidden = false;
          np.classList.add("open");
        }
      }
    });

    // Hash navigation / back-forward
    window.addEventListener("hashchange", function () {
      const page = String(location.hash || "").replace(/^#\/?/, "").toLowerCase();
      if (VALID_PAGES.has(page)) showPage(page);
    });

    window.addEventListener("popstate", function () {
      const page = String(location.hash || "").replace(/^#\/?/, "").toLowerCase() || "home";
      if (VALID_PAGES.has(page)) showPage(page);
    });
  }

  /* =========================================================
     10. INIT
     ========================================================= */

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    loadLibrary();
    bindEvents();

    // Initialize the real player (shell-aware)
    if (player && typeof player.init === "function") {
      try {
        player.init();
      } catch (e) {
        console.warn("[Resona] Player init warning:", e);
      }
    }

    bindPlayerEvents();

    await loadCatalogue();

    const saved = readStorage("last_page", "home");
    const startPage = VALID_PAGES.has(saved) ? saved : "home";
    showPage(startPage);

    updatePlayerUI();

    console.info("[Resona App] Initialized. Tracks:", state.tracks.length);
    if (player) {
      console.info("[Resona App] Using real ResonaPlayer (shell-compatible).");
    } else {
      console.warn("[Resona App] ResonaPlayer not found. Playback will not work.");
    }
  }

  /* =========================================================
     11. PUBLIC API (do not overwrite ResonaPlayer)
     ========================================================= */

  window.ResonaApp = {
    init: init,
    showPage: showPage,
    playTrackById: playTrackById,
    getState: function () { return Object.assign({}, state); },
    getTracks: function () { return state.tracks.slice(); }
  };

  // Legacy helpers (safe)
  window.showPage = showPage;
  window.togglePlay = togglePlayback;
  window.nextSong = playNext;
  window.prevSong = playPrevious;

  // Auto-start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})(window, document);
