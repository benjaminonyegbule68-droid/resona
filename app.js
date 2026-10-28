/* =========================================================
   RESONA — APPLICATION CORE
   Version 1.1.0
   Global music discovery and streaming frontend
   ========================================================= */

"use strict";

/* =========================================================
   1. CONFIGURATION
   ========================================================= */

const Resona = {
  version: "1.1.0",

  config: {
    // Leave empty until the real Resona API is available.
    // Example: https://api.example.com
    apiBase: "",

    // Never populate the catalogue with fictional music.
    enableDemoData: false,

    // Playback requires a legitimate, authorised audio source.
    enableAudioPlayback: true,

    // Maximum time to wait for a catalogue response.
    requestTimeout: 12000
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
    searchType: "all",

    selectedMood: null,
    selectedContinent: null,
    selectedCountry: null,

    libraryTab: "liked",

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

    isLoadingCatalogue: false,
    catalogueError: null
  }
};


/* =========================================================
   2. SAFE STORAGE
   ========================================================= */

const ResonaStorage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("resona_" + key);

      if (raw === null) {
        return fallback;
      }

      return JSON.parse(raw);
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
   3. CONTINENTS AND COUNTRIES
   ========================================================= */

const RESONA_CONTINENTS = [
  {
    id: "africa",
    name: "Africa",
    symbol: "🌍",
    description: "Discover African sounds",
    countries: [
      "Algeria", "Angola", "Benin", "Botswana",
      "Burkina Faso", "Burundi", "Cabo Verde",
      "Cameroon", "Central African Republic", "Chad",
      "Comoros", "Democratic Republic of the Congo",
      "Republic of the Congo", "Côte d'Ivoire", "Djibouti",
      "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini",
      "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea",
      "Guinea-Bissau", "Kenya", "Lesotho", "Liberia",
      "Libya", "Madagascar", "Malawi", "Mali", "Mauritania",
      "Mauritius", "Morocco", "Mozambique", "Namibia",
      "Niger", "Nigeria", "Rwanda", "São Tomé and Príncipe",
      "Senegal", "Seychelles", "Sierra Leone", "Somalia",
      "South Africa", "South Sudan", "Sudan", "Tanzania",
      "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"
    ]
  },

  {
    id: "europe",
    name: "Europe",
    symbol: "🌍",
    description: "Explore European music",
    countries: [
      "Albania", "Andorra", "Austria", "Belarus",
      "Belgium", "Bosnia and Herzegovina", "Bulgaria",
      "Croatia", "Cyprus", "Czechia", "Denmark",
      "Estonia", "Finland", "France", "Germany",
      "Greece", "Hungary", "Iceland", "Ireland",
      "Italy", "Latvia", "Liechtenstein", "Lithuania",
      "Luxembourg", "Malta", "Moldova", "Monaco",
      "Montenegro", "Netherlands", "North Macedonia",
      "Norway", "Poland", "Portugal", "Romania",
      "Russia", "San Marino", "Serbia", "Slovakia",
      "Slovenia", "Spain", "Sweden", "Switzerland",
      "Ukraine", "United Kingdom", "Vatican City"
    ]
  },

  {
    id: "asia",
    name: "Asia",
    symbol: "🌏",
    description: "Explore music from Asia",
    countries: [
      "Afghanistan", "Armenia", "Azerbaijan", "Bahrain",
      "Bangladesh", "Bhutan", "Brunei", "Cambodia",
      "China", "Georgia", "India", "Indonesia", "Iran",
      "Iraq", "Israel", "Japan", "Jordan", "Kazakhstan",
      "Kuwait", "Kyrgyzstan", "Laos", "Lebanon",
      "Malaysia", "Maldives", "Mongolia", "Myanmar",
      "Nepal", "North Korea", "Oman", "Pakistan",
      "Palestine", "Philippines", "Qatar", "Saudi Arabia",
      "Singapore", "South Korea", "Sri Lanka", "Syria",
      "Taiwan", "Tajikistan", "Thailand", "Timor-Leste",
      "Turkey", "Turkmenistan", "United Arab Emirates",
      "Uzbekistan", "Vietnam", "Yemen"
    ]
  },

  {
    id: "north-america",
    name: "North America",
    symbol: "🌎",
    description: "Discover North American music",
    countries: [
      "Antigua and Barbuda", "Bahamas", "Barbados",
      "Belize", "Canada", "Costa Rica", "Cuba",
      "Dominica", "Dominican Republic", "El Salvador",
      "Grenada", "Guatemala", "Haiti", "Honduras",
      "Jamaica", "Mexico", "Nicaragua", "Panama",
      "Saint Kitts and Nevis", "Saint Lucia",
      "Saint Vincent and the Grenadines",
      "Trinidad and Tobago", "United States"
    ]
  },

  {
    id: "south-america",
    name: "South America",
    symbol: "🌎",
    description: "Discover South American music",
    countries: [
      "Argentina", "Bolivia", "Brazil", "Chile",
      "Colombia", "Ecuador", "Guyana", "Paraguay",
      "Peru", "Suriname", "Uruguay", "Venezuela"
    ]
  },

  {
    id: "oceania",
    name: "Oceania",
    symbol: "🌏",
    description: "Explore music from Oceania",
    countries: [
      "Australia", "Fiji", "Kiribati", "Marshall Islands",
      "Micronesia", "Nauru", "New Zealand", "Palau",
      "Papua New Guinea", "Samoa", "Solomon Islands",
      "Tonga", "Tuvalu", "Vanuatu"
    ]
  }
];

const RESONA_MOODS = [
  { id: "calm", name: "Calm", symbol: "☁" },
  { id: "energetic", name: "Energetic", symbol: "⚡" },
  { id: "melancholy", name: "Melancholy", symbol: "☾" },
  { id: "focus", name: "Focus", symbol: "◉" },
  { id: "party", name: "Party", symbol: "✦" },
  { id: "night", name: "Night", symbol: "☽" }
];


