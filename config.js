/* =========================================================
   RESONA — GLOBAL CONFIGURATION
   File: config.js
   Version: 1.1.0
   ========================================================= */

"use strict";

(function (global) {
  const ResonaConfig = {
    app: {
      name: "Resona",
      version: "2.0.0",
      environment: "production",
      debug: false
    },

    api: {
      baseUrl: "",
      timeout: 15000,
      retries: 1,
      retryDelay: 1000
    },

    // Used by js/api.js
    apiTimeout: 15000,

    storage: {
      enabled: true,
      prefix: "resona_",

      keys: {
        favorites: "resona_liked_tracks",
        likedTracks: "resona_liked_tracks",
        savedTracks: "resona_saved_tracks",
        history: "resona_history",
        playlists: "resona_library_playlists",
        libraryPlaylists: "resona_library_playlists",
        libraryVersion: "resona_library_version",
        trackCache: "resona_trackCache",
        searchHistory: "resona_search_history"
      }
    },

    player: {
      autoplay: false,
      defaultVolume: 0.8,
      rememberVolume: true,
      crossfade: false,
      crossfadeDuration: 3000,
      preload: "metadata",
      updateInterval: 500
    },

    discovery: {
      defaultLimit: 20,
      maximumLimit: 100,
      featuredLimit: 8,
      trendingLimit: 12,
      recentlyPlayedLimit: 10
    },

    search: {
      minimumQueryLength: 1,
      debounceDelay: 300,
      defaultLimit: 20,
      maximumLimit: 100,
      historyLimit: 20
    },

    ui: {
      toastDuration: 3000,
      animationDuration: 250,
      mobileBreakpoint: 768
    },

    limits: {
      maximumPlaylistTracks: 5000,
      maximumLibraryItems: 10000,
      maximumSearchHistory: 20
    },

    features: {
      search: true,
      discovery: true,
      playlists: true,
      favorites: true,
      listeningHistory: true,
      artistPages: true,
      albumPages: true,
      downloads: false,
      offlinePlayback: false,
      musicVideos: false,
      lyrics: false,
      recommendations: true
    }
  };

  global.ResonaConfig = Object.freeze(ResonaConfig);

})(window);
