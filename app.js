/* =========================================================
   RESONA — APPLICATION CORE
   Global music discovery and streaming frontend
   ========================================================= */

"use strict";

/* =========================================================
   1. APPLICATION CONFIGURATION
   ========================================================= */

const Resona = {
  version: "1.0.0",

  config: {
    // Configure these when the backend is ready.
    apiBase: "",
    enableDemoData: false,
    enableAudioPlayback: false
  },

  state: {
    currentPage: "home",
    currentTrack: null,
    currentAudio: null,
    isPlaying: false,
    isShuffle: false,
    repeatMode: "off",

    queue: [],
    queueIndex: -1,

    searchQuery: "",
    selectedMood: null,
    selectedContinent: null,
    selectedCountry: null,

    library: {
      likedTracks: [],
      savedAlbums: [],
      followedArtists: [],
      playlists: []
    },

    catalogue: {
      tracks: [],
      artists: [],
      albums: [],
      playlists: []
    },

    audioProgress: 0,
    audioDuration: 0,

    audioObjectUrl: null
  }
};


/* =========================================================
   2. SAFE STORAGE
   ========================================================= */

const ResonaStorage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem("resona_" + key);

      return value === null
        ? fallback
        : JSON.parse(value);
    } catch (error) {
      console.warn("Resona storage read failed:", error);
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(
        "resona_" + key,
        JSON.stringify(value)
      );

      return true;
    } catch (error) {
      console.warn("Resona storage write failed:", error);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem("resona_" + key);
    } catch (error) {
      console.warn("Resona storage removal failed:", error);
    }
  }
};


/* =========================================================
   3. GLOBAL MUSIC DISCOVERY
   ========================================================= */

const RESONA_CONTINENTS = [
  {
    id: "africa",
    name: "Africa",
    symbol: "🌍",
    description: "Discover African sounds",
    countries: [
      "Nigeria",
      "Ghana",
      "South Africa",
      "Kenya",
      "Egypt",
      "Tanzania",
      "Uganda",
      "Morocco",
      "Ethiopia",
      "Senegal",
      "Cameroon",
      "Algeria",
      "Angola",
      "Rwanda",
      "Zimbabwe"
    ]
  },

  {
    id: "europe",
    name: "Europe",
    symbol: "🌍",
    description: "Explore European music",
    countries: [
      "United Kingdom",
      "France",
      "Germany",
      "Spain",
      "Italy",
      "Portugal",
      "Netherlands",
      "Sweden",
      "Norway",
      "Poland",
      "Ireland",
      "Greece",
      "Switzerland",
      "Belgium",
      "Austria"
    ]
  },

  {
    id: "asia",
    name: "Asia",
    symbol: "🌏",
    description: "Explore Asian sounds",
    countries: [
      "Japan",
      "South Korea",
      "India",
      "China",
      "Indonesia",
      "Philippines",
      "Thailand",
      "Pakistan",
      "Bangladesh",
      "Vietnam",
      "Malaysia",
      "Singapore",
      "Saudi Arabia",
      "United Arab Emirates",
      "Turkey"
    ]
  },

  {
    id: "north-america",
    name: "North America",
    symbol: "🌎",
    description: "Discover North American music",
    countries: [
      "United States",
      "Canada",
      "Mexico",
      "Cuba",
      "Jamaica",
      "Dominican Republic",
      "Haiti",
      "Costa Rica",
      "Panama",
      "Guatemala"
    ]
  },

  {
    id: "south-america",
    name: "South America",
    symbol: "🌎",
    description: "Discover South American music",
    countries: [
      "Brazil",
      "Argentina",
      "Colombia",
      "Chile",
      "Peru",
      "Venezuela",
      "Ecuador",
      "Uruguay",
      "Paraguay",
      "Bolivia"
    ]
  },

  {
    id: "oceania",
    name: "Oceania",
    symbol: "🌏",
    description: "Explore music from Oceania",
    countries: [
      "Australia",
      "New Zealand",
      "Fiji",
      "Papua New Guinea",
      "Samoa",
      "Tonga",
      "Vanuatu"
    ]
  }
];


/* =========================================================
   4. HELPERS
   ========================================================= */

