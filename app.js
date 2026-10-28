/* =========================================================
   RESONA — APPLICATION CORE
   Global music discovery and streaming frontend
   Complete replacement app.js
   ========================================================= */

"use strict";

/* =========================================================
   1. CONFIGURATION
   ========================================================= */

const ResonaConfig = {
    apiBase: "",
    enableDemoData: false,
    enableAudioPlayback: true,
    storagePrefix: "resona_",
    maxHistory: 100,
    maxQueue: 500
};


/* =========================================================
   2. APPLICATION STATE
   ========================================================= */

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


/* =========================================================
   3. GLOBAL DISCOVERY DATA
   ========================================================= */

const RESONA_CONTINENTS = [
    {
        id: "africa",
        name: "Africa",
        description: "Discover sounds from across Africa",
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
        description: "Explore music across Europe",
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
        description: "Discover music from across Asia",
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
        description: "Explore sounds from North America",
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
        description: "Discover music from South America",
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
        description: "Explore music from Oceania",
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


/* =========================================================
   4. UTILITIES
   ========================================================= */

const ResonaUtils = {
    $(selector, root = document) {
        return root.querySelector(selector);
    },

    $$(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
    },

    escape(value) {
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

            return url.protocol === "https:" ||
                url.protocol === "http:";
        } catch {
            return false;
        }
    },

    safeImage(value) {
        if (!value) return "";

        const image = String(value).trim();

        if (image.startsWith("/") && !image.startsWith("//")) {
            return image;
        }

        return this.isValidHttpUrl(image) ? image : "";
    },

    safeAudioUrl(value) {
        if (!value) return "";

        const url = String(value).trim();

        return this.isValidHttpUrl(url) ? url : "";
    },

    debounce(callback, delay = 250) {
        let timeout;

        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => callback(...args), delay);
        };
    }
};


/* =========================================================
   5. TOAST NOTIFICATIONS
   ========================================================= */

