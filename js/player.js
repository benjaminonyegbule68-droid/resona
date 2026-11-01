/* =========================================================
   RESONA — AUDIO PLAYER MODULE
   File: js/player.js
   Version: 3.0.0

   Architecture:
   - Persistent shell playback through shell-bridge.js
   - Standalone HTML5 audio fallback
   - Coordinator-compatible API for app.js
   - Queue management
   - Shuffle and repeat off / all / one
   - Playback event synchronization
   - Seeking, volume and mute
   - Media Session support in standalone mode
   - Safe cleanup without destroying shell playback

   IMPORTANT:
   The shell owns audio playback when embedded.
   Backend authorization is still required for production.
   Client-side rights flags are not proof of licensing.
   ========================================================= */

"use strict";

(function (global) {
  if (global.ResonaPlayer) {
    console.warn("[Resona Player] Already initialized.");
    return;
  }

  const EVENTS = Object.freeze({
    READY: "resona:player-ready",
    PLAY: "resona:play",
    PAUSE: "resona:pause",
    TRACK_CHANGE: "resona:track-change",
    TIME_UPDATE: "resona:time-update",
    ENDED: "resona:ended",
    ERROR: "resona:player-error",
    QUEUE_CHANGE: "resona:queue-change",
    VOLUME_CHANGE: "resona:volume-change",
    STATE_CHANGE: "resona:player-state-change",
    BUFFERING: "resona:buffering"
  });

  const DEFAULTS = Object.freeze({
    volume: 0.8,
    maxQueue: 500,
    crossOrigin: "anonymous"
  });

  const listeners = new Map();

  let initialized = false;
  let mode = "uninitialized";

  let audio = null;
  let audioCleanup = [];

  let bridge = null;
  let bridgeCleanup = [];

  let currentTrack = null;
  let queue = [];
  let originalQueueOrder = [];
  let queueIndex = -1;

  let shuffleEnabled = false;
  let repeatMode = "off";

  let volume = DEFAULTS.volume;
  let muted = false;
  let previousVolume = DEFAULTS.volume;

  let lastError = null;
  let playbackRequest = 0;

  /* =======================================================
     GENERAL HELPERS
  ======================================================= */

  function getMaxQueue() {
    const configured = Number(
      global.ResonaConfig?.maxQueue ??
      global.ResonaConfig?.queue?.maxItems ??
      DEFAULTS.maxQueue
    );

    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULTS.maxQueue;
  }

  function getTrackId(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    return String(
      track.id ??
      track.track_id ??
      track.trackId ??
      track.uuid ??
      ""
    ).trim();
  }

  function getTrackTitle(track) {
    return String(
      track?.title ||
      track?.name ||
      "Unknown track"
    );
  }

  function getTrackArtist(track) {
    if (!track || typeof track !== "object") {
      return "Unknown artist";
    }

    if (Array.isArray(track.artists)) {
      return track.artists
        .map(function (artist) {
          return typeof artist === "string"
            ? artist
            : artist?.name || "";
        })
        .filter(Boolean)
        .join(", ") || "Unknown artist";
    }

    if (
      track.artist &&
      typeof track.artist === "object"
    ) {
      return String(
        track.artist.name || "Unknown artist"
      );
    }

    return String(
      track.artist ||
      track.artist_name ||
      "Unknown artist"
    );
  }

  function getTrackArtwork(track) {
    return String(
      track?.artwork ||
      track?.artwork_url ||
      track?.cover_url ||
      track?.coverUrl ||
      track?.image_url ||
      track?.image ||
      ""
    ).trim();
  }

  function getTrackAudioUrl(track) {
    return String(
      track?.audioUrl ||
      track?.audio_url ||
      track?.stream_url ||
      track?.streamUrl ||
      track?.file_url ||
      track?.preview_url ||
      track?.previewUrl ||
      ""
    ).trim();
  }

  function sameTrack(first, second) {
    if (first === second) {
      return true;
    }

    const firstId = getTrackId(first);
    const secondId = getTrackId(second);

    return Boolean(
      firstId &&
      secondId &&
      firstId === secondId
    );
  }

  function validateHttpUrl(value) {
    if (!value) {
      return false;
    }

    try {
      const url = new URL(
        value,
        global.location.href
      );

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:"
      ) {
        return false;
      }

      if (
        global.location.protocol === "https:" &&
        url.protocol !== "https:"
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  function validateTrack(track) {
    if (!track || typeof track !== "object") {
      return {
        valid: false,
        reason: "Invalid track information."
      };
    }

    if (!getTrackId(track)) {
      return {
        valid: false,
        reason: "Track is missing its ID."
      };
    }

    const audioUrl = getTrackAudioUrl(track);

    if (!audioUrl) {
      return {
        valid: false,
        reason: "No audio stream is available for this track."
      };
    }

    if (!validateHttpUrl(audioUrl)) {
      return {
        valid: false,
        reason: "The audio URL is invalid or insecure."
      };
    }

    /*
     * Do not trust a client-side rights flag as proof
     * of authorization.
     *
     * The backend must verify the track's actual
     * streaming rights before providing playback access.
     */

    return {
      valid: true,
      audioUrl: audioUrl
    };
  }

  function normalizeResult(result) {
    if (result === true) {
      return true;
    }

    if (result === false || !result) {
      return false;
    }

    if (typeof result === "object") {
      return result.success === true;
    }

    return Boolean(result);
  }

  /* =======================================================
     EVENT SYSTEM
  ======================================================= */

  function emit(name, detail) {
    detail = detail || {};

    const eventDetail = Object.assign(
      {},
      detail,
      {
        track: Object.prototype.hasOwnProperty.call(
          detail,
          "track"
        )
          ? detail.track
          : currentTrack,

        player: getState()
      }
    );

    try {
      if (typeof global.CustomEvent === "function") {
        global.dispatchEvent(
          new global.CustomEvent(name, {
            detail: eventDetail
          })
        );
      }
    } catch (error) {
      console.warn(
        "[Resona Player] Event dispatch failed:",
        error
      );
    }

    const callbacks = listeners.get(name);

    if (callbacks) {
      callbacks.forEach(function (callback) {
        try {
          callback(eventDetail);
        } catch (error) {
          console.error(
            "[Resona Player] Listener failed:",
            error
          );
        }
      });
    }
  }

  function on(name, callback) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "Player event listener must be a function."
      );
    }

    if (!listeners.has(name)) {
      listeners.set(name, new Set());
    }

    listeners.get(name).add(callback);

    return function unsubscribe() {
      listeners.get(name)?.delete(callback);
    };
  }

  function reportError(message, track) {
    lastError = {
      message: String(
        message || "Playback failed."
      )
    };

    emit(EVENTS.ERROR, {
      error: lastError,
      track: track || currentTrack
    });

    return lastError;
  }

  /* =======================================================
     STATE SYNCHRONIZATION
  ======================================================= */

  function syncLocalState(state) {
    if (!state || typeof state !== "object") {
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        state,
        "currentTrack"
      )
    ) {
      currentTrack = state.currentTrack || null;
    }

    if (Array.isArray(state.queue)) {
      queue = state.queue.slice();
      originalQueueOrder = queue.slice();
    }

    const index =
      state.queueIndex ??
      state.currentIndex;

    if (index !== undefined) {
      const number = Number(index);

      queueIndex = Number.isFinite(number)
        ? Math.floor(number)
        : -1;
    }

    if (typeof state.shuffle === "boolean") {
      shuffleEnabled = state.shuffle;
    }

    if (
      state.repeat === "off" ||
      state.repeat === "all" ||
      state.repeat === "one"
    ) {
      repeatMode = state.repeat;
    }

    if (Number.isFinite(Number(state.volume))) {
      volume = Math.max(
        0,
        Math.min(1, Number(state.volume))
      );
    }

    if (typeof state.muted === "boolean") {
      muted = state.muted;
    }
  }

  /* =======================================================
     BRIDGE EVENT HANDLING
  ======================================================= */

  function bindBridgeEvents() {
    if (!bridge || typeof bridge.on !== "function") {
      return;
    }

    const eventMap = {
      state: function (state) {
        syncLocalState(state);

        emit(EVENTS.STATE_CHANGE, {
          state: state
        });
      },

      play: function (state) {
        syncLocalState(state);

        emit(EVENTS.PLAY);
        emit(EVENTS.STATE_CHANGE);
      },

      pause: function (state) {
        syncLocalState(state);

        emit(EVENTS.PAUSE);
        emit(EVENTS.STATE_CHANGE);
      },

      ended: function (state) {
        syncLocalState(state);

        emit(EVENTS.ENDED);
        emit(EVENTS.STATE_CHANGE);
      },

      trackchange: function (track) {
        const previousTrack = currentTrack;

        currentTrack = track || null;

        if (currentTrack) {
          const index = queue.findIndex(
            function (item) {
              return sameTrack(item, currentTrack);
            }
          );

          if (index >= 0) {
            queueIndex = index;
          }
        }

        emit(EVENTS.TRACK_CHANGE, {
          track: currentTrack,
          previousTrack: previousTrack
        });

        emit(EVENTS.STATE_CHANGE);
      },

      timeupdate: function (state) {
        syncLocalState(state);

        emit(EVENTS.TIME_UPDATE, {
          currentTime: Number(state?.currentTime) || 0,
          duration: Number(state?.duration) || 0,
          progress: getProgress()
        });
      },

      ready: function (state) {
        syncLocalState(state);

        initialized = true;

        emit(EVENTS.READY);
        emit(EVENTS.STATE_CHANGE);
      },

      error: function (error) {
        reportError(
          error?.message ||
          error?.error ||
          "Shell playback error."
        );
      }
    };

    Object.entries(eventMap).forEach(
      function ([eventName, handler]) {
        bridgeCleanup.push(
          bridge.on(eventName, handler)
        );
      }
    );
  }

  /* =======================================================
     STANDALONE AUDIO EVENT HANDLING
  ======================================================= */

  function listen(target, eventName, handler) {
    target.addEventListener(eventName, handler);

    audioCleanup.push(function () {
      target.removeEventListener(
        eventName,
        handler
      );
    });
  }

  function attachAudioEvents() {
    listen(audio, "play", function () {
      emit(EVENTS.PLAY);
      emit(EVENTS.STATE_CHANGE);
      updateMediaSessionPosition();
    });

    listen(audio, "pause", function () {
      emit(EVENTS.PAUSE);
      emit(EVENTS.STATE_CHANGE);
      updateMediaSessionPosition();
    });

    listen(audio, "timeupdate", function () {
      emit(EVENTS.TIME_UPDATE, {
        currentTime: getCurrentTime(),
        duration: getDuration(),
        progress: getProgress()
      });

      updateMediaSessionPosition();
    });

    listen(audio, "loadedmetadata", function () {
      emit(EVENTS.TIME_UPDATE, {
        currentTime: getCurrentTime(),
        duration: getDuration(),
        progress: getProgress()
      });

      updateMediaSessionPosition();
    });

    listen(audio, "ended", handleEnded);

    listen(audio, "volumechange", function () {
      volume = audio.volume;
      muted = audio.muted;

      emit(EVENTS.VOLUME_CHANGE, {
        volume: volume,
        muted: muted
      });

      emit(EVENTS.STATE_CHANGE);
    });

    listen(audio, "error", function () {
      const mediaError = audio?.error;

      if (!mediaError) {
        return;
      }

      const messages = {
        1: "Audio playback was aborted.",
        2: "A network error interrupted playback.",
        3: "The browser could not decode this audio.",
        4: "This audio format or source is unavailable."
      };

      reportError(
        messages[mediaError.code] ||
        "Audio playback failed."
      );
    });

    listen(audio, "waiting", function () {
      emit(EVENTS.BUFFERING, {
        buffering: true
      });
    });

    listen(audio, "playing", function () {
      emit(EVENTS.BUFFERING, {
        buffering: false
      });
    });
  }

  /* =======================================================
     INITIALIZATION
  ======================================================= */

  function init(options) {
    options = options || {};

    if (initialized) {
      return audio || true;
    }

    if (!global.document) {
      throw new Error(
        "Resona Player requires a browser document."
      );
    }

    /*
     * SHELL MODE
     *
     * Do not create a new Audio() element here.
     * The persistent shell owns the only audio engine.
     */

    const availableBridge =
      global.ResonaShellBridge;

    if (
      availableBridge &&
      typeof availableBridge.isInsideShell === "function" &&
      availableBridge.isInsideShell()
    ) {
      bridge = availableBridge;
      mode = "shell";

      bindBridgeEvents();

      initialized = true;

      try {
        const state = bridge.getState();

        syncLocalState(state);
      } catch (error) {
        console.warn(
          "[Resona Player] Initial shell state unavailable:",
          error
        );
      }

      bridge.refreshState().catch(function () {
        // Initial state refresh is allowed to retry later.
      });

      emit(EVENTS.READY, {
        mode: mode
      });

      return true;
    }

    /*
     * STANDALONE MODE
     */

    mode = "standalone";

    audio = new global.Audio();

    audio.preload = "metadata";
    audio.volume = DEFAULTS.volume;

    const crossOrigin =
      options.crossOrigin ??
      DEFAULTS.crossOrigin;

    if (
      crossOrigin === "anonymous" ||
      crossOrigin === "use-credentials"
    ) {
      audio.crossOrigin = crossOrigin;
    }

    attachAudioEvents();

    initialized = true;

    setupMediaSession();

    emit(EVENTS.READY, {
      mode: mode
    });

    return audio;
  }

  function ensureInitialized() {
    if (!initialized) {
      init();
    }

    return true;
  }

  /* =======================================================
     QUEUE MANAGEMENT
  ======================================================= */

  function getQueue() {
    return queue.slice();
  }

  function getQueueIndex() {
    return queueIndex;
  }

  function getCurrentTrack() {
    return currentTrack;
  }

  function setQueue(tracks, startIndex) {
    ensureInitialized();

    if (!Array.isArray(tracks)) {
      throw new TypeError(
        "The playback queue must be an array."
      );
    }

    const maximum = getMaxQueue();

    queue = tracks
      .filter(function (track) {
        return track && typeof track === "object";
      })
      .slice(0, maximum);

    originalQueueOrder = queue.slice();

    const index = Number(startIndex ?? 0);

    queueIndex = queue.length
      ? Math.min(
          queue.length - 1,
          Math.max(
            0,
            Number.isFinite(index)
              ? Math.floor(index)
              : 0
          )
        )
      : -1;

    if (shuffleEnabled) {
      shuffleQueue(false);
    }

    if (mode === "shell" && bridge) {
      const startTrackId =
        queueIndex >= 0
          ? getTrackId(queue[queueIndex])
          : null;

      bridge.setQueue(
        queue,
        startTrackId
      ).then(function (result) {
        if (!result?.success) {
          reportError(
            result?.error ||
            "Unable to update the playback queue."
          );
        }
      });
    }

    emit(EVENTS.QUEUE_CHANGE, {
      queue: getQueue(),
      index: queueIndex
    });

    emit(EVENTS.STATE_CHANGE);

    return getQueue();
  }

  function addToQueue(track) {
    ensureInitialized();

    if (!track || typeof track !== "object") {
      throw new TypeError(
        "A valid track is required."
      );
    }

    if (queue.length >= getMaxQueue()) {
      throw new Error(
        "The playback queue has reached its maximum size."
      );
    }

    queue.push(track);
    originalQueueOrder.push(track);

    if (mode === "shell" && bridge) {
      bridge.addToQueue(track).then(
        function (result) {
          if (!result?.success) {
            reportError(
              result?.error ||
              "Unable to add track to queue.",
              track
            );
          }
        }
      );
    }

    emit(EVENTS.QUEUE_CHANGE, {
      queue: getQueue(),
      index: queueIndex
    });

    emit(EVENTS.STATE_CHANGE);

    return queue.length;
  }

  function removeFromQueue(index) {
    const targetIndex = Number(index);

    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= queue.length
    ) {
      return false;
    }

    const removedTrack = queue[targetIndex];

    queue.splice(targetIndex, 1);

    const originalIndex = originalQueueOrder.findIndex(
      function (track) {
        return track === removedTrack;
      }
    );

    if (originalIndex >= 0) {
      originalQueueOrder.splice(originalIndex, 1);
    }

    if (targetIndex < queueIndex) {
      queueIndex--;
    } else if (targetIndex === queueIndex) {
      queueIndex = Math.min(
        queueIndex,
        queue.length - 1
      );
    }

    /*
     * The current bridge protocol does not expose
     * remove-from-queue. Keep this local operation
     * available, but do not pretend the shell queue
     * was changed.
     */

    emit(EVENTS.QUEUE_CHANGE, {
      queue: getQueue(),
      index: queueIndex
    });

    emit(EVENTS.STATE_CHANGE);

    return true;
  }

  function clearQueue() {
    queue = [];
    originalQueueOrder = [];
    queueIndex = -1;

    /*
     * The current shell bridge does not expose a
     * CLEAR_QUEUE message. This clears the local
     * coordinator queue only.
     */

    emit(EVENTS.QUEUE_CHANGE, {
      queue: [],
      index: -1
    });

    emit(EVENTS.STATE_CHANGE);

    return true;
  }

  /* =======================================================
     SHUFFLE
  ======================================================= */

  function shuffleQueue(emitEvent) {
    if (queue.length < 2) {
      return;
    }

    const current =
      queueIndex >= 0
        ? queue[queueIndex]
        : null;

    const remaining = queue.filter(
      function (track) {
        return track !== current;
      }
    );

    for (
      let index = remaining.length - 1;
      index > 0;
      index--
    ) {
      const randomIndex = Math.floor(
        Math.random() * (index + 1)
      );

      [
        remaining[index],
        remaining[randomIndex]
      ] = [
        remaining[randomIndex],
        remaining[index]
      ];
    }

    queue = current
      ? [current, ...remaining]
      : remaining;

    queueIndex = current ? 0 : -1;

    if (emitEvent !== false) {
      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex,
        shuffled: true
      });
    }
  }

  function setShuffle(enabled) {
    ensureInitialized();

    const nextValue = Boolean(enabled);

    if (nextValue === shuffleEnabled) {
      return shuffleEnabled;
    }

    if (mode === "shell" && bridge) {
      bridge.setShuffle(nextValue).then(
        function (result) {
          if (!result?.success) {
            reportError(
              result?.error ||
              "Unable to change shuffle mode."
            );
          }
        }
      );

      shuffleEnabled = nextValue;

      emit(EVENTS.STATE_CHANGE);

      return shuffleEnabled;
    }

    if (nextValue) {
      originalQueueOrder = queue.slice();
      shuffleEnabled = true;
      shuffleQueue(true);
    } else {
      shuffleEnabled = false;

      const current = currentTrack;

      queue = originalQueueOrder.slice();

      queueIndex = current
        ? queue.findIndex(function (track) {
            return sameTrack(track, current);
          })
        : -1;

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex,
        shuffled: false
      });
    }

    emit(EVENTS.STATE_CHANGE);

    return shuffleEnabled;
  }

  function isShuffleEnabled() {
    return shuffleEnabled;
  }

  /* =======================================================
     REPEAT
  ======================================================= */

  function setRepeat(modeValue) {
    ensureInitialized();

    const allowed = [
      "off",
      "all",
      "one"
    ];

    if (!allowed.includes(modeValue)) {
      throw new TypeError(
        'Repeat must be "off", "all", or "one".'
      );
    }

    if (mode === "shell" && bridge) {
      bridge.setRepeat(modeValue).then(
        function (result) {
          if (!result?.success) {
            reportError(
              result?.error ||
              "Unable to change repeat mode."
            );
          }
        }
      );
    }

    repeatMode = modeValue;

    emit(EVENTS.STATE_CHANGE);

    return repeatMode;
  }

  function cycleRepeat() {
    const modes = [
      "off",
      "all",
      "one"
    ];

    const index = modes.indexOf(repeatMode);

    return setRepeat(
      modes[(index + 1) % modes.length]
    );
  }

  function toggleRepeat() {
    return cycleRepeat();
  }

  function getRepeatMode() {
    return repeatMode;
  }

  /* =======================================================
     TRACK QUEUE SYNCHRONIZATION
  ======================================================= */

  function syncTrackToQueue(track) {
    const id = getTrackId(track);

    let index = id
      ? queue.findIndex(function (item) {
          return getTrackId(item) === id;
        })
      : -1;

    if (index < 0) {
      index = queue.findIndex(function (item) {
        return item === track;
      });
    }

    if (index >= 0) {
      queueIndex = index;
      return;
    }

    if (queue.length >= getMaxQueue()) {
      queue = [track];
      originalQueueOrder = queue.slice();
      queueIndex = 0;
    } else {
      queue.unshift(track);
      originalQueueOrder.unshift(track);
      queueIndex = 0;
    }

    emit(EVENTS.QUEUE_CHANGE, {
      queue: getQueue(),
      index: queueIndex
    });
  }

  /* =======================================================
     PLAY TRACK
  ======================================================= */

  async function playTrack(track, options) {
    ensureInitialized();

    options = options || {};

    const validation = validateTrack(track);

    if (!validation.valid) {
      reportError(validation.reason, track);
      return false;
    }

    const requestId = ++playbackRequest;
    const previousTrack = currentTrack;

    lastError = null;

    if (options.updateQueue !== false) {
      syncTrackToQueue(track);
    } else {
      const index = queue.findIndex(function (item) {
        return sameTrack(item, track);
      });

      if (index >= 0) {
        queueIndex = index;
      }
    }

    if (mode === "shell" && bridge) {
      currentTrack = track;

      emit(EVENTS.TRACK_CHANGE, {
        track: track,
        previousTrack: previousTrack
      });

      try {
        const result = await bridge.play(
          track,
          queue.length ? queue : [track]
        );

        if (requestId !== playbackRequest) {
          return false;
        }

        if (!normalizeResult(result)) {
          reportError(
            result?.error ||
            "The shell could not start playback.",
            track
          );

          return false;
        }

        emit(EVENTS.STATE_CHANGE);

        return true;
      } catch (error) {
        reportError(
          error?.message ||
          "Playback failed.",
          track
        );

        return false;
      }
    }

    /* STANDALONE PLAYBACK */

    try {
      audio.pause();

      audio.src = validation.audioUrl;
      audio.load();

      currentTrack = track;

      emit(EVENTS.TRACK_CHANGE, {
        track: track,
        previousTrack: previousTrack
      });

      updateMediaSessionMetadata(track);

      await audio.play();

      if (requestId !== playbackRequest) {
        return false;
      }

      emit(EVENTS.STATE_CHANGE);

      return true;
    } catch (error) {
      if (requestId === playbackRequest) {
        reportError(
          error?.message ||
          "Playback failed.",
          track
        );
      }

      return false;
    }
  }

  /* =======================================================
     PLAY / PAUSE / RESUME
  ======================================================= */

  async function play() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      const state = bridge.getState();

      if (!state.currentTrack) {
        if (queue.length && queueIndex >= 0) {
          return playTrack(queue[queueIndex], {
            updateQueue: false
          });
        }

        return false;
      }

      const result = await bridge.resume();

      if (!normalizeResult(result)) {
        reportError(
          result?.error ||
          "Unable to resume playback."
        );

        return false;
      }

      return true;
    }

    if (!currentTrack) {
      if (queue.length && queueIndex >= 0) {
        return playTrack(queue[queueIndex], {
          updateQueue: false
        });
      }

      return false;
    }

    try {
      await audio.play();

      emit(EVENTS.STATE_CHANGE);

      return true;
    } catch (error) {
      reportError(
        error?.message ||
        "Unable to resume playback."
      );

      return false;
    }
  }

  function resume() {
    return play();
  }

  function pause() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      return bridge.pause().then(function (result) {
        if (!result?.success) {
          reportError(
            result?.error ||
            "Unable to pause playback."
          );
        }

        return Boolean(result?.success);
      });
    }

    audio.pause();

    return true;
  }

  async function togglePlayback() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      const result = await bridge.toggle();

      if (!result?.success) {
        reportError(
          result?.error ||
          "Unable to toggle playback."
        );

        return false;
      }

      return true;
    }

    if (audio.paused) {
      return play();
    }

    pause();

    return false;
  }

  /* =======================================================
     NEXT / PREVIOUS
  ======================================================= */

  async function playNext() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      const result = await bridge.next();

      if (!result?.success) {
        if (result?.error) {
          reportError(result.error);
        }

        return false;
      }

      return true;
    }

    if (!queue.length || queueIndex < 0) {
      return false;
    }

    if (repeatMode === "one" && currentTrack) {
      audio.currentTime = 0;

      try {
        await audio.play();
        return true;
      } catch (error) {
        reportError(error?.message);
        return false;
      }
    }

    let nextIndex = queueIndex + 1;

    if (nextIndex >= queue.length) {
      if (repeatMode === "all") {
        nextIndex = 0;
      } else {
        pause();
        return false;
      }
    }

    return playTrack(queue[nextIndex], {
      updateQueue: false
    });
  }

  async function playPrevious() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      const result = await bridge.previous();

      if (!result?.success) {
        if (result?.error) {
          reportError(result.error);
        }

        return false;
      }

      return true;
    }

    if (
      currentTrack &&
      audio.currentTime > 3
    ) {
      audio.currentTime = 0;
      return true;
    }

    if (!queue.length || queueIndex < 0) {
      return false;
    }

    let previousIndex = queueIndex - 1;

    if (previousIndex < 0) {
      if (repeatMode === "all") {
        previousIndex = queue.length - 1;
      } else {
        audio.currentTime = 0;
        return false;
      }
    }

    return playTrack(queue[previousIndex], {
      updateQueue: false
    });
  }

  function next() {
    return playNext();
  }

  function previous() {
    return playPrevious();
  }

  async function handleEnded() {
    emit(EVENTS.ENDED, {
      track: currentTrack
    });

    if (mode !== "standalone") {
      return;
    }

    if (repeatMode === "one") {
      try {
        audio.currentTime = 0;
        await audio.play();
      } catch (error) {
        reportError(error?.message);
      }

      return;
    }

    await playNext();
  }

  /* =======================================================
     SEEKING
  ======================================================= */

  function seek(seconds) {
    ensureInitialized();

    const target = Number(seconds);

    if (
      !Number.isFinite(target) ||
      target < 0
    ) {
      return false;
    }

    if (mode === "shell" && bridge) {
      return bridge.seek(target).then(
        function (result) {
          return Boolean(result?.success);
        }
      );
    }

    if (
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0
    ) {
      return false;
    }

    audio.currentTime = Math.min(
      audio.duration,
      target
    );

    updateMediaSessionPosition();

    return true;
  }

  function seekToProgress(progress) {
    const value = Number(progress);

    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      return false;
    }

    const duration = getDuration();

    if (duration <= 0) {
      return false;
    }

    return seek(duration * value);
  }

  function getCurrentTime() {
    if (mode === "shell" && bridge) {
      return Number(
        bridge.getState().currentTime
      ) || 0;
    }

    return audio
      ? audio.currentTime || 0
      : 0;
  }

  function getDuration() {
    if (mode === "shell" && bridge) {
      return Number(
        bridge.getState().duration
      ) || 0;
    }

    return audio &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0
        ? audio.duration
        : 0;
  }

  function getProgress() {
    const duration = getDuration();

    if (!duration) {
      return 0;
    }

    return Math.min(
      1,
      Math.max(
        0,
        getCurrentTime() / duration
      )
    );
  }

  /* =======================================================
     VOLUME / MUTE
  ======================================================= */

  function setVolume(value) {
    ensureInitialized();

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return getVolume();
    }

    const nextVolume = Math.max(
      0,
      Math.min(1, number)
    );

    if (mode === "shell" && bridge) {
      volume = nextVolume;

      return bridge.setVolume(nextVolume).then(
        function (result) {
          return result?.success
            ? nextVolume
            : getVolume();
        }
      );
    }

    audio.volume = nextVolume;

    if (nextVolume > 0) {
      previousVolume = nextVolume;
      audio.muted = false;
    }

    return audio.volume;
  }

  function getVolume() {
    if (mode === "shell" && bridge) {
      const state = bridge.getState();

      return Number.isFinite(Number(state.volume))
        ? Number(state.volume)
        : volume;
    }

    return audio
      ? audio.volume
      : volume;
  }

  function mute() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      if (!muted && volume > 0) {
        previousVolume = volume;
      }

      muted = true;

      return bridge.mute().then(function (result) {
        return Boolean(result?.success);
      });
    }

    if (!audio.muted && audio.volume > 0) {
      previousVolume = audio.volume;
    }

    audio.muted = true;
    muted = true;

    return true;
  }

  function unmute() {
    ensureInitialized();

    if (mode === "shell" && bridge) {
      muted = false;

      return bridge.unmute().then(function (result) {
        return Boolean(result?.success);
      });
    }

    audio.muted = false;
    muted = false;

    if (audio.volume === 0) {
      audio.volume =
        previousVolume || DEFAULTS.volume;
    }

    return true;
  }

  function toggleMute() {
    if (isMuted()) {
      return unmute();
    }

    return mute();
  }

  function isMuted() {
    if (mode === "shell" && bridge) {
      return Boolean(
        bridge.getState().muted
      );
    }

    return audio
      ? audio.muted
      : muted;
  }

  /* =======================================================
     MEDIA SESSION — STANDALONE MODE
  ======================================================= */

  function setupMediaSession() {
    if (!global.navigator?.mediaSession) {
      return;
    }

    const session = global.navigator.mediaSession;

    const actions = {
      play: function () {
        resume();
      },

      pause: function () {
        pause();
      },

      previoustrack: function () {
        previous();
      },

      nexttrack: function () {
        next();
      },

      seekbackward: function (details) {
        seek(
          getCurrentTime() -
          (details?.seekOffset || 10)
        );
      },

      seekforward: function (details) {
        seek(
          getCurrentTime() +
          (details?.seekOffset || 10)
        );
      },

      seekto: function (details) {
        if (Number.isFinite(details?.seekTime)) {
          seek(details.seekTime);
        }
      }
    };

    Object.entries(actions).forEach(
      function ([action, handler]) {
        try {
          session.setActionHandler(action, handler);
        } catch {
          // Optional browser functionality.
        }
      }
    );
  }

  function updateMediaSessionMetadata(track) {
    if (
      !global.navigator?.mediaSession ||
      typeof global.MediaMetadata !== "function" ||
      !track
    ) {
      return;
    }

    const artwork = getTrackArtwork(track);
    const artworkEntries = [];

    if (
      artwork &&
      validateHttpUrl(artwork)
    ) {
      artworkEntries.push({
        src: artwork,
        sizes: "512x512",
        type: "image/jpeg"
      });
    }

    try {
      global.navigator.mediaSession.metadata =
        new global.MediaMetadata({
          title: getTrackTitle(track),
          artist: getTrackArtist(track),
          album: String(
            track.album_title ||
            (
              typeof track.album === "string"
                ? track.album
                : track.album?.title
            ) ||
            "Resona"
          ),
          artwork: artworkEntries
        });
    } catch {
      // Optional browser functionality.
    }

    updateMediaSessionPosition();
  }

  function updateMediaSessionPosition() {
    const session = global.navigator?.mediaSession;

    if (
      !session ||
      typeof session.setPositionState !== "function" ||
      !audio ||
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0
    ) {
      return;
    }

    try {
      session.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(
          audio.currentTime,
          audio.duration
        )
      });
    } catch {
      // Optional browser functionality.
    }
  }

  /* =======================================================
     PLAYER STATE
  ======================================================= */

  function getState() {
    let shellState = {};

    if (mode === "shell" && bridge) {
      try {
        shellState = bridge.getState() || {};
      } catch {
        shellState = {};
      }
    }

    const currentTime =
      mode === "shell"
        ? Number(shellState.currentTime) || 0
        : audio
          ? audio.currentTime || 0
          : 0;

    const duration =
      mode === "shell"
        ? Number(shellState.duration) || 0
        : audio &&
          Number.isFinite(audio.duration) &&
          audio.duration > 0
            ? audio.duration
            : 0;

    const playing =
      mode === "shell"
        ? Boolean(shellState.playing)
        : Boolean(audio && !audio.paused);

    return {
      initialized: initialized,
      mode: mode,

      currentTrack:
        shellState.currentTrack !== undefined
          ? shellState.currentTrack
          : currentTrack,

      queue:
        Array.isArray(shellState.queue)
          ? shellState.queue.slice()
          : getQueue(),

      queueIndex:
        shellState.currentIndex ??
        shellState.queueIndex ??
        queueIndex,

      playing: playing,
      paused: !playing,

      currentTime: currentTime,
      duration: duration,

      progress: duration > 0
        ? Math.min(1, currentTime / duration)
        : 0,

      volume:
        Number.isFinite(Number(shellState.volume))
          ? Number(shellState.volume)
          : getVolume(),

      muted:
        typeof shellState.muted === "boolean"
          ? shellState.muted
          : muted,

      shuffle:
        typeof shellState.shuffle === "boolean"
          ? shellState.shuffle
          : shuffleEnabled,

      repeat:
        shellState.repeat ||
        repeatMode,

      lastError: lastError
    };
  }

  /* =======================================================
     CLEANUP
  ======================================================= */

  function destroy() {
    playbackRequest++;

    /*
     * IMPORTANT:
     *
     * Never stop or destroy the shell's audio engine.
     * The shell must continue playing while pages change.
     */

    if (mode === "shell") {
      bridgeCleanup.forEach(function (cleanup) {
        try {
          if (typeof cleanup === "function") {
            cleanup();
          }
        } catch {
          // Continue cleanup.
        }
      });

      bridgeCleanup = [];

      bridge = null;
      initialized = false;
      mode = "uninitialized";

      emit(EVENTS.STATE_CHANGE);

      return true;
    }

    if (audio) {
      audio.pause();

      audioCleanup.forEach(function (cleanup) {
        try {
          cleanup();
        } catch {
          // Continue cleanup.
        }
      });

      audioCleanup = [];

      audio.removeAttribute("src");
      audio.load();
    }

    audio = null;
    initialized = false;
    mode = "uninitialized";

    currentTrack = null;
    queue = [];
    originalQueueOrder = [];
    queueIndex = -1;

    lastError = null;

    emit(EVENTS.STATE_CHANGE);

    return true;
  }

  /* =======================================================
     PUBLIC API
  ======================================================= */

  const ResonaPlayer = Object.freeze({
    EVENTS: EVENTS,

    init: init,
    destroy: destroy,

    on: on,
    getState: getState,

    play: play,
    resume: resume,
    pause: pause,
    togglePlayback: togglePlayback,

    playTrack: playTrack,
    playNext: playNext,
    playPrevious: playPrevious,

    next: next,
    previous: previous,

    setQueue: setQueue,
    getQueue: getQueue,
    getQueueIndex: getQueueIndex,
    getCurrentTrack: getCurrentTrack,

    addToQueue: addToQueue,
    removeFromQueue: removeFromQueue,
    clearQueue: clearQueue,

    setShuffle: setShuffle,
    isShuffleEnabled: isShuffleEnabled,

    setRepeat: setRepeat,
    cycleRepeat: cycleRepeat,
    toggleRepeat: toggleRepeat,
    getRepeatMode: getRepeatMode,

    seek: seek,
    seekToProgress: seekToProgress,
    getCurrentTime: getCurrentTime,
    getDuration: getDuration,
    getProgress: getProgress,

    setVolume: setVolume,
    getVolume: getVolume,

    mute: mute,
    unmute: unmute,
    toggleMute: toggleMute,
    isMuted: isMuted
  });

  global.ResonaPlayer = ResonaPlayer;

  console.info(
    "[Resona Player] Loaded v3.0.0"
  );

})(window);