const ResonaUtils = {
  escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
    );
  },

  normalise(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase();
  },

  element(id) {
    return document.getElementById(id);
  },

  setText(id, value) {
    const element = this.element(id);

    if (element) {
      element.textContent = value ?? "";
    }
  },

  showMessage(message, type = "info") {
    let toast = this.element("resonaToast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "resonaToast";

      Object.assign(toast.style, {
        position: "fixed",
        left: "16px",
        right: "16px",
        bottom: "calc(78px + env(safe-area-inset-bottom, 0px))",
        zIndex: "1000",
        padding: "13px 16px",
        borderRadius: "14px",
        background: "#191922",
        border: "1px solid rgba(255,255,255,.15)",
        color: "#f3f1fa",
        fontSize: "14px",
        boxShadow: "0 10px 35px rgba(0,0,0,.35)",
        opacity: "0",
        transform: "translateY(8px)",
        transition: "opacity .2s, transform .2s"
      });

      document.body.appendChild(toast);
    }

    toast.textContent = message;

    toast.style.borderColor =
      type === "error"
        ? "rgba(251,113,133,.6)"
        : type === "success"
          ? "rgba(52,211,153,.6)"
          : "rgba(167,139,250,.5)";

    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    clearTimeout(this._toastTimer);

    this._toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
    }, 3200);
  },

  saveJSON(key, value) {
    return ResonaStorage.set(key, value);
  },

  loadJSON(key, fallback) {
    return ResonaStorage.get(key, fallback);
  },

  shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [result[i], result[j]] = [
        result[j],
        result[i]
      ];
    }

    return result;
  }
};


/* =========================================================
   5. CATALOGUE VALIDATION
   ========================================================= */

const ResonaCatalogue = {
  setTracks(tracks) {
    if (!Array.isArray(tracks)) {
      throw new TypeError("Tracks must be an array.");
    }

    Resona.state.catalogue.tracks = tracks
      .filter(track =>
        track &&
        track.id !== undefined &&
        typeof track.title === "string" &&
        typeof track.artist === "string"
      )
      .map(track => ({
        id: String(track.id),
        title: track.title.trim(),
        artist: track.artist.trim(),
        album: track.album || "",
        artwork: track.artwork || "",
        audioUrl: track.audioUrl || "",
        duration: Number(track.duration) || 0,
        country: track.country || "",
        continent: track.continent || "",
        genre: track.genre || "",
        releaseDate: track.releaseDate || "",
        rightsConfirmed: track.rightsConfirmed === true
      }));

    Resona.state.catalogue.tracks.forEach(track => {
      if (track.audioUrl) {
        try {
          const url = new URL(track.audioUrl, location.href);

          if (!["https:", "http:"].includes(url.protocol)) {
            track.audioUrl = "";
          }
        } catch {
          track.audioUrl = "";
        }
      }
    });

    Resona.renderCurrentPage();

    return Resona.state.catalogue.tracks.length;
  },

  findTrack(id) {
    return Resona.state.catalogue.tracks.find(
      track => String(track.id) === String(id)
    ) || null;
  },

  search(query) {
    const q = ResonaUtils.normalise(query);

    if (!q) return [];

    return Resona.state.catalogue.tracks.filter(track => {
      const searchable = [
        track.title,
        track.artist,
        track.album,
        track.country,
        track.continent,
        track.genre
      ].join(" ");

      return ResonaUtils.normalise(searchable).includes(q);
    });
  },

  byContinent(continentId) {
    return Resona.state.catalogue.tracks.filter(
      track =>
        ResonaUtils.normalise(track.continent) ===
        ResonaUtils.normalise(continentId)
    );
  },

  byCountry(country) {
    return Resona.state.catalogue.tracks.filter(
      track =>
        ResonaUtils.normalise(track.country) ===
        ResonaUtils.normalise(country)
    );
  }
};


/* =========================================================
   6. LIBRARY
   ========================================================= */

const ResonaLibrary = {
  init() {
    const saved = ResonaUtils.loadJSON("library", {});

    Resona.state.library = {
      likedTracks: Array.isArray(saved.likedTracks)
        ? saved.likedTracks
        : [],

      savedAlbums: Array.isArray(saved.savedAlbums)
        ? saved.savedAlbums
        : [],

      followedArtists: Array.isArray(saved.followedArtists)
        ? saved.followedArtists
        : [],

      playlists: Array.isArray(saved.playlists)
        ? saved.playlists
        : []
    };
  },

  save() {
    ResonaUtils.saveJSON(
      "library",
      Resona.state.library
    );
  },

  isLiked(trackId) {
    return Resona.state.library.likedTracks
      .map(String)
      .includes(String(trackId));
  },

  toggleLike(trackId) {
    const id = String(trackId);
    const liked = Resona.state.library.likedTracks;

    if (liked.map(String).includes(id)) {
      Resona.state.library.likedTracks =
        liked.filter(item => String(item) !== id);
    } else {
      liked.push(id);
    }

    this.save();
    Resona.renderCurrentPage();

    return this.isLiked(id);
  },

  addPlaylist(name) {
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      ResonaUtils.showMessage(
        "Enter a playlist name first.",
        "error"
      );

      return null;
    }

    const playlist = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : "playlist_" + Date.now(),

      name: cleanName,
      trackIds: [],
      createdAt: new Date().toISOString()
    };

    Resona.state.library.playlists.push(playlist);

    this.save();
    Resona.renderCurrentPage();

    return playlist;
  },

  addToPlaylist(playlistId, trackId) {
    const playlist = Resona.state.library.playlists.find(
      item => String(item.id) === String(playlistId)
    );

    if (!playlist) return false;

    if (!playlist.trackIds.map(String).includes(String(trackId))) {
      playlist.trackIds.push(String(trackId));
    }

    this.save();

    return true;
  },

  recordRecentlyPlayed(trackId) {
    const history = ResonaUtils.loadJSON("history", []);

    const updated = [
      String(trackId),
      ...history.map(String).filter(id => id !== String(trackId))
    ].slice(0, 50);

    ResonaUtils.saveJSON("history", updated);
  },

  getRecentlyPlayed() {
    const history = ResonaUtils.loadJSON("history", []);

    return history
      .map(id => ResonaCatalogue.findTrack(id))
      .filter(Boolean);
  }
};


