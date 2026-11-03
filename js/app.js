/* ============================================================
   RESONA — APPLICATION CORE
   Complete replacement: js/app.js
   Navigation and event handling corrected.
   Compatible with the supplied Resona HTML shell.
   ============================================================ */

(() => {
  "use strict";

  /* ==========================================================
     1. CONFIGURATION
     ========================================================== */

  const DEFAULT_CONFIG = {
    apiBase: "",
    enableAudioPlayback: true,
    storagePrefix: "resona_",
    maxHistory: 100,
    maxQueue: 500
  };

  const externalConfig =
    window.RESONA_CONFIG ||
    window.RESONA_CONFIG_DATA ||
    window.APP_CONFIG ||
    {};

  const config = {
    ...DEFAULT_CONFIG,
    ...externalConfig,
    apiBase:
      externalConfig.apiBase ||
      externalConfig.api?.baseUrl ||
      externalConfig.api?.baseURL ||
      externalConfig.backendUrl ||
      DEFAULT_CONFIG.apiBase
  };

  /* ==========================================================
     2. APPLICATION STATE
     ========================================================== */

  const state = {
    currentPage: "home",

    tracks: [],
    artists: [],
    albums: [],
    playlists: [],

    likedTracks: [],
    savedTracks: [],
    listeningHistory: [],

    queue: [],
    queueIndex: -1,

    currentTrack: null,
    currentAudio: null,

    isPlaying: false,
    isLoading: false,

    searchQuery: "",
    searchType: "",
    searchGenre: "",
    searchCountry: "",
    searchLanguage: "",

    shuffle: false,
    repeat: false,

    playerExpanded: false,
    initialized: false
  };

  /* ==========================================================
     3. UTILITIES
     ========================================================== */

  const Utils = {
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

    key(name) {
      return config.storagePrefix + name;
    },

    read(name, fallback = []) {
      try {
        const value = localStorage.getItem(this.key(name));
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },

    write(name, value) {
      try {
        localStorage.setItem(
          this.key(name),
          JSON.stringify(value)
        );
        return true;
      } catch (error) {
        console.warn("Resona storage error:", error);
        return false;
      }
    },

    image(value) {
      if (!value) return "";

      const url = String(value).trim();

      if (url.startsWith("/") && !url.startsWith("//")) {
        return url;
      }

      try {
        const parsed = new URL(url);

        if (
          parsed.protocol === "https:" ||
          parsed.protocol === "http:"
        ) {
          return url;
        }
      } catch {}

      return "";
    },

    audio(value) {
      if (!value) return "";

      try {
        const url = new URL(String(value));

        return (
          url.protocol === "https:" ||
          url.protocol === "http:"
        ) ? url.href : "";
      } catch {
        return "";
      }
    },

    time(seconds) {
      const value = Number(seconds);

      if (!Number.isFinite(value) || value < 0) {
        return "0:00";
      }

      return (
        Math.floor(value / 60) +
        ":" +
        String(Math.floor(value % 60)).padStart(2, "0")
      );
    },

    debounce(callback, delay = 300) {
      let timer;

      return (...args) => {
        clearTimeout(timer);

        timer = setTimeout(() => {
          callback(...args);
        }, delay);
      };
    }
  };

  /* ==========================================================
     4. NOTIFICATIONS
     ========================================================== */

  const Toast = {
    timer: null,

    show(message, duration = 2800) {
      let element = Utils.$("#resona-toast");

      if (!element) {
        element = document.createElement("div");

        element.id = "resona-toast";
        element.setAttribute("role", "status");
        element.setAttribute("aria-live", "polite");

        Object.assign(element.style, {
          position: "fixed",
          left: "50%",
          bottom: "125px",
          transform: "translateX(-50%)",
          zIndex: "9999",
          padding: "13px 19px",
          borderRadius: "12px",
          background: "#211e35",
          color: "#ffffff",
          border: "1px solid rgba(155,123,255,.4)",
          fontSize: "13px",
          maxWidth: "90%",
          textAlign: "center",
          boxShadow: "0 8px 30px rgba(0,0,0,.4)"
        });

        document.body.appendChild(element);
      }

      element.textContent = String(message);
      element.hidden = false;

      clearTimeout(this.timer);

      this.timer = setTimeout(() => {
        element.hidden = true;
      }, duration);
    }
  };

  /* ==========================================================
     5. TRACK CATALOGUE
     ========================================================== */

  const Catalogue = {
    normalize(input) {
      if (!input || typeof input !== "object") {
        return null;
      }

      const id = String(
        input.id ??
        input.track_id ??
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

      const moods = Array.isArray(input.mood)
        ? input.mood.map(String)
        : typeof input.mood === "string"
          ? input.mood.split(",").map(v => v.trim())
          : [];

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

        artwork: Utils.image(
          input.artwork ??
          input.cover_url ??
          input.artwork_url ??
          ""
        ),

        audioUrl: Utils.audio(
          input.audioUrl ??
          input.audio_url ??
          input.stream_url ??
          ""
        ),

        duration:
          Number.isFinite(duration) && duration > 0
            ? duration
            : 0,

        country: String(input.country ?? ""),
        language: String(input.language ?? ""),
        genre: String(input.genre ?? ""),
        continent: String(input.continent ?? "").toLowerCase(),

        mood: moods,

        rightsConfirmed:
          input.rightsConfirmed === true ||
          input.rights_confirmed === true,

        explicit: input.explicit === true,
        featured: input.featured === true,

        verifiedArtist:
          input.verifiedArtist === true ||
          input.verified_artist === true,

        plays: Number(input.plays) || 0
      };
    },

    load(items) {
      if (!Array.isArray(items)) {
        return;
      }

      const seen = new Set();

      state.tracks = items
        .map(item => this.normalize(item))
        .filter(track => {
          if (!track || seen.has(track.id)) {
            return false;
          }

          seen.add(track.id);
          return true;
        });

      state.artists = [];
      state.albums = [];

      const artists = new Map();
      const albums = new Map();

      state.tracks.forEach(track => {
        if (track.artist) {
          const key = track.artist.toLowerCase();

          if (!artists.has(key)) {
            artists.set(key, {
              id: track.artistId || key,
              name: track.artist,
              artwork: track.artwork,
              country: track.country
            });
          }
        }

        if (track.album) {
          const key = track.album.toLowerCase();

          if (!albums.has(key)) {
            albums.set(key, {
              id: track.albumId || key,
              title: track.album,
              artist: track.artist,
              artwork: track.artwork
            });
          }
        }
      });

      state.artists = Array.from(artists.values());
      state.albums = Array.from(albums.values());
    },

    get(id) {
      return state.tracks.find(
        track => String(track.id) === String(id)
      ) || null;
    },

    search(query) {
      const term = String(query || "").toLowerCase().trim();

      if (!term) return [];

      return state.tracks.filter(track => {
        const text = [
          track.title,
          track.artist,
          track.album,
          track.genre,
          track.country,
          track.language
        ].join(" ").toLowerCase();

        return text.includes(term);
      });
    }
  };

  /* ==========================================================
     6. PERSONAL LIBRARY
     ========================================================== */

  const Library = {
    load() {
      state.likedTracks = Utils.read("liked_tracks", []);
      state.savedTracks = Utils.read("saved_tracks", []);
      state.listeningHistory = Utils.read("history", []);

      if (!Array.isArray(state.likedTracks)) {
        state.likedTracks = [];
      }

      if (!Array.isArray(state.savedTracks)) {
        state.savedTracks = [];
      }

      if (!Array.isArray(state.listeningHistory)) {
        state.listeningHistory = [];
      }
    },

    isLiked(id) {
      return state.likedTracks.some(
        value => String(value) === String(id)
      );
    },

    toggleLike(id) {
      const exists = this.isLiked(id);

      state.likedTracks = exists
        ? state.likedTracks.filter(
            value => String(value) !== String(id)
          )
        : [...state.likedTracks, String(id)];

      Utils.write("liked_tracks", state.likedTracks);

      return !exists;
    },

    isSaved(id) {
      return state.savedTracks.some(
        value => String(value) === String(id)
      );
    },

    toggleSaved(id) {
      const exists = this.isSaved(id);

      state.savedTracks = exists
        ? state.savedTracks.filter(
            value => String(value) !== String(id)
          )
        : [...state.savedTracks, String(id)];

      Utils.write("saved_tracks", state.savedTracks);

      return !exists;
    },

    addHistory(track) {
      if (!track) return;

      state.listeningHistory =
        state.listeningHistory.filter(
          item => String(item.id) !== String(track.id)
        );

      state.listeningHistory.unshift({
        id: track.id,
        playedAt: new Date().toISOString()
      });

      state.listeningHistory =
        state.listeningHistory.slice(0, config.maxHistory);

      Utils.write("history", state.listeningHistory);
    },

    liked() {
      return state.likedTracks
        .map(id => Catalogue.get(id))
        .filter(Boolean);
    },

    saved() {
      return state.savedTracks
        .map(id => Catalogue.get(id))
        .filter(Boolean);
    },

    history() {
      return state.listeningHistory
        .map(item => ({
          ...item,
          track: Catalogue.get(item.id)
        }))
        .filter(item => item.track);
    },

    clearLiked() {
      state.likedTracks = [];
      Utils.write("liked_tracks", []);

      Toast.show("Liked tracks cleared.");
      LibraryPage.render();
    },

    clearHistory() {
      state.listeningHistory = [];
      Utils.write("history", []);

      Toast.show("Listening history cleared.");
      LibraryPage.render();
    },

    export() {
      const data = {
        exportedAt: new Date().toISOString(),
        likedTracks: state.likedTracks,
        savedTracks: state.savedTracks,
        listeningHistory: state.listeningHistory
      };

      const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "resona-library.json";

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      Toast.show("Your library export is ready.");
    }
  };

  /* ==========================================================
     7. NAVIGATION — CORRECTED
     ========================================================== */

  const Navigation = {
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

    normalize(page) {
      return String(page || "")
        .trim()
        .toLowerCase()
        .replace(/^#\/?/, "")
        .split("?")[0]
        .replace(/_/g, "-");
    },

    getDestination(element) {
      if (!element) return "";

      const value =
        element.dataset.navigate ||
        element.dataset.pageLink ||
        element.dataset.pageTarget ||
        (
          element.matches(".page")
            ? ""
            : element.dataset.page
        ) ||
        element.getAttribute("href") ||
        "";

      return this.normalize(value);
    },

    pageFromHash() {
      const page = this.normalize(
        window.location.hash
      );

      return this.pages.includes(page) ? page : "";
    },

    updateHash(page) {
      const hash = "#" + page;

      if (window.location.hash !== hash) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname +
          window.location.search +
          hash
        );
      }
    },

    show(page, options = {}) {
      const destination = this.normalize(page);

      if (!this.pages.includes(destination)) {
        console.warn("Invalid Resona page:", destination);
        return false;
      }

      const target = Utils.$(
        "#" + destination + "-page"
      );

      if (!target) {
        console.error(
          "Resona page element not found:",
          destination
        );
        return false;
      }

      this.pages.forEach(name => {
        const element = Utils.$("#" + name + "-page");

        if (!element) return;

        const active = name === destination;

        element.hidden = !active;
        element.setAttribute(
          "aria-hidden",
          String(!active)
        );
      });

      state.currentPage = destination;

      Utils.write("last_page", destination);

      Utils.$$(
        "[data-navigate], " +
        "[data-page-link], " +
        "[data-page-target], " +
        ".nav-link, " +
        ".nav-button"
      ).forEach(element => {
        const active =
          this.getDestination(element) === destination;

        element.classList.toggle("active", active);
        element.classList.toggle("is-active", active);

        if (active) {
          element.setAttribute("aria-current", "page");
        } else {
          element.removeAttribute("aria-current");
        }
      });

      if (options.updateHash !== false) {
        this.updateHash(destination);
      }

      this.render(destination);

      window.scrollTo({
        top: 0,
        behavior: "auto"
      });

      return true;
    },

    render(page) {
      switch (page) {
        case "home":
          Home.render();
          break;

        case "explore":
          Explore.render();
          break;

        case "search":
          Search.render();
          break;

        case "library":
          LibraryPage.render();
          break;

        case "artists":
          EntityPages.artists();
          break;

        case "albums":
          EntityPages.albums();
          break;

        case "playlists":
          EntityPages.playlists();
          break;
      }
    },

    handleHashChange() {
      const page = this.pageFromHash();

      if (!page) {
        this.show("home");
        return;
      }

      if (page !== state.currentPage) {
        this.show(page, { updateHash: false });
      }
    }
  };

  /* ==========================================================
     8. TRACK DISPLAY
     ========================================================== */

  const TrackUI = {
    card(track) {
      const liked = Library.isLiked(track.id);

      const image = track.artwork
        ? `<img src="${Utils.escape(track.artwork)}"
                alt="${Utils.escape(track.title)} artwork"
                loading="lazy">`
        : `<div class="resona-art-placeholder">♫</div>`;

      return `
        <article class="track-card resona-track-card">

          <div class="track-artwork">
            ${image}
          </div>

          <button
            type="button"
            class="track-play-area"
            data-action="play"
            data-track-id="${Utils.escape(track.id)}"
          >
            <h3>${Utils.escape(track.title)}</h3>
            <p>${Utils.escape(track.artist)}</p>
          </button>

          <div class="track-card-actions">

            <button
              type="button"
              class="icon-button"
              data-action="like"
              data-track-id="${Utils.escape(track.id)}"
              aria-label="${liked ? "Unlike" : "Like"} track"
              aria-pressed="${liked}"
            >${liked ? "♥" : "♡"}</button>

            <button
              type="button"
              class="icon-button"
              data-action="play"
              data-track-id="${Utils.escape(track.id)}"
              aria-label="Play track"
            >▶</button>

          </div>
        </article>
      `;
    },

    entity(item, type) {
      const name =
        item.name ||
        item.title ||
        item.artist ||
        "Unknown";

      const image = Utils.image(item.artwork);

      return `
        <article class="entity-card">

          ${image
            ? `<img src="${Utils.escape(image)}"
                    alt="${Utils.escape(name)}"
                    loading="lazy">`
            : `<div class="entity-placeholder">♫</div>`
          }

          <h3>${Utils.escape(name)}</h3>

          <p>${Utils.escape(item.artist || item.country || type)}</p>

        </article>
      `;
    },

    render(container, tracks, emptyMessage) {
      if (!container) return;

      container.innerHTML = tracks.length
        ? tracks.map(track => this.card(track)).join("")
        : `<div class="empty-state">${Utils.escape(emptyMessage)}</div>`;
    }
  };

  /* ==========================================================
     9. HOME PAGE
     ========================================================== */

  const Home = {
    render() {
      const featured = state.tracks.filter(
        track => track.featured
      );

      const trending = [...state.tracks].sort(
        (a, b) => b.plays - a.plays
      );

      TrackUI.render(
        Utils.$("#featured-tracks"),
        featured.length ? featured : state.tracks.slice(0, 8),
        "No featured music yet. Music will appear here when a catalogue is connected."
      );

      TrackUI.render(
        Utils.$("#trending-tracks"),
        trending.slice(0, 8),
        "Trending music will appear here when available."
      );

      const recent = Library.history()
        .map(item => item.track);

      TrackUI.render(
        Utils.$("#recently-played"),
        recent.slice(0, 8),
        "Your listening history will appear here."
      );
    }
  };

  /* ==========================================================
     10. EXPLORE
     ========================================================== */

  const Explore = {
    render() {
      TrackUI.render(
        Utils.$("#explore-tracks"),
        state.tracks,
        "No music is available yet."
      );

      const artists = Utils.$("#explore-artists");
      const albums = Utils.$("#explore-albums");

      if (artists) {
        artists.innerHTML = state.artists.length
          ? state.artists.map(item =>
              TrackUI.entity(item, "Artist")
            ).join("")
          : `<div class="empty-state">Artists will appear here.</div>`;
      }

      if (albums) {
        albums.innerHTML = state.albums.length
          ? state.albums.map(item =>
              TrackUI.entity(item, "Album")
            ).join("")
          : `<div class="empty-state">Albums will appear here.</div>`;
      }
    }
  };

  /* ==========================================================
     11. SEARCH
     ========================================================== */

  const Search = {
    render() {
      const input = Utils.$("#search-input");

      if (input && input.value.trim()) {
        this.run(input.value);
      }
    },

    run(query) {
      const term = String(query || "").trim();

      const type = Utils.$(
        '#search-filters select[name="type"]'
      )?.value || "";

      const genre = Utils.$(
        '#search-filters select[name="genre"]'
      )?.value || "";

      const country = Utils.$(
        '#search-filters select[name="country"]'
      )?.value || "";

      const language = Utils.$(
        '#search-filters select[name="language"]'
      )?.value || "";

      state.searchQuery = term;

      let results = term
        ? Catalogue.search(term)
        : [];

      if (genre) {
        results = results.filter(
          track => track.genre.toLowerCase() === genre.toLowerCase()
        );
      }

      if (country) {
        results = results.filter(
          track => track.country.toLowerCase() === country.toLowerCase()
        );
      }

      if (language) {
        results = results.filter(
          track => track.language.toLowerCase() === language.toLowerCase()
        );
      }

      const tracks =
        type === "artist" ||
        type === "album" ||
        type === "playlist"
          ? []
          : results;

      TrackUI.render(
        Utils.$("#search-results"),
        tracks,
        term
          ? "No matching tracks found."
          : "Start typing to discover music."
      );

      const artistResults = term
        ? state.artists.filter(item =>
            item.name.toLowerCase().includes(term.toLowerCase())
          )
        : [];

      const albumResults = term
        ? state.albums.filter(item =>
            item.title.toLowerCase().includes(term.toLowerCase())
          )
        : [];

      const playlistResults = term
        ? state.playlists.filter(item =>
            String(item.name || item.title || "")
              .toLowerCase()
              .includes(term.toLowerCase())
          )
        : [];

      const artistContainer = Utils.$("#search-artists");
      const albumContainer = Utils.$("#search-albums");
      const playlistContainer = Utils.$("#search-playlists");

      if (artistContainer) {
        artistContainer.innerHTML = artistResults.length
          ? artistResults.map(item =>
              TrackUI.entity(item, "Artist")
            ).join("")
          : "";
      }

      if (albumContainer) {
        albumContainer.innerHTML = albumResults.length
          ? albumResults.map(item =>
              TrackUI.entity(item, "Album")
            ).join("")
          : "";
      }

      if (playlistContainer) {
        playlistContainer.innerHTML = playlistResults.length
          ? playlistResults.map(item =>
              TrackUI.entity(item, "Playlist")
            ).join("")
          : "";
      }

      const status = Utils.$("#search-status");

      if (status) {
        status.textContent = term
          ? `${results.length} matching track(s) found.`
          : "Start typing to discover music.";
      }
    }
  };

  /* ==========================================================
     12. LIBRARY PAGE
     ========================================================== */

  const LibraryPage = {
    render() {
      TrackUI.render(
        Utils.$("#liked-tracks"),
        Library.liked(),
        "Your liked tracks will appear here."
      );

      TrackUI.render(
        Utils.$("#saved-tracks"),
        Library.saved(),
        "Your saved tracks will appear here."
      );

      TrackUI.render(
        Utils.$("#listening-history"),
        Library.history().map(item => item.track),
        "Your listening history will appear here."
      );

      const playlists = Utils.$("#library-playlists");

      if (playlists) {
        playlists.innerHTML = state.playlists.length
          ? state.playlists.map(item =>
              TrackUI.entity(item, "Playlist")
            ).join("")
          : `<div class="empty-state">Your playlists will appear here.</div>`;
      }
    }
  };

  /* ==========================================================
     13. ARTISTS / ALBUMS / PLAYLISTS
     ========================================================== */

  const EntityPages = {
    artists() {
      const container = Utils.$("#artists-list");

      if (!container) return;

      container.innerHTML = state.artists.length
        ? state.artists.map(item =>
            TrackUI.entity(item, "Artist")
          ).join("")
        : `<div class="empty-state">Artists will appear here when available.</div>`;
    },

    albums() {
      const container = Utils.$("#albums-list");

      if (!container) return;

      container.innerHTML = state.albums.length
        ? state.albums.map(item =>
            TrackUI.entity(item, "Album")
          ).join("")
        : `<div class="empty-state">Albums will appear here when available.</div>`;
    },

    playlists() {
      const container = Utils.$("#playlists-list");

      if (!container) return;

      container.innerHTML = state.playlists.length
        ? state.playlists.map(item =>
            TrackUI.entity(item, "Playlist")
          ).join("")
        : `<div class="empty-state">Playlists will appear here when available.</div>`;
    }
  };

  /* ==========================================================
     14. AUDIO PLAYER
     ========================================================== */

  const Player = {
    get audio() {
      return state.currentAudio;
    },

    canPlay(track) {
      return Boolean(
        config.enableAudioPlayback &&
        track &&
        track.audioUrl &&
        track.rightsConfirmed
      );
    },

    async playTrack(id, queue = null) {
      const track = Catalogue.get(id);

      if (!track) {
        Toast.show("Track not found.");
        return;
      }

      if (Array.isArray(queue)) {
        state.queue = queue.slice(0, config.maxQueue);
      }

      if (!state.queue.length) {
        state.queue = [track];
      }

      state.queueIndex = state.queue.findIndex(
        item => String(item.id) === String(track.id)
      );

      state.currentTrack = track;

      this.updateUI();

      if (!this.canPlay(track)) {
        this.stop();

        Toast.show(
          "Playback is unavailable for this track."
        );

        return;
      }

      this.stop();

      const audio = new Audio();

      audio.preload = "metadata";
      audio.src = track.audioUrl;

      state.currentAudio = audio;

      audio.addEventListener("timeupdate", () => {
        this.updateProgress();
      });

      audio.addEventListener("loadedmetadata", () => {
        this.updateProgress();
      });

      audio.addEventListener("play", () => {
        state.isPlaying = true;
        this.updateUI();
      });

      audio.addEventListener("pause", () => {
        state.isPlaying = false;
        this.updateUI();
      });

      audio.addEventListener("ended", () => {
        state.isPlaying = false;

        if (state.repeat) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }

        this.next();
      });

      audio.addEventListener("error", () => {
        state.isPlaying = false;

        this.updateUI();

        Toast.show("Unable to load this audio source.");
      });

      try {
        await audio.play();

        state.isPlaying = true;

        Library.addHistory(track);

        this.updateUI();
        Home.render();

      } catch (error) {
        state.isPlaying = false;

        this.updateUI();

        console.warn("Resona playback error:", error);

        Toast.show("Playback could not start.");
      }
    },

    toggle() {
      const audio = state.currentAudio;

      if (!audio) {
        Toast.show("Choose a track first.");
        return;
      }

      if (audio.paused) {
        audio.play()
          .then(() => {
            state.isPlaying = true;
            this.updateUI();
          })
          .catch(() => {
            Toast.show("Unable to resume playback.");
          });
      } else {
        audio.pause();
      }
    },

    stop() {
      if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio.removeAttribute("src");
        state.currentAudio.load();
      }

      state.currentAudio = null;
      state.isPlaying = false;
    },

    next() {
      if (!state.queue.length) {
        Toast.show("Your queue is empty.");
        return;
      }

      let nextIndex = state.queueIndex + 1;

      if (state.shuffle && state.queue.length > 1) {
        nextIndex = Math.floor(
          Math.random() * state.queue.length
        );
      }

      if (nextIndex >= state.queue.length) {
        if (state.repeat) {
          nextIndex = 0;
        } else {
          Toast.show("You've reached the end of the queue.");
          return;
        }
      }

      this.playTrack(
        state.queue[nextIndex].id,
        state.queue
      );
    },

    previous() {
      const audio = state.currentAudio;

      if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
      }

      if (state.queueIndex <= 0) {
        Toast.show("This is the first track.");
        return;
      }

      this.playTrack(
        state.queue[state.queueIndex - 1].id,
        state.queue
      );
    },

    seek(percentage) {
      const audio = state.currentAudio;

      if (!audio || !Number.isFinite(audio.duration)) {
        return;
      }

      const value = Math.max(
        0,
        Math.min(100, Number(percentage) || 0)
      );

      audio.currentTime =
        audio.duration * value / 100;
    },

    updateProgress() {
      const audio = state.currentAudio;

      const current = audio ? audio.currentTime : 0;

      const duration =
        audio && Number.isFinite(audio.duration)
          ? audio.duration
          : state.currentTrack?.duration || 0;

      const percentage = duration > 0
        ? current / duration * 100
        : 0;

      const fill = Utils.$("#player-progress-fill");

      if (fill) {
        fill.style.width = percentage + "%";
      }

      const progress = Utils.$("#player-progress-track");

      if (progress) {
        progress.setAttribute(
          "aria-valuenow",
          String(Math.round(percentage))
        );
      }

      const currentTime = Utils.$("#player-current-time");
      const durationTime = Utils.$("#player-duration");

      if (currentTime) {
        currentTime.textContent = Utils.time(current);
      }

      if (durationTime) {
        durationTime.textContent = Utils.time(duration);
      }
    },

    updateUI() {
      const track = state.currentTrack;

      const mini = Utils.$("#mini-player");

      if (mini) {
        mini.hidden = !track;
      }

      if (!track) return;

      const values = {
        "#mini-player-title": track.title,
        "#mini-player-artist": track.artist,
        "#now-playing-title": track.title,
        "#now-playing-artist": track.artist
      };

      Object.entries(values).forEach(([selector, value]) => {
        const element = Utils.$(selector);

        if (element) {
          element.textContent = value;
        }
      });

      const cover = Utils.image(track.artwork);

      [
        "#mini-player-cover",
        "#now-playing-cover"
      ].forEach(selector => {
        const image = Utils.$(selector);

        if (image) {
          image.src = cover;
        }
      });

      Utils.$$(
        "#mini-player-toggle, #player-toggle"
      ).forEach(button => {
        button.innerHTML = state.isPlaying ? "❚❚" : "▶";

        button.setAttribute(
          "aria-label",
          state.isPlaying ? "Pause" : "Play"
        );
      });

      this.updateProgress();
    }
  };

  /* ==========================================================
     15. NOW PLAYING OVERLAY
     ========================================================== */

  const NowPlaying = {
    open() {
      if (!state.currentTrack) {
        Toast.show("Choose a track first.");
        return;
      }

      const element = Utils.$("#now-playing");

      if (!element) return;

      element.hidden = false;
      element.setAttribute("aria-hidden", "false");

      state.playerExpanded = true;

      Player.updateUI();
    },

    close() {
      const element = Utils.$("#now-playing");

      if (!element) return;

      element.hidden = true;
      element.setAttribute("aria-hidden", "true");

      state.playerExpanded = false;
    }
  };

  /* ==========================================================
     16. BACKEND API
     ========================================================== */

  const API = {
    get baseUrl() {
      return String(config.apiBase || "").replace(/\/+$/, "");
    },

    async request(path) {
      if (!this.baseUrl) {
        throw new Error("Resona backend is not configured.");
      }

      const response = await fetch(
        this.baseUrl + "/" + String(path).replace(/^\/+/, ""),
        {
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          "API returned HTTP " + response.status
        );
      }

      return response.json();
    },

    async loadCatalogue() {
      if (!this.baseUrl) {
        console.info(
          "Resona is running without a connected catalogue API."
        );

        return false;
      }

      state.isLoading = true;

      try {
        const response = await this.request("tracks");

        const tracks = Array.isArray(response)
          ? response
          : response.tracks || [];

        Catalogue.load(tracks);

        state.isLoading = false;

        return true;

      } catch (error) {
        state.isLoading = false;

        console.error(
          "Resona catalogue error:",
          error
        );

        Toast.show("Music catalogue could not be loaded.");

        return false;
      }
    }
  };

  /* ==========================================================
     17. ACTION HANDLING — CORRECTED
     ========================================================== */

  const Actions = {
    handle(event) {
      const target = event.target instanceof Element
        ? event.target
        : event.target?.parentElement;

      if (!target) return;

      /*
       * Navigation only recognises actual navigation controls.
       * Page sections carrying data-page are deliberately excluded.
       */

      const navigation = target.closest(
        "[data-navigate], " +
        "[data-page-link], " +
        "[data-page-target], " +
        ".nav-link, " +
        ".nav-button, " +
        "a[href^='#']"
      );

      if (navigation) {
        const destination =
          Navigation.getDestination(navigation);

        if (Navigation.pages.includes(destination)) {
          event.preventDefault();

          Navigation.show(destination);

          return;
        }
      }

      /* Track actions */

      const trackButton = target.closest("[data-action]");

      if (trackButton) {
        const action = trackButton.dataset.action;
        const trackId = trackButton.dataset.trackId;

        if (action === "play") {
          event.preventDefault();

          Player.playTrack(trackId, state.tracks);

          return;
        }

        if (action === "like") {
          event.preventDefault();

          const liked = Library.toggleLike(trackId);

          Toast.show(
            liked
              ? "Added to liked tracks."
              : "Removed from liked tracks."
          );

          Navigation.render(state.currentPage);

          return;
        }

        if (action === "save") {
          event.preventDefault();

          const saved = Library.toggleSaved(trackId);

          Toast.show(
            saved
              ? "Track saved."
              : "Track removed from saved music."
          );

          Navigation.render(state.currentPage);

          return;
        }
      }

      /* Player controls */

      const playerButton = target.closest(
        "#mini-player-toggle, " +
        "#player-toggle, " +
        "#mini-player-next, " +
        "#player-next, " +
        "#mini-player-previous, " +
        "#player-previous, " +
        "#mini-player-open, " +
        "#now-playing-close"
      );

      if (playerButton) {
        event.preventDefault();

        switch (playerButton.id) {
          case "mini-player-toggle":
          case "player-toggle":
            Player.toggle();
            return;

          case "mini-player-next":
          case "player-next":
            Player.next();
            return;

          case "mini-player-previous":
          case "player-previous":
            Player.previous();
            return;

          case "mini-player-open":
            NowPlaying.open();
            return;

          case "now-playing-close":
            NowPlaying.close();
            return;
        }
      }

      /* Other application actions */

      const resonaAction = target.closest(
        "[data-resona-action]"
      );

      if (resonaAction) {
        event.preventDefault();

        switch (resonaAction.dataset.resonaAction) {
          case "clear-liked":
            Library.clearLiked();
            break;

          case "clear-history":
            Library.clearHistory();
            break;

          case "refresh":
            API.loadCatalogue().then(() => {
              Navigation.render(state.currentPage);
              Toast.show("Music refresh completed.");
            });
            break;

          case "shuffle":
            state.shuffle = !state.shuffle;

            Toast.show(
              state.shuffle
                ? "Shuffle enabled."
                : "Shuffle disabled."
            );
            break;

          case "repeat":
            state.repeat = !state.repeat;

            Toast.show(
              state.repeat
                ? "Repeat enabled."
                : "Repeat disabled."
            );
            break;
        }

        return;
      }

      /* Library export */

      if (
        target.closest("#export-library-button") ||
        target.closest("#export-library-button-settings")
      ) {
        event.preventDefault();

        Library.export();

        return;
      }
    }
  };

  /* ==========================================================
     18. EVENT INITIALIZATION — CORRECTED
     ========================================================== */

  function bindEvents() {
    if (document.body.dataset.resonaEventsBound === "true") {
      return;
    }

    document.body.dataset.resonaEventsBound = "true";

    /* Global click handling */

    document.addEventListener("click", event => {
      Actions.handle(event);
    });

    /* Browser back and forward navigation */

    window.addEventListener("hashchange", () => {
      Navigation.handleHashChange();
    });

    /* Main search */

    const searchInput = Utils.$("#search-input");

    if (searchInput) {
      searchInput.addEventListener(
        "input",
        Utils.debounce(() => {
          Search.run(searchInput.value);
        })
      );
    }

    /* Explore search */

    const exploreInput = Utils.$("#explore-search-input");

    if (exploreInput) {
      exploreInput.addEventListener(
        "input",
        Utils.debounce(() => {
          const results = Catalogue.search(exploreInput.value);

          const container = Utils.$(
            "#explore-search-results"
          );

          if (!container) return;

          container.innerHTML = results.length
            ? `<div class="track-grid">
                ${results.map(track => TrackUI.card(track)).join("")}
               </div>`
            : `<div class="status-text">No matching music found.</div>`;
        })
      );
    }

    /* Search filters */

    Utils.$$("#search-filters select").forEach(select => {
      select.addEventListener("change", () => {
        Search.run(searchInput?.value || "");
      });
    });

    /* Player progress */

    const progress = Utils.$("#player-progress-track");

    if (progress) {
      progress.addEventListener("click", event => {
        const rect = progress.getBoundingClientRect();

        if (!rect.width) return;

        const percentage =
          (event.clientX - rect.left) / rect.width * 100;

        Player.seek(percentage);
      });

      progress.addEventListener("keydown", event => {
        if (
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight"
        ) {
          event.preventDefault();

          const current = Number(
            progress.getAttribute("aria-valuenow") || 0
          );

          Player.seek(
            current + (event.key === "ArrowRight" ? 5 : -5)
          );
        }
      });
    }

    /* Keyboard shortcuts */

    document.addEventListener("keydown", event => {
      if (
        event.key === "Escape" &&
        state.playerExpanded
      ) {
        NowPlaying.close();
      }
    });
  }

  /* ==========================================================
     19. INITIALIZATION — CORRECTED
     ========================================================== */

  async function init() {
    if (state.initialized) return;

    state.initialized = true;

    Library.load();

    bindEvents();

    await API.loadCatalogue();

    /*
     * Priority:
     * 1. A valid page in the URL.
     * 2. The user's previously saved page.
     * 3. Home.
     */

    const hashPage = Navigation.pageFromHash();

    const savedPage = Navigation.normalize(
      Utils.read("last_page", "home")
    );

    const initialPage =
      hashPage ||
      (
        Navigation.pages.includes(savedPage)
          ? savedPage
          : "home"
      );

    Navigation.show(initialPage);

    const nowPlaying = Utils.$("#now-playing");

    if (nowPlaying) {
      nowPlaying.hidden = true;
      nowPlaying.setAttribute("aria-hidden", "true");
    }

    const mini = Utils.$("#mini-player");

    if (mini) {
      mini.hidden = true;
    }

    const year = Utils.$("#resona-year");

    if (year) {
      year.textContent = new Date().getFullYear();
    }

    console.info("Resona initialized.");
    console.info("Current page:", state.currentPage);
    console.info("Catalogue tracks:", state.tracks.length);
  }

  /* ==========================================================
     20. PUBLIC API
     ========================================================== */

  const Resona = {
    config,
    state,

    utils: Utils,
    toast: Toast,

    catalogue: Catalogue,
    library: Library,

    navigation: Navigation,
    home: Home,
    explore: Explore,
    search: Search,

    player: Player,
    nowPlaying: NowPlaying,

    api: API,

    init
  };

  window.Resona = Resona;

  window.ResonaNavigation = Navigation;
  window.ResonaPlayer = Player;

  /* Legacy compatibility */

  window.showPage = page => {
    Navigation.show(page);
  };

  window.togglePlay = () => Player.toggle();
  window.nextSong = () => Player.next();
  window.prevSong = () => Player.previous();

  window.openNowPlaying = () => NowPlaying.open();
  window.closeNowPlaying = () => NowPlaying.close();

  /* Start application */

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }

})();