/* =========================================================
   4. UTILITIES
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

  validHttpUrl(value) {
    if (!value) return "";

    try {
      const url = new URL(String(value), location.href);

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:"
      ) {
        return "";
      }

      return url.href;
    } catch {
      return "";
    }
  },

  formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "0:00";
    }

    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const remaining = total % 60;

    return minutes + ":" + String(remaining).padStart(2, "0");
  },

  showMessage(message, type = "info") {
    let toast = this.element("toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      document.body.appendChild(toast);
    }

    toast.textContent = String(message ?? "");

    toast.dataset.type = type;

    Object.assign(toast.style, {
      position: "fixed",
      left: "16px",
      right: "16px",
      bottom: "calc(145px + env(safe-area-inset-bottom, 0px))",
      zIndex: "2000",
      padding: "13px 16px",
      borderRadius: "14px",
      background: "#191922",
      border: "1px solid rgba(167,139,250,.5)",
      color: "#f3f1fa",
      fontSize: "14px",
      boxShadow: "0 10px 35px rgba(0,0,0,.35)",
      opacity: "1",
      visibility: "visible",
      transform: "translateY(0)",
      transition: "opacity .2s, transform .2s"
    });

    if (type === "error") {
      toast.style.borderColor = "rgba(251,113,133,.7)";
    } else if (type === "success") {
      toast.style.borderColor = "rgba(52,211,153,.7)";
    }

    clearTimeout(this._toastTimer);

    this._toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";

      setTimeout(() => {
        if (toast.style.opacity === "0") {
          toast.style.visibility = "hidden";
        }
      }, 250);
    }, 3200);
  },

  loadJSON(key, fallback) {
    return ResonaStorage.get(key, fallback);
  },

  saveJSON(key, value) {
    return ResonaStorage.set(key, value);
  },

  shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  },

  normaliseList(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string" && value.trim()) {
      return value.split(",").map(item => item.trim());
    }

    return [];
  },

  getTrackMoods(track) {
    return [
      ...this.normaliseList(track.moods),
      ...this.normaliseList(track.mood),
      ...this.normaliseList(track.tags),
      ...this.normaliseList(track.genres),
      ...this.normaliseList(track.genre)
    ].map(item => this.normalise(item));
  }
};


/* =========================================================
   5. CATALOGUE NORMALISATION
   ========================================================= */

const ResonaCatalogue = {
  normaliseTrack(source) {
    if (!source || typeof source !== "object") {
      return null;
    }

    const id = source.id ??
      source.track_id ??
      source.trackId;

    const title = source.title ??
      source.name ??
      source.track_name;

    const artistValue = source.artist ??
      source.artist_name ??
      source.artistName;

    const artist = typeof artistValue === "object"
      ? artistValue?.name || artistValue?.display_name || ""
      : artistValue;

    if (
      id === undefined ||
      id === null ||
      !String(title ?? "").trim() ||
      !String(artist ?? "").trim()
    ) {
      return null;
    }

    const artwork = source.artwork ??
      source.artwork_url ??
      source.artworkUrl ??
      source.cover_url ??
      source.coverUrl ??
      source.image_url ??
      source.imageUrl ??
      "";

    const audioUrl = source.audioUrl ??
      source.audio_url ??
      source.stream_url ??
      source.streamUrl ??
      "";

    const albumValue = source.album ?? source.album_name ?? "";

    const album = typeof albumValue === "object"
      ? albumValue?.title || albumValue?.name || ""
      : albumValue;

    const duration = Number(
      source.duration_seconds ??
      source.duration ??
      source.durationSeconds ??
      0
    );

    return {
      id: String(id),
      title: String(title).trim(),
      artist: String(artist).trim(),
      album: String(album ?? ""),
      artwork: ResonaUtils.validHttpUrl(artwork),
      audioUrl: ResonaUtils.validHttpUrl(audioUrl),
      duration: Number.isFinite(duration) && duration > 0
        ? duration
        : 0,

      country: String(
        source.country ??
        source.country_name ??
        ""
      ),

      continent: this.normaliseContinent(
        source.continent ??
        source.continent_id ??
        ""
      ),

      genre: source.genre ?? source.genres ?? "",
      moods: source.moods ?? source.mood ?? source.tags ?? [],

      releaseDate: String(
        source.releaseDate ??
        source.release_date ??
        ""
      ),

      rightsConfirmed:
        source.rightsConfirmed === true ||
        source.rights_confirmed === true,

      streamAllowed:
        source.streamAllowed === true ||
        source.stream_allowed === true,

      lyrics: typeof source.lyrics === "string"
        ? source.lyrics
        : "",

      lyricsTimed:
        source.lyrics_timed === true ||
        source.lyricsTimed === true
    };
  },

  normaliseContinent(value) {
    const text = ResonaUtils.normalise(value);

    const aliases = {
      "africa": "africa",
      "europe": "europe",
      "asia": "asia",
      "north america": "north-america",
      "north-america": "north-america",
      "south america": "south-america",
      "south-america": "south-america",
      "oceania": "oceania",
      "australia": "oceania"
    };

    return aliases[text] || text;
  },

  setTracks(tracks) {
    if (!Array.isArray(tracks)) {
      throw new TypeError("The catalogue must contain an array of tracks.");
    }

    const seen = new Set();

    Resona.state.catalogue.tracks = tracks
      .map(track => this.normaliseTrack(track))
      .filter(Boolean)
      .filter(track => {
        if (seen.has(track.id)) return false;

        seen.add(track.id);

        return true;
      });

    Resona.state.catalogue.artists = [
      ...new Set(
        Resona.state.catalogue.tracks.map(track => track.artist)
      )
    ];

    Resona.state.catalogue.albums = [
      ...new Set(
        Resona.state.catalogue.tracks
          .map(track => track.album)
          .filter(Boolean)
      )
    ];

    this.reconcileQueue();
    Resona.renderCurrentPage();

    return Resona.state.catalogue.tracks.length;
  },

  reconcileQueue() {
    const currentId = Resona.state.currentTrack?.id;

    if (!Resona.state.queue.length) return;

    Resona.state.queue = Resona.state.queue
      .map(item => this.findTrack(item.id))
      .filter(Boolean);

    Resona.state.queueIndex = currentId
      ? Resona.state.queue.findIndex(
          item => item.id === String(currentId)
        )
      : -1;
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
        track.genre,
        ...ResonaUtils.getTrackMoods(track)
      ].join(" ");

      return ResonaUtils.normalise(searchable).includes(q);
    });
  },

  byContinent(continentId) {
    const wanted = this.normaliseContinent(continentId);

    return Resona.state.catalogue.tracks.filter(track =>
      this.normaliseContinent(track.continent) === wanted
    );
  },

  byCountry(country) {
    const wanted = ResonaUtils.normalise(country);

    return Resona.state.catalogue.tracks.filter(track =>
      ResonaUtils.normalise(track.country) === wanted
    );
  },

  byMood(mood) {
    const wanted = ResonaUtils.normalise(mood);

    return Resona.state.catalogue.tracks.filter(track =>
      ResonaUtils.getTrackMoods(track).includes(wanted)
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
        ? saved.likedTracks.map(String)
        : [],

      savedAlbums: Array.isArray(saved.savedAlbums)
        ? saved.savedAlbums.map(String)
        : [],

      followedArtists: Array.isArray(saved.followedArtists)
        ? saved.followedArtists.map(String)
        : [],

      playlists: Array.isArray(saved.playlists)
        ? saved.playlists
            .filter(item => item && typeof item === "object")
            .map(item => ({
              id: String(item.id ?? ""),
              name: String(item.name ?? "Untitled playlist"),
              trackIds: Array.isArray(item.trackIds)
                ? item.trackIds.map(String)
                : [],
              createdAt: item.createdAt || ""
            }))
        : []
    };
  },

  save() {
    return ResonaUtils.saveJSON(
      "library",
      Resona.state.library
    );
  },

  isLiked(trackId) {
    return Resona.state.library.likedTracks.includes(String(trackId));
  },

  toggleLike(trackId) {
    const id = String(trackId);
    const liked = Resona.state.library.likedTracks;

    if (liked.includes(id)) {
      Resona.state.library.likedTracks =
        liked.filter(item => item !== id);
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
      ResonaUtils.showMessage("Enter a playlist name first.", "error");
      return null;
    }

    const playlist = {
      id: "playlist_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 8),

      name: cleanName.slice(0, 80),
      trackIds: [],
      createdAt: new Date().toISOString()
    };

    Resona.state.library.playlists.push(playlist);

    this.save();

    return playlist;
  },

  addToPlaylist(playlistId, trackId) {
    const playlist = Resona.state.library.playlists.find(
      item => item.id === String(playlistId)
    );

    if (!playlist) return false;

    const id = String(trackId);

    if (!playlist.trackIds.includes(id)) {
      playlist.trackIds.push(id);
    }

    this.save();

    return true;
  },

  recordRecentlyPlayed(trackId) {
    const id = String(trackId);
    const history = ResonaUtils.loadJSON("history", []);

    const oldHistory = Array.isArray(history)
      ? history.map(String)
      : [];

    const updated = [
      id,
      ...oldHistory.filter(item => item !== id)
    ].slice(0, 50);

    ResonaUtils.saveJSON("history", updated);
  },

  getRecentlyPlayed() {
    const history = ResonaUtils.loadJSON("history", []);

    if (!Array.isArray(history)) return [];

    return history
      .map(id => ResonaCatalogue.findTrack(id))
      .filter(Boolean);
  }
};