/* =========================================================
   7. NAVIGATION
   ========================================================= */

const ResonaNavigation = {
  pages: [
    "home",
    "explore",
    "search",
    "library",
    "artist"
  ],

  show(name) {
    const pageName = String(name || "").toLowerCase();

    if (!this.pages.includes(pageName)) {
      ResonaUtils.showMessage("That page is not available yet.");
      return;
    }

    document.querySelectorAll(".page").forEach(page => {
      page.classList.remove("active");
    });

    const page = ResonaUtils.element("page-" + pageName);

    if (!page) {
      ResonaUtils.showMessage(
        "The " + pageName + " page has not been added to index.html yet."
      );

      return;
    }

    page.classList.add("active");

    document.querySelectorAll("nav button").forEach(button => {
      button.classList.toggle(
        "on",
        button.dataset.page === pageName ||
        button.getAttribute("onclick")?.includes(
          "'" + pageName + "'"
        )
      );
    });

    Resona.state.currentPage = pageName;

    ResonaUtils.saveJSON("lastPage", pageName);

    const main = ResonaUtils.element("main");

    if (main) main.scrollTop = 0;

    Resona.renderCurrentPage();
  }
};


/* =========================================================
   8. GLOBAL EXPLORE
   ========================================================= */

const ResonaExplore = {
  render() {
    const page = ResonaUtils.element("page-explore");

    if (!page) return;

    const selected = Resona.state.selectedContinent;

    if (selected) {
      this.renderContinent(selected);
      return;
    }

    page.innerHTML = `
      <div class="section-heading">
        <div>
          <div class="tag">Music without borders</div>
          <h1>Explore the world</h1>
        </div>
      </div>

      <p class="tag" style="margin:8px 0 18px">
        Discover music by continent and country.
      </p>

      <div class="continent-grid">
        ${RESONA_CONTINENTS.map(continent => `
          <button
            class="continent-card"
            data-continent="${ResonaUtils.escapeHTML(continent.id)}"
            type="button"
          >
            <span class="continent-symbol">${continent.symbol}</span>
            <span class="continent-name">${ResonaUtils.escapeHTML(continent.name)}</span>
            <span class="continent-description">${ResonaUtils.escapeHTML(continent.description)}</span>
          </button>
        `).join("")}
      </div>

      <h2>Worldwide releases</h2>
      <div id="exploreGlobalTracks"></div>
    `;

    page.querySelectorAll("[data-continent]").forEach(button => {
      button.addEventListener("click", () => {
        this.openContinent(button.dataset.continent);
      });
    });

    const globalTracks = ResonaUtils.element("exploreGlobalTracks");

    if (globalTracks) {
      const tracks = Resona.state.catalogue.tracks;

      globalTracks.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.emptyCatalogue();
    }
  },

  openContinent(continentId) {
    if (!RESONA_CONTINENTS.some(c => c.id === continentId)) return;

    Resona.state.selectedContinent = continentId;
    Resona.state.selectedCountry = null;

    this.render();
  },

  renderContinent(continentId) {
    const page = ResonaUtils.element("page-explore");
    const continent = RESONA_CONTINENTS.find(
      item => item.id === continentId
    );

    if (!page || !continent) return;

    const country = Resona.state.selectedCountry;

    const tracks = country
      ? ResonaCatalogue.byCountry(country)
      : ResonaCatalogue.byContinent(continent.id);

    page.innerHTML = `
      <button class="chip" id="exploreBack" type="button">
        ← All continents
      </button>

      <div style="margin-top:18px">
        <div style="font-size:32px">${continent.symbol}</div>
        <h1>${ResonaUtils.escapeHTML(continent.name)}</h1>
        <p class="tag" style="margin-top:6px">
          ${country
            ? "Discover music from " + ResonaUtils.escapeHTML(country)
            : ResonaUtils.escapeHTML(continent.description)}
        </p>
      </div>

      ${country ? `
        <button class="chip" id="countryBack" style="margin-top:16px" type="button">
          ← Countries
        </button>
      ` : `
        <h2>Countries</h2>
        <div class="country-grid">
          ${continent.countries.map(name => `
            <button
              class="country-card"
              data-country="${ResonaUtils.escapeHTML(name)}"
              type="button"
            >
              <div class="country-name">${ResonaUtils.escapeHTML(name)}</div>
              <div class="country-meta">Explore music</div>
            </button>
          `).join("")}
        </div>
      `}

      <h2>${country
        ? "Music from " + ResonaUtils.escapeHTML(country)
        : "Music from " + ResonaUtils.escapeHTML(continent.name)}</h2>

      <div id="continentTracks">
        ${tracks.length
          ? tracks.map(track => Resona.renderTrackRow(track)).join("")
          : this.emptyCatalogue()}
      </div>
    `;

    page.querySelector("#exploreBack")?.addEventListener("click", () => {
      Resona.state.selectedContinent = null;
      Resona.state.selectedCountry = null;
      this.render();
    });

    page.querySelector("#countryBack")?.addEventListener("click", () => {
      Resona.state.selectedCountry = null;
      this.render();
    });

    page.querySelectorAll("[data-country]").forEach(button => {
      button.addEventListener("click", () => {
        Resona.state.selectedCountry = button.dataset.country;
        this.render();
      });
    });
  },

  emptyCatalogue() {
    return `
      <div class="empty-state">
        <div class="symbol">♫</div>
        <p>No published tracks are available here yet.</p>
        <p class="tag" style="margin-top:6px">
          Music will appear when the real catalogue is connected.
        </p>
      </div>
    `;
  }
};