const ResonaToast = {
    timeout: null,

    show(message, duration = 2800) {
        let element = ResonaUtils.$("#toast");

        if (!element) {
            element = document.createElement("div");
            element.id = "toast";
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


/* =========================================================
   6. CATALOGUE
   ========================================================= */

const ResonaCatalogue = {
    normalizeTrack(input) {
        if (!input || typeof input !== "object") return null;

        const id = String(input.id ?? input.track_id ?? "").trim();
        const title = String(input.title ?? input.name ?? "").trim();
        const artist = String(
            input.artist ?? input.artist_name ?? ""
        ).trim();

        if (!id || !title || !artist) return null;

        const duration = Number(
            input.duration ?? input.duration_seconds ?? 0
        );

        const mood = Array.isArray(input.mood)
            ? input.mood.map(String)
            : typeof input.mood === "string"
                ? input.mood.split(",")
                    .map(item => item.trim())
                    .filter(Boolean)
                : [];

        return {
            id,
            title,
            artist,
            artistId: String(input.artistId ?? input.artist_id ?? ""),
            album: String(input.album ?? input.album_title ?? ""),
            albumId: String(input.albumId ?? input.album_id ?? ""),
            artwork: ResonaUtils.safeImage(
                input.artwork ??
                input.cover_url ??
                input.artwork_url ??
                ""
            ),
            audioUrl: ResonaUtils.safeAudioUrl(
                input.audioUrl ??
                input.audio_url ??
                input.stream_url ??
                ""
            ),
            duration: Number.isFinite(duration) && duration > 0
                ? duration
                : 0,
            country: String(input.country ?? "").trim(),
            continent: String(input.continent ?? "").trim().toLowerCase(),
            genre: String(input.genre ?? "").trim(),
            mood,
            releaseDate: String(
                input.releaseDate ?? input.release_date ?? ""
            ),
            rightsConfirmed:
                input.rightsConfirmed === true ||
                input.rights_confirmed === true,
            explicit: input.explicit === true,
            featured: input.featured === true,
            verifiedArtist:
                input.verifiedArtist === true ||
                input.verified_artist === true,
            plays: Math.max(0, Number(input.plays) || 0),
            createdAt: String(input.createdAt ?? input.created_at ?? "")
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

    getTrackIndex(id) {
        return ResonaState.tracks.findIndex(
            track => String(track.id) === String(id)
        );
    },

    search(query) {
        const term = String(query ?? "").trim().toLowerCase();

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
        return ResonaState.tracks.filter(track =>
            track.continent === String(continent).toLowerCase()
        );
    },

    byCountry(country) {
        return ResonaState.tracks.filter(track =>
            track.country.toLowerCase() ===
            String(country).toLowerCase()
        );
    },

    byMood(mood) {
        return ResonaState.tracks.filter(track =>
            track.mood.some(item =>
                item.toLowerCase() === String(mood).toLowerCase()
            )
        );
    }
};


/* =========================================================
   7. PERSONAL LIBRARY
   ========================================================= */

const ResonaLibrary = {
    load() {
        const liked = ResonaUtils.readStorage("liked_tracks", []);
        const history = ResonaUtils.readStorage("history", []);

        ResonaState.likedTracks = Array.isArray(liked) ? liked : [];
        ResonaState.listeningHistory = Array.isArray(history) ? history : [];
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


/* =========================================================
   8. PAGE NAVIGATION
   Supports data-page buttons AND legacy showPage handlers.
   ========================================================= */

const ResonaNavigation = {
    pages: [
        "home",
        "explore",
        "search",
        "library",
        "artist",
        "reset"
    ],

    ensurePage(id, title) {
        let page = ResonaUtils.$("#page-" + id);

        if (page) return page;

        const main = ResonaUtils.$("#main");

        if (!main) return null;

        page = document.createElement("section");
        page.id = "page-" + id;
        page.className = "page";
        page.setAttribute("aria-label", title);

        page.innerHTML = `
            <div class="page-heading">
                <h1>${ResonaUtils.escape(title)}</h1>
            </div>
            <div id="${id}Content"></div>
        `;

        main.appendChild(page);

        return page;
    },

    ensurePages() {
        this.ensurePage("home", "Home");
        this.ensurePage("explore", "Explore");
        this.ensurePage("search", "Search");
        this.ensurePage("library", "Your Library");
        this.ensurePage("artist", "Artist Studio");
        this.ensurePage("reset", "Reset your mood");
    },

    show(pageName, button = null) {
        const target = String(pageName || "home");

        if (!this.pages.includes(target)) {
            ResonaToast.show("That page is not available.");
            return false;
        }

        const pageElement = ResonaUtils.$("#page-" + target);

        if (!pageElement) {
            console.error("Resona page missing:", "#page-" + target);
            ResonaToast.show("The requested page could not be opened.");
            return false;
        }

        ResonaUtils.$$(".page").forEach(page => {
            page.classList.remove("active");
            page.setAttribute("aria-hidden", "true");
        });

        pageElement.classList.add("active");
        pageElement.setAttribute("aria-hidden", "false");

        ResonaState.currentPage = target;

        ResonaUtils.writeStorage("last_page", target);

        /*
         * FIX:
         * The replacement HTML uses data-page, not only onclick.
         * Match both patterns for compatibility.
         */
        ResonaUtils.$$("nav button, [data-page]").forEach(navButton => {
            const buttonPage =
                navButton.dataset.page ||
                navButton.getAttribute("data-page");

            navButton.classList.remove("active", "on");
            navButton.removeAttribute("aria-current");

            if (buttonPage === target) {
                navButton.classList.add("active", "on");
                navButton.setAttribute("aria-current", "page");
            }
        });

        if (button && button instanceof Element) {
            button.classList.add("active", "on");
            button.setAttribute("aria-current", "page");
        }

        this.renderPage(target);

        const main = ResonaUtils.$("#main");

        if (main) main.scrollTop = 0;

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

            case "artist":
                ResonaArtistStudio.render();
                break;

            case "reset":
                ResonaReset.render();
                break;
        }
    }
};


/* =========================================================
   9. TRACK UI
   ========================================================= */

const ResonaTrackUI = {
    artwork(track, size = "") {
        const image = ResonaUtils.safeImage(track.artwork);
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
                    <span class="tt">${ResonaUtils.escape(track.title)}</span>
                    <span class="tag">
                        ${ResonaUtils.escape(track.artist)}
                        ${track.album
                            ? " · " + ResonaUtils.escape(track.album)
                            : ""}
                    </span>
                </button>

                <button
                    type="button"
                    class="icon-button"
                    data-action="like"
                    data-track-id="${ResonaUtils.escape(track.id)}"
                    aria-label="${liked ? "Unlike" : "Like"} ${ResonaUtils.escape(track.title)}"
                    aria-pressed="${liked}"
                >${liked ? "♥" : "♡"}</button>

                <button
                    type="button"
                    class="icon-button"
                    data-action="play"
                    data-track-id="${ResonaUtils.escape(track.id)}"
                    aria-label="Play track"
                >▶</button>
            </article>
        `;
    },

    card(track) {
        const liked = ResonaLibrary.isLiked(track.id);

        return `
            <article class="card resona-track-card">
                <button
                    type="button"
                    class="resona-card-play"
                    data-action="play"
                    data-track-id="${ResonaUtils.escape(track.id)}"
                    aria-label="Play ${ResonaUtils.escape(track.title)}"
                >
                    ${this.artwork(track)}
                </button>

                <div class="card-info">
                    <div class="tt">${ResonaUtils.escape(track.title)}</div>
                    <div class="tag">${ResonaUtils.escape(track.artist)}</div>

                    ${track.country
                        ? `<div class="tag">${ResonaUtils.escape(track.country)}</div>`
                        : ""}

                    <div class="resona-card-actions">
                        <button
                            type="button"
                            class="icon-button"
                            data-action="play"
                            data-track-id="${ResonaUtils.escape(track.id)}"
                            aria-label="Play track"
                        >▶</button>

                        <button
                            type="button"
                            class="icon-button"
                            data-action="like"
                            data-track-id="${ResonaUtils.escape(track.id)}"
                            aria-pressed="${liked}"
                            aria-label="${liked ? "Unlike" : "Like"} track"
                        >${liked ? "♥" : "♡"}</button>
                    </div>
                </div>
            </article>
        `;
    },

    empty(message, description = "") {
        return `
            <div class="empty-state">
                <div class="empty-icon">♫</div>
                <h3>${ResonaUtils.escape(message)}</h3>
                ${description
                    ? `<p>${ResonaUtils.escape(description)}</p>`
                    : ""}
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

                ${displayTracks.length
                    ? `<div class="resona-track-list">
                        ${displayTracks.map(track => this.row(track)).join("")}
                    </div>`
                    : this.empty(
                        options.emptyTitle || "Nothing here yet",
                        options.emptyDescription || ""
                    )}
            </section>
        `;
    }
};


/* =========================================================
   10. HOME
   ========================================================= */

const ResonaHome = {
    render() {
        const page = ResonaUtils.$("#page-home");
        if (!page) return;

        const recent = ResonaLibrary.getHistory().map(item => item.track);
        const seen = new Set();

        const uniqueRecent = recent.filter(track => {
            if (seen.has(track.id)) return false;
            seen.add(track.id);
            return true;
        });

        const featured = ResonaState.tracks.filter(track => track.featured);
        const recommendations = featured.length
            ? featured
            : ResonaState.tracks;

        page.innerHTML = `
            <header class="home-header">
                <div>
                    <p class="eyebrow">YOUR GLOBAL MUSIC SPACE</p>
                    <h1 id="greeting">Discover Your Sound</h1>
                    <p class="muted">Music and artists from around the world.</p>
                </div>

                <button
                    type="button"
                    class="icon-button"
                    data-page="search"
                    aria-label="Search music"
                >⌕</button>
            </header>

            <section class="hero">
                <div class="hero-content">
                    <p class="eyebrow">A WORLD OF MUSIC</p>
                    <h2>One world.<br>Countless sounds.</h2>
                    <p>Find new artists, explore cultures, and discover music beyond borders.</p>

                    <button type="button" class="cta" data-page="explore">
                        Explore music
                    </button>
                </div>
            </section>

            <section class="resona-section">
                <div class="section-heading">
                    <h2>Explore the world</h2>
                    <button type="button" class="text-button" data-page="explore">
                        View all
                    </button>
                </div>

                <div class="resona-horizontal">
                    ${RESONA_CONTINENTS.map(continent => `
                        <button
                            type="button"
                            class="continent-card"
                            data-action="continent"
                            data-continent="${continent.id}"
                        >
                            <span class="continent-emoji">${continent.emoji}</span>
                            <span class="continent-name">${ResonaUtils.escape(continent.name)}</span>
                        </button>
                    `).join("")}
                </div>
            </section>

            ${ResonaTrackUI.section("Recently played", uniqueRecent, {
                emptyTitle: "Your listening journey starts here",
                emptyDescription: "Play music to build your listening history."
            })}

            ${ResonaTrackUI.section("Discover music", recommendations, {
                emptyTitle: "Your next favourite starts here",
                emptyDescription: "Real tracks will appear when the catalogue is connected."
            })}

            <section class="resona-section">
                <div class="section-heading"><h2>Find your mood</h2></div>

                <div class="mood-grid">
                    ${RESONA_MOODS.map(mood => `
                        <button
                            type="button"
                            class="mood-card"
                            data-action="mood"
                            data-mood="${mood.id}"
                        >
                            <span>${mood.emoji}</span>
                            <strong>${ResonaUtils.escape(mood.label)}</strong>
                            <small>${ResonaUtils.escape(mood.description)}</small>
                        </button>
                    `).join("")}
                </div>
            </section>
        `;
    }
};


/* =========================================================
   11. EXPLORE
   ========================================================= */

const ResonaExplore = {
    render() {
        const page = ResonaUtils.$("#page-explore");
        if (!page) return;

        const selectedContinent = RESONA_CONTINENTS.find(
            item => item.id === ResonaState.selectedContinent
        );

        let content = `
            <header class="page-heading">
                <p class="eyebrow">DISCOVER BEYOND BORDERS</p>
                <h1>Explore</h1>
                <p class="muted">Discover music, artists, and cultures worldwide.</p>
            </header>
        `;

        if (ResonaState.selectedCountry && selectedContinent) {
            content += this.renderCountry(
                selectedContinent,
                ResonaState.selectedCountry
            );
        } else if (selectedContinent) {
            content += this.renderContinent(selectedContinent);
        } else {
            content += this.renderContinents();
        }

        page.innerHTML = content;
    },

    renderContinents() {
        return `
            <section class="resona-section">
                <div class="continent-grid">
                    ${RESONA_CONTINENTS.map(continent => `
                        <button
                            type="button"
                            class="continent-card"
                            data-action="continent"
                            data-continent="${continent.id}"
                        >
                            <span class="continent-emoji">${continent.emoji}</span>
                            <strong>${ResonaUtils.escape(continent.name)}</strong>
                            <span class="tag">${ResonaUtils.escape(continent.description)}</span>
                            <span class="tag">${ResonaCatalogue.byContinent(continent.id).length} available tracks</span>
                        </button>
                    `).join("")}
                </div>
            </section>

            ${ResonaTrackUI.section(
                "Music from around the world",
                ResonaState.tracks,
                {
                    limit: 20,
                    emptyTitle: "The world is waiting to be heard",
                    emptyDescription: "Connect the catalogue API to discover real tracks from artists worldwide."
                }
            )}
        `;
    },

    renderContinent(continent) {
        const tracks = ResonaCatalogue.byContinent(continent.id);

        return `
            <button type="button" class="text-button" data-action="clear-explore-selection">
                ← All continents
            </button>

            <section class="resona-section">
                <h2>${continent.emoji} ${ResonaUtils.escape(continent.name)}</h2>
                <p class="muted">${ResonaUtils.escape(continent.description)}</p>

                <div class="country-grid">
                    ${continent.countries.map(country => `
                        <button
                            type="button"
                            class="country-card"
                            data-action="country"
                            data-country="${ResonaUtils.escape(country)}"
                        >
                            <strong>${ResonaUtils.escape(country)}</strong>
                            <span class="tag">${ResonaCatalogue.byCountry(country).length} tracks</span>
                        </button>
                    `).join("")}
                </div>
            </section>

            ${ResonaTrackUI.section("Tracks from " + continent.name, tracks, {
                emptyTitle: "No tracks available yet",
                emptyDescription: "This section will populate as legitimate catalogue entries become available."
            })}
        `;
    },

    renderCountry(continent, country) {
        const tracks = ResonaCatalogue.byCountry(country);

        return `
            <button type="button" class="text-button" data-action="back-continent">
                ← ${ResonaUtils.escape(continent.name)}
            </button>

            <section class="resona-section">
                <h2>${ResonaUtils.escape(country)}</h2>
                <p class="muted">
                    Discover artists and music associated with ${ResonaUtils.escape(country)}.
                </p>
            </section>

            ${ResonaTrackUI.section("Music from " + country, tracks, {
                emptyTitle: "No music listed for this country yet",
                emptyDescription: "Real releases will appear when they are available in the catalogue."
            })}
        `;
    },

    openContinent(id) {
        const exists = RESONA_CONTINENTS.some(item => item.id === id);
        if (!exists) return;

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


/* =========================================================
   12. SEARCH
   ========================================================= */

const ResonaSearch = {
    render() {
        const page = ResonaUtils.$("#page-search");
        if (!page) return;

        const query = ResonaState.searchQuery;
        const results = query ? ResonaCatalogue.search(query) : [];

        page.innerHTML = `
            <header class="page-heading">
                <p class="eyebrow">FIND YOUR NEXT FAVOURITE</p>
                <h1>Search</h1>
            </header>

            <form id="resonaSearchForm" class="search-form">
                <label class="sr-only" for="resonaSearchInput">
                    Search tracks, artists, albums, genres, and countries
                </label>

                <input
                    id="resonaSearchInput"
                    class="search-input"
                    type="search"
                    placeholder="Tracks, artists, albums, countries..."
                    value="${ResonaUtils.escape(query)}"
                    autocomplete="off"
                >

                <button type="submit" class="cta">Search</button>
            </form>

            <div id="resonaSearchResults">
                ${query
                    ? this.renderResults(results, query)
                    : `
                        <section class="resona-section">
                            <h2>Explore by mood</h2>
                            <div class="mood-grid">
                                ${RESONA_MOODS.map(mood => `
                                    <button
                                        type="button"
                                        class="mood-card"
                                        data-action="mood"
                                        data-mood="${mood.id}"
                                    >
                                        <span>${mood.emoji}</span>
                                        <strong>${ResonaUtils.escape(mood.label)}</strong>
                                    </button>
                                `).join("")}
                            </div>
                        </section>
                    `}
            </div>
        `;

        const form = ResonaUtils.$("#resonaSearchForm", page);
        const input = ResonaUtils.$("#resonaSearchInput", page);

        if (form) {
            form.addEventListener("submit", event => {
                event.preventDefault();

                ResonaState.searchQuery = input
                    ? input.value.trim()
                    : "";

                this.render();
            });
        }

        if (input) {
            input.addEventListener("input", event => {
                ResonaState.searchQuery = event.target.value.trim();

                const resultsElement = ResonaUtils.$(
                    "#resonaSearchResults",
                    page
                );

                if (resultsElement) {
                    resultsElement.innerHTML =
                        ResonaState.searchQuery
                            ? this.renderResults(
                                ResonaCatalogue.search(ResonaState.searchQuery),
                                ResonaState.searchQuery
                            )
                            : ResonaTrackUI.empty(
                                "Start searching",
                                "Search for a title, artist, genre, album, or country."
                            );
                }
            });
        }
    },

    renderResults(results, query) {
        if (!results.length) {
            return ResonaTrackUI.empty(
                "No results found",
                "No matching tracks are currently in the catalogue. Try another search."
            );
        }

        return `
            <section class="resona-section">
                <h2>Results for "${ResonaUtils.escape(query)}"</h2>
                <div class="resona-track-list">
                    ${results.map(track => ResonaTrackUI.row(track)).join("")}
                </div>
            </section>
        `;
    },

    open(query = "") {
        ResonaState.searchQuery = String(query);
        ResonaNavigation.show("search");
    }
};


/* =========================================================
   13. LIBRARY
   ========================================================= */

const ResonaLibraryPage = {
    render() {
        const page = ResonaUtils.$("#page-library");
        if (!page) return;

        let content = "";

        if (ResonaState.libraryTab === "liked") {
            content = ResonaTrackUI.section(
                "Liked songs",
                ResonaLibrary.getLiked(),
                {
                    emptyTitle: "Your favourites belong here",
                    emptyDescription: "Like tracks while exploring music to save them to your library."
                }
            );
        } else if (ResonaState.libraryTab === "history") {
            const history = ResonaLibrary.getHistory();

            content = `
                <section class="resona-section">
                    <div class="section-heading">
                        <h2>Recently played</h2>

                        ${history.length
                            ? `<button type="button" class="text-button" data-action="clear-history">
                                Clear history
                            </button>`
                            : ""}
                    </div>

                    ${history.length
                        ? `<div class="resona-track-list">
                            ${history.map(item => `
                                <div class="history-item">
                                    ${ResonaTrackUI.row(item.track)}
                                    <small class="tag">
                                        ${ResonaUtils.escape(ResonaUtils.formatDate(item.playedAt))}
                                    </small>
                                </div>
                            `).join("")}
                        </div>`
                        : ResonaTrackUI.empty(
                            "No listening history yet",
                            "Tracks you listen to will appear here."
                        )}
                </section>
            `;
        } else {
            content = ResonaTrackUI.empty(
                "Playlists are coming next",
                "Playlist creation and cross-device synchronisation require additional implementation and a backend."
            );
        }

        page.innerHTML = `
            <header class="page-heading">
                <p class="eyebrow">YOUR PERSONAL COLLECTION</p>
                <h1>Your Library</h1>
            </header>

            <div class="chips" role="tablist">
                <button
                    type="button"
                    class="chip ${ResonaState.libraryTab === "liked" ? "active" : ""}"
                    data-action="library-tab"
                    data-tab="liked"
                    role="tab"
                    aria-selected="${ResonaState.libraryTab === "liked"}"
                >Liked songs</button>

                <button
                    type="button"
                    class="chip ${ResonaState.libraryTab === "history" ? "active" : ""}"
                    data-action="library-tab"
                    data-tab="history"
                    role="tab"
                    aria-selected="${ResonaState.libraryTab === "history"}"
                >Recently played</button>

                <button
                    type="button"
                    class="chip ${ResonaState.libraryTab === "playlists" ? "active" : ""}"
                    data-action="library-tab"
                    data-tab="playlists"
                    role="tab"
                    aria-selected="${ResonaState.libraryTab === "playlists"}"
                >Playlists</button>
            </div>

            <div id="libraryContent">${content}</div>
        `;
    },

    openTab(tab) {
        if (!["liked", "history", "playlists"].includes(tab)) return;

        ResonaState.libraryTab = tab;
        this.render();
    }
};


/* =========================================================
   14. ARTIST STUDIO
   ========================================================= */

const ResonaArtistStudio = {
    render() {
        const page = ResonaUtils.$("#page-artist");
        if (!page) return;

        page.innerHTML = `
            <header class="page-heading">
                <p class="eyebrow">FOR MUSIC CREATORS</p>
                <h1>Artist Studio</h1>
                <p class="muted">Your starting point for publishing music on Resona.</p>
            </header>

            <section class="panel">
                <h2>Bring your music to the world</h2>

                <p>
                    Resona is being prepared for independent artists
                    and established creators worldwide.
                </p>

                <p>
                    Registration, secure uploads, rights declarations,
                    release management, and publishing status require
                    a connected backend.
                </p>

                <div class="divider"></div>

                <h3>Before publishing</h3>

                <ul class="artist-requirements">
                    <li>You must own the recording or have permission to distribute it.</li>
                    <li>You must have the necessary rights to the composition and samples.</li>
                    <li>Artwork and metadata must be accurate.</li>
                    <li>Releases must follow Resona's content and copyright policies.</li>
                </ul>

                <button type="button" class="cta full" data-action="artist-registration">
                    Artist registration
                </button>
            </section>

            <section class="resona-section">
                <h2>Publishing tools</h2>

                <div class="panel">
                    <h3>Upload a release</h3>
                    <p class="muted">
                        Secure audio uploads and release submission will become available
                        after the upload API, storage, authentication, and rights checks
                        are implemented.
                    </p>
                    <button type="button" class="secondary-button" data-action="artist-registration">
                        Learn about publishing
                    </button>
                </div>

                <div class="panel">
                    <h3>Artist dashboard</h3>
                    <p class="muted">
                        Artist statistics, release management, and earnings tools require
                        an authenticated artist account and backend.
                    </p>
                </div>
            </section>
        `;
    }
};


/* =========================================================
   15. MOOD DISCOVERY
   ========================================================= */

const ResonaReset = {
    render() {
        const page = ResonaUtils.$("#page-reset");
        if (!page) return;

        page.innerHTML = `
            <header class="page-heading">
                <p class="eyebrow">MUSIC FOR YOUR MOMENT</p>
                <h1>Reset your mood</h1>
                <p class="muted">Choose how you feel and explore matching music.</p>
            </header>

            <div class="mood-grid">
                ${RESONA_MOODS.map(mood => `
                    <button
                        type="button"
                        class="mood-card ${ResonaState.selectedMood === mood.id ? "active" : ""}"
                        data-action="mood"
                        data-mood="${mood.id}"
                        aria-pressed="${ResonaState.selectedMood === mood.id}"
                    >
                        <span>${mood.emoji}</span>
                        <strong>${ResonaUtils.escape(mood.label)}</strong>
                        <small>${ResonaUtils.escape(mood.description)}</small>
                    </button>
                `).join("")}
            </div>

            <div id="resetResults">
                ${ResonaState.selectedMood
                    ? this.renderMoodResults(ResonaState.selectedMood)
                    : ResonaTrackUI.empty(
                        "Choose a mood",
                        "Your music suggestions will appear here when matching tracks exist."
                    )}
            </div>
        `;
    },

    renderMoodResults(mood) {
        return ResonaTrackUI.section(
            "Music for " + mood,
            ResonaCatalogue.byMood(mood),
            {
                emptyTitle: "No matching tracks yet",
                emptyDescription: "Mood discovery will improve as the catalogue grows and tracks receive accurate mood tags."
            }
        );
    },

    selectMood(mood) {
        if (!RESONA_MOODS.some(item => item.id === mood)) return;

        ResonaState.selectedMood = mood;
        ResonaNavigation.show("reset");
    }
};


/* =========================================================
   16. AUDIO PLAYER
   ========================================================= */

const ResonaPlayer = {
    getAudio() {
        return ResonaState.currentAudio;
    },

    canPlay(track) {
        return Boolean(
            ResonaConfig.enableAudioPlayback &&
            track &&
            track.audioUrl &&
            track.rightsConfirmed
        );
    },

    playTrack(trackId, queue = null) {
        const track = ResonaCatalogue.getTrack(trackId);

        if (!track) {
            ResonaToast.show("This track is not available in the catalogue.");
            return;
        }

        if (Array.isArray(queue)) {
            ResonaState.queue = queue.slice(0, ResonaConfig.maxQueue);
        }

        ResonaState.queueIndex = ResonaState.queue.findIndex(
            item => String(item.id) === String(track.id)
        );

        ResonaState.currentTrack = track;
        ResonaState.audioError = "";

        this.updatePlayerUI();

        if (!this.canPlay(track)) {
            this.stopAudio();
            ResonaToast.show("Playback is unavailable for this track.");
            return;
        }

        this.stopAudio();

        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = track.audioUrl;

        audio.addEventListener("loadedmetadata", () => {
            this.updateProgress();
        });

        audio.addEventListener("timeupdate", () => {
            this.updateProgress();
        });

        audio.addEventListener("play", () => {
            ResonaState.isPlaying = true;
            this.updatePlayerUI();
        });

        audio.addEventListener("pause", () => {
            ResonaState.isPlaying = false;
            this.updatePlayerUI();
        });

        audio.addEventListener("ended", () => {
            ResonaState.isPlaying = false;

            if (ResonaState.queueIndex >= 0 &&
                ResonaState.queueIndex < ResonaState.queue.length - 1) {
                this.next();
            } else {
                this.updatePlayerUI();
                ResonaToast.show("Track finished.");
            }
        });

        audio.addEventListener("error", () => {
            ResonaState.isPlaying = false;
            ResonaState.audioError = "Audio could not be loaded.";
            this.updatePlayerUI();

            ResonaToast.show(
                "Unable to play this track. The audio source may be unavailable."
            );
        });

        ResonaState.currentAudio = audio;

        audio.play()
            .then(() => {
                ResonaState.isPlaying = true;
                ResonaLibrary.addHistory(track);
                this.updatePlayerUI();
            })
            .catch(error => {
                ResonaState.isPlaying = false;
                this.updatePlayerUI();

                console.warn("Resona playback failed:", error);

                ResonaToast.show(
                    "Playback could not start. Check the audio source and browser permissions."
                );
            });
    },

    toggle() {
        const audio = this.getAudio();

        if (!audio || !ResonaState.currentTrack) {
            ResonaToast.show("Choose a track first.");
            return;
        }

        if (audio.paused) {
            audio.play()
                .then(() => {
                    ResonaState.isPlaying = true;
                    this.updatePlayerUI();
                })
                .catch(() => {
                    ResonaToast.show("Unable to resume playback.");
                });
        } else {
            audio.pause();
        }
    },

    stopAudio() {
        const audio = ResonaState.currentAudio;

        if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
        }

        ResonaState.currentAudio = null;
        ResonaState.isPlaying = false;
    },

    next() {
        const queue = ResonaState.queue;

        if (!queue.length) {
            ResonaToast.show("There are no more tracks in the queue.");
            return;
        }

        const index = ResonaState.queueIndex;

        if (index < 0 || index >= queue.length - 1) {
            ResonaToast.show("You've reached the end of the queue.");
            return;
        }

        this.playTrack(queue[index + 1].id, queue);
    },

    previous() {
        const audio = this.getAudio();

        if (audio && audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }

        const index = ResonaState.queueIndex;

        if (index <= 0) {
            ResonaToast.show("This is the first track in the queue.");
            return;
        }

        this.playTrack(ResonaState.queue[index - 1].id, ResonaState.queue);
    },

    seek(value) {
        const audio = this.getAudio();

        if (!audio || !Number.isFinite(audio.duration)) return;

        const percentage = Math.max(0, Math.min(100, Number(value) || 0));

        audio.currentTime = audio.duration * percentage / 100;
    },

    updateProgress() {
        const audio = this.getAudio();
        const currentTime = audio ? audio.currentTime : 0;

        const duration = audio && Number.isFinite(audio.duration)
            ? audio.duration
            : (ResonaState.currentTrack?.duration || 0);

        const percentage = duration > 0
            ? currentTime / duration * 100
            : 0;

        /*
         * Support the old player IDs and the IDs in the new index.html.
         */
        const seekBar =
            ResonaUtils.$("#seekBar") ||
            ResonaUtils.$("#miniProgressTrack") ||
            ResonaUtils.$("#npProgressTrack");

        if (seekBar && "value" in seekBar) {
            seekBar.value = String(percentage);
            seekBar.setAttribute("aria-valuenow", String(Math.round(percentage)));
        }

        const miniProgress = ResonaUtils.$("#miniProgress");
        if (miniProgress) {
            miniProgress.style.width = percentage + "%";
        }

        const npProgress = ResonaUtils.$("#npProgress");
        if (npProgress) {
            npProgress.style.width = percentage + "%";
        }

        /*
         * If the HTML uses progress tracks instead of range inputs,
         * update their visual fill without changing the track element.
         */
        ["#miniProgressTrack", "#npProgressTrack"].forEach(selector => {
            const element = ResonaUtils.$(selector);

            if (element && !("value" in element)) {
                element.style.setProperty("--progress", percentage + "%");
                element.setAttribute("aria-valuenow", String(Math.round(percentage)));
            }
        });

        const currentElement = ResonaUtils.$("#currentTime");
        if (currentElement) {
            currentElement.textContent = ResonaUtils.formatTime(currentTime);
        }

        const durationElement = ResonaUtils.$("#duration");
        if (durationElement) {
            durationElement.textContent = ResonaUtils.formatTime(duration);
        }
    },

    updatePlayerUI() {
        const track = ResonaState.currentTrack;
        const mini = ResonaUtils.$("#mini");

        if (mini) {
            mini.hidden = !track;
            mini.style.display = track ? "flex" : "none";
        }

        if (!track) {
            this.updateProgress();
            return;
        }

        const setText = (selector, value) => {
            const element = ResonaUtils.$(selector);
            if (element) element.textContent = value;
        };

        setText("#miniTitle", track.title);
        setText("#miniArtist", track.artist);
        setText("#npTitle", track.title);
        setText("#npArtist", track.artist);

        const setArtwork = selector => {
            const element = ResonaUtils.$(selector);
            if (!element) return;

            const artwork = ResonaUtils.safeImage(track.artwork);

            if (artwork) {
                element.style.backgroundImage =
                    `url("${artwork.replace(/["\\]/g, "")}")`;
                element.textContent = "";
            } else {
                element.style.backgroundImage = "";
                element.textContent = "♫";
            }
        };

        setArtwork("#miniArt");
        setArtwork("#npArt");

        const playLabel = ResonaState.isPlaying ? "Ⅱ" : "▶";

        ["#miniPlay", "#npPlay"].forEach(selector => {
            const button = ResonaUtils.$(selector);

            if (button) {
                button.textContent = playLabel;
                button.setAttribute(
                    "aria-label",
                    ResonaState.isPlaying ? "Pause" : "Play"
                );
            }
        });

        const liked = ResonaLibrary.isLiked(track.id);

        ["#npLike", "#miniLike"].forEach(selector => {
            const button = ResonaUtils.$(selector);

            if (button) {
                button.textContent = liked ? "♥" : "♡";
                button.setAttribute("aria-pressed", String(liked));
            }
        });

        const lyrics = ResonaUtils.$("#lyrics");

        if (lyrics) {
            lyrics.textContent = "Lyrics are not available for this track.";
        }

        this.updateProgress();
    }
};


/* =========================================================
   17. NOW PLAYING SCREEN
   ========================================================= */

const ResonaNowPlaying = {
    open() {
        const element = ResonaUtils.$("#np");

        if (!element) {
            ResonaToast.show("Now Playing is not available on this page.");
            return;
        }

        element.classList.add("open");
        element.setAttribute("aria-hidden", "false");

        ResonaState.playerExpanded = true;
        ResonaPlayer.updatePlayerUI();
    },

    close() {
        const element = ResonaUtils.$("#np");
        if (!element) return;

        element.classList.remove("open");
        element.setAttribute("aria-hidden", "true");

        ResonaState.playerExpanded = false;
    }
};


/* =========================================================
   18. BACKEND API
   ========================================================= */

const ResonaAPI = {
    getBaseUrl() {
        return String(ResonaConfig.apiBase || "").replace(/\/+$/, "");
    },

    async request(path, options = {}) {
        const baseUrl = this.getBaseUrl();

        if (!baseUrl) {
            throw new Error("Resona API is not configured.");
        }

        const url = baseUrl + "/" + String(path).replace(/^\/+/, "");

        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body ? {
                    "Content-Type": "application/json"
                } : {}),
                ...(options.headers || {})
            }
        });

        if (!response.ok) {
            throw new Error("API request failed with status " + response.status);
        }

        return response.json();
    },

    async loadCatalogue() {
        if (!this.getBaseUrl()) {
            console.info(
                "Resona API is not connected. No remote catalogue loaded."
            );
            return false;
        }

        try {
            ResonaState.isLoading = true;

            const response = await this.request("/tracks");

            const rawTracks = Array.isArray(response)
                ? response
                : Array.isArray(response.tracks)
                    ? response.tracks
                    : [];

            ResonaState.tracks =
                ResonaCatalogue.normalizeTracks(rawTracks);

            ResonaState.isLoading = false;
            return true;
        } catch (error) {
            ResonaState.isLoading = false;

            console.error("Could not load Resona catalogue:", error);

            ResonaToast.show("Music catalogue could not be loaded.");
            return false;
        }
    }
};


