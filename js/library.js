/* =========================================================
   RESONA — MUSIC LIBRARY
   File: js/library.js

   Features:
   - Like and unlike tracks
   - Save and remove tracks
   - Listening history
   - Recently played tracks
   - Search within the library
   - Import and export library data
   - Clear history and library events
   - Persistent storage with localStorage
   - Works with ResonaUtils and ResonaState when available

   Public API:
   window.ResonaLibrary
   ========================================================= */

(function (window, document) {
  "use strict";

  if (window.ResonaLibrary) {
    console.warn("[Resona Library] Already initialized.");
    return;
  }

  const LIBRARY_VERSION = 1;
  const MAX_HISTORY = 500;
  const MAX_SAVED_TRACKS = 2000;

  const STORAGE_KEYS = {
    liked: "resona_liked_tracks",
    saved: "resona_saved_tracks",
    history: "resona_history",
    playlists: "resona_library_playlists",
    version: "resona_library_version"
  };

  const listeners = new Map();

  let initialized = false;
  let likedTracks = [];
  let savedTracks = [];
  let history = [];
  let playlists = [];

  /* =========================================================
     UTILITIES
     ========================================================= */

  function createId(prefix) {
    const safePrefix = prefix || "resona";

    if (
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
    ) {
      return safePrefix + "_" + window.crypto.randomUUID();
    }

    return (
      safePrefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function clone(value) {
    if (value == null) {
      return value;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function normalizeId(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function getTrackId(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    return normalizeId(
      track.id ||
      track.track_id ||
      track.trackId ||
      track.uuid ||
      track.slug
    );
  }

  function normalizeTrack(track) {
    if (!track || typeof track !== "object") {
      return null;
    }

    const id = getTrackId(track);

    if (!id) {
      return null;
    }

    return Object.assign({}, clone(track), {
      id: id
    });
  }

  function getStorageKey(name) {
    try {
      if (
        window.ResonaConfig &&
        window.ResonaConfig.storage &&
        window.ResonaConfig.storage.keys &&
        window.ResonaConfig.storage.keys[name]
      ) {
        return window.ResonaConfig.storage.keys[name];
      }

      if (
        window.ResonaConfig &&
        window.ResonaConfig.storagePrefix
      ) {
        return window.ResonaConfig.storagePrefix + name;
      }
    } catch (_) {
      // Fall back to the default key.
    }

    return STORAGE_KEYS[name] || ("resona_" + name);
  }

  function readStorage(name, fallback) {
    const defaultValue =
      fallback === undefined ? [] : fallback;

    try {
      if (
        window.ResonaUtils &&
        typeof window.ResonaUtils.readStorage === "function"
      ) {
        const result = window.ResonaUtils.readStorage(
          getStorageKey(name),
          defaultValue
        );

        if (result !== undefined && result !== null) {
          return result;
        }
      }
    } catch (error) {
      console.warn(
        "[Resona Library] Utility storage read failed:",
        error
      );
    }

    try {
      const raw = window.localStorage.getItem(
        getStorageKey(name)
      );

      if (!raw) {
        return defaultValue;
      }

      return JSON.parse(raw);
    } catch (error) {
      console.warn(
        "[Resona Library] Could not read storage:",
        name,
        error
      );

      return defaultValue;
    }
  }

  function writeStorage(name, value) {
    try {
      if (
        window.ResonaUtils &&
        typeof window.ResonaUtils.writeStorage === "function"
      ) {
        const result = window.ResonaUtils.writeStorage(
          getStorageKey(name),
          value
        );

        if (result === false) {
          throw new Error("Storage utility reported failure.");
        }

        return true;
      }
    } catch (error) {
      console.warn(
        "[Resona Library] Utility storage write failed:",
        error
      );
    }

    try {
      window.localStorage.setItem(
        getStorageKey(name),
        JSON.stringify(value)
      );

      return true;
    } catch (error) {
      console.error(
        "[Resona Library] Could not save storage:",
        name,
        error
      );

      emit("storage:error", {
        key: name,
        message: "Could not save library data."
      });

      return false;
    }
  }

  function normalizeTrackList(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    const result = [];
    const seen = new Set();

    for (const item of items) {
      const track = normalizeTrack(item);

      if (!track || seen.has(track.id)) {
        continue;
      }

      seen.add(track.id);
      result.push(track);
    }

    return result;
  }

  function syncState() {
    if (!window.ResonaState) {
      return;
    }

    try {
      window.ResonaState.likedTracks = clone(likedTracks);
      window.ResonaState.history = clone(history);

      if (
        window.ResonaState.library &&
        typeof window.ResonaState.library === "object"
      ) {
        window.ResonaState.library.likedTracks =
          clone(likedTracks);

        window.ResonaState.library.savedTracks =
          clone(savedTracks);

        window.ResonaState.library.history =
          clone(history);
      }
    } catch (error) {
      console.warn(
        "[Resona Library] Could not synchronize application state:",
        error
      );
    }
  }

  function emit(eventName, detail) {
    const payload = {
      type: eventName,
      detail: detail === undefined ? null : detail,
      timestamp: new Date().toISOString()
    };

    const callbacks = listeners.get(eventName);

    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload.detail, payload);
        } catch (error) {
          console.error(
            "[Resona Library] Event listener failed:",
            error
          );
        }
      }
    }

    try {
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("resona:library:" + eventName, {
            detail: payload
          })
        );
      }
    } catch (_) {
      // Event dispatch is optional.
    }
  }

  function persistAll() {
    const likedSaved = writeStorage("liked", likedTracks);
    const savedSaved = writeStorage("saved", savedTracks);
    const historySaved = writeStorage("history", history);
    const playlistsSaved = writeStorage("playlists", playlists);

    syncState();

    return (
      likedSaved &&
      savedSaved &&
      historySaved &&
      playlistsSaved
    );
  }

  function findTrackIndex(collection, trackId) {
    const id = normalizeId(trackId);

    if (!id) {
      return -1;
    }

    return collection.findIndex(function (track) {
      return getTrackId(track) === id;
    });
  }

  function removeTrackFromCollection(collection, trackId) {
    const index = findTrackIndex(collection, trackId);

    if (index === -1) {
      return false;
    }

    collection.splice(index, 1);
    return true;
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  function init() {
    if (initialized) {
      return getSummary();
    }

    const storedVersion = readStorage("version", 0);

    if (
      storedVersion &&
      Number(storedVersion) > LIBRARY_VERSION
    ) {
      console.warn(
        "[Resona Library] Stored library data comes from a newer version."
      );
    }

    likedTracks = normalizeTrackList(
      readStorage("liked", [])
    );

    savedTracks = normalizeTrackList(
      readStorage("saved", [])
    );

    const storedHistory = readStorage("history", []);

    history = Array.isArray(storedHistory)
      ? storedHistory
          .filter(function (entry) {
            return (
              entry &&
              typeof entry === "object" &&
              getTrackId(entry.track || entry)
            );
          })
          .map(function (entry) {
            const track = normalizeTrack(entry.track || entry);

            return {
              track: track,
              playedAt:
                entry.playedAt ||
                entry.played_at ||
                entry.timestamp ||
                new Date().toISOString()
            };
          })
          .slice(0, MAX_HISTORY)
      : [];

    const storedPlaylists = readStorage("playlists", []);

    playlists = Array.isArray(storedPlaylists)
      ? storedPlaylists.filter(function (playlist) {
          return (
            playlist &&
            typeof playlist === "object" &&
            typeof playlist.id === "string" &&
            typeof playlist.name === "string"
          );
        })
      : [];

    initialized = true;

    writeStorage("version", LIBRARY_VERSION);
    syncState();

    emit("initialized", getSummary());

    return getSummary();
  }

  function ensureInitialized() {
    if (!initialized) {
      init();
    }
  }

  /* =========================================================
     LIKED TRACKS
     ========================================================= */

  function likeTrack(track) {
    ensureInitialized();

    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        success: false,
        liked: false,
        message: "A valid track with an ID is required."
      };
    }

    const existingIndex = findTrackIndex(
      likedTracks,
      normalized.id
    );

    if (existingIndex !== -1) {
      likedTracks[existingIndex] = Object.assign(
        {},
        likedTracks[existingIndex],
        normalized
      );

      persistAll();

      return {
        success: true,
        liked: true,
        track: clone(likedTracks[existingIndex]),
        message: "Track is already liked."
      };
    }

    if (likedTracks.length >= MAX_SAVED_TRACKS) {
      return {
        success: false,
        liked: false,
        message: "Your liked tracks limit has been reached."
      };
    }

    likedTracks.unshift(normalized);

    persistAll();

    emit("track:liked", {
      track: clone(normalized),
      total: likedTracks.length
    });

    return {
      success: true,
      liked: true,
      track: clone(normalized),
      message: "Track added to liked music."
    };
  }

  function unlikeTrack(trackOrId) {
    ensureInitialized();

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    const index = findTrackIndex(likedTracks, trackId);

    if (index === -1) {
      return {
        success: false,
        liked: false,
        message: "Track was not found in liked music."
      };
    }

    const removed = likedTracks.splice(index, 1)[0];

    persistAll();

    emit("track:unliked", {
      track: clone(removed),
      total: likedTracks.length
    });

    return {
      success: true,
      liked: false,
      track: clone(removed),
      message: "Track removed from liked music."
    };
  }

  function toggleLike(track) {
    ensureInitialized();

    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        success: false,
        liked: false,
        message: "A valid track with an ID is required."
      };
    }

    if (isLiked(normalized.id)) {
      return unlikeTrack(normalized.id);
    }

    return likeTrack(normalized);
  }

  function isLiked(trackOrId) {
    ensureInitialized();

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    return findTrackIndex(likedTracks, trackId) !== -1;
  }

  function getLiked(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(likedTracks);

    if (settings.query) {
      result = filterTracks(result, settings.query);
    }

    if (settings.limit != null) {
      const limit = Math.max(0, Number(settings.limit) || 0);
      result = result.slice(0, limit);
    }

    return result;
  }

  function getLikedCount() {
    ensureInitialized();
    return likedTracks.length;
  }

  function clearLiked() {
    ensureInitialized();

    const previousCount = likedTracks.length;

    likedTracks = [];

    persistAll();

    emit("liked:cleared", {
      removedCount: previousCount
    });

    return {
      success: true,
      removedCount: previousCount
    };
  }

  /* =========================================================
     SAVED TRACKS
     ========================================================= */

  function saveTrack(track) {
    ensureInitialized();

    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        success: false,
        saved: false,
        message: "A valid track with an ID is required."
      };
    }

    const existingIndex = findTrackIndex(
      savedTracks,
      normalized.id
    );

    if (existingIndex !== -1) {
      savedTracks[existingIndex] = Object.assign(
        {},
        savedTracks[existingIndex],
        normalized
      );

      persistAll();

      return {
        success: true,
        saved: true,
        track: clone(savedTracks[existingIndex]),
        message: "Track is already saved."
      };
    }

    if (savedTracks.length >= MAX_SAVED_TRACKS) {
      return {
        success: false,
        saved: false,
        message: "Your saved tracks limit has been reached."
      };
    }

    savedTracks.unshift(normalized);

    persistAll();

    emit("track:saved", {
      track: clone(normalized),
      total: savedTracks.length
    });

    return {
      success: true,
      saved: true,
      track: clone(normalized),
      message: "Track saved to your library."
    };
  }

  function unsaveTrack(trackOrId) {
    ensureInitialized();

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    const index = findTrackIndex(savedTracks, trackId);

    if (index === -1) {
      return {
        success: false,
        saved: false,
        message: "Track was not found in saved music."
      };
    }

    const removed = savedTracks.splice(index, 1)[0];

    persistAll();

    emit("track:unsaved", {
      track: clone(removed),
      total: savedTracks.length
    });

    return {
      success: true,
      saved: false,
      track: clone(removed),
      message: "Track removed from saved music."
    };
  }

  function toggleSaved(track) {
    ensureInitialized();

    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        success: false,
        saved: false,
        message: "A valid track with an ID is required."
      };
    }

    if (isSaved(normalized.id)) {
      return unsaveTrack(normalized.id);
    }

    return saveTrack(normalized);
  }

  function isSaved(trackOrId) {
    ensureInitialized();

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    return findTrackIndex(savedTracks, trackId) !== -1;
  }

  function getSaved(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(savedTracks);

    if (settings.query) {
      result = filterTracks(result, settings.query);
    }

    if (settings.limit != null) {
      const limit = Math.max(0, Number(settings.limit) || 0);
      result = result.slice(0, limit);
    }

    return result;
  }

  function getSavedCount() {
    ensureInitialized();
    return savedTracks.length;
  }

  function clearSaved() {
    ensureInitialized();

    const previousCount = savedTracks.length;

    savedTracks = [];

    persistAll();

    emit("saved:cleared", {
      removedCount: previousCount
    });

    return {
      success: true,
      removedCount: previousCount
    };
  }

  /* =========================================================
     LISTENING HISTORY
     ========================================================= */

  function addHistory(track, options) {
    ensureInitialized();

    const normalized = normalizeTrack(track);

    if (!normalized) {
      return {
        success: false,
        message: "A valid track with an ID is required."
      };
    }

    const settings = options || {};
    const now = settings.playedAt || new Date().toISOString();

    history = history.filter(function (entry) {
      return getTrackId(entry.track) !== normalized.id;
    });

    history.unshift({
      track: normalized,
      playedAt: now
    });

    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    persistAll();

    emit("history:added", {
      track: clone(normalized),
      playedAt: now,
      total: history.length
    });

    return {
      success: true,
      track: clone(normalized),
      playedAt: now
    };
  }

  function getHistory(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(history);

    if (settings.query) {
      const query = String(settings.query).trim().toLowerCase();

      result = result.filter(function (entry) {
        return matchesTrack(entry.track, query);
      });
    }

    if (settings.tracksOnly === true) {
      result = result.map(function (entry) {
        return entry.track;
      });
    }

    if (settings.limit != null) {
      const limit = Math.max(0, Number(settings.limit) || 0);
      result = result.slice(0, limit);
    }

    return result;
  }

  function getRecentlyPlayed(limit) {
    ensureInitialized();

    const count =
      limit == null
        ? 20
        : Math.max(0, Number(limit) || 0);

    return history
      .slice(0, count)
      .map(function (entry) {
        return clone(entry.track);
      });
  }

  function clearHistory() {
    ensureInitialized();

    const previousCount = history.length;

    history = [];

    persistAll();

    emit("history:cleared", {
      removedCount: previousCount
    });

    return {
      success: true,
      removedCount: previousCount
    };
  }

  function removeFromHistory(trackOrId) {
    ensureInitialized();

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    const previousCount = history.length;

    history = history.filter(function (entry) {
      return getTrackId(entry.track) !== trackId;
    });

    const removedCount = previousCount - history.length;

    if (removedCount > 0) {
      persistAll();

      emit("history:removed", {
        trackId: trackId,
        removedCount: removedCount
      });
    }

    return {
      success: removedCount > 0,
      removedCount: removedCount
    };
  }

  /* =========================================================
     LIBRARY SEARCH AND SUMMARY
     ========================================================= */

  function matchesTrack(track, query) {
    if (!track || !query) {
      return false;
    }

    const searchable = [
      track.title,
      track.name,
      track.artist,
      track.artistName,
      track.artist_name,
      track.album,
      track.albumTitle,
      track.album_name,
      track.genre,
      track.mood,
      track.language,
      track.country
    ]
      .filter(function (value) {
        return value !== undefined && value !== null;
      })
      .map(function (value) {
        return Array.isArray(value)
          ? value.join(" ")
          : String(value);
      })
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  }

  function filterTracks(tracks, query) {
    const normalizedQuery = String(query || "")
      .trim()
      .toLowerCase();

    if (!normalizedQuery) {
      return tracks;
    }

    return tracks.filter(function (track) {
      return matchesTrack(track, normalizedQuery);
    });
  }

  function searchLibrary(query, options) {
    ensureInitialized();

    const settings = options || {};
    const normalizedQuery = String(query || "").trim();

    if (!normalizedQuery) {
      return {
        query: "",
        liked: [],
        saved: [],
        history: [],
        total: 0
      };
    }

    const liked = filterTracks(
      clone(likedTracks),
      normalizedQuery.toLowerCase()
    );

    const saved = filterTracks(
      clone(savedTracks),
      normalizedQuery.toLowerCase()
    );

    const historyResults = history.filter(function (entry) {
      return matchesTrack(
        entry.track,
        normalizedQuery.toLowerCase()
      );
    });

    const result = {
      query: normalizedQuery,
      liked: liked,
      saved: saved,
      history: clone(historyResults),
      total:
        liked.length +
        saved.length +
        historyResults.length
    };

    if (settings.section === "liked") {
      result.saved = [];
      result.history = [];
      result.total = result.liked.length;
    } else if (settings.section === "saved") {
      result.liked = [];
      result.history = [];
      result.total = result.saved.length;
    } else if (settings.section === "history") {
      result.liked = [];
      result.saved = [];
      result.total = result.history.length;
    }

    return result;
  }

  function getSummary() {
    ensureInitialized();

    return {
      version: LIBRARY_VERSION,
      likedCount: likedTracks.length,
      savedCount: savedTracks.length,
      historyCount: history.length,
      playlistCount: playlists.length,
      initialized: initialized
    };
  }

  /* =========================================================
     PLAYLISTS STORED IN THE LIBRARY
     ========================================================= */

  function createPlaylist(name, options) {
    ensureInitialized();

    const playlistName = String(name || "").trim();

    if (!playlistName) {
      return {
        success: false,
        message: "Enter a playlist name."
      };
    }

    if (playlistName.length > 80) {
      return {
        success: false,
        message: "Playlist names must be 80 characters or fewer."
      };
    }

    const duplicate = playlists.some(function (playlist) {
      return (
        playlist.name.toLowerCase() ===
        playlistName.toLowerCase()
      );
    });

    if (duplicate) {
      return {
        success: false,
        message: "A playlist with that name already exists."
      };
    }

    const settings = options || {};

    const playlist = {
      id: createId("playlist"),
      name: playlistName,
      description: String(settings.description || "").trim(),
      trackIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    playlists.unshift(playlist);

    persistAll();

    emit("playlist:created", {
      playlist: clone(playlist)
    });

    return {
      success: true,
      playlist: clone(playlist)
    };
  }

  function getPlaylists() {
    ensureInitialized();
    return clone(playlists);
  }

  function getPlaylist(playlistId) {
    ensureInitialized();

    const id = normalizeId(playlistId);

    const playlist = playlists.find(function (item) {
      return item.id === id;
    });

    return playlist ? clone(playlist) : null;
  }

  function addTrackToPlaylist(playlistId, trackOrId) {
    ensureInitialized();

    const id = normalizeId(playlistId);

    const playlist = playlists.find(function (item) {
      return item.id === id;
    });

    if (!playlist) {
      return {
        success: false,
        message: "Playlist not found."
      };
    }

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    if (!trackId) {
      return {
        success: false,
        message: "A valid track ID is required."
      };
    }

    if (playlist.trackIds.includes(trackId)) {
      return {
        success: false,
        message: "Track is already in this playlist."
      };
    }

    playlist.trackIds.push(trackId);
    playlist.updatedAt = new Date().toISOString();

    persistAll();

    emit("playlist:track-added", {
      playlistId: id,
      trackId: trackId
    });

    return {
      success: true,
      playlist: clone(playlist)
    };
  }

  function removeTrackFromPlaylist(playlistId, trackOrId) {
    ensureInitialized();

    const id = normalizeId(playlistId);

    const playlist = playlists.find(function (item) {
      return item.id === id;
    });

    if (!playlist) {
      return {
        success: false,
        message: "Playlist not found."
      };
    }

    const trackId =
      typeof trackOrId === "object"
        ? getTrackId(trackOrId)
        : normalizeId(trackOrId);

    const index = playlist.trackIds.indexOf(trackId);

    if (index === -1) {
      return {
        success: false,
        message: "Track is not in this playlist."
      };
    }

    playlist.trackIds.splice(index, 1);
    playlist.updatedAt = new Date().toISOString();

    persistAll();

    emit("playlist:track-removed", {
      playlistId: id,
      trackId: trackId
    });

    return {
      success: true,
      playlist: clone(playlist)
    };
  }

  function deletePlaylist(playlistId) {
    ensureInitialized();

    const id = normalizeId(playlistId);

    const index = playlists.findIndex(function (playlist) {
      return playlist.id === id;
    });

    if (index === -1) {
      return {
        success: false,
        message: "Playlist not found."
      };
    }

    const removed = playlists.splice(index, 1)[0];

    persistAll();

    emit("playlist:deleted", {
      playlist: clone(removed)
    });

    return {
      success: true,
      playlist: clone(removed)
    };
  }

  function getPlaylistTracks(playlistId) {
    ensureInitialized();

    const playlist = playlists.find(function (item) {
      return item.id === normalizeId(playlistId);
    });

    if (!playlist) {
      return [];
    }

    const result = [];

    for (const trackId of playlist.trackIds) {
      const liked = likedTracks.find(function (track) {
        return track.id === trackId;
      });

      const saved = savedTracks.find(function (track) {
        return track.id === trackId;
      });

      const historyEntry = history.find(function (entry) {
        return getTrackId(entry.track) === trackId;
      });

      const track =
        liked ||
        saved ||
        (historyEntry && historyEntry.track);

      if (track) {
        result.push(clone(track));
      }
    }

    return result;
  }

  /* =========================================================
     IMPORT AND EXPORT
     ========================================================= */

  function exportLibrary() {
    ensureInitialized();

    return {
      app: "Resona",
      type: "music-library",
      version: LIBRARY_VERSION,
      exportedAt: new Date().toISOString(),
      likedTracks: clone(likedTracks),
      savedTracks: clone(savedTracks),
      history: clone(history),
      playlists: clone(playlists)
    };
  }

  function importLibrary(data, options) {
    ensureInitialized();

    if (!data || typeof data !== "object") {
      return {
        success: false,
        message: "Invalid library data."
      };
    }

    if (
      data.type &&
      data.type !== "music-library"
    ) {
      return {
        success: false,
        message: "This file is not a Resona music library."
      };
    }

    const settings = options || {};
    const merge = settings.merge === true;

    const importedLiked = normalizeTrackList(
      data.likedTracks || data.liked || []
    );

    const importedSaved = normalizeTrackList(
      data.savedTracks || data.saved || []
    );

    const importedHistory = Array.isArray(data.history)
      ? data.history
          .map(function (entry) {
            const track = normalizeTrack(
              entry && (entry.track || entry)
            );

            if (!track) {
              return null;
            }

            return {
              track: track,
              playedAt:
                entry.playedAt ||
                entry.played_at ||
                entry.timestamp ||
                new Date().toISOString()
            };
          })
          .filter(Boolean)
      : [];

    const importedPlaylists = Array.isArray(data.playlists)
      ? data.playlists.filter(function (playlist) {
          return (
            playlist &&
            typeof playlist.name === "string" &&
            Array.isArray(playlist.trackIds)
          );
        })
      : [];

    if (merge) {
      const likedMap = new Map();

      likedTracks.concat(importedLiked).forEach(function (track) {
        likedMap.set(track.id, track);
      });

      const savedMap = new Map();

      savedTracks.concat(importedSaved).forEach(function (track) {
        savedMap.set(track.id, track);
      });

      likedTracks = Array.from(likedMap.values()).slice(
        0,
        MAX_SAVED_TRACKS
      );

      savedTracks = Array.from(savedMap.values()).slice(
        0,
        MAX_SAVED_TRACKS
      );

      const historyMap = new Map();

      history.concat(importedHistory).forEach(function (entry) {
        const id = getTrackId(entry.track);

        if (!id) {
          return;
        }

        const current = historyMap.get(id);

        if (
          !current ||
          String(entry.playedAt) > String(current.playedAt)
        ) {
          historyMap.set(id, entry);
        }
      });

      history = Array.from(historyMap.values())
        .sort(function (a, b) {
          return (
            new Date(b.playedAt).getTime() -
            new Date(a.playedAt).getTime()
          );
        })
        .slice(0, MAX_HISTORY);

      const playlistMap = new Map();

      playlists.concat(importedPlaylists).forEach(function (item) {
        if (!item.id) {
          item.id = createId("playlist");
        }

        playlistMap.set(item.id, {
          id: String(item.id),
          name: String(item.name),
          description: String(item.description || ""),
          trackIds: Array.from(
            new Set(
              item.trackIds.map(normalizeId).filter(Boolean)
            )
          ),
          createdAt:
            item.createdAt || new Date().toISOString(),
          updatedAt:
            item.updatedAt || new Date().toISOString()
        });
      });

      playlists = Array.from(playlistMap.values());
    } else {
      likedTracks = importedLiked.slice(0, MAX_SAVED_TRACKS);
      savedTracks = importedSaved.slice(0, MAX_SAVED_TRACKS);

      history = importedHistory.slice(0, MAX_HISTORY);

      playlists = importedPlaylists.map(function (item) {
        return {
          id: String(item.id || createId("playlist")),
          name: String(item.name),
          description: String(item.description || ""),
          trackIds: Array.from(
            new Set(
              item.trackIds.map(normalizeId).filter(Boolean)
            )
          ),
          createdAt:
            item.createdAt || new Date().toISOString(),
          updatedAt:
            item.updatedAt || new Date().toISOString()
        };
      });
    }

    persistAll();

    emit("imported", getSummary());

    return {
      success: true,
      summary: getSummary(),
      message: "Library imported successfully."
    };
  }

  /* =========================================================
     EVENT SUBSCRIPTIONS
     ========================================================= */

  function on(eventName, callback) {
    if (
      typeof eventName !== "string" ||
      typeof callback !== "function"
    ) {
      return function () {};
    }

    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }

    listeners.get(eventName).add(callback);

    return function unsubscribe() {
      off(eventName, callback);
    };
  }

  function off(eventName, callback) {
    const callbacks = listeners.get(eventName);

    if (!callbacks) {
      return false;
    }

    const removed = callbacks.delete(callback);

    if (callbacks.size === 0) {
      listeners.delete(eventName);
    }

    return removed;
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.ResonaLibrary = {
    init: init,

    // Liked tracks
    likeTrack: likeTrack,
    unlikeTrack: unlikeTrack,
    toggleLike: toggleLike,
    isLiked: isLiked,
    getLiked: getLiked,
    getLikedCount: getLikedCount,
    clearLiked: clearLiked,

    // Saved tracks
    saveTrack: saveTrack,
    unsaveTrack: unsaveTrack,
    toggleSaved: toggleSaved,
    isSaved: isSaved,
    getSaved: getSaved,
    getSavedCount: getSavedCount,
    clearSaved: clearSaved,

    // Listening history
    addHistory: addHistory,
    getHistory: getHistory,
    getRecentlyPlayed: getRecentlyPlayed,
    clearHistory: clearHistory,
    removeFromHistory: removeFromHistory,

    // Search and summary
    searchLibrary: searchLibrary,
    getSummary: getSummary,

    // Playlists
    createPlaylist: createPlaylist,
    getPlaylists: getPlaylists,
    getPlaylist: getPlaylist,
    addTrackToPlaylist: addTrackToPlaylist,
    removeTrackFromPlaylist: removeTrackFromPlaylist,
    deletePlaylist: deletePlaylist,
    getPlaylistTracks: getPlaylistTracks,

    // Backup and restore
    exportLibrary: exportLibrary,
    importLibrary: importLibrary,

    // Events
    on: on,
    off: off,

    // Compatibility helpers
    getLikedTracks: getLiked,
    getSavedTracks: getSaved,
    getListeningHistory: getHistory,
    addToHistory: addHistory,
    removeLikedTrack: unlikeTrack
  };

  // Initialize the module when the script loads.
  init();

})(window, document);