/* =========================================================
   9. SEARCH
   ========================================================= */

const ResonaSearch = {
  render() {
    const page = ResonaUtils.element("page-search");

    if (!page) return;

    page.innerHTML = `
      <h1>Search</h1>

      <p class="tag" style="margin:8px 0 16px">
        Find songs, artists, albums and more.
      </p>

      <input
        class="q"
        id="resonaSearchInput"
        type="search"
        placeholder="What do you want to hear?"
        autocomplete="off"
        aria-label="Search music"
      >

      <div class="chips" style="margin-top:14px">
        <button class="chip on" data-search-type="all">All</button>
        <button class="chip" data-search-type="track">Songs</button>
        <button class="chip" data-search-type="artist">Artists</button>
        <button class="chip" data-search-type="album">Albums</button>
      </div>

      <div id="resonaSearchResults" style="margin-top:18px"></div>
    `;

    const input = page.querySelector("#resonaSearchInput");

    input.addEventListener("input", () => {
      Resona.state.searchQuery = input.value;
      this.run(input.value);
    });

    page.querySelectorAll("[data-search-type]").forEach(button => {
      button.addEventListener("click", () => {
        page.querySelectorAll("[data-search-type]").forEach(item => {
          item.classList.remove("on");
        });

        button.classList.add("on");

        this.type = button.dataset.searchType;
        this.run(input.value);
      });
    });

    this.type = "all";
    this.run("");
  },

  run(query) {
    const results = ResonaUtils.element("resonaSearchResults");

    if (!results) return;

    const q = String(query || "").trim();

    if (!q) {
      results.innerHTML = `
        <div class="empty-state">
          <div class="symbol">⌕</div>
          <p>Search the Resona catalogue.</p>
          <p class="tag" style="margin-top:6px">
            Results will appear as music becomes available.
          </p>
        </div>
      `;

      return;
    }

    const tracks = ResonaCatalogue.search(q);

    results.innerHTML = tracks.length
      ? tracks.map(track => Resona.renderTrackRow(track)).join("")
      : `
        <div class="empty-state">
          <p>No catalogue results for "${ResonaUtils.escapeHTML(q)}".</p>
          <p class="tag" style="margin-top:6px">
            Search only returns music available in the connected catalogue.
          </p>
        </div>
      `;
  }
};


/* =========================================================
   10. LIBRARY PAGE
   ========================================================= */

