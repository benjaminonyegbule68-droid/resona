/* =========================================================
   RESONA SHELL BRIDGE
   Connects the Resona application to shell.html.

   Architecture:
   shell.html owns the persistent audio engine.
   index.html owns the application interface.
   js/app.js owns internal SPA navigation.

   Software Version: 1.2.0
   Message Protocol: 1.0.0
========================================================= */

(function () {
  "use strict";

  if (window.ResonaShellBridge) return;

  /* =======================================================
     VERSIONING
  ======================================================= */

  const VERSION = "1.2.0";

  // Must match shell.html PROTOCOL_VERSION.
  const PROTOCOL_VERSION = "1.0.0";

  const MESSAGE_TIMEOUT = 7000;

  /* =======================================================
     ENVIRONMENT
  ======================================================= */

  let shellWindow = null;
  let isInsideShell = false;
  let shellReady = false;

  const pendingRequests = new Map();

  let requestCounter = 0;

  function detectShell() {
    try {
      isInsideShell =
        Boolean(window.parent) &&
        window.parent !== window;

      shellWindow = isInsideShell
        ? window.parent
        : null;

    } catch (error) {
      isInsideShell = false;
      shellWindow = null;
    }

    return isInsideShell;
  }

  detectShell();

  /* =======================================================
     PLAYER STATE
  ======================================================= */

  let playerState = {
    ready: false,
    playing: false,
    currentTrack: null,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: "off",
    queue: [],
    currentIndex: -1
  };

  /* =======================================================
     EVENT SYSTEM
  ======================================================= */

  const listeners = {
    state: new Set(),
    play: new Set(),
    pause: new Set(),
    ended: new Set(),
    trackchange: new Set(),
    timeupdate: new Set(),
    ready: new Set(),
    error: new Set()
  };

  function emit(eventName, detail) {
    const callbacks = listeners[eventName];

    if (!callbacks) return;

    callbacks.forEach(function (callback) {
      try {
        callback(detail);
      } catch (error) {
        console.error(
          "[Resona Bridge] Listener error:",
          error
        );
      }
    });
  }

  function on(eventName, callback) {
    if (!listeners[eventName]) {
      console.warn(
        "[Resona Bridge] Unknown event:",
        eventName
      );

      return function () {};
    }

    if (typeof callback !== "function") {
      return function () {};
    }

    listeners[eventName].add(callback);

    return function unsubscribe() {
      listeners[eventName].delete(callback);
    };
  }

  /* =======================================================
     REQUEST IDENTIFIERS
  ======================================================= */

  function createRequestId() {
    requestCounter++;

    return (
      "resona_" +
      Date.now() +
      "_" +
      requestCounter
    );
  }

  /* =======================================================
     MESSAGE SENDING
  ======================================================= */

  function send(action, payload) {
    if (!detectShell()) {
      return Promise.resolve({
        success: false,
        error: "Page is not running inside Resona shell."
      });
    }

    if (!shellWindow) {
      return Promise.resolve({
        success: false,
        error: "Shell window unavailable."
      });
    }

    const requestId = createRequestId();

    return new Promise(function (resolve) {
      const timeout = setTimeout(function () {
        pendingRequests.delete(requestId);

        resolve({
          success: false,
          error: "Shell request timed out: " + action
        });

      }, MESSAGE_TIMEOUT);

      pendingRequests.set(requestId, {
        resolve: resolve,
        timeout: timeout,
        action: action
      });

      try {
        shellWindow.postMessage(
          {
            source: "resona-page",

            // Important: this is the protocol version,
            // not the bridge software version.
            version: PROTOCOL_VERSION,

            action: action,
            requestId: requestId,
            payload: payload || {}
          },
          window.location.origin
        );

      } catch (error) {
        clearTimeout(timeout);

        pendingRequests.delete(requestId);

        resolve({
          success: false,
          error: error.message
        });
      }
    });
  }

  /* =======================================================
     STATE NORMALISATION
  ======================================================= */

  function normalizeState(state) {
    if (!state || typeof state !== "object") {
      return null;
    }

    const normalized = Object.assign(
      {},
      state
    );

    if ("isPlaying" in normalized) {
      normalized.playing =
        Boolean(normalized.isPlaying);
    }

    if ("currentTrack" in normalized) {
      normalized.currentTrack =
        normalized.currentTrack || null;
    }

    if ("currentTime" in normalized) {
      normalized.currentTime =
        Math.max(
          0,
          Number(normalized.currentTime) || 0
        );
    }

    if ("duration" in normalized) {
      normalized.duration =
        Math.max(
          0,
          Number(normalized.duration) || 0
        );
    }

    if ("volume" in normalized) {
      normalized.volume =
        Math.max(
          0,
          Math.min(
            1,
            Number(normalized.volume) || 0
          )
        );
    }

    if ("muted" in normalized) {
      normalized.muted =
        Boolean(normalized.muted);
    }

    if ("shuffle" in normalized) {
      normalized.shuffle =
        Boolean(normalized.shuffle);
    }

    if ("queue" in normalized) {
      normalized.queue =
        Array.isArray(normalized.queue)
          ? normalized.queue.slice()
          : [];
    }

    if ("currentIndex" in normalized) {
      normalized.currentIndex =
        Number.isInteger(
          Number(normalized.currentIndex)
        )
          ? Number(normalized.currentIndex)
          : -1;
    }

    return normalized;
  }

  function updateState(state) {
    const normalized = normalizeState(state);

    if (!normalized) return;

    playerState = Object.assign(
      {},
      playerState,
      normalized,
      {
        ready: true
      }
    );

    shellReady = true;

    emit("state", getState());
  }

  function getState() {
    return Object.assign(
      {},
      playerState,
      {
        queue: Array.isArray(playerState.queue)
          ? playerState.queue.slice()
          : []
      }
    );
  }

  /* =======================================================
     MESSAGE RESPONSE HANDLING
  ======================================================= */

  function resolvePendingRequest(message) {
    if (!message.requestId) return;

    const pending = pendingRequests.get(
      message.requestId
    );

    if (!pending) return;

    clearTimeout(pending.timeout);

    pendingRequests.delete(
      message.requestId
    );

    const payload = message.payload;

    pending.resolve(
      payload && typeof payload === "object"
        ? payload
        : {
            success: true
          }
    );
  }

  /* =======================================================
     INCOMING SHELL MESSAGES
  ======================================================= */

  function handleMessage(event) {
    if (!detectShell()) return;

    if (event.source !== shellWindow) return;

    if (event.origin !== window.location.origin) return;

    const message = event.data;

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.source !== "resona-shell") {
      return;
    }

    // Both sides must use the same protocol.
    if (message.version !== PROTOCOL_VERSION) {
      console.warn(
        "[Resona Bridge] Protocol mismatch.",
        {
          expected: PROTOCOL_VERSION,
          received: message.version
        }
      );

      return;
    }

    const payload =
      message.payload &&
      typeof message.payload === "object"
        ? message.payload
        : {};

    /* -----------------------------------------------
       REQUEST RESPONSES
    ----------------------------------------------- */

    if (
      typeof message.action === "string" &&
      message.action.endsWith("_RESULT")
    ) {
      resolvePendingRequest(message);

      return;
    }

    /* -----------------------------------------------
       SHELL READY
    ----------------------------------------------- */

    if (message.action === "SHELL_READY") {
      shellReady = true;

      playerState.ready = true;

      emit("ready", getState());

      refreshState().catch(function () {});

      return;
    }

    /* -----------------------------------------------
       PAGE READY RESPONSE
    ----------------------------------------------- */

    if (message.action === "PAGE_READY") {
      shellReady = true;

      playerState.ready = true;

      emit("ready", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYER STATE
    ----------------------------------------------- */

    if (message.action === "PLAYER_STATE") {
      updateState(payload);

      return;
    }

    /* -----------------------------------------------
       TRACK CHANGED
    ----------------------------------------------- */

    if (message.action === "TRACK_CHANGED") {
      const track =
        payload.track ||
        payload ||
        null;

      playerState.currentTrack = track;

      playerState.currentTime = 0;

      emit("trackchange", track);

      return;
    }

    /* -----------------------------------------------
       PLAYBACK STARTED
    ----------------------------------------------- */

    if (message.action === "PLAYBACK_PLAY") {
      playerState.playing = true;

      emit("play", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYBACK PAUSED
    ----------------------------------------------- */

    if (message.action === "PLAYBACK_PAUSE") {
      playerState.playing = false;

      emit("pause", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYBACK ENDED
    ----------------------------------------------- */

    if (message.action === "PLAYBACK_ENDED") {
      playerState.playing = false;

      emit("ended", getState());

      return;
    }

    /* -----------------------------------------------
       TIME UPDATE
    ----------------------------------------------- */

    if (message.action === "TIME_UPDATE") {
      playerState.currentTime =
        Math.max(
          0,
          Number(payload.currentTime) || 0
        );

      playerState.duration =
        Math.max(
          0,
          Number(payload.duration) || 0
        );

      emit("timeupdate", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYER ERROR
    ----------------------------------------------- */

    if (message.action === "PLAYER_ERROR") {
      playerState.playing = false;

      emit("error", payload);

      return;
    }
  }

  window.addEventListener(
    "message",
    handleMessage
  );

  /* =======================================================
     TRACK VALIDATION
  ======================================================= */

  function normalizeTrack(track) {
    if (!track || typeof track !== "object") {
      throw new Error("Invalid track.");
    }

    const id = String(
      track.id ||
      track.track_id ||
      track.trackId ||
      ""
    ).trim();

    const title = String(
      track.title ||
      track.name ||
      ""
    ).trim();

    const audioUrl = String(
      track.audio_url ||
      track.stream_url ||
      track.file_url ||
      track.audioUrl ||
      ""
    ).trim();

    if (!id) {
      throw new Error(
        "Track is missing its ID."
      );
    }

    if (!title) {
      throw new Error(
        "Track is missing its title."
      );
    }

    return Object.assign(
      {},
      track,
      {
        id: id,
        title: title,
        audio_url: audioUrl
      }
    );
  }

  /* =======================================================
     PLAY TRACK
  ======================================================= */

  async function play(track, queue) {
    try {
      const normalizedTrack =
        normalizeTrack(track);

      const normalizedQueue =
        Array.isArray(queue)
          ? queue.map(normalizeTrack)
          : [normalizedTrack];

      return await send(
        "PLAY_TRACK",
        {
          track: normalizedTrack,
          queue: normalizedQueue
        }
      );

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /* =======================================================
     QUEUE MANAGEMENT
  ======================================================= */

  async function setQueue(tracks, startTrackId) {
    if (!Array.isArray(tracks)) {
      return {
        success: false,
        error: "Queue must be an array."
      };
    }

    try {
      const normalizedTracks =
        tracks.map(normalizeTrack);

      return await send(
        "SET_QUEUE",
        {
          tracks: normalizedTracks,
          startTrackId: startTrackId || null
        }
      );

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async function addToQueue(track) {
    try {
      const normalizedTrack =
        normalizeTrack(track);

      return await send(
        "ADD_TO_QUEUE",
        {
          track: normalizedTrack
        }
      );

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /* =======================================================
     PLAYBACK CONTROLS
  ======================================================= */

  function pause() {
    return send("PAUSE");
  }

  function resume() {
    return send("RESUME");
  }

  function toggle() {
    return send("TOGGLE_PLAY");
  }

  function next() {
    return send("NEXT_TRACK");
  }

  function previous() {
    return send("PREVIOUS_TRACK");
  }

  function seek(seconds) {
    const value = Number(seconds);

    if (
      !Number.isFinite(value) ||
      value < 0
    ) {
      return Promise.resolve({
        success: false,
        error: "Invalid seek position."
      });
    }

    return send(
      "SEEK",
      {
        seconds: value
      }
    );
  }

  function setVolume(volume) {
    const value = Number(volume);

    if (!Number.isFinite(value)) {
      return Promise.resolve({
        success: false,
        error: "Invalid volume."
      });
    }

    return send(
      "SET_VOLUME",
      {
        volume: Math.max(
          0,
          Math.min(1, value)
        )
      }
    );
  }

  function mute() {
    return send("MUTE");
  }

  function unmute() {
    return send("UNMUTE");
  }

  function setShuffle(enabled) {
    return send(
      "SET_SHUFFLE",
      {
        enabled: Boolean(enabled)
      }
    );
  }

  function setRepeat(mode) {
    const allowed = [
      "off",
      "all",
      "one"
    ];

    if (!allowed.includes(mode)) {
      return Promise.resolve({
        success: false,
        error: "Invalid repeat mode."
      });
    }

    return send(
      "SET_REPEAT",
      {
        mode: mode
      }
    );
  }

  /* =======================================================
     SPA NAVIGATION
  ======================================================= */

  const SPA_PAGES = [
    "home",
    "explore",
    "search",
    "library",
    "artists",
    "albums",
    "playlists",
    "settings"
  ];

  const LEGACY_PAGES = [
    "artist.html",
    "album.html",
    "player.html",
    "lyrics.html",
    "downloads.html",
    "profile.html",
    "login.html",
    "register.html",
    "forgot-password.html",
    "artist-dashboard.html",
    "upload.html"
  ];

  function normalizePageName(page) {
    let value = String(
      page || ""
    ).trim();

    if (!value) return "";

    value = value
      .replace(/^#/, "")
      .replace(/^\/+/, "")
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .pop()
      .toLowerCase();

    if (value.endsWith(".html")) {
      value = value.slice(0, -5);
    }

    return value;
  }

  function buildQueryString(query) {
    if (!query) return "";

    if (typeof query === "string") {
      const cleaned =
        query.replace(/^\?/, "");

      return cleaned
        ? "?" + cleaned
        : "";
    }

    if (query instanceof URLSearchParams) {
      const result = query.toString();

      return result
        ? "?" + result
        : "";
    }

    if (
      typeof query === "object" &&
      !Array.isArray(query)
    ) {
      const params = new URLSearchParams();

      Object.keys(query).forEach(function (key) {
        const value = query[key];

        if (
          value === undefined ||
          value === null
        ) {
          return;
        }

        if (Array.isArray(value)) {
          value.forEach(function (item) {
            params.append(
              key,
              String(item)
            );
          });

          return;
        }

        params.set(
          key,
          String(value)
        );
      });

      const result = params.toString();

      return result
        ? "?" + result
        : "";
    }

    return "";
  }

  function dispatchHashChange() {
    try {
      window.dispatchEvent(
        new Event("hashchange")
      );
    } catch (error) {
      console.warn(
        "[Resona Bridge] Could not dispatch hashchange:",
        error
      );
    }
  }

  function navigate(page, query) {
    const cleanPage =
      normalizePageName(page);

    if (!cleanPage) {
      return Promise.resolve({
        success: false,
        error: "A destination page is required."
      });
    }

    const queryString =
      buildQueryString(query);

    /* -----------------------------------------------
       INTERNAL SPA NAVIGATION
    ----------------------------------------------- */

    if (SPA_PAGES.includes(cleanPage)) {
      try {
        const newHash =
          "#" + cleanPage + queryString;

        if (window.location.hash !== newHash) {
          window.location.hash = newHash;
        } else {
          dispatchHashChange();
        }

        return Promise.resolve({
          success: true,
          navigation: "spa",
          page: cleanPage,
          query: queryString
        });

      } catch (error) {
        return Promise.resolve({
          success: false,
          error: error.message
        });
      }
    }

    /* -----------------------------------------------
       LEGACY STANDALONE PAGE NAVIGATION
    ----------------------------------------------- */

    const legacyFilename =
      cleanPage + ".html";

    if (!LEGACY_PAGES.includes(legacyFilename)) {
      return Promise.resolve({
        success: false,
        error: "Page is not allowed."
      });
    }

    return send(
      "NAVIGATE",
      {
        url: legacyFilename + queryString
      }
    );
  }

  /* =======================================================
     PLAYER STATE REFRESH
  ======================================================= */

  function containsPlayerState(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    return (
      "playing" in value ||
      "isPlaying" in value ||
      "currentTrack" in value ||
      "currentTime" in value ||
      "duration" in value ||
      "volume" in value ||
      "queue" in value ||
      "currentIndex" in value
    );
  }

  async function refreshState() {
    const response =
      await send("GET_PLAYER_STATE");

    if (
      !response ||
      response.success === false
    ) {
      return response;
    }

    const candidate =
      response.state &&
      typeof response.state === "object"
        ? response.state
        : response;

    if (containsPlayerState(candidate)) {
      updateState(candidate);
    }

    return response;
  }

  /* =======================================================
     READY STATUS
  ======================================================= */

  function isReady() {
    return Boolean(
      isInsideShell &&
      shellReady
    );
  }

  /* =======================================================
     CLEANUP
  ======================================================= */

  function destroy() {
    window.removeEventListener(
      "message",
      handleMessage
    );

    pendingRequests.forEach(function (pending) {
      clearTimeout(pending.timeout);

      pending.resolve({
        success: false,
        error: "Bridge destroyed."
      });
    });

    pendingRequests.clear();

    Object.keys(listeners).forEach(function (key) {
      listeners[key].clear();
    });

    shellReady = false;
  }

  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.ResonaShellBridge = Object.freeze({

    version: VERSION,

    protocolVersion: PROTOCOL_VERSION,

    isInsideShell: function () {
      return isInsideShell;
    },

    isReady: isReady,

    play: play,

    pause: pause,

    resume: resume,

    toggle: toggle,

    next: next,

    previous: previous,

    seek: seek,

    setVolume: setVolume,

    mute: mute,

    unmute: unmute,

    setShuffle: setShuffle,

    setRepeat: setRepeat,

    setQueue: setQueue,

    addToQueue: addToQueue,

    navigate: navigate,

    getState: getState,

    refreshState: refreshState,

    on: on,

    destroy: destroy

  });

  /* =======================================================
     INITIAL CONNECTION
  ======================================================= */

  if (isInsideShell) {
    send(
      "PAGE_READY",
      {
        page: window.location.pathname,
        application: "resona-spa",
        version: VERSION
      }
    ).then(function (response) {
      if (
        response &&
        response.success !== false
      ) {
        shellReady = true;
        playerState.ready = true;

        emit("ready", getState());
      }
    });

    setTimeout(function () {
      if (!shellReady) return;

      refreshState().catch(function (error) {
        console.warn(
          "[Resona Bridge] Initial state refresh failed:",
          error
        );
      });

    }, 500);
  }

  /* =======================================================
     DIAGNOSTICS
  ======================================================= */

  console.info(
    "[Resona Shell Bridge] Loaded v" + VERSION,
    {
      insideShell: isInsideShell,
      architecture: "SPA",
      shellOwnsAudio: true,
      protocol: PROTOCOL_VERSION
    }
  );

})();
