/* =========================================================
   RESONA SHELL BRIDGE
   Connects individual Resona pages to shell.html.

   Responsibilities:
   - Communicate with the persistent audio player.
   - Play tracks without reloading the shell.
   - Control playback, queue, shuffle and repeat.
   - Navigate between pages inside the shell.
   - Receive player state updates.
   - Provide a fallback when a page is opened outside shell.

   Version: 1.0.0
========================================================= */

(function () {
  "use strict";

  if (window.ResonaShellBridge) return;

  const VERSION = "1.0.0";
  const MESSAGE_TIMEOUT = 5000;

  let shellWindow = null;
  let isInsideShell = false;
  let shellReady = false;

  let pendingRequests = new Map();
  let requestCounter = 0;

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

  /* =======================================================
     ENVIRONMENT DETECTION
  ======================================================= */

  function detectShell() {
    try {
      isInsideShell =
        window.parent &&
        window.parent !== window;

      if (isInsideShell) {
        shellWindow = window.parent;
      } else {
        shellWindow = null;
      }
    } catch (error) {
      isInsideShell = false;
      shellWindow = null;
    }

    return isInsideShell;
  }

  detectShell();

  /* =======================================================
     EVENT SYSTEM
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
          error: "Shell request timed out."
        });
      }, MESSAGE_TIMEOUT);

      pendingRequests.set(requestId, {
        resolve: resolve,
        timeout: timeout
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
     RECEIVE MESSAGES FROM SHELL
  ======================================================= */

  function handleMessage(event) {
    if (!detectShell()) return;

    if (event.source !== shellWindow) return;

    if (event.origin !== window.location.origin) return;

    const message = event.data;

    if (!message || typeof message !== "object") return;

    if (message.source !== "resona-shell") return;

    /* Request response */

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
          message.payload || {
            success: true
          }
        );
      }
    }

    /* Player state */

    if (message.action === "PLAYER_STATE") {
      updateState(message.payload || {});
    }

    /* Shell ready */

    if (message.action === "SHELL_READY") {
      shellReady = true;

      playerState.ready = true;

      emit("ready", playerState);
    }

    /* Track changes */

    if (message.action === "TRACK_CHANGED") {
      const track = message.payload?.track || null;

      playerState.currentTrack = track;

      emit("trackchange", track);
    }

    /* Playback events */

    if (message.action === "PLAYBACK_PLAY") {
      playerState.playing = true;

      emit("play", playerState);
    }

    if (message.action === "PLAYBACK_PAUSE") {
      playerState.playing = false;

      emit("pause", playerState);
    }

    if (message.action === "PLAYBACK_ENDED") {
      playerState.playing = false;

      emit("ended", playerState);
    }

    if (message.action === "TIME_UPDATE") {
      playerState.currentTime =
        Number(message.payload?.currentTime) || 0;

      playerState.duration =
        Number(message.payload?.duration) || 0;

      emit("timeupdate", playerState);
    }

    if (message.action === "PLAYER_ERROR") {
      emit("error", message.payload);
    }
  }

  window.addEventListener(
    "message",
    handleMessage
  );

  /* =======================================================
     UPDATE PLAYER STATE
  ======================================================= */

  function updateState(state) {
    playerState = Object.assign(
      {},
      playerState,
      state,
      {
        ready: true
      }
    );

    shellReady = true;

    emit("state", playerState);
  }

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
    let normalizedTrack;

    try {
      normalizedTrack = normalizeTrack(track);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }

    const normalizedQueue = Array.isArray(queue)
      ? queue.map(function (item) {
          return normalizeTrack(item);
        })
      : [normalizedTrack];

    return send("PLAY_TRACK", {
      track: normalizedTrack,
      queue: normalizedQueue
    });
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
      volume: Math.max(0, Math.min(1, value))
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
     NAVIGATION
  ======================================================= */

  const ALLOWED_PAGES = [
    "index.html",
    "explore.html",
    "search.html",
    "artist.html",
    "album.html",
    "player.html",
    "lyrics.html",
    "library.html",
    "playlists.html",
    "downloads.html",
    "profile.html",
    "settings.html",
    "login.html",
    "register.html",
    "forgot-password.html",
    "artist-dashboard.html",
    "upload.html"
  ];

  function navigate(page, query) {
    const cleanPage = String(page || "")
      .trim()
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .pop();

    if (!ALLOWED_PAGES.includes(cleanPage)) {
      return Promise.resolve({
        success: false,
        error: "Page is not allowed."
      });
    }

    let target = cleanPage;

    if (query) {
      const params = new URLSearchParams(query);

      const queryString = params.toString();

      if (queryString) {
        target += "?" + queryString;
      }
    }

    return send("NAVIGATE", {
      url: target
    });
  }

  /* =======================================================
     PLAYER STATE
  ======================================================= */

  function getState() {
    return Object.assign({}, playerState);
  }

  async function refreshState() {
    const response = await send("GET_PLAYER_STATE");

    if (response.success && response.state) {
      updateState(response.state);
    }

    return response;
  }

  /* =======================================================
     MESSAGE TO PAGES
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
      page: window.location.pathname
    });

    setTimeout(function () {
      refreshState();
    }, 500);
  }

  console.info(
    "[Resona Shell Bridge] Loaded v" + VERSION,
    {
      insideShell: isInsideShell
    }
  );

})();