const ResonaLibraryPage = {
  render() {
    const page = ResonaUtils.element("page-library");

    if (!page) return;

    const liked = Resona.state.library.likedTracks
      .map(id => ResonaCatalogue.findTrack(id))
      .filter(Boolean);

    const history = ResonaLibrary.getRecentlyPlayed();

    const playlists = Resona.state.library.playlists;

    page.innerHTML = `
      <h1>Your Library</h1>

      <p class="tag" style="margin-top:6px">
        Your saved music and listening history.
      </p>

      <div class="chips" style="margin:16px 0">
        <button class="chip on" data-library-tab="liked">Liked songs</button>
        <button class="chip" data-library-tab="history">Recently played</button>
        <button class="chip" data-library-tab="playlists">Playlists</button>
      </div>

      <div id="libraryContent"></div>

      <button class="cta secondary full" id="createPlaylist" style="margin-top:18px">
        + Create playlist
      </button>
    `;

    page.querySelectorAll("[data-library-tab]").forEach(button => {
      button.addEventListener("click", () => {
        page.querySelectorAll("[data-library-tab]").forEach(item => {
          item.classList.remove("on");
        });

        button.classList.add("on");

        this.showTab(button.dataset.libraryTab);
      });
    });

    page.querySelector("#createPlaylist").addEventListener("click", () => {
      const name = prompt("Name your playlist:");

      if (name === null) return;

      const playlist = ResonaLibrary.addPlaylist(name);

      if (playlist) {
        this.showTab("playlists");
        ResonaUtils.showMessage("Playlist created.", "success");
      }
    });

    this.showTab("liked");
  },

  showTab(tab) {
    const content = ResonaUtils.element("libraryContent");

    if (!content) return;

    if (tab === "liked") {
      const tracks = Resona.state.library.likedTracks
        .map(id => ResonaCatalogue.findTrack(id))
        .filter(Boolean);

      content.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.empty("Your liked songs will appear here.");
    } else if (tab === "history") {
      const tracks = ResonaLibrary.getRecentlyPlayed();

      content.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.empty("Songs you listen to will appear here.");
    } else if (tab === "playlists") {
      const playlists = Resona.state.library.playlists;

      content.innerHTML = playlists.length
        ? playlists.map(playlist => `
            <div class="row">
              <div class="art" style="width:48px;height:48px">♫</div>
              <div class="m">
                <div class="tt">${ResonaUtils.escapeHTML(playlist.name)}</div>
                <div class="tag">${playlist.trackIds.length} tracks</div>
              </div>
            </div>
          `).join("")
        : this.empty("Create your first playlist.");
    }
  },

  empty(message) {
    return `
      <div class="empty-state">
        <div class="symbol">♫</div>
        <p>${ResonaUtils.escapeHTML(message)}</p>
      </div>
    `;
  }
};


/* =========================================================
   11. ARTIST STUDIO ENTRY POINT
   ========================================================= */

const ResonaArtist = {
  render() {
    const page = ResonaUtils.element("page-artist");

    if (!page) return;

    page.innerHTML = `
      <div class="tag">For independent musicians</div>
      <h1 style="margin-top:4px">Artist Studio</h1>

      <p class="tag" style="margin-top:10px">
        Build your artist profile and prepare music for publishing.
      </p>

      <div class="panel" style="margin-top:20px">
        <h3>Publish your music</h3>

        <p class="tag" style="margin:8px 0 16px">
          Artist accounts, authorised audio uploads, release management,
          and publishing controls will be connected to the Resona backend.
        </p>

        <button class="cta full" id="artistStart">
          Get started
        </button>
      </div>

      <div class="panel" style="margin-top:14px">
        <h3>What artists will be able to do</h3>

        <div class="divider"></div>

        <p>• Create an artist profile</p>
        <p style="margin-top:10px">• Upload audio and cover artwork</p>
        <p style="margin-top:10px">• Add release details and credits</p>
        <p style="margin-top:10px">• Declare music rights and ownership</p>
        <p style="margin-top:10px">• Manage releases and view statistics</p>
      </div>
    `;

    page.querySelector("#artistStart").addEventListener("click", () => {
      ResonaUtils.showMessage(
        "Artist registration needs the backend and secure accounts."
      );
    });
  }
};


/* =========================================================
   12. MUSIC PLAYER
   ========================================================= */