/* =========================================================
   7. TRACK ROW RENDERER
   ========================================================= */

Resona.renderTrackRow = function(track) {
  const id = ResonaUtils.escapeHTML(track.id);
  const title = ResonaUtils.escapeHTML(track.title);
  const artist = ResonaUtils.escapeHTML(track.artist);
  const liked = ResonaLibrary.isLiked(track.id);

  const art = track.artwork
    ? `<img src="${ResonaUtils.escapeHTML(track.artwork)}" alt="" loading="lazy">`
    : "♫";

  return `
    <div class="row" data-track-row="${id}">
      <button
        class="art"
        type="button"
        data-play-track="${id}"
        style="width:48px;height:48px"
        aria-label="Play ${title}"
      >${art}</button>

      <button
        class="m"
        type="button"
        data-play-track="${id}"
        style="min-width:0;text-align:left"
      >
        <div class="tt">${title}</div>
        <div class="tag">${artist}</div>
      </button>

      <button
        class="ic"
        type="button"
        data-like-track="${id}"
        aria-label="${liked ? "Unlike" : "Like"} ${title}"
        aria-pressed="${liked ? "true" : "false"}"
      >${liked ? "♥" : "♡"}</button>
    </div>
  `;
};


/* =========================================================
   8. HOME PAGE
   ========================================================= */

const ResonaHome = {
  render() {
    const page = ResonaUtils.element("page-home");

    if (!page) return;

    const recent = ResonaLibrary.getRecentlyPlayed();
    const tracks = Resona.state.catalogue.tracks;

    page.innerHTML = `
      <div class="section-heading">
        <div>
          <div class="tag">Music without borders</div>
          <h1>Resona</h1>
        </div>

        <button
          class="ic"
          id="homeSearch"
          type="button"
          aria-label="Search music"
        >⌕</button>
      </div>

      <div class="hero glass">
        <div>
          <div class="tag">Discover something new</div>
          <h2 style="margin:5px 0">Your world of music</h2>
          <p class="tag">Sounds and artists from around the world.</p>
        </div>

        <button class="cta" id="homeExplore" type="button">
          Explore
        </button>
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

    page.querySelector("#homeSearch")?.addEventListener("click", () => {
      ResonaNavigation.show("search");
    });

    page.querySelector("#homeExplore")?.addEventListener("click", () => {
      ResonaNavigation.show("explore");
    });

    const recentEl = page.querySelector("#recent");

    if (recentEl) {
      recentEl.innerHTML = recent.length
        ? recent.map(track => `
            <button
              class="card"
              type="button"
              data-play-track="${ResonaUtils.escapeHTML(track.id)}"
            >
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
    }

    const recommended = page.querySelector("#recommended");

    if (recommended) {
      recommended.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : `
            <div class="empty-state">
              <div class="symbol">♫</div>
              <p>${Resona.state.isLoadingCatalogue
                ? "Loading the music catalogue..."
                : "The Resona catalogue is not connected yet."}</p>

              <p class="tag" style="margin-top:6px">
                Real releases will appear here when the catalogue is connected.
              </p>
            </div>
          `;
    }
  }
};


/* =========================================================
   9. GLOBAL EXPLORE
   ========================================================= */