/* =========================================================
   19. EVENTS
   ========================================================= */

const ResonaEvents = {
    bound: false,

    bind() {
        if (this.bound) return;
        this.bound = true;

        /*
         * Main navigation:
         * The replacement index.html uses data-page attributes.
         * This listener is delegated, so it also works after rendering.
         */
        document.addEventListener("click", event => {
            const pageButton = event.target.closest("[data-page]");

            if (pageButton) {
                event.preventDefault();

                ResonaNavigation.show(
                    pageButton.dataset.page,
                    pageButton
                );

                return;
            }

            const button = event.target.closest("[data-action]");

            if (!button) return;

            const action = button.dataset.action;
            const trackId = button.dataset.trackId;

            switch (action) {
                case "play":
                    event.preventDefault();
                    ResonaPlayer.playTrack(trackId, ResonaState.tracks);
                    break;

                case "like":
                    event.preventDefault();
                    this.toggleLike(trackId);
                    break;

                case "open-explore":
                    ResonaNavigation.show("explore");
                    break;

                case "open-search":
                    ResonaSearch.open();
                    break;

                case "continent":
                    ResonaExplore.openContinent(button.dataset.continent);
                    break;

                case "country":
                    ResonaExplore.openCountry(button.dataset.country);
                    break;

                case "back-continent":
                    ResonaState.selectedCountry = "";
                    ResonaNavigation.show("explore");
                    break;

                case "clear-explore-selection":
                    ResonaExplore.resetSelection();
                    break;

                case "mood":
                    ResonaReset.selectMood(button.dataset.mood);
                    break;

                case "library-tab":
                    ResonaLibraryPage.openTab(button.dataset.tab);
                    break;

                case "clear-history":
                    ResonaLibrary.clearHistory();
                    break;

                case "artist-registration":
                    ResonaToast.show(
                        "Artist registration requires the account and publishing backend."
                    );
                    break;
            }
        });

        /*
         * Player controls from the current index.html.
         */
        document.addEventListener("click", event => {
            const control = event.target.closest(
                "#miniPlay, #npPlay, #npPrev, #npNext, #npClose, #npMore, #mini, #miniArt, #miniTitle, #miniArtist"
            );

            if (!control) return;

            const id = control.id;

            if (id === "miniPlay" || id === "npPlay") {
                event.preventDefault();
                event.stopPropagation();
                ResonaPlayer.toggle();
                return;
            }

            if (id === "npPrev") {
                event.preventDefault();
                ResonaPlayer.previous();
                return;
            }

            if (id === "npNext") {
                event.preventDefault();
                ResonaPlayer.next();
                return;
            }

            if (id === "npClose") {
                event.preventDefault();
                ResonaNowPlaying.close();
                return;
            }

            if (id === "npMore") {
                event.preventDefault();
                ResonaToast.show("Additional player options are coming next.");
                return;
            }

            if (
                ["mini", "miniArt", "miniTitle", "miniArtist"].includes(id) &&
                ResonaState.currentTrack
            ) {
                ResonaNowPlaying.open();
            }
        });

        document.addEventListener("input", event => {
            const target = event.target;

            if (
                target.matches("#seekBar") ||
                target.matches("#miniProgressTrack") ||
                target.matches("#npProgressTrack")
            ) {
                ResonaPlayer.seek(target.value);
            }
        });

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
                ? "Added to your liked songs."
                : "Removed from your liked songs."
        );

        ResonaPlayer.updatePlayerUI();

        ResonaNavigation.renderPage(ResonaState.currentPage);
    }
};


