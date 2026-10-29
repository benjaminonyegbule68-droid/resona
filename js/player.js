/* =========================================================
   RESONA — AUDIO PLAYER MODULE
   File: js/player.js

   Features:
   - HTML5 audio playback
   - Play and pause controls
   - Previous and next track
   - Queue management
   - Seek and playback progress
   - Volume and mute
   - Shuffle
   - Repeat off / all / one
   - Playback event handling
   - Safe audio URL validation
   - Playback rights verification
   - Media Session API integration

   This module does not invent audio URLs or bypass
   track-rights requirements.
   ========================================================= */

"use strict";

(function (global) {
  const ResonaPlayer = (() => {
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
      STATE_CHANGE: "resona:player-state-change"
    });

    const DEFAULTS = Object.freeze({
      volume: 0.8,
      maxQueue: 500,
      crossOrigin: "anonymous"
    });

    let audio = null;
    let initialized = false;
    let currentTrack = null;
    let queue = [];
    let queueIndex = -1;

    let shuffleEnabled = false;
    let repeatMode = "off";
    let muted = false;
    let previousVolume = DEFAULTS.volume;

    let playedIndexes = [];
    let originalQueueOrder = [];
    let lastError = null;

    const listeners = new Map();

    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(name, detail = {}) {
      const eventDetail = {
        ...detail,
        track: detail.track || currentTrack,
        player: getState()
      };

      try {
        global.dispatchEvent(
          new CustomEvent(name, {
            detail: eventDetail
          })
        );
      } catch (error) {
        console.error(
          "[Resona Player] Event dispatch failed:",
          error
        );
      }

      const registered = listeners.get(name);

      if (registered) {
        registered.forEach(callback => {
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

    /* =====================================================
       TRACK VALIDATION
       ===================================================== */

    function getTrackId(track) {
      if (!track || typeof track !== "object") {
        return "";
      }

      return String(
        track.id ||
        track.track_id ||
        track.trackId ||
        ""
      ).trim();
    }

    function getTrackTitle(track) {
      if (!track || typeof track !== "object") {
        return "Unknown track";
      }

      return String(
        track.title ||
        track.name ||
        "Unknown track"
      );
    }

    function getTrackArtist(track) {
      if (!track || typeof track !== "object") {
        return "Unknown artist";
      }

      if (Array.isArray(track.artists)) {
        return track.artists
          .map(artist => {
            if (typeof artist === "string") {
              return artist;
            }

            return artist?.name || "";
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
      if (!track || typeof track !== "object") {
        return "";
      }

      return String(
        track.artwork ||
        track.cover_url ||
        track.coverUrl ||
        track.image_url ||
        track.image ||
        ""
      ).trim();
    }

    function getTrackAudioUrl(track) {
      if (!track || typeof track !== "object") {
        return "";
      }

      return String(
        track.audioUrl ||
        track.audio_url ||
        track.stream_url ||
        track.streamUrl ||
        track.preview_url ||
        track.previewUrl ||
        ""
      ).trim();
    }

    function hasPlaybackPermission(track) {
      if (!track || typeof track !== "object") {
        return false;
      }

      /*
       * Match the existing Resona safety rule:
       * playback requires an explicit rights confirmation.
       *
       * This is a client-side safeguard, not a substitute
       * for server-side licensing and authorization checks.
       */

      return track.rightsConfirmed === true;
    }

    function validateAudioUrl(value) {
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
          url.protocol === "http:"
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

      const audioUrl = getTrackAudioUrl(track);

      if (!audioUrl) {
        return {
          valid: false,
          reason: "No audio stream is available for this track."
        };
      }

      if (!validateAudioUrl(audioUrl)) {
        return {
          valid: false,
          reason: "This track has an invalid or insecure audio URL."
        };
      }

      if (!hasPlaybackPermission(track)) {
        return {
          valid: false,
          reason: "Playback is unavailable because the track's rights have not been confirmed."
        };
      }

      return {
        valid: true,
        audioUrl
      };
    }

    /* =====================================================
       PLAYER INITIALIZATION
       ===================================================== */

    function init(options = {}) {
      if (initialized && audio) {
        return audio;
      }

      if (!global.document) {
        throw new Error(
          "Resona Player requires a browser document."
        );
      }

      audio = new Audio();

      audio.preload = "metadata";
      audio.volume = DEFAULTS.volume;

      /*
       * Some cross-origin streaming providers do not
       * support anonymous CORS. The backend must provide
       * compatible URLs if CORS is required.
       */

      if (options.crossOrigin === "anonymous") {
        audio.crossOrigin = "anonymous";
      } else if (options.crossOrigin === "use-credentials") {
        audio.crossOrigin = "use-credentials";
      }

      attachAudioEvents();

      initialized = true;

      setupMediaSession();

      emit(EVENTS.READY);

      return audio;
    }

    function ensureInitialized() {
      if (!initialized || !audio) {
        init();
      }

      return audio;
    }

    /* =====================================================
       AUDIO EVENTS
       ===================================================== */

    function attachAudioEvents() {
      audio.addEventListener("play", () => {
        emit(EVENTS.PLAY);
        emit(EVENTS.STATE_CHANGE);
        updateMediaSessionPosition();
      });

      audio.addEventListener("pause", () => {
        emit(EVENTS.PAUSE);
        emit(EVENTS.STATE_CHANGE);
        updateMediaSessionPosition();
      });

      audio.addEventListener("timeupdate", () => {
        emit(EVENTS.TIME_UPDATE, {
          currentTime: audio.currentTime,
          duration: getDuration(),
          progress: getProgress()
        });

        updateMediaSessionPosition();
      });

      audio.addEventListener("loadedmetadata", () => {
        emit(EVENTS.TIME_UPDATE, {
          currentTime: audio.currentTime,
          duration: getDuration(),
          progress: getProgress()
        });

        updateMediaSessionPosition();
      });

      audio.addEventListener("ended", handleEnded);

      audio.addEventListener("volumechange", () => {
        emit(EVENTS.VOLUME_CHANGE, {
          volume: audio.volume,
          muted: audio.muted
        });
      });

      audio.addEventListener("error", () => {
        const mediaError = audio.error;

        lastError = {
          code: mediaError?.code || 0,
          message: getMediaErrorMessage(mediaError)
        };

        emit(EVENTS.ERROR, {
          error: lastError
        });
      });

      audio.addEventListener("waiting", () => {
        emit("resona:buffering", {
          buffering: true
        });
      });

      audio.addEventListener("playing", () => {
        emit("resona:buffering", {
          buffering: false
        });
      });
    }

    function getMediaErrorMessage(error) {
      if (!error) {
        return "An unknown audio playback error occurred.";
      }

      switch (error.code) {
        case 1:
          return "Audio playback was aborted.";

        case 2:
          return "A network error interrupted playback.";

        case 3:
          return "The browser could not decode this audio.";

        case 4:
          return "This audio format or source is unavailable.";

        default:
          return "Audio playback failed.";
      }
    }

    /* =====================================================
       QUEUE
       ===================================================== */

    function setQueue(tracks, startIndex = 0) {
      if (!Array.isArray(tracks)) {
        throw new TypeError(
          "The playback queue must be an array."
        );
      }

      const maxQueue = Number(
        global.ResonaConfig?.maxQueue ||
        global.ResonaConfig?.queue?.maxItems ||
        DEFAULTS.maxQueue
      );

      queue = tracks
        .filter(track => {
          return (
            track &&
            typeof track === "object"
          );
        })
        .slice(0, maxQueue);

      originalQueueOrder = queue.slice();

      playedIndexes = [];

      const index = Number(startIndex);

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
        shuffleQueue();
      }

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex
      });

      return getQueue();
    }

    function getQueue() {
      return queue.slice();
    }

    function getQueueIndex() {
      return queueIndex;
    }

    function getCurrentTrack() {
      return currentTrack;
    }

    function addToQueue(track) {
      if (!track || typeof track !== "object") {
        throw new TypeError(
          "A valid track is required."
        );
      }

      const maxQueue = Number(
        global.ResonaConfig?.maxQueue ||
        global.ResonaConfig?.queue?.maxItems ||
        DEFAULTS.maxQueue
      );

      if (queue.length >= maxQueue) {
        throw new Error(
          "The playback queue has reached its maximum size."
        );
      }

      queue.push(track);
      originalQueueOrder = queue.slice();

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex
      });

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

      queue.splice(targetIndex, 1);
      originalQueueOrder = queue.slice();

      if (targetIndex < queueIndex) {
        queueIndex--;
      } else if (targetIndex === queueIndex) {
        queueIndex = Math.min(
          queueIndex,
          queue.length - 1
        );
      }

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex
      });

      return true;
    }

    function clearQueue() {
      queue = [];
      originalQueueOrder = [];
      playedIndexes = [];
      queueIndex = -1;

      emit(EVENTS.QUEUE_CHANGE, {
        queue: [],
        index: -1
      });
    }

    /* =====================================================
       SHUFFLE
       ===================================================== */

    function shuffleQueue() {
      if (queue.length < 2) {
        return;
      }

      const current = queueIndex >= 0
        ? queue[queueIndex]
        : null;

      const remaining = queue.filter(
        track => track !== current
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

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex,
        shuffled: true
      });
    }

    function setShuffle(enabled) {
      const nextValue = Boolean(enabled);

      if (nextValue === shuffleEnabled) {
        return shuffleEnabled;
      }

      shuffleEnabled = nextValue;

      if (shuffleEnabled) {
        originalQueueOrder = queue.slice();
        shuffleQueue();
      } else if (originalQueueOrder.length) {
        const current = currentTrack;

        queue = originalQueueOrder.slice();

        const currentId = getTrackId(current);

        queueIndex = currentId
          ? queue.findIndex(
              track => getTrackId(track) === currentId
            )
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

    /* =====================================================
       REPEAT
       ===================================================== */

    function setRepeat(mode) {
      const allowedModes = [
        "off",
        "all",
        "one"
      ];

      if (!allowedModes.includes(mode)) {
        throw new TypeError(
          'Repeat mode must be "off", "all", or "one".'
        );
      }

      repeatMode = mode;

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

      repeatMode = modes[
        (index + 1) % modes.length
      ];

      emit(EVENTS.STATE_CHANGE);

      return repeatMode;
    }

    function getRepeatMode() {
      return repeatMode;
    }

    /* =====================================================
       PLAYBACK
       ===================================================== */

    async function playTrack(track, options = {}) {
      ensureInitialized();

      if (!track || typeof track !== "object") {
        throw new TypeError(
          "A valid track is required."
        );
      }

      const validation = validateTrack(track);

      if (!validation.valid) {
        const error = new Error(
          validation.reason
        );

        emit(EVENTS.ERROR, {
          error: {
            message: error.message
          },
          track
        });

        throw error;
      }

      const previousTrack = currentTrack;

      currentTrack = track;
      lastError = null;

      const id = getTrackId(track);

      if (options.updateQueue !== false) {
        const existingIndex = id
          ? queue.findIndex(
              item => getTrackId(item) === id
            )
          : -1;

        if (existingIndex >= 0) {
          queueIndex = existingIndex;
        } else if (!queue.length) {
          queue = [track];
          originalQueueOrder = queue.slice();
          queueIndex = 0;
        } else {
          queueIndex = queue.findIndex(
            item => item === track
          );

          if (queueIndex === -1) {
            queue.unshift(track);
            originalQueueOrder.unshift(track);
            queueIndex = 0;
          }
        }
      }

      try {
        audio.pause();

        audio.src = validation.audioUrl;
        audio.load();

        emit(EVENTS.TRACK_CHANGE, {
          track,
          previousTrack
        });

        updateMediaSessionMetadata(track);

        await audio.play();

        return true;
      } catch (error) {
        lastError = {
          message: error.message || "Playback failed."
        };

        emit(EVENTS.ERROR, {
          error: lastError,
          track
        });

        throw error;
      }
    }

    async function play() {
      ensureInitialized();

      if (!currentTrack) {
        if (queue.length && queueIndex >= 0) {
          return playTrack(queue[queueIndex]);
        }

        throw new Error(
          "There is no track selected for playback."
        );
      }

      const validation = validateTrack(currentTrack);

      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      if (audio.src !== validation.audioUrl) {
        audio.src = validation.audioUrl;
      }

      await audio.play();

      return true;
    }

    function pause() {
      ensureInitialized();
      audio.pause();

      return true;
    }

    async function togglePlayback() {
      ensureInitialized();

      if (audio.paused) {
        return play();
      }

      pause();

      return false;
    }

    async function playNext() {
      ensureInitialized();

      if (!queue.length) {
        return false;
      }

      if (repeatMode === "one" && currentTrack) {
        audio.currentTime = 0;
        await audio.play();

        return true;
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

      queueIndex = nextIndex;

      await playTrack(queue[queueIndex], {
        updateQueue: false
      });

      return true;
    }

    async function playPrevious() {
      ensureInitialized();

      if (
        audio.currentTime > 3 &&
        currentTrack
      ) {
        audio.currentTime = 0;
        return true;
      }

      if (!queue.length) {
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

      queueIndex = previousIndex;

      await playTrack(queue[queueIndex], {
        updateQueue: false
      });

      return true;
    }

    async function handleEnded() {
      emit(EVENTS.ENDED, {
        track: currentTrack
      });

      if (repeatMode === "one") {
        try {
          audio.currentTime = 0;
          await audio.play();
        } catch (error) {
          emit(EVENTS.ERROR, {
            error: {
              message: error.message
            }
          });
        }

        return;
      }

      try {
        await playNext();
      } catch (error) {
        emit(EVENTS.ERROR, {
          error: {
            message: error.message
          }
        });
      }
    }

    /* =====================================================
       SEEKING
       ===================================================== */

    function seek(seconds) {
      ensureInitialized();

      const target = Number(seconds);

      if (!Number.isFinite(target)) {
        return false;
      }

      if (!Number.isFinite(audio.duration)) {
        return false;
      }

      audio.currentTime = Math.min(
        audio.duration,
        Math.max(0, target)
      );

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

      if (!duration) {
        return false;
      }

      return seek(duration * value);
    }

    function getCurrentTime() {
      return audio
        ? audio.currentTime || 0
        : 0;
    }

    function getDuration() {
      if (!audio || !Number.isFinite(audio.duration)) {
        return 0;
      }

      return audio.duration;
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

    /* =====================================================
       VOLUME
       ===================================================== */

    function setVolume(value) {
      ensureInitialized();

      const number = Number(value);

      if (!Number.isFinite(number)) {
        return audio.volume;
      }

      const volume = Math.min(
        1,
        Math.max(0, number)
      );

      audio.volume = volume;

      if (volume > 0) {
        previousVolume = volume;
        audio.muted = false;
        muted = false;
      }

      return audio.volume;
    }

    function getVolume() {
      return audio
        ? audio.volume
        : DEFAULTS.volume;
    }

    function mute() {
      ensureInitialized();

      if (!audio.muted && audio.volume > 0) {
        previousVolume = audio.volume;
      }

      audio.muted = true;
      muted = true;

      return true;
    }

    function unmute() {
      ensureInitialized();

      audio.muted = false;
      muted = false;

      if (audio.volume === 0) {
        audio.volume = previousVolume || DEFAULTS.volume;
      }

      return false;
    }

    function toggleMute() {
      ensureInitialized();

      if (audio.muted) {
        unmute();
      } else {
        mute();
      }

      return audio.muted;
    }

    function isMuted() {
      return audio
        ? audio.muted
        : muted;
    }

    /* =====================================================
       MEDIA SESSION
       ===================================================== */

    function setupMediaSession() {
      if (!("mediaSession" in navigator)) {
        return;
      }

      const actions = {
        play: () => play(),
        pause: () => pause(),
        previoustrack: () => playPrevious(),
        nexttrack: () => playNext(),
        seekbackward: details => {
          seek(
            getCurrentTime() -
            (details.seekOffset || 10)
          );
        },
        seekforward: details => {
          seek(
            getCurrentTime() +
            (details.seekOffset || 10)
          );
        },
        seekto: details => {
          if (Number.isFinite(details.seekTime)) {
            seek(details.seekTime);
          }
        }
      };

      Object.entries(actions).forEach(
        ([action, handler]) => {
          try {
            navigator.mediaSession.setActionHandler(
              action,
              handler
            );
          } catch {
            /*
             * Some browsers do not support every action.
             */
          }
        }
      );
    }

    function updateMediaSessionMetadata(track) {
      if (
        !("mediaSession" in navigator) ||
        !("MediaMetadata" in global) ||
        !track
      ) {
        return;
      }

      const artwork = getTrackArtwork(track);

      const artworkEntries = [];

      if (artwork && validateAudioUrl(artwork)) {
        artworkEntries.push({
          src: artwork,
          sizes: "512x512",
          type: "image/jpeg"
        });
      }

      try {
        navigator.mediaSession.metadata =
          new MediaMetadata({
            title: getTrackTitle(track),
            artist: getTrackArtist(track),
            album: String(
              track.album_title ||
              track.album ||
              "Resona"
            ),
            artwork: artworkEntries
          });
      } catch {
        /* Metadata support is optional. */
      }

      updateMediaSessionPosition();
    }

    function updateMediaSessionPosition() {
      if (
        !("mediaSession" in navigator) ||
        typeof navigator.mediaSession.setPositionState !== "function" ||
        !audio ||
        !Number.isFinite(audio.duration) ||
        audio.duration <= 0
      ) {
        return;
      }

      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(
            audio.currentTime,
            audio.duration
          )
        });
      } catch {
        /* Position reporting is optional. */
      }
    }

    /* =====================================================
       STATE
       ===================================================== */

    function getState() {
      return {
        initialized,
        currentTrack,
        queue: getQueue(),
        queueIndex,
        playing: Boolean(audio && !audio.paused),
        paused: !audio || audio.paused,
        currentTime: getCurrentTime(),
        duration: getDuration(),
        progress: getProgress(),
        volume: getVolume(),
        muted: isMuted(),
        shuffle: shuffleEnabled,
        repeat: repeatMode,
        lastError
      };
    }

    function destroy() {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }

      audio = null;
      currentTrack = null;
      initialized = false;

      emit(EVENTS.STATE_CHANGE);
    }

    /* =====================================================
       PUBLIC MODULE
       ===================================================== */

    return Object.freeze({
      EVENTS,

      init,
      destroy,

      on,
      getState,

      play,
      pause,
      togglePlayback,
      playTrack,
      playNext,
      playPrevious,

      setQueue,
      getQueue,
      getQueueIndex,
      getCurrentTrack,
      addToQueue,
      removeFromQueue,
      clearQueue,

      setShuffle,
      isShuffleEnabled,

      setRepeat,
      cycleRepeat,
      getRepeatMode,

      seek,
      seekToProgress,
      getCurrentTime,
      getDuration,
      getProgress,

      setVolume,
      getVolume,
      mute,
      unmute,
      toggleMute,
      isMuted
    });
  })();

  global.ResonaPlayer = ResonaPlayer;
})(window);
