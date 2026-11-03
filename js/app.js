/* =========================================================
   RESONA — APPLICATION CORE
   Complete replacement for js/app.js
   Compatible with current Resona index.html
   Uses player.js + shell-bridge.js for playback.
   ========================================================= */

(function () {
  "use strict";

  /* =======================================================
     1. CONFIGURATION
     ======================================================= */

  const ExistingConfig = window.ResonaConfig || {};

  const ResonaConfig = {
    ...ExistingConfig,

    apiBase:
      ExistingConfig.apiBase ||
      ExistingConfig.API_BASE ||
      "",

    enableDemoData: false,
    enableAudioPlayback: true,
    storagePrefix: ExistingConfig.storagePrefix || "resona_",
    maxHistory: 100,
    maxQueue: 500
  };

  window.ResonaConfig = ResonaConfig;

  /*
   * Capture the player created by js/player.js.
   * Never replace window.ResonaPlayer with the app wrapper.
   */

  const PersistentPlayer =
    window.ResonaPlayer || null;

  const ShellBridge =
    window.ResonaShellBridge || null;


  /* =======================================================
     2. APPLICATION STATE
     ======================================================= */

  const ResonaState = {
    currentPage: "home",

    tracks: [],
    artists: [],
    albums: [],
    playlists: [],

    likedTracks: [],
    listeningHistory: [],

    queue: [],
    queueIndex: -1,

    currentTrack: null,
    currentAudio: null,

    isPlaying: false,
    isLoading: false,

    searchQuery: "",

    selectedMood: "",
    selectedContinent: "",
    selectedCountry: "",

    libraryTab: "liked",

    playerExpanded: false,

    audioError: "",

    initialized: false
  };


  /* =======================================================
     3. DISCOVERY DATA
     ======================================================= */

  const RESONA_CONTINENTS = [
    {
      id: "africa",
      name: "Africa",
      emoji: "🌍",
      countries: [
        "Nigeria", "Ghana", "South Africa", "Kenya",
        "Uganda", "Tanzania", "Rwanda", "Ethiopia",
        "Senegal", "Cameroon", "Egypt", "Morocco",
        "Algeria", "Angola", "Botswana", "Côte d'Ivoire",
        "Democratic Republic of the Congo", "Zimbabwe",
        "Zambia", "Mozambique"
      ]
    },
    {
      id: "europe",
      name: "Europe",
      emoji: "🌍",
      countries: [
        "United Kingdom", "France", "Germany", "Italy",
        "Spain", "Portugal", "Netherlands", "Sweden",
        "Norway", "Denmark", "Switzerland", "Ireland",
        "Poland", "Greece", "Belgium", "Austria",
        "Finland", "Romania", "Ukraine", "Iceland"
      ]
    },
    {
      id: "asia",
      name: "Asia",
      emoji: "🌏",
      countries: [
        "Japan", "South Korea", "China", "India",
        "Indonesia", "Philippines", "Thailand", "Vietnam",
        "Malaysia", "Singapore", "Pakistan", "Bangladesh",
        "Sri Lanka", "Nepal", "Saudi Arabia",
        "United Arab Emirates", "Turkey", "Israel",
        "Lebanon", "Qatar"
      ]
    },
    {
      id: "north-america",
      name: "North America",
      emoji: "🌎",
      countries: [
        "United States", "Canada", "Mexico", "Jamaica",
        "Cuba", "Haiti", "Dominican Republic",
        "Costa Rica", "Panama", "Trinidad and Tobago",
        "Bahamas", "Barbados", "Guatemala", "Honduras",
        "El Salvador"
      ]
    },
    {
      id: "south-america",
      name: "South America",
      emoji: "🌎",
      countries: [
        "Brazil", "Argentina", "Colombia", "Chile",
        "Peru", "Ecuador", "Venezuela", "Uruguay",
        "Paraguay", "Bolivia", "Guyana", "Suriname"
      ]
    },
    {
      id: "oceania",
      name: "Oceania",
      emoji: "🌏",
      countries: [
        "Australia", "New Zealand", "Fiji",
        "Papua New Guinea", "Samoa", "Tonga",
        "Vanuatu", "Solomon Islands"
      ]
    }
  ];

  const RESONA_MOODS = [
    {
      id: "calm",
      label: "Calm",
      emoji: "🌙",
      description: "Quiet moments and gentle sounds"
    },
    {
      id: "energetic",
      label: "Energetic",
      emoji: "⚡",
      description: "Music that gets you moving"
    },
    {
      id: "melancholy",
      label: "Melancholy",
      emoji: "🌧️",
      description: "Reflective and emotional sounds"
    },
    {
      id: "focus",
      label: "Focus",
      emoji: "🎧",
      description: "Music for concentration"
    },
    {
      id: "party",
      label: "Party",
      emoji: "🎉",
      description: "Music for celebrations"
    },
    {
      id: "night",
      label: "Night",
      emoji: "🌃",
      description: "Sounds for late hours"
    }
  ];


  /* =======================================================
     4. UTILITIES
     ======================================================= */

  const ResonaUtils = {

    $(selector, root = document) {
      return root.querySelector(selector);
    },

    $$(selector, root = document) {
      return Array.from(root.querySelectorAll(selector));
    },

    escape(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    },

    storageKey(key) {
      return ResonaConfig.storagePrefix + key;
    },

    readStorage(key, fallback = null) {
      try {
        const value = localStorage.getItem(
          this.storageKey(key)
        );

        return value === null
          ? fallback
          : JSON.parse(value);

      } catch (error) {
        console.warn("Resona storage read failed:", error);
        return fallback;
      }
    },

    writeStorage(key, value) {
      try {
        localStorage.setItem(
          this.storageKey(key),
          JSON.stringify(value)
        );

        return true;

      } catch (error) {
        console.warn("Resona storage write failed:", error);
        return false;
      }
    },

    createId(prefix = "resona") {
      if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
      ) {
        return prefix + "_" + crypto.randomUUID();
      }

      return prefix + "_" +
        Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2);
    },

    formatTime(seconds) {
      const value = Number(seconds);

      if (!Number.isFinite(value) || value < 0) {
        return "0:00";
      }

      return Math.floor(value / 60) + ":" +
        String(Math.floor(value % 60)).padStart(2, "0");
    },

    formatDate(value) {
      if (!value) return "";

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) return "";

      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(date);
    },

    isValidHttpUrl(value) {
      try {
        const url = new URL(value);

        return (
          url.protocol === "https:" ||
          url.protocol === "http:"
        );

      } catch {
        return false;
      }
    },

    safeImage(value) {
      if (!value) return "";

      const image = String(value).trim();

      if (
        image.startsWith("/") &&
        !image.startsWith("//")
      ) {
        return image;
      }

      return this.isValidHttpUrl(image)
        ? image
        : "";
    },

    safeAudioUrl(value) {
      if (!value) return "";

      const url = String(value).trim();

      return this.isValidHttpUrl(url)
        ? url
        : "";
    },

    debounce(callback, delay = 250) {
      let timeout;

      return (...args) => {
        clearTimeout(timeout);

        timeout = setTimeout(() => {
          callback(...args);
        }, delay);
      };
    }
  };


  /* =======================================================
     5. NOTIFICATIONS
     ======================================================= */

  const ResonaToast = {
    timeout: null,

    show(message, duration = 2800) {
      let element =
        ResonaUtils.$("#resona-toast") ||
        ResonaUtils.$("#toast");

      if (!element) {
        element = document.createElement("div");

        element.id = "resona-toast";
        element.setAttribute("role", "status");
        element.setAttribute("aria-live", "polite");

        document.body.appendChild(element);
      }

      element.textContent = String(message);

      element.classList.add("show");
      element.style.display = "block";

      clearTimeout(this.timeout);

      this.timeout = setTimeout(() => {
        element.classList.remove("show");
        element.style.display = "";
      }, duration);
    }
  };


  /* =======================================================
     6. MUSIC CATALOGUE
     ======================================================= */

  const ResonaCatalogue = {

    normalizeTrack(input) {
      if (!input || typeof input !== "object") {
        return null;
      }

      const id = String(
        input.id ??
        input.track_id ??
        input.trackId ??
        ""
      ).trim();

      const title = String(
        input.title ??
        input.name ??
        ""
      ).trim();

      const artist = String(
        input.artist ??
        input.artist_name ??
        ""
      ).trim();

      if (!id || !title || !artist) {
        return null;
      }

      const duration = Number(
        input.duration ??
        input.duration_seconds ??
        0
      );

      const mood = Array.isArray(input.mood)
        ? input.mood.map(String)
        : typeof input.mood === "string"
          ? input.mood.split(",")
              .map(item => item.trim())
              .filter(Boolean)
          : [];

      const artwork = ResonaUtils.safeImage(
        input.artwork ??
        input.artwork_url ??
        input.cover_url ??
        input.coverUrl ??
        input.image_url ??
        ""
      );

      const audioUrl = ResonaUtils.safeAudioUrl(
        input.audioUrl ??
        input.audio_url ??
        input.stream_url ??
        input.file_url ??
        ""
      );

      return {
        id,
        title,
        artist,

        artistId: String(
          input.artistId ??
          input.artist_id ??
          ""
        ),

        album: String(
          input.album ??
          input.album_title ??
          ""
        ),

        albumId: String(
          input.albumId ??
          input.album_id ??
          ""
        ),

        artwork,
        artwork_url: artwork,

        audioUrl,
        audio_url: audioUrl,

        duration:
          Number.isFinite(duration) && duration > 0
            ? duration
            : 0,

        country: String(
          input.country ?? ""
        ).trim(),

        continent: String(
          input.continent ?? ""
        ).trim().toLowerCase(),

        genre: String(
          input.genre ?? ""
        ).trim(),

        mood,

        releaseDate: String(
          input.releaseDate ??
          input.release_date ??
          ""
        ),

        rightsConfirmed:
          input.rightsConfirmed === true ||
          input.rights_confirmed === true,

        explicit: input.explicit === true,
        featured: input.featured === true,

        verifiedArtist:
          input.verifiedArtist === true ||
          input.verified_artist === true,

        plays: Math.max(
          0,
          Number(input.plays) || 0
        ),

        createdAt: String(
          input.createdAt ??
          input.created_at ??
          ""
        )
      };
    },

    normalizeTracks(input) {
      if (!Array.isArray(input)) return [];

      const seen = new Set();
      const result = [];

      for (const item of input) {
        const track = this.normalizeTrack(item);

        if (!track || seen.has(track.id)) continue;

        seen.add(track.id);
        result.push(track);
      }

      return result;
    },

    getTrack(id) {
      return ResonaState.tracks.find(
        track => String(track.id) === String(id)
      ) || null;
    },

    search(query) {
      const term = String(query ?? "")
        .trim()
        .toLowerCase();

      if (!term) return [];

      return ResonaState.tracks.filter(track => {
        const searchable = [
          track.title,
          track.artist,
          track.album,
          track.genre,
          track.country,
          track.continent
        ].join(" ").toLowerCase();

        return searchable.includes(term);
      });
    },

    byContinent(continent) {
      return ResonaState.tracks.filter(
        track =>
          track.continent ===
          String(continent).toLowerCase()
      );
    },

    byCountry(country) {
      return ResonaState.tracks.filter(
        track =>
          track.country.toLowerCase() ===
          String(country).toLowerCase()
      );
    },

    byMood(mood) {
      return ResonaState.tracks.filter(
        track =>
          track.mood.some(
            item =>
              item.toLowerCase() ===
              String(mood).toLowerCase()
          )
      );
    }
  };


  /* =======================================================
     7. PERSONAL LIBRARY
     ======================================================= */

  const ResonaLibrary = {

    load() {
      const liked = ResonaUtils.readStorage(
        "liked_tracks",
        []
      );

      const history = ResonaUtils.readStorage(
        "history",
        []
      );

      ResonaState.likedTracks =
        Array.isArray(liked) ? liked : [];

      ResonaState.listeningHistory =
        Array.isArray(history) ? history : [];
    },

    isLiked(trackId) {
      return ResonaState.likedTracks.some(
        id => String(id) === String(trackId)
      );
    },

    toggleLike(trackId) {
      const id = String(trackId);

      if (this.isLiked(id)) {
        ResonaState.likedTracks =
          ResonaState.likedTracks.filter(
            item => String(item) !== id
          );

        ResonaUtils.writeStorage(
          "liked_tracks",
          ResonaState.likedTracks
        );

        return false;
      }

      ResonaState.likedTracks.push(id);

      ResonaUtils.writeStorage(
        "liked_tracks",
        ResonaState.likedTracks
      );

      return true;
    },

    addHistory(track) {
      if (!track) return;

      ResonaState.listeningHistory =
        ResonaState.listeningHistory.filter(
          item => String(item.id) !== String(track.id)
        );

      ResonaState.listeningHistory.unshift({
        id: track.id,
        title: track.title,
        artist: track.artist,
        playedAt: new Date().toISOString()
      });

      ResonaState.listeningHistory =
        ResonaState.listeningHistory.slice(
          0,
          ResonaConfig.maxHistory
        );

      ResonaUtils.writeStorage(
        "history",
        ResonaState.listeningHistory
      );
    },

    getLiked() {
      return ResonaState.likedTracks
        .map(id => ResonaCatalogue.getTrack(id))
        .filter(Boolean);
    },

    getHistory() {
      return ResonaState.listeningHistory
        .map(item => ({
          ...item,
          track: ResonaCatalogue.getTrack(item.id)
        }))
        .filter(item => item.track);
    },

    clearHistory() {
      ResonaState.listeningHistory = [];

      ResonaUtils.writeStorage("history", []);

      ResonaToast.show("Listening history cleared.");

      ResonaLibraryPage.render();
    }
  };


  /* =======================================================
     8. PAGE NAVIGATION
     ======================================================= */

  const ResonaNavigation = {

    pageMap: {
      home: "home-page",
      explore: "explore-page",
      search: "search-page",
      library: "library-page",
      artists: "artists-page",
      albums: "albums-page",
      playlists: "playlists-page",
      settings: "settings-page"
    },

    pages: [
      "home",
      "explore",
      "search",
      "library",
      "artists",
      "albums",
      "playlists",
      "settings"
    ],

    getPageElement(name) {
      const id = this.pageMap[name] || (name + "-page");

      return ResonaUtils.$("#" + id);
    },

    show(pageName, button = null, updateHistory = true) {
      const target = String(
        pageName || "home"
      ).toLowerCase().trim();

      if (!this.pages.includes(target)) {
        return false;
      }

      const pageElement = this.getPageElement(target);

      if (!pageElement) {
        console.error("Resona page missing:", target);

        ResonaToast.show(
          "The requested page could not be opened."
        );

        return false;
      }

      Object.values(this.pageMap).forEach(id => {
        const element = ResonaUtils.$("#" + id);

        if (!element) return;

        element.classList.remove("active");

        element.setAttribute("aria-hidden", "true");

        element.hidden = true;
        element.style.display = "none";
      });

      pageElement.hidden = false;
      pageElement.style.display = "";
      pageElement.classList.add("active");

      pageElement.setAttribute("aria-hidden", "false");

      ResonaState.currentPage = target;

      ResonaUtils.writeStorage(
        "last_page",
        target
      );

      ResonaUtils.$$(
        "[data-navigate], [data-page-target], [data-page], .nav-button"
      ).forEach(navButton => {

        const buttonPage =
          navButton.dataset.navigate ||
          navButton.dataset.pageTarget ||
          navButton.dataset.page ||
          "";

        navButton.classList.remove("active", "on");

        navButton.removeAttribute("aria-current");

        if (buttonPage === target) {
          navButton.classList.add("active");

          navButton.setAttribute(
            "aria-current",
            "page"
          );
        }
      });

      if (button instanceof Element) {
        button.classList.add("active");

        button.setAttribute(
          "aria-current",
          "page"
        );
      }

      if (updateHistory) {
        const hash = "#" + target;

        if (window.location.hash !== hash) {
          window.history.pushState(
            { page: target },
            "",
            hash
          );
        }
      }

      this.renderPage(target);

      const main = ResonaUtils.$(".main-area");

      if (main) {
        main.scrollTop = 0;
      }

      window.scrollTo({
        top: 0,
        behavior: "auto"
      });

      return true;
    },

    renderPage(page) {
      switch (page) {
        case "home":
          ResonaHome.render();
          break;

        case "explore":
          ResonaExplore.render();
          break;

        case "search":
          ResonaSearch.render();
          break;

        case "library":
          ResonaLibraryPage.render();
          break;
      }
    },

    readHash() {
      const raw = window.location.hash
        .replace(/^#/, "");

      const page = raw.split("?")[0].toLowerCase();

      return this.pages.includes(page)
        ? page
        : "home";
    },

    handleHashChange() {
      const page = this.readHash();

      if (page !== ResonaState.currentPage) {
        this.show(page, null, false);
      }
    }
  };


  /* =======================================================
     9. TRACK DISPLAY
     ======================================================= */

  const ResonaTrackUI = {

    artwork(track, size = "") {
      const image = ResonaUtils.safeImage(
        track.artwork
      );

      const sizeClass = size ? " " + size : "";

      if (image) {
        return `
          <div class="art${sizeClass}">
            <img
              src="${ResonaUtils.escape(image)}"
              alt="${ResonaUtils.escape(track.title)} artwork"
              loading="lazy"
              onerror="this.style.display='none'"
            >
          </div>
        `;
      }

      return `
        <div class="art${sizeClass} resona-art-placeholder">
          <span aria-hidden="true">♫</span>
        </div>
      `;
    },

    row(track) {
      const liked = ResonaLibrary.isLiked(track.id);

      return `
        <article class="row resona-track-row">

          ${this.artwork(track)}

          <button
            type="button"
            class="m resona-track-info"
            data-action="play"
            data-track-id="${ResonaUtils.escape(track.id)}"
            aria-label="Play ${ResonaUtils.escape(track.title)}"
          >
            <span class="tt">
              ${ResonaUtils.escape(track.title)}
            </span>

            <span class="tag">
              ${ResonaUtils.escape(track.artist)}
              ${
                track.album
                  ? " · " + ResonaUtils.escape(track.album)
                  : ""
              }
            </span>
          </button>

          <button
            type="button"
            class="icon-button"
            data-action="like"
            data-track-id="${ResonaUtils.escape(track.id)}"
            aria-label="${liked ? "Unlike" : "Like"} ${ResonaUtils.escape(track.title)}"
            aria-pressed="${liked}"
          >
            ${liked ? "♥" : "♡"}
          </button>

          <button
            type="button"
            class="icon-button"
            data-action="play"
            data-track-id="${ResonaUtils.escape(track.id)}"
            aria-label="Play track"
          >
            ▶
          </button>

        </article>
      `;
    },

    empty(message, description = "") {
      return `
        <div class="empty-state">
          <div class="empty-icon">♫</div>
          <h3>${ResonaUtils.escape(message)}</h3>
          ${
            description
              ? `<p>${ResonaUtils.escape(description)}</p>`
              : ""
          }
        </div>
      `;
    },

    section(title, tracks, options = {}) {
      const items = tracks || [];

      const displayTracks = options.limit
        ? items.slice(0, options.limit)
        : items;

      return `
        <section class="resona-section">
          <div class="section-heading">
            <h2>${ResonaUtils.escape(title)}</h2>
          </div>

          ${
            displayTracks.length
              ? `
                <div class="resona-track-list">
                  ${displayTracks.map(track => this.row(track)).join("")}
                </div>
              `
              : this.empty(
                  options.emptyTitle || "Nothing here yet",
                  options.emptyDescription || ""
                )
          }
        </section>
      `;
    }
  };


  /* =======================================================
     10. HOME
     ======================================================= */

  const ResonaHome = {

    render() {
      const featured = ResonaUtils.$(
        "#featured-tracks"
      );

      if (!featured) return;

      const recommendations =
        ResonaState.tracks.filter(
          track => track.featured
        ).length
          ? ResonaState.tracks.filter(
              track => track.featured
            )
          : ResonaState.tracks;

      if (recommendations.length) {
        featured.innerHTML = recommendations
          .slice(0, 10)
          .map(track => ResonaTrackUI.row(track))
          .join("");
      } else {
        featured.innerHTML = ResonaTrackUI.empty(
          "No featured music yet",
          "Music will appear here when the catalogue is connected."
        );
      }
    }
  };


  /* =======================================================
     11. EXPLORE
     ======================================================= */

  const ResonaExplore = {

    render() {
      const container = ResonaUtils.$(
        "#explore-tracks"
      );

      if (!container) return;

      let tracks = ResonaState.tracks;

      if (ResonaState.selectedContinent) {
        tracks = tracks.filter(
          track =>
            track.continent ===
            ResonaState.selectedContinent
        );
      }

      if (ResonaState.selectedCountry) {
        tracks = tracks.filter(
          track =>
            track.country.toLowerCase() ===
            ResonaState.selectedCountry.toLowerCase()
        );
      }

      container.innerHTML = tracks.length
        ? tracks.slice(0, 50)
            .map(track => ResonaTrackUI.row(track))
            .join("")
        : ResonaTrackUI.empty(
            "No music found",
            "There are currently no tracks matching this selection."
          );
    },

    openContinent(id) {
      ResonaState.selectedContinent = String(id);
      ResonaState.selectedCountry = "";

      ResonaNavigation.show("explore");
    },

    openCountry(country) {
      ResonaState.selectedCountry = String(country);

      ResonaNavigation.show("explore");
    },

    resetSelection() {
      ResonaState.selectedContinent = "";
      ResonaState.selectedCountry = "";

      this.render();
    }
  };


  /* =======================================================
     12. SEARCH
     ======================================================= */

  const ResonaSearch = {

    render() {
      const input = ResonaUtils.$("#search-input");

      const container = ResonaUtils.$(
        "#search-results"
      );

      if (!container) return;

      const query = input
        ? input.value.trim()
        : ResonaState.searchQuery;

      if (!query) {
        container.innerHTML = ResonaTrackUI.empty(
          "Search Resona",
          "Find songs, artists, albums and more."
        );

        return;
      }

      const results = ResonaCatalogue.search(query);

      container.innerHTML = results.length
        ? results.map(
            track => ResonaTrackUI.row(track)
          ).join("")
        : ResonaTrackUI.empty(
            "No results found",
            "Try another song title, artist or genre."
          );
    },

    open(query = "") {
      ResonaState.searchQuery = String(query);

      ResonaNavigation.show("search");

      const input =
        ResonaUtils.$("#search-input") ||
        ResonaUtils.$("#explore-search-input");

      if (input) {
        input.value = ResonaState.searchQuery;
        this.render();
        input.focus();
      }
    }
  };


  /* =======================================================
     13. LIBRARY
     ======================================================= */

  const ResonaLibraryPage = {

    render() {
      const likedContainer = ResonaUtils.$(
        "#liked-tracks"
      );

      const historyContainer = ResonaUtils.$(
        "#listening-history"
      );

      if (likedContainer) {
        const liked = ResonaLibrary.getLiked();

        likedContainer.innerHTML = liked.length
          ? liked.map(
              track => ResonaTrackUI.row(track)
            ).join("")
          : ResonaTrackUI.empty(
              "Your favourites belong here",
              "Like tracks while exploring to save them."
            );
      }

      if (historyContainer) {
        const history = ResonaLibrary.getHistory();

        historyContainer.innerHTML = history.length
          ? history.map(
              item => ResonaTrackUI.row(item.track)
            ).join("")
          : ResonaTrackUI.empty(
              "No listening history yet",
              "Tracks you listen to will appear here."
            );
      }
    },

    openTab(tab) {
      if (!["liked", "history", "playlists"].includes(tab)) {
        return;
      }

      ResonaState.libraryTab = tab;

      this.render();
    }
  };


  /* =======================================================
     14. PLAYBACK ADAPTER
     Uses js/player.js.
     Does not create a second HTML Audio element.
     ======================================================= */

  const ResonaPlayback = {

    getEngine() {
      return PersistentPlayer ||
        window.ResonaPlayer ||
        null;
    },

    isAvailable() {
      const engine = this.getEngine();

      return Boolean(
        engine &&
        typeof engine.playTrack === "function"
      );
    },

    canPlay(track) {
      return Boolean(
        ResonaConfig.enableAudioPlayback &&
        track &&
        track.audioUrl &&
        track.rightsConfirmed
      );
    },

    syncState() {
      const engine = this.getEngine();

      if (!engine) return;

      try {
        const state = typeof engine.getState === "function"
          ? engine.getState()
          : null;

        if (!state) return;

        ResonaState.isPlaying = Boolean(
          state.playing ??
          state.isPlaying ??
          false
        );

        const current = state.currentTrack;

        if (current) {
          const normalized =
            ResonaCatalogue.normalizeTrack(current);

          if (normalized) {
            ResonaState.currentTrack = normalized;
          } else {
            ResonaState.currentTrack = current;
          }
        }

        if (Array.isArray(state.queue)) {
          ResonaState.queue = state.queue;
        }

        if (Number.isInteger(state.currentIndex)) {
          ResonaState.queueIndex = state.currentIndex;
        }

        this.updatePlayerUI();

      } catch (error) {
        console.warn(
          "Resona player state sync failed:",
          error
        );
      }
    },

    playTrack(trackId, queue = null) {
      const track = ResonaCatalogue.getTrack(trackId);

      if (!track) {
        ResonaToast.show(
          "This track is not available in the catalogue."
        );

        return false;
      }

      if (!this.canPlay(track)) {
        ResonaToast.show(
          "Playback is unavailable for this track."
        );

        return false;
      }

      const engine = this.getEngine();

      if (!engine || typeof engine.playTrack !== "function") {
        ResonaToast.show(
          "The Resona player is not ready. Please refresh the page."
        );

        console.error(
          "Resona player.js is missing or has not initialized."
        );

        return false;
      }

      const normalizedQueue = Array.isArray(queue)
        ? queue
            .map(item =>
              ResonaCatalogue.normalizeTrack(item)
            )
            .filter(Boolean)
            .slice(0, ResonaConfig.maxQueue)
        : ResonaState.tracks.slice(
            0,
            ResonaConfig.maxQueue
          );

      ResonaState.queue = normalizedQueue;

      ResonaState.queueIndex =
        normalizedQueue.findIndex(
          item => String(item.id) === String(track.id)
        );

      ResonaState.currentTrack = track;
      ResonaState.audioError = "";

      this.updatePlayerUI();

      try {
        const result = engine.playTrack(
          track,
          normalizedQueue
        );

        if (result && typeof result.catch === "function") {
          result.catch(error => {
            console.error("Resona play error:", error);
            ResonaToast.show("Playback could not start.");
          });
        }

        ResonaLibrary.addHistory(track);

        return true;

      } catch (error) {
        console.error("Resona playback error:", error);

        ResonaToast.show(
          "Playback could not start."
        );

        return false;
      }
    },

    toggle() {
      const engine = this.getEngine();

      if (!engine) {
        ResonaToast.show("The player is not available.");
        return;
      }

      if (typeof engine.toggle === "function") {
        engine.toggle();
      } else if (ResonaState.isPlaying) {
        this.pause();
      } else {
        this.resume();
      }

      setTimeout(() => this.syncState(), 100);
    },

    pause() {
      const engine = this.getEngine();

      if (engine && typeof engine.pause === "function") {
        engine.pause();
      }

      ResonaState.isPlaying = false;
      this.updatePlayerUI();
    },

    resume() {
      const engine = this.getEngine();

      if (engine && typeof engine.resume === "function") {
        engine.resume();
      }

      setTimeout(() => this.syncState(), 100);
    },

    stopAudio() {
      this.pause();
    },

    next() {
      const engine = this.getEngine();

      if (engine && typeof engine.next === "function") {
        engine.next();
      }

      setTimeout(() => this.syncState(), 150);
    },

    previous() {
      const engine = this.getEngine();

      if (engine && typeof engine.previous === "function") {
        engine.previous();
      }

      setTimeout(() => this.syncState(), 150);
    },

    seek(value) {
      const engine = this.getEngine();

      if (!engine) return;

      const percentage = Math.max(
        0,
        Math.min(100, Number(value) || 0)
      );

      const state = typeof engine.getState === "function"
        ? engine.getState()
        : null;

      const duration = Number(state?.duration || 0);

      if (duration > 0 && typeof engine.seek === "function") {
        engine.seek(duration * percentage / 100);
      }
    },

    updateProgress() {
      const engine = this.getEngine();

      let currentTime = 0;
      let duration = 0;

      if (engine && typeof engine.getState === "function") {
        try {
          const state = engine.getState() || {};

          currentTime = Number(
            state.currentTime || 0
          );

          duration = Number(
            state.duration || 0
          );

        } catch (error) {
          console.warn("Player progress unavailable:", error);
        }
      }

      if (!duration && ResonaState.currentTrack) {
        duration = Number(
          ResonaState.currentTrack.duration || 0
        );
      }

      const percentage = duration > 0
        ? (currentTime / duration) * 100
        : 0;

      const fill = ResonaUtils.$(
        "#player-progress-fill"
      );

      if (fill) {
        fill.style.width = percentage + "%";
      }

      const track = ResonaUtils.$(
        "#player-progress-track"
      );

      if (track) {
        track.setAttribute(
          "aria-valuenow",
          String(Math.round(percentage))
        );
      }

      const currentEl = ResonaUtils.$(
        "#player-current-time"
      );

      if (currentEl) {
        currentEl.textContent =
          ResonaUtils.formatTime(currentTime);
      }

      const durationEl = ResonaUtils.$(
        "#player-duration"
      );

      if (durationEl) {
        durationEl.textContent =
          ResonaUtils.formatTime(duration);
      }
    },

    updatePlayerUI() {
      const track = ResonaState.currentTrack;

      const mini = ResonaUtils.$(
        "#mini-player"
      );

      if (mini) {
        mini.style.display = track ? "flex" : "";
      }

      if (!track) {
        this.updateProgress();
        return;
      }

      const setText = (selector, value) => {
        const element = ResonaUtils.$(selector);

        if (element) {
          element.textContent = value || "";
        }
      };

      setText("#mini-player-title", track.title);
      setText("#mini-player-artist", track.artist);
      setText("#now-playing-title", track.title);
      setText("#now-playing-artist", track.artist);

      const playLabel = ResonaState.isPlaying
        ? "❚❚"
        : "▶";

      [
        "#mini-player-toggle",
        "#player-toggle"
      ].forEach(selector => {
        const button = ResonaUtils.$(selector);

        if (button) {
          button.textContent = playLabel;

          button.setAttribute(
            "aria-label",
            ResonaState.isPlaying
              ? "Pause"
              : "Play"
          );
        }
      });

      this.updateProgress();
    }
  };


  /* =======================================================
     15. NOW PLAYING
     ======================================================= */

  const ResonaNowPlaying = {

    open() {
      const element = ResonaUtils.$(
        "#now-playing"
      );

      if (!element) return;

      element.classList.add("open");

      element.setAttribute(
        "aria-hidden",
        "false"
      );

      ResonaState.playerExpanded = true;

      ResonaPlayback.updatePlayerUI();
    },

    close() {
      const element = ResonaUtils.$(
        "#now-playing"
      );

      if (!element) return;

      element.classList.remove("open");

      element.setAttribute(
        "aria-hidden",
        "true"
      );

      ResonaState.playerExpanded = false;
    }
  };


  /* =======================================================
     16. BACKEND API
     ======================================================= */

  const ResonaAPI = {

    getBaseUrl() {
      return String(
        ResonaConfig.apiBase || ""
      ).replace(/\/+$/, "");
    },

    async request(path, options = {}) {
      const baseUrl = this.getBaseUrl();

      if (!baseUrl) {
        throw new Error(
          "Resona API is not configured."
        );
      }

      const url =
        baseUrl + "/" +
        String(path).replace(/^\/+/, "");

      const response = await fetch(url, {
        ...options,

        headers: {
          Accept: "application/json",

          ...(options.body
            ? { "Content-Type": "application/json" }
            : {}),

          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        throw new Error(
          "API request failed with status " +
          response.status
        );
      }

      return response.json();
    },

    async loadCatalogue() {
      if (!this.getBaseUrl()) {
        console.info(
          "Resona API is not configured."
        );

        return false;
      }

      try {
        ResonaState.isLoading = true;

        const response = await this.request(
          "/tracks"
        );

        const rawTracks = Array.isArray(response)
          ? response
          : Array.isArray(response.tracks)
            ? response.tracks
            : Array.isArray(response.data)
              ? response.data
              : [];

        ResonaState.tracks =
          ResonaCatalogue.normalizeTracks(rawTracks);

        ResonaState.isLoading = false;

        return true;

      } catch (error) {
        ResonaState.isLoading = false;

        console.error(
          "Could not load Resona catalogue:",
          error
        );

        ResonaToast.show(
          "Music catalogue could not be loaded."
        );

        return false;
      }
    }
  };


  /* =======================================================
     17. PLAYER EVENT SYNCHRONIZATION
     ======================================================= */

  const ResonaPlayerEvents = {

    bound: false,

    bind() {
      if (this.bound) return;

      this.bound = true;

      const engine = PersistentPlayer;

      if (engine && typeof engine.on === "function") {
        [
          "state",
          "play",
          "pause",
          "ended",
          "trackchange",
          "timeupdate",
          "error",
          "ready"
        ].forEach(eventName => {
          try {
            engine.on(eventName, payload => {
              this.handle(eventName, payload);
            });
          } catch (error) {
            console.warn(
              "Could not subscribe to player event:",
              eventName,
              error
            );
          }
        });
      }

      /*
       * Also listen to shell messages.
       * This helps keep the UI synchronized when
       * playback is controlled outside the page.
       */

      window.addEventListener("message", event => {
        if (event.origin !== window.location.origin) {
          return;
        }

        const message = event.data;

        if (
          !message ||
          message.source !== "resona-shell"
        ) {
          return;
        }

        const action = String(message.action || "");

        if (
          [
            "PLAYER_STATE",
            "PLAYBACK_PLAY",
            "PLAYBACK_PAUSE",
            "PLAYBACK_ENDED",
            "TRACK_CHANGED",
            "TIME_UPDATE",
            "PLAYER_ERROR"
          ].includes(action)
        ) {
          this.handle(action, message.payload);
        }
      });
    },

    handle(eventName, payload) {
      const event = String(eventName).toLowerCase();

      if (
        event === "play" ||
        event === "playback_play"
      ) {
        ResonaState.isPlaying = true;
      }

      if (
        event === "pause" ||
        event === "playback_pause" ||
        event === "ended" ||
        event === "playback_ended"
      ) {
        ResonaState.isPlaying = false;
      }

      const suppliedTrack =
        payload?.track ||
        payload?.currentTrack ||
        (
          payload && (
            payload.id ||
            payload.track_id
          )
            ? payload
            : null
        );

      if (
        suppliedTrack &&
        (
          event === "trackchange" ||
          event === "track_changed" ||
          event === "play" ||
          event === "playback_play" ||
          event === "player_state"
        )
      ) {
        const normalized =
          ResonaCatalogue.normalizeTrack(suppliedTrack);

        if (normalized) {
          ResonaState.currentTrack = normalized;
        }
      }

      if (
        event === "error" ||
        event === "player_error"
      ) {
        ResonaState.audioError =
          payload?.message ||
          "Playback error.";
      }

      ResonaPlayback.syncState();
      ResonaPlayback.updatePlayerUI();
    }
  };


  /* =======================================================
     18. EVENT HANDLING
     ======================================================= */

  const ResonaEvents = {

    bound: false,

    bind() {
      if (this.bound) return;

      this.bound = true;

      /* NAVIGATION */

      document.addEventListener("click", event => {
        const pageButton = event.target.closest(
          "[data-navigate], [data-page-target], [data-page]"
        );

        if (!pageButton) return;

        const page =
          pageButton.dataset.navigate ||
          pageButton.dataset.pageTarget ||
          pageButton.dataset.page ||
          "";

        if (!page) return;

        event.preventDefault();

        ResonaNavigation.show(
          page,
          pageButton
        );
      });


      /* GENERAL ACTIONS */

      document.addEventListener("click", event => {
        const button = event.target.closest(
          "[data-action], [data-resona-action]"
        );

        if (!button) return;

        const action =
          button.dataset.action ||
          button.dataset.resonaAction;

        const trackId = button.dataset.trackId;

        switch (action) {

          case "play":
            event.preventDefault();

            ResonaPlayback.playTrack(
              trackId,
              ResonaState.tracks
            );

            break;

          case "like":
            event.preventDefault();

            this.toggleLike(trackId);

            break;

          case "continent":
            event.preventDefault();

            ResonaExplore.openContinent(
              button.dataset.continent
            );

            break;

          case "country":
            event.preventDefault();

            ResonaExplore.openCountry(
              button.dataset.country
            );

            break;

          case "clear-history":
            ResonaLibrary.clearHistory();
            break;

          case "library-tab":
            ResonaLibraryPage.openTab(
              button.dataset.tab
            );
            break;

          case "clear-liked":
            ResonaState.likedTracks = [];

            ResonaUtils.writeStorage(
              "liked_tracks",
              []
            );

            ResonaToast.show(
              "Liked songs cleared."
            );

            ResonaLibraryPage.render();

            break;

          case "refresh":
            ResonaAPI.loadCatalogue().then(() => {
              ResonaNavigation.renderPage(
                ResonaState.currentPage
              );

              ResonaToast.show(
                "Catalogue refresh completed."
              );
            });

            break;

          case "shuffle":
            if (ResonaState.tracks.length) {
              const shuffled = [
                ...ResonaState.tracks
              ].sort(() => Math.random() - 0.5);

              ResonaPlayback.playTrack(
                shuffled[0].id,
                shuffled
              );
            } else {
              ResonaToast.show(
                "No music is available to shuffle."
              );
            }

            break;

          case "repeat": {
            const engine = ResonaPlayback.getEngine();

            if (
              engine &&
              typeof engine.setRepeat === "function"
            ) {
              const state = engine.getState?.() || {};

              const current = state.repeat || "off";

              const next = current === "off"
                ? "all"
                : current === "all"
                  ? "one"
                  : "off";

              engine.setRepeat(next);

              ResonaToast.show(
                "Repeat: " + next
              );
            } else {
              ResonaToast.show(
                "Repeat is not available."
              );
            }

            break;
          }
        }
      });


      /* PLAYER CONTROLS */

      document.addEventListener("click", event => {
        const target = event.target.closest(
          "#mini-player-toggle, " +
          "#player-toggle, " +
          "#mini-player-next, " +
          "#player-next, " +
          "#mini-player-previous, " +
          "#player-previous, " +
          "#mini-player-open, " +
          "#now-playing-close, " +
          "#mini-player"
        );

        if (!target) return;

        const id = target.id;

        if (
          id === "mini-player-toggle" ||
          id === "player-toggle"
        ) {
          event.preventDefault();
          event.stopPropagation();

          ResonaPlayback.toggle();

          return;
        }

        if (
          id === "mini-player-next" ||
          id === "player-next"
        ) {
          event.preventDefault();

          ResonaPlayback.next();

          return;
        }

        if (
          id === "mini-player-previous" ||
          id === "player-previous"
        ) {
          event.preventDefault();

          ResonaPlayback.previous();

          return;
        }

        if (id === "now-playing-close") {
          event.preventDefault();

          ResonaNowPlaying.close();

          return;
        }

        if (
          id === "mini-player-open" ||
          id === "mini-player"
        ) {
          if (ResonaState.currentTrack) {
            ResonaNowPlaying.open();
          }
        }
      });


      /* PROGRESS SEEKING */

      document.addEventListener("click", event => {
        const track = event.target.closest(
          "#player-progress-track"
        );

        if (!track) return;

        const rect = track.getBoundingClientRect();

        if (!rect.width) return;

        const percentage =
          ((event.clientX - rect.left) / rect.width) * 100;

        ResonaPlayback.seek(percentage);
      });


      /* SEARCH */

      const handleSearch = ResonaUtils.debounce(
        input => {
          ResonaState.searchQuery = input.value;

          if (ResonaState.currentPage === "search") {
            ResonaSearch.render();
          }
        },
        250
      );

      document.addEventListener("input", event => {
        const input = event.target;

        if (
          input.matches(
            "#search-input, #explore-search-input"
          )
        ) {
          handleSearch(input);
        }
      });


      /* BROWSER BACK AND FORWARD */

      window.addEventListener("popstate", () => {
        ResonaNavigation.handleHashChange();
      });


      /*
       * Important for shell-bridge.js:
       * its navigate() method changes the iframe hash
       * and dispatches hashchange.
       */

      window.addEventListener("hashchange", () => {
        ResonaNavigation.handleHashChange();
      });


      /* KEYBOARD SHORTCUTS */

      document.addEventListener("keydown", event => {
        if (
          event.key === "Escape" &&
          ResonaState.playerExpanded
        ) {
          ResonaNowPlaying.close();
        }
      });
    },

    toggleLike(trackId) {
      if (!trackId) return;

      const liked = ResonaLibrary.toggleLike(trackId);

      ResonaToast.show(
        liked
          ? "Added to liked songs."
          : "Removed from liked songs."
      );

      ResonaNavigation.renderPage(
        ResonaState.currentPage
      );
    }
  };


  /* =======================================================
     19. INITIALIZATION
     ======================================================= */

  async function initResona() {
    if (ResonaState.initialized) return;

    ResonaState.initialized = true;

    ResonaLibrary.load();

    ResonaEvents.bind();

    ResonaPlayerEvents.bind();

    const urlPage = ResonaNavigation.readHash();

    const savedPage = ResonaUtils.readStorage(
      "last_page",
      "home"
    );

    const initialPage =
      window.location.hash
        ? urlPage
        : ResonaNavigation.pages.includes(savedPage)
          ? savedPage
          : "home";

    ResonaNavigation.show(
      initialPage,
      null,
      false
    );

    /*
     * Load catalogue from the configured API.
     */

    await ResonaAPI.loadCatalogue();

    /*
     * Render after catalogue loading.
     */

    ResonaNavigation.renderPage(
      ResonaState.currentPage
    );

    /*
     * Synchronize with the persistent player.
     */

    ResonaPlayback.syncState();

    /*
     * Close Now Playing initially.
     */

    const nowPlaying = ResonaUtils.$(
      "#now-playing"
    );

    if (nowPlaying) {
      nowPlaying.classList.remove("open");

      nowPlaying.setAttribute(
        "aria-hidden",
        "true"
      );
    }

    console.info(
      "Resona initialized successfully."
    );

    console.info(
      "Catalogue tracks:",
      ResonaState.tracks.length
    );

    console.info(
      "Persistent player available:",
      ResonaPlayback.isAvailable()
    );

    console.info(
      "Shell mode:",
      ShellBridge?.isInsideShell?.() === true
    );

    if (!ResonaConfig.apiBase) {
      console.info(
        "Backend API is not configured. Remote catalogue loading is disabled."
      );
    }
  }


  /* =======================================================
     20. PUBLIC APPLICATION INTERFACE
     ======================================================= */

  const Resona = {

    config: ResonaConfig,

    state: ResonaState,

    continents: RESONA_CONTINENTS,

    moods: RESONA_MOODS,

    utils: ResonaUtils,

    catalogue: ResonaCatalogue,

    library: ResonaLibrary,

    navigation: ResonaNavigation,

    player: ResonaPlayback,

    explore: ResonaExplore,

    search: ResonaSearch,

    api: ResonaAPI,

    toast: ResonaToast,

    init: initResona
  };


  /* =======================================================
     21. GLOBAL COMPATIBILITY
     ======================================================= */

  window.Resona = Resona;

  window.ResonaState = ResonaState;

  window.ResonaNavigation = ResonaNavigation;

  window.ResonaCatalogue = ResonaCatalogue;

  window.ResonaLibrary = ResonaLibrary;

  window.ResonaExplore = ResonaExplore;

  window.ResonaSearch = ResonaSearch;

  window.ResonaToast = ResonaToast;

  /*
   * Do not overwrite window.ResonaPlayer.
   * That belongs to js/player.js.
   */

  window.ResonaAppPlayer = ResonaPlayback;


  /* LEGACY COMPATIBILITY */

  window.showPage = function (page, button) {
    return ResonaNavigation.show(page, button);
  };

  window.togglePlay = function () {
    ResonaPlayback.toggle();
  };

  window.nextSong = function () {
    ResonaPlayback.next();
  };

  window.prevSong = function () {
    ResonaPlayback.previous();
  };

  window.openNowPlaying = function () {
    ResonaNowPlaying.open();
  };

  window.closeNowPlaying = function () {
    ResonaNowPlaying.close();
  };


  /* =======================================================
     22. START APPLICATION
     ======================================================= */

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initResona,
      { once: true }
    );
  } else {
    initResona();
  }

})();