const ResonaPlayer = {
  async play(trackOrId, queue = null) {
    const track = typeof trackOrId === "object"
      ? trackOrId
      : ResonaCatalogue.findTrack(trackOrId);

    if (!track) {
      ResonaUtils.showMessage(
        "This track is not available in the catalogue.",
        "error"
      );

      return false;
    }

    if (!Resona.config.enableAudioPlayback) {
      ResonaUtils.showMessage(
        "Audio playback is not connected yet. The real audio source must be configured first."
      );

      return false;
    }

    if (!track.audioUrl || track.rightsConfirmed !== true) {
      ResonaUtils.showMessage(
        "This track does not have a verified, authorised audio source.",
        "error"
      );

      return false;
    }

    try {
      if (queue) {
        Resona.state.queue = [...queue];
        Resona.state.queueIndex = Resona.state.queue.findIndex(
          item => String(item.id) === String(track.id)
        );
      } else if (!Resona.state.queue.length) {
        Resona.state.queue = [track];
        Resona.state.queueIndex = 0;
      }

      this.stopAudio();

      const audio = new Audio();

      audio.preload = "metadata";
      audio.src = track.audioUrl;

      audio.addEventListener("timeupdate", () => {
        Resona.state.audioProgress = audio.currentTime;
        Resona.state.audioDuration = audio.duration || 0;
        this.updateProgress();
      });

      audio.addEventListener("ended", () => {
        if (Resona.state.repeatMode === "one") {
          audio.currentTime = 0;
          audio.play().catch(() => {});
          return;
        }

        this.next();
      });

      audio.addEventListener("error", () => {
        ResonaUtils.showMessage(
          "Unable to play this audio source.",
          "error"
        );
      });

      Resona.state.currentAudio = audio;
      Resona.state.currentTrack = track;

      await audio.play();

      Resona.state.isPlaying = true;

      ResonaLibrary.recordRecentlyPlayed(track.id);

      this.updateInterface();
      this.updateButtons();

      return true;
    } catch (error) {
      console.error("Resona playback error:", error);

      Resona.state.isPlaying = false;

      ResonaUtils.showMessage(
        "Playback could not start. Check the audio source and permissions.",
        "error"
      );

      return false;
    }
  },

  stopAudio() {
    const audio = Resona.state.currentAudio;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    Resona.state.currentAudio = null;
    Resona.state.isPlaying = false;
  },

  async toggle() {
    const audio = Resona.state.currentAudio;

    if (!audio) {
      ResonaUtils.showMessage("Choose an available track first.");
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        Resona.state.isPlaying = true;
      } catch (error) {
        ResonaUtils.showMessage("Unable to resume playback.", "error");
      }
    } else {
      audio.pause();
      Resona.state.isPlaying = false;
    }

    this.updateButtons();
  },

  async next() {
    const queue = Resona.state.queue;

    if (!queue.length) return;

    let index = Resona.state.queueIndex;

    if (Resona.state.isShuffle && queue.length > 1) {
      let nextIndex = index;

      while (nextIndex === index) {
        nextIndex = Math.floor(Math.random() * queue.length);
      }

      index = nextIndex;
    } else {
      index++;
    }

    if (index >= queue.length) {
      if (Resona.state.repeatMode === "all") {
        index = 0;
      } else {
        this.stopAudio();
        this.updateButtons();
        return;
      }
    }

    Resona.state.queueIndex = index;

    await this.play(queue[index], queue);
  },

  async previous() {
    const audio = Resona.state.currentAudio;

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    const queue = Resona.state.queue;

    if (!queue.length) return;

    let index = Math.max(0, Resona.state.queueIndex - 1);

    Resona.state.queueIndex = index;

    await this.play(queue[index], queue);
  },

  updateInterface() {
    const track = Resona.state.currentTrack;

    if (!track) return;

    ResonaUtils.setText("miniTitle", track.title);
    ResonaUtils.setText("miniArtist", track.artist);

    ResonaUtils.setText("npTitle", track.title);
    ResonaUtils.setText("npArtist", track.artist);

    for (const id of ["miniArt", "npArt"]) {
      const art = ResonaUtils.element(id);

      if (!art) continue;

      if (track.artwork) {
        art.style.backgroundImage = `url("${track.artwork}")`;
        art.style.backgroundSize = "cover";
        art.style.backgroundPosition = "center";
        art.textContent = "";
      } else {
        art.style.backgroundImage = "";
        art.textContent = "♫";
      }
    }

    const mini = ResonaUtils.element("mini");

    if (mini) mini.style.display = "flex";

    const bg = ResonaUtils.element("npbg");

    if (bg) {
      bg.style.background = track.artwork
        ? `center / cover url("${track.artwork}")`
        : "linear-gradient(135deg,#312e81,#134e4a)";
    }
  },

  updateButtons() {
    const symbol = Resona.state.isPlaying ? "⏸" : "▶";

    ResonaUtils.setText("miniPlay", symbol);
    ResonaUtils.setText("npPlay", symbol);
  },

  updateProgress() {
    const current = Resona.state.audioProgress;
    const duration = Resona.state.audioDuration;

    const percentage = duration > 0
      ? Math.min(100, (current / duration) * 100)
      : 0;

    const miniProgress = ResonaUtils.element("miniProgress");
    const npProgress = ResonaUtils.element("npProgress");

    if (miniProgress) {
      miniProgress.style.width = percentage + "%";
    }

    if (npProgress) {
      npProgress.style.width = percentage + "%";
    }
  }
};