const ResonaExplore = {
  render() {
    const page = ResonaUtils.element("page-explore");

    if (!page) return;

    if (Resona.state.selectedContinent) {
      this.renderContinent(Resona.state.selectedContinent);
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
        Explore music by continent and country.
      </p>

      <div class="continent-grid">
        ${RESONA_CONTINENTS.map(continent => `
          <button
            class="continent-card"
            type="button"
            data-continent="${ResonaUtils.escapeHTML(continent.id)}"
          >
            <span class="continent-symbol">${continent.symbol}</span>
            <span class="continent-name">${ResonaUtils.escapeHTML(continent.name)}</span>
            <span class="continent-description">${ResonaUtils.escapeHTML(continent.description)}</span>
          </button>
        `).join("")}
      </div>

      <h2>Worldwide music</h2>
      <div id="exploreGlobalTracks"></div>
    `;

    page.querySelectorAll("[data-continent]").forEach(button => {
      button.addEventListener("click", () => {
        this.openContinent(button.dataset.continent);
      });
    });

    const globalTracks = page.querySelector("#exploreGlobalTracks");

    if (globalTracks) {
      const tracks = Resona.state.catalogue.tracks;

      globalTracks.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.emptyCatalogue();
    }
  },

  openContinent(continentId) {
    if (!RESONA_CONTINENTS.some(item => item.id === continentId)) {
      return;
    }

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
            ? "Music from " + ResonaUtils.escapeHTML(country)
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
              type="button"
              data-country="${ResonaUtils.escapeHTML(name)}"
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
          This area will populate when matching releases enter the real catalogue.
        </p>
      </div>
    `;
  }
};


/* =========================================================
   10. SEARCH
   ========================================================= */

const ResonaSearch = {
  type: "all",

  render() {
    const page = ResonaUtils.element("page-search");

    if (!page) return;

    /*
      Use the existing HTML search controls whenever possible.
      Do not replace the whole page if those controls exist.
    */

    let input = ResonaUtils.element("searchInput");
    let results = ResonaUtils.element("searchResults");

    if (!input || !results) {
      page.innerHTML = `
        <h1>Search</h1>

        <p class="tag" style="margin:8px 0 16px">
          Find songs, artists and albums.
        </p>

        <input
          class="q"
          id="searchInput"
          type="search"
          placeholder="What do you want to hear?"
          autocomplete="off"
          aria-label="Search music"
        >

        <div class="chips" style="margin-top:14px">
          <button class="chip on" data-search-type="all" type="button">All</button>
          <button class="chip" data-search-type="track" type="button">Songs</button>
          <button class="chip" data-search-type="artist" type="button">Artists</button>
          <button class="chip" data-search-type="album" type="button">Albums</button>
        </div>

        <div id="searchResults" style="margin-top:18px"></div>
      `;

      input = ResonaUtils.element("searchInput");
      results = ResonaUtils.element("searchResults");
    }

    if (!input || !results) return;

    if (!input.dataset.resonaBound) {
      input.dataset.resonaBound = "true";

      input.addEventListener("input", () => {
        Resona.state.searchQuery = input.value;
        this.run(input.value);
      });
    }

    page.querySelectorAll("[data-search-type]").forEach(button => {
      if (button.dataset.resonaBound) return;

      button.dataset.resonaBound = "true";

      button.addEventListener("click", () => {
        page.querySelectorAll("[data-search-type]").forEach(item => {
          item.classList.toggle("on", item === button);
        });

        this.type = button.dataset.searchType || "all";
        Resona.state.searchType = this.type;

        this.run(input.value);
      });
    });

    input.value = Resona.state.searchQuery || "";
    this.run(input.value);
  },

  run(query) {
    const results = ResonaUtils.element("searchResults");

    if (!results) return;

    const q = String(query || "").trim();

    if (!q) {
      results.innerHTML = `
        <div class="empty-state">
          <div class="symbol">⌕</div>
          <p>Search the Resona catalogue.</p>
          <p class="tag" style="margin-top:6px">
            Search results will appear when catalogue music is available.
          </p>
        </div>
      `;

      return;
    }

    const allMatches = ResonaCatalogue.search(q);

    let tracks = allMatches;

    if (this.type === "track") {
      tracks = allMatches.filter(track =>
        ResonaUtils.normalise(track.title).includes(
          ResonaUtils.normalise(q)
        )
      );
    } else if (this.type === "artist") {
      tracks = allMatches.filter(track =>
        ResonaUtils.normalise(track.artist).includes(
          ResonaUtils.normalise(q)
        )
      );
    } else if (this.type === "album") {
      tracks = allMatches.filter(track =>
        ResonaUtils.normalise(track.album).includes(
          ResonaUtils.normalise(q)
        )
      );
    }

    results.innerHTML = tracks.length
      ? tracks.map(track => Resona.renderTrackRow(track)).join("")
      : `
        <div class="empty-state">
          <p>No catalogue results for "${ResonaUtils.escapeHTML(q)}".</p>
          <p class="tag" style="margin-top:6px">
            Search only returns tracks in the connected catalogue.
          </p>
        </div>
      `;
  }
};


/* =========================================================
   11. LIBRARY PAGE
   ========================================================= */

const ResonaLibraryPage = {
  render() {
    const page = ResonaUtils.element("page-library");

    if (!page) return;

    const existingFilters = ResonaUtils.element("libraryFilters");
    const existingList = ResonaUtils.element("libraryList");

    /*
      Preserve the current HTML structure when it exists.
    */

    if (!existingFilters || !existingList) {
      page.innerHTML = `
        <h1>Your Library</h1>

        <p class="tag" style="margin-top:6px">
          Your saved music and listening history.
        </p>

        <div class="chips" id="libraryFilters" style="margin:16px 0">
          <button class="chip on" data-library="liked" type="button">Liked songs</button>
          <button class="chip" data-library="recent" type="button">Recently played</button>
          <button class="chip" data-library="playlists" type="button">Playlists</button>
        </div>

        <div id="libraryList"></div>

        <button class="cta secondary full" id="createPlaylist" style="margin-top:18px" type="button">
          + Create playlist
        </button>
      `;
    }

    const filters = ResonaUtils.element("libraryFilters");
    const list = ResonaUtils.element("libraryList");

    if (!filters || !list) return;

    filters.querySelectorAll("[data-library]").forEach(button => {
      if (button.dataset.resonaBound) return;

      button.dataset.resonaBound = "true";

      button.addEventListener("click", () => {
        Resona.state.libraryTab = button.dataset.library;

        filters.querySelectorAll("[data-library]").forEach(item => {
          item.classList.toggle("on", item === button);
        });

        this.renderList();
      });
    });

    const createButton = ResonaUtils.element("createPlaylist");

    if (createButton && !createButton.dataset.resonaBound) {
      createButton.dataset.resonaBound = "true";

      createButton.addEventListener("click", () => {
        const name = prompt("Name your playlist:");

        if (name === null) return;

        const playlist = ResonaLibrary.addPlaylist(name);

        if (playlist) {
          Resona.state.libraryTab = "playlists";
          this.render();
          ResonaUtils.showMessage("Playlist created.", "success");
        }
      });
    }

    this.renderList();
  },

  renderList() {
    const list = ResonaUtils.element("libraryList");

    if (!list) return;

    const tab = Resona.state.libraryTab || "liked";

    if (tab === "liked") {
      const tracks = Resona.state.library.likedTracks
        .map(id => ResonaCatalogue.findTrack(id))
        .filter(Boolean);

      list.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.empty("Your liked songs will appear here.");
    } else if (tab === "recent") {
      const tracks = ResonaLibrary.getRecentlyPlayed();

      list.innerHTML = tracks.length
        ? tracks.map(track => Resona.renderTrackRow(track)).join("")
        : this.empty("Songs you play will appear here.");
    } else if (tab === "playlists") {
      const playlists = Resona.state.library.playlists;

      list.innerHTML = playlists.length
        ? playlists.map(playlist => `
            <div class="row">
              <div class="art" style="width:48px;height:48px">♫</div>

              <div class="m">
                <div class="tt">${ResonaUtils.escapeHTML(playlist.name)}</div>
                <div class="tag">${playlist.trackIds.length} tracks</div>
              </div>

              <button
                class="ic"
                type="button"
                data-delete-playlist="${ResonaUtils.escapeHTML(playlist.id)}"
                aria-label="Delete ${ResonaUtils.escapeHTML(playlist.name)}"
              >×</button>
            </div>
          `).join("")
        : this.empty("Create your first playlist.");

      list.querySelectorAll("[data-delete-playlist]").forEach(button => {
        button.addEventListener("click", () => {
          const id = button.dataset.deletePlaylist;

          Resona.state.library.playlists =
            Resona.state.library.playlists.filter(
              item => item.id !== id
            );

          ResonaLibrary.save();
          this.renderList();

          ResonaUtils.showMessage("Playlist deleted.", "success");
        });
      });
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
   12. RESET / MOOD DISCOVERY
   ========================================================= */

const ResonaReset = {
  render() {
    const page = ResonaUtils.element("page-reset");

    if (!page) return;

    let moods = ResonaUtils.element("moods");
    let button = ResonaUtils.element("resetButton");
    let message = ResonaUtils.element("resetMsg");

    if (!moods || !button || !message) {
      page.innerHTML = `
        <div class="tag">Find your sound</div>
        <h1>Reset your mood</h1>

        <p class="tag" style="margin:8px 0 18px">
          Choose the feeling you want your music to match.
        </p>

        <div class="mood-grid" id="moods">
          ${RESONA_MOODS.map(mood => `
            <button
              class="mood"
              type="button"
              data-mood="${mood.id}"
            >
              <span>${mood.symbol}</span>
              <span>${ResonaUtils.escapeHTML(mood.name)}</span>
            </button>
          `).join("")}
        </div>

        <button class="cta full" id="resetButton" style="margin-top:20px" type="button">
          Find my music
        </button>

        <div id="resetMsg" style="margin-top:18px"></div>
      `;

      moods = ResonaUtils.element("moods");
      button = ResonaUtils.element("resetButton");
      message = ResonaUtils.element("resetMsg");
    }

    if (!moods || !button || !message) return;

    moods.querySelectorAll("[data-mood]").forEach(item => {
      if (item.dataset.resonaBound) return;

      item.dataset.resonaBound = "true";

      item.addEventListener("click", () => {
        Resona.state.selectedMood = item.dataset.mood;

        moods.querySelectorAll("[data-mood]").forEach(other => {
          other.classList.toggle("on", other === item);
          other.setAttribute(
            "aria-pressed",
            other === item ? "true" : "false"
          );
        });

        message.textContent = "Selected: " +
          (RESONA_MOODS.find(
            mood => mood.id === item.dataset.mood
          )?.name || item.dataset.mood);
      });
    });

    if (!button.dataset.resonaBound) {
      button.dataset.resonaBound = "true";

      button.addEventListener("click", () => {
        this.findMusic();
      });
    }

    if (Resona.state.selectedMood) {
      moods.querySelectorAll("[data-mood]").forEach(item => {
        const selected = item.dataset.mood === Resona.state.selectedMood;

        item.classList.toggle("on", selected);
        item.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    }
  },

  findMusic() {
    const mood = Resona.state.selectedMood;
    const message = ResonaUtils.element("resetMsg");

    if (!mood) {
      ResonaUtils.showMessage("Choose a mood first.");
      return;
    }

    const tracks = ResonaCatalogue.byMood(mood);

    if (!message) return;

    if (!tracks.length) {
      message.innerHTML = `
        <div class="empty-state">
          <div class="symbol">♫</div>
          <p>No matching tracks are available for this mood yet.</p>
          <p class="tag" style="margin-top:6px">
            Recommendations require actual catalogue mood or genre metadata.
          </p>
        </div>
      `;

      return;
    }

    message.innerHTML = `
      <h2>${ResonaUtils.escapeHTML(mood)} music</h2>
      ${tracks.map(track => Resona.renderTrackRow(track)).join("")}
    `;
  }
};


/* =========================================================
   13. ARTIST STUDIO
   ========================================================= */

const ResonaArtist = {
  render() {
    const page = ResonaUtils.element("page-artist");

    if (!page) return;

    page.innerHTML = `
      <div class="tag">For independent musicians</div>
      <h1 style="margin-top:4px">Artist Studio</h1>

      <p class="tag" style="margin-top:10px">
        A home for your music, releases and artist identity.
      </p>

      <div class="panel" style="margin-top:20px">
        <h3>Publish your music</h3>

        <p class="tag" style="margin:8px 0 16px">
          Artist registration, authorised audio uploads and release
          management require a connected Resona backend.
        </p>

        <button class="cta full" id="artistStart" type="button">
          Get started
        </button>
      </div>

      <div class="panel" style="margin-top:14px">
        <h3>Artist tools</h3>

        <div class="divider"></div>

        <p>Create an artist profile</p>
        <p style="margin-top:10px">Upload authorised audio and artwork</p>
        <p style="margin-top:10px">Add release details and credits</p>
        <p style="margin-top:10px">Declare music rights and ownership</p>
        <p style="margin-top:10px">Manage releases and statistics</p>
      </div>
    `;

    page.querySelector("#artistStart")?.addEventListener("click", () => {
      ResonaUtils.showMessage(
        "Artist registration is not connected yet. Secure accounts and the publishing API must be implemented first."
      );
    });
  }
};


/* =========================================================
   14. NAVIGATION
   ========================================================= */

const ResonaNavigation = {
  pages: [
    "home",
    "explore",
    "search",
    "library",
    "reset",
    "artist"
  ],

  show(name) {
    const pageName = String(name || "").toLowerCase();

    if (!this.pages.includes(pageName)) {
      ResonaUtils.showMessage("That page is not available.");
      return;
    }

    const page = ResonaUtils.element("page-" + pageName);

    if (!page) {
      ResonaUtils.showMessage(
        "The " + pageName + " page is not present in index.html yet."
      );

      return;
    }

    document.querySelectorAll(".page").forEach(item => {
      item.classList.toggle("active", item === page);
    });

    document.querySelectorAll("nav button").forEach(button => {
      const matches =
        button.dataset.page === pageName ||
        button.getAttribute("onclick")?.includes(
          "'" + pageName + "'"
        );

      button.classList.toggle("on", Boolean(matches));
    });

    Resona.state.currentPage = pageName;

    ResonaUtils.saveJSON("lastPage", pageName);

    const main = ResonaUtils.element("main");

    if (main) {
      main.scrollTop = 0;
    }

    Resona.renderCurrentPage();
  }
};


/* =========================================================
   15. AUDIO PLAYER
   ========================================================= */

const ResonaPlayer = {
  async play(trackOrId, queue = null) {
    const track = typeof trackOrId === "object"
      ? ResonaCatalogue.findTrack(trackOrId.id) || trackOrId
      : ResonaCatalogue.findTrack(trackOrId);

    if (!track) {
      ResonaUtils.showMessage("Track not found.", "error");
      return false;
    }

    if (!Resona.config.enableAudioPlayback) {
      ResonaUtils.showMessage(
        "Audio playback is currently disabled."
      );

      return false;
    }

    if (
      !track.audioUrl ||
      track.rightsConfirmed !== true ||
      track.streamAllowed !== true
    ) {
      ResonaUtils.showMessage(
        "This track does not have a verified, authorised streaming source.",
        "error"
      );

      return false;
    }

    if (queue) {
      Resona.state.queue = queue
        .map(item => ResonaCatalogue.findTrack(item.id))
        .filter(Boolean);

      Resona.state.queueIndex = Resona.state.queue.findIndex(
        item => item.id === track.id
      );
    } else if (
      !Resona.state.queue.length ||
      !Resona.state.queue.some(item => item.id === track.id)
    ) {
      Resona.state.queue = [track];
      Resona.state.queueIndex = 0;
    } else {
      Resona.state.queueIndex = Resona.state.queue.findIndex(
        item => item.id === track.id
      );
    }

    this.stopAudio();

    try {
      const audio = new Audio();

      audio.preload = "metadata";
      audio.src = track.audioUrl;

      audio.addEventListener("loadedmetadata", () => {
        if (Resona.state.currentAudio !== audio) return;

        Resona.state.audioDuration =
          Number.isFinite(audio.duration)
            ? audio.duration
            : track.duration;

        this.updateProgress();
        this.updateTime();
      });

      audio.addEventListener("timeupdate", () => {
        if (Resona.state.currentAudio !== audio) return;

        Resona.state.audioProgress = audio.currentTime;

        if (Number.isFinite(audio.duration)) {
          Resona.state.audioDuration = audio.duration;
        }

        this.updateProgress();
        this.updateTime();
      });

      audio.addEventListener("play", () => {
        if (Resona.state.currentAudio !== audio) return;

        Resona.state.isPlaying = true;
        this.updateButtons();
      });

      audio.addEventListener("pause", () => {
        if (Resona.state.currentAudio !== audio) return;

        Resona.state.isPlaying = false;
        this.updateButtons();
      });

      audio.addEventListener("ended", () => {
        if (Resona.state.currentAudio !== audio) return;

        if (Resona.state.repeatMode === "one") {
          audio.currentTime = 0;

          audio.play().catch(() => {
            ResonaUtils.showMessage(
              "Could not restart this track.",
              "error"
            );
          });

          return;
        }

        this.next();
      });

      audio.addEventListener("error", () => {
        if (Resona.state.currentAudio !== audio) return;

        Resona.state.isPlaying = false;
        this.updateButtons();

        ResonaUtils.showMessage(
          "The audio source could not be played. Check its URL, permissions and server configuration.",
          "error"
        );
      });

      Resona.state.currentAudio = audio;
      Resona.state.currentTrack = track;
      Resona.state.audioProgress = 0;
      Resona.state.audioDuration = track.duration || 0;

      this.updateInterface();
      this.updateButtons();

      await audio.play();

      Resona.state.isPlaying = true;

      ResonaLibrary.recordRecentlyPlayed(track.id);

      this.updateButtons();

      return true;
    } catch (error) {
      console.error("Resona playback failed:", error);

      Resona.state.isPlaying = false;
      this.updateButtons();

      ResonaUtils.showMessage(
        "Playback could not start. The audio source may be unavailable or blocked.",
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
    Resona.state.audioProgress = 0;
    Resona.state.audioDuration = 0;
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
        ResonaUtils.showMessage(
          "Unable to resume playback.",
          "error"
        );
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
      const possible = queue
        .map((_, i) => i)
        .filter(i => i !== index);

      index = possible[
        Math.floor(Math.random() * possible.length)
      ];
    } else {
      index++;
    }

    if (index >= queue.length) {
      if (Resona.state.repeatMode === "all") {
        index = 0;
      } else {
        this.stopAudio();
        this.updateButtons();
        this.updateProgress();
        this.updateTime();
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

    let index = Resona.state.queueIndex - 1;

    if (index < 0) {
      if (Resona.state.repeatMode === "all") {
        index = queue.length - 1;
      } else {
        index = 0;
      }
    }

    Resona.state.queueIndex = index;

    await this.play(queue[index], queue);
  },

  seek(value) {
    const audio = Resona.state.currentAudio;

    if (!audio || !Number.isFinite(audio.duration)) {
      return;
    }

    const percentage = Math.max(
      0,
      Math.min(100, Number(value) || 0)
    );

    audio.currentTime = audio.duration * percentage / 100;
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

      art.replaceChildren();

      if (track.artwork) {
        const image = document.createElement("img");

        image.src = track.artwork;
        image.alt = "";
        image.loading = "lazy";

        Object.assign(image.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "inherit"
        });

        art.appendChild(image);
      } else {
        art.textContent = "♫";
      }
    }

    const mini = ResonaUtils.element("mini");

    if (mini) {
      mini.style.display = "flex";
    }

    const background = ResonaUtils.element("npbg");

    if (background) {
      background.replaceChildren();

      if (track.artwork) {
        const image = document.createElement("img");

        image.src = track.artwork;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");

        Object.assign(image.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: ".22",
          filter: "blur(35px)",
          transform: "scale(1.15)",
          pointerEvents: "none"
        });

        background.appendChild(image);
      }
    }

    const likeButton = ResonaUtils.element("npLike");

    if (likeButton) {
      likeButton.textContent = ResonaLibrary.isLiked(track.id)
        ? "♥"
        : "♡";

      likeButton.setAttribute(
        "aria-pressed",
        ResonaLibrary.isLiked(track.id) ? "true" : "false"
      );
    }

    this.updateProgress();
    this.updateTime();
  },

  updateButtons() {
    const symbol = Resona.state.isPlaying ? "⏸" : "▶";

    ResonaUtils.setText("miniPlay", symbol);

    /*
      The existing HTML may not have #npPlay.
      Support either ID without requiring it.
    */

    ResonaUtils.setText("npPlay", symbol);

    const miniButton = ResonaUtils.element("miniPlay");
    const npButton = ResonaUtils.element("npPlay");

    if (miniButton) {
      miniButton.setAttribute(
        "aria-label",
        Resona.state.isPlaying ? "Pause" : "Play"
      );
    }

    if (npButton) {
      npButton.setAttribute(
        "aria-label",
        Resona.state.isPlaying ? "Pause" : "Play"
      );
    }

    const mini = ResonaUtils.element("mini");

    if (mini) {
      mini.classList.toggle("playing", Resona.state.isPlaying);
    }

    const disc = ResonaUtils.element("npDisc");

    if (disc) {
      disc.classList.toggle("playing", Resona.state.isPlaying);
    }
  },

  updateProgress() {
    const current = Resona.state.audioProgress;
    const duration = Resona.state.audioDuration;

    const percentage = duration > 0
      ? Math.max(0, Math.min(100, current / duration * 100))
      : 0;

    const miniProgress = ResonaUtils.element("miniProgress");
    const npProgress = ResonaUtils.element("npProgress");
    const seekBar = ResonaUtils.element("seekBar");

    if (miniProgress) {
      miniProgress.style.width = percentage + "%";
    }

    if (npProgress) {
      npProgress.style.width = percentage + "%";
    }

    if (seekBar) {
      if (seekBar.type === "range") {
        seekBar.value = String(percentage);
      }

      seekBar.setAttribute(
        "aria-valuenow",
        String(Math.round(percentage))
      );
    }
  },

  updateTime() {
    ResonaUtils.setText(
      "currentTime",
      ResonaUtils.formatTime(Resona.state.audioProgress)
    );

    ResonaUtils.setText(
      "duration",
      ResonaUtils.formatTime(Resona.state.audioDuration)
    );
  }
};


/* =========================================================
   16. NOW PLAYING CONTROLS
   ========================================================= */

function openNowPlaying() {
  const panel = ResonaUtils.element("np");

  if (!panel) return;

  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";

  const closeButton = panel.querySelector(
    '[onclick="closeNowPlaying()"]'
  );

  closeButton?.focus();
}

function closeNowPlaying() {
  const panel = ResonaUtils.element("np");

  if (!panel) return;

  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

function playSong(id) {
  const track = ResonaCatalogue.findTrack(id);

  if (!track) {
    ResonaUtils.showMessage(
      "No available track exists at this position."
    );

    return;
  }

  ResonaPlayer.play(track, Resona.state.catalogue.tracks);
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

function toggleLikeCurrent() {
  const track = Resona.state.currentTrack;

  if (!track) {
    ResonaUtils.showMessage("Choose a track first.");
    return;
  }

  const liked = ResonaLibrary.toggleLike(track.id);

  const button = ResonaUtils.element("npLike");

  if (button) {
    button.textContent = liked ? "♥" : "♡";
    button.setAttribute("aria-pressed", liked ? "true" : "false");
  }

  ResonaUtils.showMessage(
    liked ? "Added to liked songs." : "Removed from liked songs.",
    "success"
  );
}


/* =========================================================
   17. SHUFFLE AND REPEAT
   ========================================================= */

function toggleShuffle() {
  Resona.state.isShuffle = !Resona.state.isShuffle;

  const button = ResonaUtils.element("shuffleButton");

  if (button) {
    button.classList.toggle("on", Resona.state.isShuffle);
    button.setAttribute(
      "aria-pressed",
      Resona.state.isShuffle ? "true" : "false"
    );
  }

  ResonaUtils.showMessage(
    Resona.state.isShuffle ? "Shuffle enabled." : "Shuffle disabled."
  );
}

function cycleRepeat() {
  const modes = ["off", "all", "one"];

  const current = modes.indexOf(Resona.state.repeatMode);

  Resona.state.repeatMode = modes[(current + 1) % modes.length];

  const button = ResonaUtils.element("repeatButton");

  if (button) {
    button.classList.toggle(
      "on",
      Resona.state.repeatMode !== "off"
    );

    button.textContent =
      Resona.state.repeatMode === "one"
        ? "↻¹"
        : "↻";

    button.setAttribute(
      "aria-label",
      "Repeat " + Resona.state.repeatMode
    );

    button.setAttribute(
      "aria-pressed",
      Resona.state.repeatMode !== "off" ? "true" : "false"
    );
  }

  const labels = {
    off: "Repeat off.",
    all: "Repeat all enabled.",
    one: "Repeat current track enabled."
  };

  ResonaUtils.showMessage(labels[Resona.state.repeatMode]);
}


/* =========================================================
   18. EVENT DELEGATION
   ========================================================= */

document.addEventListener("click", event => {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const playButton = target.closest("[data-play-track]");

  if (playButton) {
    event.preventDefault();

    const trackId = playButton.dataset.playTrack;

    ResonaPlayer.play(
      trackId,
      Resona.state.catalogue.tracks
    );

    return;
  }

  const likeButton = target.closest("[data-like-track]");

  if (likeButton) {
    event.preventDefault();
    event.stopPropagation();

    const id = likeButton.dataset.likeTrack;

    const liked = ResonaLibrary.toggleLike(id);

    ResonaUtils.showMessage(
      liked ? "Added to liked songs." : "Removed from liked songs.",
      "success"
    );
  }
});


/* =========================================================
   19. BACKEND API
   ========================================================= */

const ResonaAPI = {
  async request(path, options = {}) {
    if (!Resona.config.apiBase) {
      throw new Error("Resona API has not been configured.");
    }

    const base = Resona.config.apiBase.replace(/\/+$/, "");

    const endpoint =
      base + "/" + String(path).replace(/^\/+/, "");

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      Resona.config.requestTimeout
    );

    try {
      const response = await fetch(endpoint, {
        ...options,

        signal: options.signal || controller.signal,

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

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  },

  extractTracks(result) {
    if (Array.isArray(result)) {
      return result;
    }

    if (!result || typeof result !== "object") {
      return null;
    }

    const candidates = [
      result.tracks,
      result.items,
      result.results,
      result.data
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }

      if (candidate && typeof candidate === "object") {
        if (Array.isArray(candidate.tracks)) {
          return candidate.tracks;
        }

        if (Array.isArray(candidate.items)) {
          return candidate.items;
        }
      }
    }

    return null;
  },

  async loadCatalogue() {
    if (!Resona.config.apiBase) {
      return [];
    }

    Resona.state.isLoadingCatalogue = true;
    Resona.state.catalogueError = null;

    Resona.renderCurrentPage();

    try {
      const result = await this.request("/tracks");
      const tracks = this.extractTracks(result);

      if (!Array.isArray(tracks)) {
        throw new Error(
          "The API response does not contain a valid tracks array."
        );
      }

      ResonaCatalogue.setTracks(tracks);

      Resona.state.catalogueError = null;

      return Resona.state.catalogue.tracks;
    } catch (error) {
      Resona.state.catalogueError = error;

      throw error;
    } finally {
      Resona.state.isLoadingCatalogue = false;

      Resona.renderCurrentPage();
    }
  }
};


/* =========================================================
   20. COMPATIBILITY FUNCTIONS
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
  const input = ResonaUtils.element("searchInput");

  if (input && query !== undefined) {
    input.value = String(query);
  }

  Resona.state.searchQuery = String(
    query ?? input?.value ?? ""
  );

  ResonaSearch.run(Resona.state.searchQuery);
}

function openReset() {
  ResonaNavigation.show("reset");
}

function doReset() {
  ResonaReset.findMusic();
}


/* =========================================================
   21. RENDER CURRENT PAGE
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

    case "reset":
      ResonaReset.render();
      break;

    case "artist":
      ResonaArtist.render();
      break;

    default:
      ResonaHome.render();
  }
};


/* =========================================================
   22. CONNECT EXISTING PLAYER CONTROLS
   ========================================================= */

function bindPlayerControls() {
  const mini = ResonaUtils.element("mini");

  const miniOpen = mini?.querySelector(".mini-open");

  if (miniOpen && !miniOpen.dataset.resonaBound) {
    miniOpen.dataset.resonaBound = "true";

    miniOpen.addEventListener("click", event => {
      if (event.target.closest("button.ic")) return;

      openNowPlaying();
    });
  }

  const miniPlay = ResonaUtils.element("miniPlay");

  if (miniPlay && !miniPlay.dataset.resonaBound) {
    miniPlay.dataset.resonaBound = "true";

    miniPlay.addEventListener("click", event => {
      event.stopPropagation();
      togglePlay();
    });
  }

  const miniLike = ResonaUtils.element("miniLike");

  if (miniLike && !miniLike.dataset.resonaBound) {
    miniLike.dataset.resonaBound = "true";

    miniLike.addEventListener("click", event => {
      event.stopPropagation();

      if (Resona.state.currentTrack) {
        const liked = ResonaLibrary.toggleLike(
          Resona.state.currentTrack.id
        );

        miniLike.textContent = liked ? "♥" : "♡";
      }
    });
  }

  const npLike = ResonaUtils.element("npLike");

  if (npLike && !npLike.dataset.resonaBound) {
    npLike.dataset.resonaBound = "true";

    npLike.addEventListener("click", toggleLikeCurrent);
  }

  const seekBar = ResonaUtils.element("seekBar");

  if (seekBar && !seekBar.dataset.resonaBound) {
    seekBar.dataset.resonaBound = "true";

    if (seekBar.type === "range") {
      seekBar.addEventListener("input", () => {
        ResonaPlayer.seek(seekBar.value);
      });
    } else {
      seekBar.addEventListener("click", event => {
        const rect = seekBar.getBoundingClientRect();

        if (!rect.width) return;

        const percentage =
          ((event.clientX - rect.left) / rect.width) * 100;

        ResonaPlayer.seek(percentage);
      });
    }
  }

  /*
    These controls are optional. They can be added to index.html
    later without breaking this application core.
  */

  ResonaUtils.element("shuffleButton")?.addEventListener(
    "click",
    toggleShuffle
  );

  ResonaUtils.element("repeatButton")?.addEventListener(
    "click",
    cycleRepeat
  );
}


/* =========================================================
   23. KEYBOARD AND ACCESSIBILITY
   ========================================================= */

function bindAccessibility() {
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const panel = ResonaUtils.element("np");

      if (panel?.classList.contains("open")) {
        closeNowPlaying();
      }
    }
  });

  const panel = ResonaUtils.element("np");

  if (panel) {
    panel.setAttribute("aria-hidden", "true");
  }
}


/* =========================================================
   24. INITIALISATION
   ========================================================= */

async function initResona() {
  ResonaLibrary.init();

  const main = ResonaUtils.element("main");

  if (!main) {
    console.error(
      "Resona could not start: #main was not found in index.html."
    );

    return;
  }

  bindPlayerControls();
  bindAccessibility();

  const savedPage = ResonaUtils.loadJSON("lastPage", "home");

  const initialPage =
    ResonaNavigation.pages.includes(savedPage) &&
    ResonaUtils.element("page-" + savedPage)
      ? savedPage
      : "home";

  Resona.state.currentPage = initialPage;

  Resona.renderCurrentPage();

  ResonaNavigation.show(initialPage);

  /*
    Hide Now Playing until the user opens it.
  */

  const panel = ResonaUtils.element("np");

  if (panel) {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  /*
    Load real catalogue data only when an API URL is configured.
  */

  if (Resona.config.apiBase) {
    try {
      await ResonaAPI.loadCatalogue();
    } catch (error) {
      console.error("Resona catalogue loading failed:", error);

      ResonaUtils.showMessage(
        "Could not load the music catalogue. Check the API configuration.",
        "error"
      );
    }
  }

  console.info(
    "Resona initialised.",
    {
      version: Resona.version,
      apiConfigured: Boolean(Resona.config.apiBase),
      trackCount: Resona.state.catalogue.tracks.length
    }
  );
}


/* =========================================================
   25. PUBLIC INTERFACE
   ========================================================= */

window.Resona = Resona;
window.ResonaAPI = ResonaAPI;
window.ResonaCatalogue = ResonaCatalogue;
window.ResonaExplore = ResonaExplore;
window.ResonaLibrary = ResonaLibrary;
window.ResonaLibraryPage = ResonaLibraryPage;
window.ResonaNavigation = ResonaNavigation;
window.ResonaPlayer = ResonaPlayer;
window.ResonaUtils = ResonaUtils;

window.showPage = showPage;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.nextSong = nextSong;
window.prevSong = prevSong;

window.openNowPlaying = openNowPlaying;
window.closeNowPlaying = closeNowPlaying;
window.toggleLikeCurrent = toggleLikeCurrent;

window.toggleShuffle = toggleShuffle;
window.cycleRepeat = cycleRepeat;

window.doSearch = doSearch;
window.openReset = openReset;
window.doReset = doReset;


/* =========================================================
   26. START
   ========================================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initResona,
    { once: true }
  );
} else {
  initResona();
                              }
