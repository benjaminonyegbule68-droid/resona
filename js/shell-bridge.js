/* =========================================================
   RESONA SHELL BRIDGE
   Connects the Resona application to shell.html.

   Responsibilities:
   - Communicate with the persistent shell audio player.
   - Control playback, queue, shuffle and repeat.
   - Receive player state and playback events.
   - Navigate internally using SPA hash routes.
   - Support legacy standalone-page navigation.
   - Maintain secure postMessage communication.

   Architecture:
   shell.html owns the persistent audio engine.
   index.html owns the application interface.
   js/app.js owns internal SPA navigation.
   This bridge connects the two.

   Version: 1.1.0
========================================================= */

(function () {
  "use strict";

  if (window.ResonaShellBridge) return;

  const VERSION = "1.1.0";
  const MESSAGE_TIMEOUT = 5000;

  /* =======================================================
     ENVIRONMENT
  ======================================================= */

  let shellWindow = null;
  let isInsideShell = false;
  let shellReady = false;

  const pendingRequests = new Map();

  let requestCounter = 0;

  /* =======================================================
     PLAYER STATE
  ======================================================= */

  let playerState = {
    ready: false,
    playing: false,
    currentTrack: null,
    currentTime: 0,
    duration: 0,
    volume: 1,
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
     EVENT EMISSION
  ======================================================= */

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
     SEND MESSAGE TO SHELL
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
            version: VERSION,
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
     PLAYER STATE
  ======================================================= */

  function updateState(state) {
    if (!state || typeof state !== "object") {
      return;
    }

    playerState = Object.assign(
      {},
      playerState,
      state,
      {
        ready: true
      }
    );

    shellReady = true;

    emit("state", getState());
  }

  function getState() {
    return Object.assign({}, playerState, {
      queue: Array.isArray(playerState.queue)
        ? playerState.queue.slice()
        : []
    });
  }

  /* =======================================================
     RECEIVE SHELL MESSAGES
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

    const payload = message.payload || {};

    /* -----------------------------------------------
       REQUEST RESPONSES
    ----------------------------------------------- */

    if (message.requestId) {
      const pending = pendingRequests.get(
        message.requestId
      );

      if (pending) {
        clearTimeout(pending.timeout);

        pendingRequests.delete(
          message.requestId
        );

        pending.resolve(
          payload && typeof payload === "object"
            ? payload
            : {
                success: true
              }
        );
      }
    }

    /* -----------------------------------------------
       SHELL READY
    ----------------------------------------------- */

    if (message.action === "SHELL_READY") {
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

       Supports both:
       payload: track

       and:
       payload: { track: track }
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
       PLAYBACK PLAY
    ----------------------------------------------- */

    if (message.action === "PLAYBACK_PLAY") {
      playerState.playing = true;

      emit("play", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYBACK PAUSE
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
        Number(payload.currentTime) || 0;

      playerState.duration =
        Number(payload.duration) || 0;

      emit("timeupdate", getState());

      return;
    }

    /* -----------------------------------------------
       PLAYER ERROR
    ----------------------------------------------- */

    if (message.action === "PLAYER_ERROR") {
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

    return Object.assign({}, track, {
      id: id,
      title: title,
      audio_url: audioUrl
    });
  }

  /* =======================================================
     PLAY TRACK
  ======================================================= */

  async function play(track, queue) {
    try {
      const normalizedTrack = normalizeTrack(track);

      let normalizedQueue;

      if (Array.isArray(queue)) {
        normalizedQueue = queue.map(
          normalizeTrack
        );
      } else {
        normalizedQueue = [normalizedTrack];
      }

      return send("PLAY_TRACK", {
        track: normalizedTrack,
        queue: normalizedQueue
      });

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
      const normalizedTracks = tracks.map(
        normalizeTrack
      );

      return send("SET_QUEUE", {
        tracks: normalizedTracks,
        startTrackId: startTrackId || null
      });

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async function addToQueue(track) {
    try {
      const normalizedTrack = normalizeTrack(track);

      return send("ADD_TO_QUEUE", {
        track: normalizedTrack
      });

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

    if (!Number.isFinite(value) || value < 0) {
      return Promise.resolve({
        success: false,
        error: "Invalid seek position."
      });
    }

    return send("SEEK", {
      seconds: value
    });
  }

  function setVolume(volume) {
    const value = Number(volume);

    if (!Number.isFinite(value)) {
      return Promise.resolve({
        success: false,
        error: "Invalid volume."
      });
    }

    return send("SET_VOLUME", {
      volume: Math.max(
        0,
        Math.min(1, value)
      )
    });
  }

  function mute() {
    return send("MUTE");
  }

  function unmute() {
    return send("UNMUTE");
  }

  function setShuffle(enabled) {
    return send("SET_SHUFFLE", {
      enabled: Boolean(enabled)
    });
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

    return send("SET_REPEAT", {
      mode: mode
    });
  }

  /* =======================================================
     SPA NAVIGATION

     These are internal sections of index.html.

     They must not trigger shell iframe reloads.
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
    let value = String(page || "").trim();

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
      const cleaned = query.replace(/^\?/, "");

      return cleaned
        ? "?" + cleaned
        : "";
    }

    if (
      typeof query === "object" &&
      !(query instanceof URLSearchParams)
    ) {
      const params = new URLSearchParams();

      Object.keys(query).forEach(function (key) {
        const value = query[key];

        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      });

      const result = params.toString();

      return result ? "?" + result : "";
    }

    if (query instanceof URLSearchParams) {
      const result = query.toString();

      return result ? "?" + result : "";
    }

    return "";
  }

  function navigate(page, query) {
    const cleanPage = normalizePageName(page);

    if (!cleanPage) {
      return Promise.resolve({
        success: false,
        error: "A destination page is required."
      });
    }

    const queryString = buildQueryString(query);

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
          window.dispatchEvent(
            new HashChangeEvent("hashchange")
          );
        }

        return Promise.resolve({
          success: true,
          navigation: "spa",
          page: cleanPage
        });

      } catch (error) {
        return Promise.resolve({
          success: false,
          error: error.message
        });
      }
    }

    /* -----------------------------------------------
       LEGACY STANDALONE NAVIGATION

       Retained for pages that genuinely need a
       separate HTML document.
    ----------------------------------------------- */

    const legacyFilename = cleanPage + ".html";

    if (!LEGACY_PAGES.includes(legacyFilename)) {
      return Promise.resolve({
        success: false,
        error: "Page is not allowed."
      });
    }

    return send("NAVIGATE", {
      url: legacyFilename + queryString
    });
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
    const response = await send("GET_PLAYER_STATE");

    if (!response || response.success === false) {
      return response;
    }

    /*
       Supports both:

       { state: {...}, success: true }

       and the shell's direct state response:

       { playing: false, currentTrack: null, ... }
    */

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
     PUBLIC API
  ======================================================= */

  window.ResonaShellBridge = Object.freeze({

    version: VERSION,

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

    on: on

  });

  /* =======================================================
     INITIAL CONNECTION
  ======================================================= */

  if (isInsideShell) {
    send("PAGE_READY", {
      page: window.location.pathname,
      application: "resona-spa",
      version: VERSION
    });

    setTimeout(function () {
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
      shellOwnsAudio: true
    }
  );

})();