/* =========================================================
   20. LEGACY COMPATIBILITY FUNCTIONS
   ========================================================= */

function showPage(pageName, button = null) {
    return ResonaNavigation.show(pageName, button);
}

function playSong(index) {
    const position = Number(index);

    if (
        !Number.isInteger(position) ||
        position < 0 ||
        position >= ResonaState.tracks.length
    ) {
        ResonaToast.show("There is no track at that position.");
        return;
    }

    ResonaPlayer.playTrack(
        ResonaState.tracks[position].id,
        ResonaState.tracks
    );
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

function openNowPlaying() {
    ResonaNowPlaying.open();
}

function closeNowPlaying() {
    ResonaNowPlaying.close();
}

function doSearch() {
    const input =
        ResonaUtils.$("#searchInput") ||
        ResonaUtils.$("#resonaSearchInput");

    ResonaSearch.open(input ? input.value : "");
}

function openReset() {
    ResonaNavigation.show("reset");
}

function doReset() {
    if (!ResonaState.selectedMood) {
        ResonaToast.show("Choose a mood first.");
        return;
    }

    ResonaReset.selectMood(ResonaState.selectedMood);
}


/* =========================================================
   21. SUPPORT STYLES
   ========================================================= */

function installResonaSupportStyles() {
    if (ResonaUtils.$("#resonaSupportStyles")) return;

    const style = document.createElement("style");
    style.id = "resonaSupportStyles";

    style.textContent = `
        .sr-only {
            position:absolute;
            width:1px;
            height:1px;
            padding:0;
            margin:-1px;
            overflow:hidden;
            clip:rect(0,0,0,0);
            white-space:nowrap;
            border:0;
        }

        .muted,.tag { color:var(--mu,#9b97b8); }

        .resona-section { margin-block:24px; }

        .section-heading {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            margin-bottom:14px;
        }

        .section-heading h2 { margin:0; }

        .resona-track-list {
            display:flex;
            flex-direction:column;
            gap:8px;
        }

        .resona-track-row { min-width:0; }

        .resona-track-info {
            border:0;
            background:transparent;
            color:inherit;
            cursor:pointer;
            min-width:0;
            text-align:left;
        }

        .resona-track-info .tt,
        .resona-track-info .tag {
            display:block;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
        }

        .resona-art-placeholder {
            display:grid;
            place-items:center;
            background:linear-gradient(
                135deg,
                rgba(155,92,255,.24),
                rgba(48,214,190,.14)
            );
            font-size:24px;
        }

        .resona-art-placeholder span { opacity:.85; }

        .resona-horizontal {
            display:flex;
            gap:12px;
            overflow-x:auto;
            padding-bottom:8px;
            scrollbar-width:thin;
        }

        .continent-card,.country-card,.mood-card {
            color:var(--tx,#f3f1fa);
            font:inherit;
            text-align:left;
            cursor:pointer;
            border:1px solid var(--b,rgba(255,255,255,.1));
            border-radius:var(--r,16px);
            background:var(--s,rgba(255,255,255,.06));
            padding:14px;
        }

        .resona-horizontal .continent-card { flex:0 0 150px; }

        .continent-card,.country-card {
            display:flex;
            flex-direction:column;
            gap:8px;
        }

        .continent-emoji { font-size:28px; }

        .continent-grid,.country-grid,.mood-grid {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
        }

        .mood-card { display:flex; flex-direction:column; gap:8px; }
        .mood-card>span { font-size:24px; }

        .mood-card small {
            color:var(--mu,#9b97b8);
            line-height:1.4;
        }

        .mood-card.active,.chip.active {
            border-color:var(--pu,#a78bfa);
            background:rgba(167,139,250,.15);
        }

        .search-form {
            display:flex;
            gap:8px;
            margin-block:18px;
        }

        .search-input {
            width:100%;
            min-width:0;
            padding:13px;
            color:var(--tx,#f3f1fa);
            background:var(--s,rgba(255,255,255,.06));
            border:1px solid var(--b,rgba(255,255,255,.1));
            border-radius:12px;
            font:inherit;
        }

        .text-button,.secondary-button {
            cursor:pointer;
            color:var(--te,#5eead4);
            background:transparent;
            border:0;
            font:inherit;
        }

        .secondary-button {
            padding:10px 14px;
            border:1px solid var(--b,rgba(255,255,255,.1));
            border-radius:10px;
        }

        .panel {
            padding:18px;
            border:1px solid var(--b,rgba(255,255,255,.1));
            border-radius:var(--r,16px);
            background:var(--s,rgba(255,255,255,.06));
            margin-block:12px;
        }

        .panel p,.panel li { line-height:1.65; }
        .artist-requirements { padding-left:22px; }

        .resona-card-actions {
            display:flex;
            gap:6px;
            margin-top:10px;
        }

        .resona-card-play {
            display:block;
            width:100%;
            padding:0;
            border:0;
            background:transparent;
            cursor:pointer;
            color:inherit;
        }

        .resona-card-play .art {
            width:100%;
            aspect-ratio:1;
        }

        .resona-card-play img {
            width:100%;
            height:100%;
            object-fit:cover;
            border-radius:inherit;
        }

        .resona-track-card .card-info { padding-top:10px; }
        .resona-track-card .tt { overflow-wrap:anywhere; }
        .history-item { margin-bottom:14px; }

        .history-item>.tag {
            display:block;
            padding-left:10px;
            margin-top:4px;
        }

        .home-header {
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            gap:12px;
            margin-bottom:22px;
        }

        .home-header h1 { margin-block:4px; }

        .eyebrow {
            font-size:11px;
            letter-spacing:.15em;
            opacity:.75;
        }

        .hero-content { max-width:500px; }
        .hero-content p { line-height:1.6; }
        .page-heading { margin-bottom:18px; }
        .page-heading h1 { margin-block:6px; }

        .empty-state {
            padding:24px 14px;
            text-align:center;
            border:1px dashed var(--b,rgba(255,255,255,.1));
            border-radius:var(--r,16px);
        }

        .empty-state p {
            line-height:1.6;
            color:var(--mu,#9b97b8);
        }

        .empty-icon { font-size:28px; margin-bottom:8px; }
        .full { width:100%; }

        .page[aria-hidden="true"] { pointer-events:none; }

        #np[aria-hidden="true"] {
            visibility:hidden;
            pointer-events:none;
        }

        #np.open {
            visibility:visible;
            pointer-events:auto;
        }

        button:focus-visible,input:focus-visible {
            outline:2px solid var(--te,#5eead4);
            outline-offset:3px;
        }

        @media(max-width:420px) {
            .search-form { flex-direction:column; }
            .search-form .cta { width:100%; }
        }

        @media(min-width:650px) {
            .continent-grid,.country-grid,.mood-grid {
                grid-template-columns:repeat(3,minmax(0,1fr));
            }
        }
    `;

    document.head.appendChild(style);
}


/* =========================================================
   22. INITIALIZATION
   ========================================================= */

async function initResona() {
    if (ResonaState.initialized) return;

    ResonaState.initialized = true;

    installResonaSupportStyles();
    ResonaLibrary.load();
    ResonaNavigation.ensurePages();
    ResonaEvents.bind();

    await ResonaAPI.loadCatalogue();

    const savedPage = ResonaUtils.readStorage("last_page", "home");

    const initialPage = ResonaNavigation.pages.includes(savedPage)
        ? savedPage
        : "home";

    ResonaNavigation.show(initialPage);

    const mini = ResonaUtils.$("#mini");

    if (mini && !ResonaState.currentTrack) {
        mini.hidden = true;
        mini.style.display = "none";
    }

    const nowPlaying = ResonaUtils.$("#np");

    if (nowPlaying) {
        nowPlaying.classList.remove("open");
        nowPlaying.setAttribute("aria-hidden", "true");
    }

    console.info("Resona initialized successfully.");
    console.info("Catalogue tracks:", ResonaState.tracks.length);

    if (!ResonaConfig.apiBase) {
        console.info(
            "The backend is not connected. The interface can be explored, but remote music and account features are not active."
        );
    }
}


/* =========================================================
   23. PUBLIC API
   ========================================================= */

window.Resona = {
    config: ResonaConfig,
    state: ResonaState,
    catalogue: ResonaCatalogue,
    library: ResonaLibrary,
    navigation: ResonaNavigation,
    player: ResonaPlayer,
    explore: ResonaExplore,
    search: ResonaSearch,
    api: ResonaAPI,
    toast: ResonaToast,
    init: initResona
};

window.ResonaNavigation = ResonaNavigation;
window.ResonaPlayer = ResonaPlayer;
window.ResonaExplore = ResonaExplore;


/* =========================================================
   24. START APPLICATION
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
