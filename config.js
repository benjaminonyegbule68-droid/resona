/* =========================================================
   RESONA — APPLICATION CONFIGURATION
   Global music discovery and streaming platform
   ========================================================= */

"use strict";

window.ResonaConfig = Object.freeze({

  /* -------------------------------------------------------
     APPLICATION
     ------------------------------------------------------- */

  app: Object.freeze({
    name: "Resona",
    version: "1.0.0",
    tagline: "Your world. Your sound.",
    description:
      "Discover music, explore artists, and find your next favourite sound from around the world.",
    defaultLanguage: "en",
    defaultRegion: "global"
  }),

  /* -------------------------------------------------------
     API CONFIGURATION
     ------------------------------------------------------- */

  api: Object.freeze({

    /*
     * Leave empty until the actual backend URL is available.
     * Example: "https://api.example.com"
     */
    baseUrl: "",

    timeout: 15000,

    endpoints: Object.freeze({
      health: "/health",
      tracks: "/tracks",
      albums: "/albums",
      artists: "/artists",
      search: "/search",
      playlists: "/playlists",
      recommendations: "/recommendations",
      auth: "/auth",
      subscriptions: "/subscriptions"
    })
  }),

  /* -------------------------------------------------------
     MUSIC DISCOVERY
     ------------------------------------------------------- */

  discovery: Object.freeze({

    defaultPageSize: 20,
    maximumPageSize: 50,

    regions: Object.freeze([
      "global",
      "africa",
      "asia",
      "europe",
      "north-america",
      "south-america",
      "oceania"
    ]),

    categories: Object.freeze([
      "trending",
      "new-releases",
      "popular",
      "recommended",
      "genres",
      "moods"
    ]),

    enablePersonalizedRecommendations: true,
    enableRegionalDiscovery: true,
    enableGlobalCharts: true
  }),

  /* -------------------------------------------------------
     MUSIC PLAYER
     ------------------------------------------------------- */

  player: Object.freeze({

    autoplay: false,
    shuffle: false,
    repeat: "off",
    defaultVolume: 0.8,
    rememberVolume: true,
    updateProgressInterval: 1000
  }),

  /* -------------------------------------------------------
     LOCAL STORAGE
     ------------------------------------------------------- */

  storage: Object.freeze({

    prefix: "resona_",

    keys: Object.freeze({
      preferences: "resona_preferences",
      favorites: "resona_favorites",
      history: "resona_history",
      playlists: "resona_playlists",
      volume: "resona_volume",
      queue: "resona_queue",
      session: "resona_session"
    })
  }),

  /* -------------------------------------------------------
     FEATURE FLAGS
     ------------------------------------------------------- */

  features: Object.freeze({

    search: true,
    musicDiscovery: true,
    favorites: true,
    playlists: true,
    listeningHistory: true,
    artistProfiles: true,
    globalCharts: true,

    /*
     * Keep authentication and payments disabled until
     * their backend implementations are ready.
     */
    authentication: false,
    subscriptions: false,
    offlineMode: false,

    /*
     * Resona must not pretend to stream music when an
     * authorised playback source is unavailable.
     */
    requireAuthorizedPlayback: true
  }),

  /* -------------------------------------------------------
     INTERFACE
     ------------------------------------------------------- */

  ui: Object.freeze({

    theme: "dark",
    defaultPage: "home",
    toastDuration: 3500,
    animationDuration: 250,

    breakpoints: Object.freeze({
      mobile: 480,
      tablet: 768,
      desktop: 1024
    })
  }),

  /* -------------------------------------------------------
     APPLICATION LIMITS
     ------------------------------------------------------- */

  limits: Object.freeze({

    maximumSearchLength: 200,
    maximumPlaylistNameLength: 100,
    maximumRecentTracks: 50,
    maximumLocalPlaylists: 100
  })

});

/* =========================================================
   RESONA CONFIGURATION READY
   ========================================================= */

console.info(
  "[Resona] Configuration loaded:",
  window.ResonaConfig.app.version
);
