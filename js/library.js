/* =========================================================
   RESONA — MUSIC LIBRARY
   File: js/library.js
   Version: 2.0.0

   Features:
   - Like and unlike tracks
   - Save and remove tracks
   - Listening history and recently played tracks
   - Search across library collections
   - Create and manage playlists
   - Playlist tracks retained independently of other collections
   - Import and export library data
   - Persistent localStorage support
   - ResonaUtils and ResonaState compatibility
   - Event subscriptions
   - Storage and import validation

   Public API:
   window.ResonaLibrary

   Compatibility:
   Existing storage keys and public method names are preserved.
   ========================================================= */

(function (window, document) {
  "use strict";

  if (window.ResonaLibrary) {
    console.warn("[Resona Library] Already initialized.");
    return;
  }

  const LIBRARY_VERSION = 2;
  const MAX_HISTORY = 500;
  const MAX_SAVED_TRACKS = 2000;
  const MAX_PLAYLISTS = 500;
  const MAX_PLAYLIST_TRACKS = 5000;
  const MAX_PLAYLIST_NAME = 80;
  const MAX_DESCRIPTION = 1000;

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

  /*
   * Independent track cache.
   *
   * This allows a playlist to retain its track information even
   * when that track is removed from liked music, saved music,
   * or listening history.
   *
   * Existing playlist records are migrated when possible.
   */
  let trackCache = new Map();

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
      Math.random().toString(36).slice(2, 12)
    );
  }

  function clone(value) {
    if (value === undefined || value === null) {
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

  function isPlainObject(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return (
      prototype === Object.prototype ||
      prototype === null
    );
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

    const normalized = Object.assign({}, clone(track), {
      id: id
    });

    /*
     * Remove legacy ID aliases from the normalized identity only
     * when they are empty. Keep meaningful original metadata.
     */
    return normalized;
  }

  function normalizeDate(value, fallback) {
    if (value !== undefined && value !== null && value !== "") {
      const parsed = new Date(value);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return fallback || new Date().toISOString();
  }

  function getStorageKey(name) {
    try {
      const config = window.ResonaConfig;

      if (
        config &&
        config.storage &&
        config.storage.keys &&
        config.storage.keys[name]
      ) {
        return config.storage.keys[name];
      }

      if (
        config &&
        typeof config.storagePrefix === "string" &&
        config.storagePrefix
      ) {
        return config.storagePrefix + name;
      }
    } catch (_) {
      // Continue using the original default keys.
    }

    return STORAGE_KEYS[name] || ("resona_" + name);
  }

  function emit(eventName, detail) {
    const payload = {
      type: eventName,
      detail: detail === undefined ? null : detail,
      timestamp: new Date().toISOString()
    };

    const callbacks = listeners.get(eventName);

    if (callbacks) {
      Array.from(callbacks).forEach(function (callback) {
        try {
          callback(payload.detail, payload);
        } catch (error) {
          console.error(
            "[Resona Library] Event listener failed:",
            error
          );
        }
      });
    }

    try {
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(
          new window.CustomEvent(
            "resona:library:" + eventName,
            {
              detail: payload
            }
          )
        );
      }
    } catch (_) {
      // Custom events are optional.
    }
  }

  function readStorage(name, fallback) {
    const defaultValue =
      fallback === undefined ? [] : fallback;

    const key = getStorageKey(name);

    /*
     * Try the project's shared storage utility first.
     */
    try {
      if (
        window.ResonaUtils &&
        typeof window.ResonaUtils.readStorage === "function"
      ) {
        const result = window.ResonaUtils.readStorage(
          key,
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

    /*
     * Fall back to localStorage.
     */
    try {
      const raw = window.localStorage.getItem(key);

      if (raw === null || raw === "") {
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
    const key = getStorageKey(name);

    /*
     * Try the shared storage utility first.
     */
    try {
      if (
        window.ResonaUtils &&
        typeof window.ResonaUtils.writeStorage === "function"
      ) {
        const result = window.ResonaUtils.writeStorage(
          key,
          value
        );

        if (result !== false) {
          return true;
        }

        console.warn(
          "[Resona Library] Storage utility reported failure:",
          name
        );
      }
    } catch (error) {
      console.warn(
        "[Resona Library] Utility storage write failed:",
        error
      );
    }

    /*
     * Fall back to localStorage.
     */
    try {
      window.localStorage.setItem(
        key,
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
        message: "Could not save library data.",
        reason: error && error.name
          ? error.name
          : "StorageError"
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

    items.forEach(function (item) {
      const track = normalizeTrack(item);

      if (!track || seen.has(track.id)) {
        return;
      }

      seen.add(track.id);
      result.push(track);
    });

    return result;
  }

  function normalizeTrackIds(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const result = [];
    const seen = new Set();

    values.forEach(function (value) {
      const id =
        value && typeof value === "object"
          ? getTrackId(value)
          : normalizeId(value);

      if (!id || seen.has(id)) {
        return;
      }

      seen.add(id);
      result.push(id);

      if (result.length >= MAX_PLAYLIST_TRACKS) {
        return;
      }
    });

    return result.slice(0, MAX_PLAYLIST_TRACKS);
  }

  function normalizePlaylist(playlist) {
    if (!playlist || typeof playlist !== "object") {
      return null;
    }

    const name = String(playlist.name || "").trim();

    if (!name) {
      return null;
    }

    const now = new Date().toISOString();

    return {
      id: normalizeId(playlist.id) || createId("playlist"),
      name: name.slice(0, MAX_PLAYLIST_NAME),
      description: String(
        playlist.description || ""
      ).trim().slice(0, MAX_DESCRIPTION),
      trackIds: normalizeTrackIds(
        playlist.trackIds || playlist.track_ids || []
      ),
      createdAt: normalizeDate(
        playlist.createdAt || playlist.created_at,
        now
      ),
      updatedAt: normalizeDate(
        playlist.updatedAt || playlist.updated_at,
        now
      )
    };
  }

  function normalizePlaylists(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    const result = [];
    const seenIds = new Set();
    const seenNames = new Set();

    items.forEach(function (item) {
      if (result.length >= MAX_PLAYLISTS) {
        return;
      }

      const playlist = normalizePlaylist(item);

      if (!playlist) {
        return;
      }

      let id = playlist.id;

      if (seenIds.has(id)) {
        id = createId("playlist");
        playlist.id = id;
      }

      const normalizedName = playlist.name.toLowerCase();

      if (seenNames.has(normalizedName)) {
        return;
      }

      seenIds.add(id);
      seenNames.add(normalizedName);
      result.push(playlist);
    });

    return result;
  }

  function normalizeHistory(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    const result = [];
    const seen = new Set();

    items.forEach(function (entry) {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const track = normalizeTrack(entry.track || entry);

      if (!track) {
        return;
      }

      /*
       * Keep only the newest history entry for each track.
       */
      if (seen.has(track.id)) {
        return;
      }

      seen.add(track.id);

      result.push({
        track: track,
        playedAt: normalizeDate(
          entry.playedAt ||
          entry.played_at ||
          entry.timestamp
        )
      });
    });

    return result.slice(0, MAX_HISTORY);
  }

  function syncState() {
    if (!window.ResonaState) {
      return;
    }

    try {
      window.ResonaState.likedTracks = clone(likedTracks);
      window.ResonaState.savedTracks = clone(savedTracks);
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

        window.ResonaState.library.playlists =
          clone(playlists);
      }
    } catch (error) {
      console.warn(
        "[Resona Library] Could not synchronize application state:",
        error
      );
    }
  }

  function persistAll() {
    const results = [
      writeStorage("liked", likedTracks),
      writeStorage("saved", savedTracks),
      writeStorage("history", history),
      writeStorage("playlists", playlists),
      writeStorage("trackCache", Array.from(trackCache.values())),
      writeStorage("version", LIBRARY_VERSION)
    ];

    syncState();

    const success = results.every(Boolean);

    if (!success) {
      emit("storage:partial-failure", {
        message:
          "Some library data could not be saved. Check available browser storage."
      });
    }

    return success;
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

  function rememberTrack(track) {
    const normalized = normalizeTrack(track);

    if (!normalized) {
      return null;
    }

    trackCache.set(normalized.id, normalized);

    return normalized;
  }

  function rememberTracks(items) {
    items.forEach(function (track) {
      rememberTrack(track);
    });
  }

  function getTrackFromCollections(trackId) {
    const id = normalizeId(trackId);

    if (!id) {
      return null;
    }

    const cached = trackCache.get(id);

    if (cached) {
      return clone(cached);
    }

    const liked = likedTracks.find(function (track) {
      return track.id === id;
    });

    if (liked) {
      return clone(liked);
    }

    const saved = savedTracks.find(function (track) {
      return track.id === id;
    });

    if (saved) {
      return clone(saved);
    }

    const entry = history.find(function (item) {
      return getTrackId(item.track) === id;
    });

    if (entry) {
      return clone(entry.track);
    }

    return null;
  }

  function normalizeTrackOrId(trackOrId) {
    if (trackOrId && typeof trackOrId === "object") {
      return getTrackId(trackOrId);
    }

    return normalizeId(trackOrId);
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  function init() {
    if (initialized) {
      return getSummary();
    }

    const storedVersion = Number(
      readStorage("version", 0)
    ) || 0;

    if (storedVersion > LIBRARY_VERSION) {
      console.warn(
        "[Resona Library] Stored data comes from a newer library version."
      );
    }

    likedTracks = normalizeTrackList(
      readStorage("liked", [])
    );

    savedTracks = normalizeTrackList(
      readStorage("saved", [])
    );

    history = normalizeHistory(
      readStorage("history", [])
    );

    playlists = normalizePlaylists(
      readStorage("playlists", [])
    );

    trackCache = new Map();

    const storedCache = readStorage("trackCache", []);

    if (Array.isArray(storedCache)) {
      storedCache.forEach(function (track) {
        rememberTrack(track);
      });
    }

    /*
     * Rebuild the cache from known tracks.
     */
    rememberTracks(likedTracks);
    rememberTracks(savedTracks);

    history.forEach(function (entry) {
      rememberTrack(entry.track);
    });

    /*
     * Migrate legacy playlists where possible.
     */
    playlists.forEach(function (playlist) {
      playlist.trackIds.forEach(function (trackId) {
        if (!trackCache.has(trackId)) {
          const track = getTrackFromCollections(trackId);

          if (track) {
            rememberTrack(track);
          }
        }
      });
    });

    initialized = true;

    /*
     * Save normalized data. Existing keys are preserved.
     */
    persistAll();

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

    rememberTrack(normalized);

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

    const trackId = normalizeTrackOrId(trackOrId);
    const index = findTrackIndex(likedTracks, trackId);

    if (index === -1) {
      return {
        success: false,
        liked: false,
        message: "Track was not found in liked music."
      };
    }

    const removed = likedTracks.splice(index, 1)[0];

    /*
     * Keep the track cached because playlists may still reference it.
     */
    rememberTrack(removed);

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

    return isLiked(normalized.id)
      ? unlikeTrack(normalized.id)
      : likeTrack(normalized);
  }

  function isLiked(trackOrId) {
    ensureInitialized();

    const id = normalizeTrackOrId(trackOrId);

    return findTrackIndex(likedTracks, id) !== -1;
  }

  function getLiked(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(likedTracks);

    if (settings.query) {
      result = filterTracks(result, settings.query);
    }

    if (settings.limit != null) {
      const limit = Math.max(
        0,
        Number(settings.limit) || 0
      );

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

    /*
     * Cache tracks before clearing so playlists keep their metadata.
     */
    rememberTracks(likedTracks);

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

    rememberTrack(normalized);

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

    const trackId = normalizeTrackOrId(trackOrId);
    const index = findTrackIndex(savedTracks, trackId);

    if (index === -1) {
      return {
        success: false,
        saved: false,
        message: "Track was not found in saved music."
      };
    }

    const removed = savedTracks.splice(index, 1)[0];

    rememberTrack(removed);

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

    return isSaved(normalized.id)
      ? unsaveTrack(normalized.id)
      : saveTrack(normalized);
  }

  function isSaved(trackOrId) {
    ensureInitialized();

    const id = normalizeTrackOrId(trackOrId);

    return findTrackIndex(savedTracks, id) !== -1;
  }

  function getSaved(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(savedTracks);

    if (settings.query) {
      result = filterTracks(result, settings.query);
    }

    if (settings.limit != null) {
      const limit = Math.max(
        0,
        Number(settings.limit) || 0
      );

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

    rememberTracks(savedTracks);

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

    const playedAt = normalizeDate(
      settings.playedAt || settings.played_at
    );

    rememberTrack(normalized);

    /*
     * Keep one most-recent entry per track.
     */
    history = history.filter(function (entry) {
      return getTrackId(entry.track) !== normalized.id;
    });

    history.unshift({
      track: normalized,
      playedAt: playedAt
    });

    history = history.slice(0, MAX_HISTORY);

    persistAll();

    emit("history:added", {
      track: clone(normalized),
      playedAt: playedAt,
      total: history.length
    });

    return {
      success: true,
      track: clone(normalized),
      playedAt: playedAt
    };
  }

  function getHistory(options) {
    ensureInitialized();

    const settings = options || {};
    let result = clone(history);

    if (settings.query) {
      const query = String(settings.query)
        .trim()
        .toLowerCase();

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
      const limit = Math.max(
        0,
        Number(settings.limit) || 0
      );

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

    rememberTracks(
      history.map(function (entry) {
        return entry.track;
      })
    );

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

    const trackId = normalizeTrackOrId(trackOrId);

    if (!trackId) {
      return {
        success: false,
        removedCount: 0
      };
    }

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

    const values = [
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
    ];

    const searchable = values
      .filter(function (value) {
        return value !== undefined && value !== null;
      })
      .map(function (value) {
        if (Array.isArray(value)) {
          return value.join(" ");
        }

        if (typeof value === "object") {
          return "";
        }

        return String(value);
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

    const normalizedSearch = normalizedQuery.toLowerCase();

    const liked = filterTracks(
      clone(likedTracks),
      normalizedSearch
    );

    const saved = filterTracks(
      clone(savedTracks),
      normalizedSearch
    );

    const historyResults = history.filter(function (entry) {
      return matchesTrack(
        entry.track,
        normalizedSearch
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
      cachedTrackCount: trackCache.size,
      initialized: initialized
    };
  }

  /* =========================================================
     PLAYLISTS
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

    if (playlistName.length > MAX_PLAYLIST_NAME) {
      return {
        success: false,
        message:
          "Playlist names must be 80 characters or fewer."
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
        message:
          "A playlist with that name already exists."
      };
    }

    if (playlists.length >= MAX_PLAYLISTS) {
      return {
        success: false,
        message: "Your playlist limit has been reached."
      };
    }

    const settings = options || {};
    const now = new Date().toISOString();

    const playlist = {
      id: createId("playlist"),
      name: playlistName,
      description: String(
        settings.description || ""
      ).trim().slice(0, MAX_DESCRIPTION),
      trackIds: [],
      createdAt: now,
      updatedAt: now
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

    const isTrackObject =
      trackOrId &&
      typeof trackOrId === "object";

    const trackId = isTrackObject
      ? getTrackId(trackOrId)
      : normalizeId(trackOrId);

    if (!trackId) {
      return {
        success: false,
        message: "A valid track ID is required."
      };
    }

    if (
      isTrackObject &&
      normalizeTrack(trackOrId)
    ) {
      rememberTrack(trackOrId);
    }

    if (playlist.trackIds.includes(trackId)) {
      return {
        success: false,
        message: "Track is already in this playlist."
      };
    }

    if (
      playlist.trackIds.length >= MAX_PLAYLIST_TRACKS
    ) {
      return {
        success: false,
        message: "This playlist has reached its track limit."
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

    const trackId = normalizeTrackOrId(trackOrId);
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

  function renamePlaylist(playlistId, newName) {
    ensureInitialized();

    const id = normalizeId(playlistId);
    const name = String(newName || "").trim();

    const playlist = playlists.find(function (item) {
      return item.id === id;
    });

    if (!playlist) {
      return {
        success: false,
        message: "Playlist not found."
      };
    }

    if (!name || name.length > MAX_PLAYLIST_NAME) {
      return {
        success: false,
        message:
          "Enter a playlist name of 1–80 characters."
      };
    }

    const duplicate = playlists.some(function (item) {
      return (
        item.id !== id &&
        item.name.toLowerCase() === name.toLowerCase()
      );
    });

    if (duplicate) {
      return {
        success: false,
        message:
          "A playlist with that name already exists."
      };
    }

    const previousName = playlist.name;

    playlist.name = name;
    playlist.updatedAt = new Date().toISOString();

    persistAll();

    emit("playlist:renamed", {
      playlistId: id,
      previousName: previousName,
      name: name
    });

    return {
      success: true,
      playlist: clone(playlist)
    };
  }

  function updatePlaylist(playlistId, updates) {
    ensureInitialized();

    const id = normalizeId(playlistId);
    const values = updates || {};

    const playlist = playlists.find(function (item) {
      return item.id === id;
    });

    if (!playlist) {
      return {
        success: false,
        message: "Playlist not found."
      };
    }

    if (values.name !== undefined) {
      const name = String(values.name || "").trim();

      if (!name || name.length > MAX_PLAYLIST_NAME) {
        return {
          success: false,
          message:
            "Enter a playlist name of 1–80 characters."
        };
      }

      const duplicate = playlists.some(function (item) {
        return (
          item.id !== id &&
          item.name.toLowerCase() === name.toLowerCase()
        );
      });

      if (duplicate) {
        return {
          success: false,
          message:
            "A playlist with that name already exists."
        };
      }

      playlist.name = name;
    }

    if (values.description !== undefined) {
      playlist.description = String(
        values.description || ""
      ).trim().slice(0, MAX_DESCRIPTION);
    }

    playlist.updatedAt = new Date().toISOString();

    persistAll();

    emit("playlist:updated", {
      playlist: clone(playlist)
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

    /*
     * Do not delete cached tracks here. Another playlist may
     * reference the same track.
     */

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

    playlist.trackIds.forEach(function (trackId) {
      const track = getTrackFromCollections(trackId);

      if (track) {
        result.push(track);
      }
    });

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
      playlists: clone(playlists),
      trackCache: Array.from(trackCache.values()).map(
        function (track) {
          return clone(track);
        }
      )
    };
  }

  function importLibrary(data, options) {
    ensureInitialized();

    if (!data || typeof data !== "object" || Array.isArray(data)) {
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
        message:
          "This file is not a Resona music library."
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

    const importedHistory = normalizeHistory(
      data.history || []
    );

    const importedPlaylists = normalizePlaylists(
      data.playlists || []
    );

    const importedCache = normalizeTrackList(
      data.trackCache || []
    );

    /*
     * Work with temporary collections first. If validation fails,
     * existing library data is not partially replaced.
     */
    let nextLiked;
    let nextSaved;
    let nextHistory;
    let nextPlaylists;
    let nextCache;

    if (merge) {
      nextLiked = mergeTracks(
        likedTracks,
        importedLiked,
        MAX_SAVED_TRACKS
      );

      nextSaved = mergeTracks(
        savedTracks,
        importedSaved,
        MAX_SAVED_TRACKS
      );

      nextHistory = mergeHistory(
        history,
        importedHistory
      );

      nextPlaylists = mergePlaylists(
        playlists,
        importedPlaylists
      );

      nextCache = mergeTracks(
        Array.from(trackCache.values()),
        importedCache.concat(
          importedLiked,
          importedSaved,
          importedHistory.map(function (entry) {
            return entry.track;
          })
        ),
        10000
      );
    } else {
      nextLiked = importedLiked.slice(
        0,
        MAX_SAVED_TRACKS
      );

      nextSaved = importedSaved.slice(
        0,
        MAX_SAVED_TRACKS
      );

      nextHistory = importedHistory.slice(
        0,
        MAX_HISTORY
      );

      nextPlaylists = importedPlaylists.slice(
        0,
        MAX_PLAYLISTS
      );

      nextCache = mergeTracks(
        importedCache.concat(
          importedLiked,
          importedSaved,
          importedHistory.map(function (entry) {
            return entry.track;
          })
        ),
        [],
        10000
      );
    }

    likedTracks = nextLiked;
    savedTracks = nextSaved;
    history = nextHistory;
    playlists = nextPlaylists;

    trackCache = new Map();

    nextCache.forEach(function (track) {
      rememberTrack(track);
    });

    /*
     * Ensure every track referenced by a collection is cached.
     */
    rememberTracks(likedTracks);
    rememberTracks(savedTracks);

    history.forEach(function (entry) {
      rememberTrack(entry.track);
    });

    persistAll();

    emit("imported", getSummary());

    return {
      success: true,
      summary: getSummary(),
      message: "Library imported successfully."
    };
  }

  function mergeTracks(existing, incoming, limit) {
    const map = new Map();

    existing.concat(incoming).forEach(function (item) {
      const track = normalizeTrack(item);

      if (track) {
        /*
         * Incoming data updates the existing track metadata.
         */
        map.set(track.id, track);
      }
    });

    return Array.from(map.values()).slice(
      0,
      limit || MAX_SAVED_TRACKS
    );
  }

  function mergeHistory(existing, incoming) {
    const map = new Map();

    existing.concat(incoming).forEach(function (entry) {
      if (!entry || !entry.track) {
        return;
      }

      const track = normalizeTrack(entry.track);

      if (!track) {
        return;
      }

      const playedAt = normalizeDate(entry.playedAt);
      const previous = map.get(track.id);

      if (
        !previous ||
        new Date(playedAt).getTime() >
          new Date(previous.playedAt).getTime()
      ) {
        map.set(track.id, {
          track: track,
          playedAt: playedAt
        });
      }
    });

    return Array.from(map.values())
      .sort(function (a, b) {
        return (
          new Date(b.playedAt).getTime() -
          new Date(a.playedAt).getTime()
        );
      })
      .slice(0, MAX_HISTORY);
  }

  function mergePlaylists(existing, incoming) {
    const map = new Map();

    existing.concat(incoming).forEach(function (item) {
      const playlist = normalizePlaylist(item);

      if (!playlist) {
        return;
      }

      /*
       * Copy all data into a new object. Never mutate the imported
       * object supplied by the caller.
       */
      map.set(playlist.id, playlist);
    });

    return normalizePlaylists(
      Array.from(map.values())
    ).slice(0, MAX_PLAYLISTS);
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
    version: LIBRARY_VERSION,

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
    getPlaylistTracks: getPlaylistTracks,
    renamePlaylist: renamePlaylist,
    updatePlaylist: updatePlaylist,
    deletePlaylist: deletePlaylist,

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

  /*
   * Initialize when the script loads.
   */
  init();

})(window, document);
