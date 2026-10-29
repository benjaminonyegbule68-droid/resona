/* =========================================================
   RESONA — LOCAL STORAGE MODULE
   Handles favourites, playlists, history and preferences.
   ========================================================= */

(function (global) {
  "use strict";

  if (global.ResonaStorage) {
    console.warn("[Resona] Storage module already loaded.");
    return;
  }

  const config = global.ResonaConfig || {};

  const storageConfig = config.storage || {};
  const prefix = storageConfig.prefix || "resona_";

  const configuredKeys = storageConfig.keys || {};

  const KEYS = Object.freeze({
    preferences: configuredKeys.preferences || prefix + "preferences",
    favorites: configuredKeys.favorites || prefix + "favorites",
    history: configuredKeys.history || prefix + "history",
    playlists: configuredKeys.playlists || prefix + "playlists",
    volume: configuredKeys.volume || prefix + "volume",
    queue: configuredKeys.queue || prefix + "queue",
    session: configuredKeys.session || prefix + "session"
  });

  const LIMITS = Object.freeze({
    history: Number(config.limits?.maximumRecentTracks) || 50,
    playlists: Number(config.limits?.maximumLocalPlaylists) || 100,
    playlistNameLength:
      Number(config.limits?.maximumPlaylistNameLength) || 100
  });

  const listeners = new Set();

  /* -------------------------------------------------------
     STORAGE AVAILABILITY
     ------------------------------------------------------- */

  function getStorage() {
    try {
      if (!global.localStorage) return null;

      const testKey = prefix + "__storage_test__";

      global.localStorage.setItem(testKey, "1");
      global.localStorage.removeItem(testKey);

      return global.localStorage;
    } catch (error) {
      return null;
    }
  }

  function isAvailable() {
    return getStorage() !== null;
  }

  /* -------------------------------------------------------
     INTERNAL HELPERS
     ------------------------------------------------------- */

  function emitChange(type, detail) {
    const eventData = {
      type: type,
      detail: detail || null,
      timestamp: Date.now()
    };

    listeners.forEach(function (listener) {
      try {
        listener(eventData);
      } catch (error) {
        console.error("[Resona] Storage listener failed:", error);
      }
    });

    try {
      global.dispatchEvent(
        new CustomEvent("resona:storage-change", {
          detail: eventData
        })
      );
    } catch (error) {
      // Custom events may be unavailable in restricted environments.
    }
  }

  function read(key, fallback) {
    const storage = getStorage();

    if (!storage) return fallback;

    try {
      const value = storage.getItem(key);

      if (value === null) return fallback;

      return JSON.parse(value);
    } catch (error) {
      console.warn("[Resona] Could not read storage key:", key);
      return fallback;
    }
  }

  function write(key, value, eventType) {
    const storage = getStorage();

    if (!storage) {
      return {
        ok: false,
        error: "Local storage is unavailable."
      };
    }

    try {
      const serialized = JSON.stringify(value);

      storage.setItem(key, serialized);

      emitChange(eventType || key, value);

      return {
        ok: true
      };
    } catch (error) {
      console.error("[Resona] Could not save data:", error);

      return {
        ok: false,
        error: "Unable to save data. Storage may be full."
      };
    }
  }

  function remove(key, eventType) {
    const storage = getStorage();

    if (!storage) {
      return {
        ok: false,
        error: "Local storage is unavailable."
      };
    }

    try {
      storage.removeItem(key);

      emitChange(eventType || key, null);

      return {
        ok: true
      };
    } catch (error) {
      return {
        ok: false,
        error: "Unable to remove saved data."
      };
    }
  }

  function normalizeId(id) {
    if (id === undefined || id === null) return "";

    return String(id).trim();
  }

  function normalizeTrack(track) {
    if (!track || typeof track !== "object") return null;

    const id = normalizeId(
      track.id ??
      track.track_id ??
      track.trackId
    );

    if (!id) return null;

    return Object.assign({}, track, {
      id: id
    });
  }

  function getTrackId(track) {
    if (typeof track === "string" || typeof track === "number") {
      return normalizeId(track);
    }

    if (!track || typeof track !== "object") return "";

    return normalizeId(
      track.id ??
      track.track_id ??
      track.trackId
    );
  }

  function uniqueTracks(tracks) {
    const seen = new Set();
    const result = [];

    tracks.forEach(function (track) {
      const normalized = normalizeTrack(track);

      if (!normalized || seen.has(normalized.id)) return;

      seen.add(normalized.id);
      result.push(normalized);
    });

    return result;
  }

  /* -------------------------------------------------------
     PREFERENCES
     ------------------------------------------------------- */

  function getPreferences() {
    const value = read(KEYS.preferences, {});

    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function savePreferences(preferences) {
    if (
      !preferences ||
      typeof preferences !== "object" ||
      Array.isArray(preferences)
    ) {
      return {
        ok: false,
        error: "Preferences must be an object."
      };
    }

    return write(
      KEYS.preferences,
      Object.assign({}, getPreferences(), preferences),
      "preferences"
    );
  }

  function getPreference(name, fallback) {
    if (typeof name !== "string" || !name.trim()) {
      return fallback;
    }

    const preferences = getPreferences();

    return Object.prototype.hasOwnProperty.call(preferences, name)
      ? preferences[name]
      : fallback;
  }

  function setPreference(name, value) {
    if (typeof name !== "string" || !name.trim()) {
      return {
        ok: false,
        error: "A preference name is required."
      };
    }

    const preferences = getPreferences();

    preferences[name] = value;

    return savePreferences(preferences);
  }

  /* -------------------------------------------------------
     FAVOURITES
     ------------------------------------------------------- */

  function getFavorites() {
    const value = read(KEYS.favorites, []);

    return Array.isArray(value) ? uniqueTracks(value) : [];
  }

  function isFavorite(trackOrId) {
    const id = getTrackId(trackOrId);

    if (!id) return false;

    return getFavorites().some(function (track) {
      return track.id === id;
    });
  }

  function addFavorite(track) {
    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        ok: false,
        error: "A valid track with an ID is required."
      };
    }

    const favorites = getFavorites();

    const existingIndex = favorites.findIndex(function (item) {
      return item.id === normalized.id;
    });

    if (existingIndex !== -1) {
      favorites[existingIndex] = Object.assign(
        {},
        favorites[existingIndex],
        normalized
      );
    } else {
      favorites.unshift(normalized);
    }

    const result = write(KEYS.favorites, favorites, "favorites");

    if (result.ok) result.track = normalized;

    return result;
  }

  function removeFavorite(trackOrId) {
    const id = getTrackId(trackOrId);

    if (!id) {
      return {
        ok: false,
        error: "A valid track ID is required."
      };
    }

    const favorites = getFavorites().filter(function (track) {
      return track.id !== id;
    });

    return write(KEYS.favorites, favorites, "favorites");
  }

  function toggleFavorite(track) {
    return isFavorite(track)
      ? removeFavorite(track)
      : addFavorite(track);
  }

  /* -------------------------------------------------------
     LISTENING HISTORY
     ------------------------------------------------------- */

  function getHistory() {
    const value = read(KEYS.history, []);

    return Array.isArray(value) ? uniqueTracks(value) : [];
  }

  function addHistory(track) {
    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        ok: false,
        error: "A valid track with an ID is required."
      };
    }

    const history = getHistory().filter(function (item) {
      return item.id !== normalized.id;
    });

    history.unshift(
      Object.assign({}, normalized, {
        playedAt: new Date().toISOString()
      })
    );

    const result = write(
      KEYS.history,
      history.slice(0, LIMITS.history),
      "history"
    );

    return result;
  }

  function clearHistory() {
    return write(KEYS.history, [], "history");
  }

  /* -------------------------------------------------------
     PLAYLISTS
     ------------------------------------------------------- */

  function getPlaylists() {
    const value = read(KEYS.playlists, []);

    return Array.isArray(value) ? value : [];
  }

  function createPlaylist(name, options) {
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      return {
        ok: false,
        error: "Enter a playlist name."
      };
    }

    if (cleanName.length > LIMITS.playlistNameLength) {
      return {
        ok: false,
        error:
          "Playlist names cannot exceed " +
          LIMITS.playlistNameLength +
          " characters."
      };
    }

    const playlists = getPlaylists();

    if (playlists.length >= LIMITS.playlists) {
      return {
        ok: false,
        error: "The local playlist limit has been reached."
      };
    }

    const playlistOptions =
      options && typeof options === "object" ? options : {};

    const playlist = {
      id: "playlist_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 8),

      name: cleanName,

      description: String(
        playlistOptions.description || ""
      ).trim(),

      tracks: [],

      createdAt: new Date().toISOString(),

      updatedAt: new Date().toISOString()
    };

    playlists.unshift(playlist);

    const result = write(KEYS.playlists, playlists, "playlists");

    if (result.ok) result.playlist = playlist;

    return result;
  }

  function getPlaylist(playlistId) {
    const id = normalizeId(playlistId);

    if (!id) return null;

    return getPlaylists().find(function (playlist) {
      return playlist.id === id;
    }) || null;
  }

  function addToPlaylist(playlistId, track) {
    const id = normalizeId(playlistId);
    const normalized = normalizeTrack(track);

    if (!id || !normalized) {
      return {
        ok: false,
        error: "A playlist and valid track are required."
      };
    }

    const playlists = getPlaylists();

    const index = playlists.findIndex(function (playlist) {
      return playlist.id === id;
    });

    if (index === -1) {
      return {
        ok: false,
        error: "Playlist not found."
      };
    }

    const playlist = Object.assign({}, playlists[index]);
    const tracks = Array.isArray(playlist.tracks)
      ? playlist.tracks.slice()
      : [];

    if (tracks.some(function (item) {
      return getTrackId(item) === normalized.id;
    })) {
      return {
        ok: true,
        alreadyExists: true
      };
    }

    tracks.push(normalized);

    playlist.tracks = tracks;
    playlist.updatedAt = new Date().toISOString();

    playlists[index] = playlist;

    const result = write(KEYS.playlists, playlists, "playlists");

    if (result.ok) result.playlist = playlist;

    return result;
  }

  function removeFromPlaylist(playlistId, trackOrId) {
    const id = normalizeId(playlistId);
    const trackId = getTrackId(trackOrId);

    if (!id || !trackId) {
      return {
        ok: false,
        error: "A playlist ID and track ID are required."
      };
    }

    const playlists = getPlaylists();

    const index = playlists.findIndex(function (playlist) {
      return playlist.id === id;
    });

    if (index === -1) {
      return {
        ok: false,
        error: "Playlist not found."
      };
    }

    const playlist = Object.assign({}, playlists[index]);

    playlist.tracks = (Array.isArray(playlist.tracks)
      ? playlist.tracks
      : []
    ).filter(function (track) {
      return getTrackId(track) !== trackId;
    });

    playlist.updatedAt = new Date().toISOString();

    playlists[index] = playlist;

    return write(KEYS.playlists, playlists, "playlists");
  }

  function renamePlaylist(playlistId, newName) {
    const id = normalizeId(playlistId);
    const cleanName = String(newName || "").trim();

    if (!id || !cleanName) {
      return {
        ok: false,
        error: "A playlist ID and name are required."
      };
    }

    if (cleanName.length > LIMITS.playlistNameLength) {
      return {
        ok: false,
        error:
          "Playlist names cannot exceed " +
          LIMITS.playlistNameLength +
          " characters."
      };
    }

    const playlists = getPlaylists();

    const index = playlists.findIndex(function (playlist) {
      return playlist.id === id;
    });

    if (index === -1) {
      return {
        ok: false,
        error: "Playlist not found."
      };
    }

    playlists[index] = Object.assign({}, playlists[index], {
      name: cleanName,
      updatedAt: new Date().toISOString()
    });

    return write(KEYS.playlists, playlists, "playlists");
  }

  function deletePlaylist(playlistId) {
    const id = normalizeId(playlistId);

    if (!id) {
      return {
        ok: false,
        error: "A playlist ID is required."
      };
    }

    const playlists = getPlaylists().filter(function (playlist) {
      return playlist.id !== id;
    });

    return write(KEYS.playlists, playlists, "playlists");
  }

  /* -------------------------------------------------------
     PLAYER PREFERENCES
     ------------------------------------------------------- */

  function getVolume() {
    const value = read(KEYS.volume, 0.8);
    const number = Number(value);

    if (!Number.isFinite(number)) return 0.8;

    return Math.max(0, Math.min(1, number));
  }

  function setVolume(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return {
        ok: false,
        error: "Volume must be a valid number."
      };
    }

    return write(
      KEYS.volume,
      Math.max(0, Math.min(1, number)),
      "volume"
    );
  }

  function getQueue() {
    const value = read(KEYS.queue, []);

    return Array.isArray(value) ? uniqueTracks(value) : [];
  }

  function setQueue(tracks) {
    if (!Array.isArray(tracks)) {
      return {
        ok: false,
        error: "The playback queue must be an array."
      };
    }

    return write(
      KEYS.queue,
      uniqueTracks(tracks),
      "queue"
    );
  }

  /* -------------------------------------------------------
     EVENT SUBSCRIPTIONS
     ------------------------------------------------------- */

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return function () {};
    }

    listeners.add(listener);

    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  /* -------------------------------------------------------
     CLEAR LOCAL DATA
     ------------------------------------------------------- */

  function clearLocalData() {
    const storage = getStorage();

    if (!storage) {
      return {
        ok: false,
        error: "Local storage is unavailable."
      };
    }

    try {
      Object.keys(KEYS).forEach(function (name) {
        storage.removeItem(KEYS[name]);
      });

      emitChange("clear", null);

      return {
        ok: true
      };
    } catch (error) {
      return {
        ok: false,
        error: "Unable to clear local Resona data."
      };
    }
  }

  /* -------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------- */

  global.ResonaStorage = Object.freeze({

    isAvailable: isAvailable,

    preferences: Object.freeze({
      get: getPreferences,
      save: savePreferences,
      getValue: getPreference,
      setValue: setPreference
    }),

    favorites: Object.freeze({
      getAll: getFavorites,
      has: isFavorite,
      add: addFavorite,
      remove: removeFavorite,
      toggle: toggleFavorite
    }),

    history: Object.freeze({
      getAll: getHistory,
      add: addHistory,
      clear: clearHistory
    }),

    playlists: Object.freeze({
      getAll: getPlaylists,
      get: getPlaylist,
      create: createPlaylist,
      addTrack: addToPlaylist,
      removeTrack: removeFromPlaylist,
      rename: renamePlaylist,
      delete: deletePlaylist
    }),

    player: Object.freeze({
      getVolume: getVolume,
      setVolume: setVolume,
      getQueue: getQueue,
      setQueue: setQueue
    }),

    events: Object.freeze({
      subscribe: subscribe
    }),

    clearLocalData: clearLocalData

  });

  console.info("[Resona] Local storage module loaded.");

})(window);