/* =========================================================
   13. NOW PLAYING CONTROLS
   ========================================================= */

function openNowPlaying() {
  ResonaUtils.element("np")?.classList.add("open");
}

function closeNowPlaying() {
  ResonaUtils.element("np")?.classList.remove("open");
}

function playSong(id) {
  const tracks = Resona.state.catalogue.tracks;

  const track = ResonaCatalogue.findTrack(id);

  if (!track) {
    ResonaUtils.showMessage("Track not found.");
    return;
  }

  ResonaPlayer.play(track, tracks);
}

function togglePlay() {
  ResonaPlayer.toggle();
}

function nextSong() {
  ResonaPlayer.next();
}

function prevSong() {
  ResonaPlayer.previous();
}


/* =========================================================
   14. SHARED TRACK RENDERER
   ========================================================= */

Resona.renderTrackRow = function(track) {
  const liked = ResonaLibrary.isLiked(track.id);

  return `
    <div class="row" data-track-row="${ResonaUtils.escapeHTML(track.id)}">
      <button
        class="art"
        data-play-track="${ResonaUtils.escapeHTML(track.id)}"
        style="width:48px;height:48px"
        aria-label="Play ${ResonaUtils.escapeHTML(track.title)}"
      >
        ${track.artwork
          ? `<img src="${ResonaUtils.escapeHTML(track.artwork)}" alt="" loading="lazy">`
          : "♫"}
      </button>

      <button class="m" data-play-track="${ResonaUtils.escapeHTML(track.id)}">
        <div class="tt">${ResonaUtils.escapeHTML(track.title)}</div>
        <div class="tag">${ResonaUtils.escapeHTML(track.artist)}</div>
      </button>

      <button
        class="ic"
        data-like-track="${ResonaUtils.escapeHTML(track.id)}"
        aria-label="${liked ? "Unlike" : "Like"} ${ResonaUtils.escapeHTML(track.title)}"
      >${liked ? "♥" : "♡"}</button>
    </div>
  `;
};


/* =========================================================
   15. HOME PAGE
   ========================================================= */

const ResonaHome = {
  render() {
    const page = ResonaUtils.element("page-home");

    if (!page) return;

    const recent = ResonaLibrary.getRecentlyPlayed();
    const tracks = Resona.state.catalogue.tracks;

    page.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div class="tag">Music without borders</div>
          <h1>Resona</h1>
        </div>

        <button class="icon-button" id="homeSearch" aria-label="Search">
          ⌕
        </button>
      </div>

      <div class="hero glass">
        <div>
          <div class="tag">Discover something new</div>
          <div style="font-weight:700;font-size:17px;margin:4px 0">
            Your world of music
          </div>
          <div class="tag">Find sounds from every continent.</div>
        </div>

        <button class="cta" id="homeExplore">Explore</button>
      </div>

      <div class="section-heading">
        <h2>Recently played</h2>
      </div>

      <div class="hs" id="recent"></div>

      <div class="section-heading">
        <h2>Available music</h2>
      </div>

      <div id="recommended"></div>
    `;

    page.querySelector("#homeSearch").addEventListener("click", () => {
      ResonaNavigation.show("search");
    });

    page.querySelector("#homeExplore").addEventListener("click", () => {
      ResonaNavigation.show("explore");
    });

    const recentEl = page.querySelector("#recent");

    recentEl.innerHTML = recent.length
      ? recent.map(track => `
          <button class="card" data-play-track="${ResonaUtils.escapeHTML(track.id)}">
            <div class="art">
              ${track.artwork
                ? `<img src="${ResonaUtils.escapeHTML(track.artwork)}" alt="" loading="lazy">`
                : "♫"}
            </div>
            <div class="tt">${ResonaUtils.escapeHTML(track.title)}</div>
            <div class="tag">${ResonaUtils.escapeHTML(track.artist)}</div>
          </button>
        `).join("")
      : `
          <div class="empty-state" style="width:100%">
            <p class="tag">Your listening history will appear here.</p>
          </div>
        `;

    page.querySelector("#recommended").innerHTML = tracks.length
      ? tracks.map(track => Resona.renderTrackRow(track)).join("")
      : `
          <div class="empty-state">
            <div class="symbol">♫</div>
            <p>The Resona catalogue is not connected yet.</p>
            <p class="tag" style="margin-top:6px">
              No fictional songs are being presented as real releases.
            </p>
          </div>
        `;
  }
};


/* =========================================================
   16. GLOBAL EVENT DELEGATION
   ========================================================= */

document.addEventListener("click", event => {
  const playButton = event.target.closest("[data-play-track]");

  if (playButton) {
    event.preventDefault();

    const trackId = playButton.dataset.playTrack;

    ResonaPlayer.play(
      trackId,
      Resona.state.catalogue.tracks
    );

    return;
  }

  const likeButton = event.target.closest("[data-like-track]");

  if (likeButton) {
    event.preventDefault();
    event.stopPropagation();

    const id = likeButton.dataset.likeTrack;

    const liked = ResonaLibrary.toggleLike(id);

    ResonaUtils.showMessage(
      liked ? "Added to liked songs." : "Removed from liked songs.",
      "success"
    );

    return;
  }
});


/* =========================================================
   17. PAGE RENDERING
   ========================================================= */

Resona.renderCurrentPage = function() {
  switch (Resona.state.currentPage) {
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

    case "artist":
      ResonaArtist.render();
      break;
  }
};


/* =========================================================
   18. BACKEND CONNECTION FOUNDATION
   ========================================================= */

const ResonaAPI = {
  async request(path, options = {}) {
    if (!Resona.config.apiBase) {
      throw new Error(
        "Resona API has not been configured yet."
      );
    }

    const base = Resona.config.apiBase.replace(/\/+$/, "");

    const endpoint = base + "/" + String(path).replace(/^\/+/, "");

    const response = await fetch(endpoint, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(
        "Resona API returned HTTP " + response.status
      );
    }

    return response.json();
  },

  async loadCatalogue() {
    if (!Resona.config.apiBase) return [];

    const result = await this.request("/tracks");

    const tracks = Array.isArray(result)
      ? result
      : result.tracks;

    if (!Array.isArray(tracks)) {
      throw new Error("Unexpected catalogue response.");
    }

    ResonaCatalogue.setTracks(tracks);

    return tracks;
  }
};


/* =========================================================
   19. NAVIGATION COMPATIBILITY
   ========================================================= */

function showPage(name, button) {
  ResonaNavigation.show(name);

  if (button) {
    document.querySelectorAll("nav button").forEach(item => {
      item.classList.toggle("on", item === button);
    });
  }
}

function doSearch(query) {
  ResonaSearch.run(query);
}

function openReset() {
  ResonaUtils.showMessage(
    "The Reset mood-discovery interface will be integrated into Explore."
  );
}

function doReset() {
  if (!Resona.state.selectedMood) {
    ResonaUtils.showMessage("Choose a mood first.");
    return;
  }

  ResonaUtils.showMessage(
    "Mood-based recommendations require the connected catalogue."
  );
}


/* =========================================================
   20. INITIALISATION
   ========================================================= */

function initResona() {
  ResonaLibrary.init();

  const main = ResonaUtils.element("main");

  if (!main) {
    console.error(
      "Resona could not start: #main was not found in index.html."
    );

    return;
  }

  const requiredPages = [
    "home",
    "explore",
    "search",
    "library",
    "artist"
  ];

  const missingPages = requiredPages.filter(
    name => !ResonaUtils.element("page-" + name)
  );

  if (missingPages.length) {
    console.warn(
      "Resona pages still need to be added to index.html:",
      missingPages.join(", ")
    );
  }

  Resona.renderCurrentPage();

  const savedPage = ResonaUtils.loadJSON("lastPage", "home");

  if (requiredPages.includes(savedPage) &&
      ResonaUtils.element("page-" + savedPage)) {
    ResonaNavigation.show(savedPage);
  }

  // The API remains disconnected until a real endpoint is configured.
  if (Resona.config.apiBase) {
    ResonaAPI.loadCatalogue().catch(error => {
      console.error("Catalogue loading failed:", error);

      ResonaUtils.showMessage(
        "Could not load the music catalogue.",
        "error"
      );
    });
  }

  console.info(
    "Resona frontend initialised. Backend:",
    Resona.config.apiBase ? "configured" : "not configured"
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initResona);
} else {
  initResona();
}


/* =========================================================
   21. PUBLIC APPLICATION INTERFACE
   ========================================================= */

window.Resona = Resona;
window.ResonaAPI = ResonaAPI;
window.ResonaCatalogue = ResonaCatalogue;
window.ResonaExplore = ResonaExplore;
window.ResonaLibrary = ResonaLibrary;
window.ResonaNavigation = ResonaNavigation;
window.ResonaPlayer = ResonaPlayer;
window.ResonaUtils = ResonaUtils;

window.playSong = playSong;
window.togglePlay = togglePlay;
window.nextSong = nextSong;
window.prevSong = prevSong;
window.openNowPlaying = openNowPlaying;
window.closeNowPlaying = closeNowPlaying;
window.showPage = showPage;
window.doSearch = doSearch;
window.openReset = openReset;
window.doReset = doReset;
