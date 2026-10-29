/* =========================================================
   RESONA — AUDIO PLAYER MODULE
   File: js/player.js
   Version: 2.0.0

   Features:
   - HTML5 audio playback
   - Coordinator-compatible playback methods
   - Previous / next / resume / toggle repeat
   - Queue management
   - Seek and playback progress
   - Volume and mute
   - Shuffle and repeat off / all / one
   - Playback event handling
   - Audio URL validation
   - Playback-rights safeguards
   - Media Session API integration
   - Proper cleanup and error handling

   IMPORTANT:
   Client-side rights flags are not proof of licensing.
   Production playback must also be authorized by the server.
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
      STATE_CHANGE: "resona:player-state-change",
      BUFFERING: "resona:buffering"
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
    let lastError = null;
    let playbackRequest = 0;

    let originalQueueOrder = [];
    let listeners = new Map();
    let audioCleanup = [];

    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(name, detail = {}) {
      const eventDetail = {
        ...detail,
        track:
          Object.prototype.hasOwnProperty.call(detail, "track")
            ? detail.track
            : currentTrack,
        player: getState()
      };

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
        for (const callback of callbacks) {
          try {
            callback(eventDetail);
          } catch (error) {
            console.error(
              "[Resona Player] Event listener failed:",
              error
            );
          }
        }
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
       TRACK HELPERS
       ===================================================== */

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
          track.artist.name ||
          "Unknown artist"
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
        track?.preview_url ||
        track?.previewUrl ||
        ""
      ).trim();
    }

    function hasPlaybackPermission(track) {
      /*
       * Compatibility with the existing Resona data model.
       *
       * This flag is only a client-side safeguard.
       * Production authorization must be enforced by the
       * backend, which must verify the track's actual rights.
       */
      return Boolean(
        track &&
        track.rightsConfirmed === true
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

      if (!hasPlaybackPermission(track)) {
        return {
          valid: false,
          reason:
            "Playback is unavailable because the track's rights have not been confirmed."
        };
      }

      return {
        valid: true,
        audioUrl
      };
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

    function reportError(message, track = currentTrack) {
      lastError = {
        message: String(message || "Playback failed.")
      };

      emit(EVENTS.ERROR, {
        error: lastError,
        track
      });

      return lastError;
    }

    /* =====================================================
       INITIALIZATION
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

      audio = new global.Audio();

      audio.preload = "metadata";
      audio.volume = DEFAULTS.volume;

      const crossOrigin =
        options.crossOrigin ?? DEFAULTS.crossOrigin;

      if (
        crossOrigin === "anonymous" ||
        crossOrigin === "use-credentials"
      ) {
        audio.crossOrigin = crossOrigin;
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
       AUDIO EVENT MANAGEMENT
       ===================================================== */

    function listen(target, eventName, handler) {
      target.addEventListener(eventName, handler);

      audioCleanup.push(() => {
        target.removeEventListener(eventName, handler);
      });
    }

    function attachAudioEvents() {
      listen(audio, "play", () => {
        emit(EVENTS.PLAY);
        emit(EVENTS.STATE_CHANGE);
        updateMediaSessionPosition();
      });

      listen(audio, "pause", () => {
        emit(EVENTS.PAUSE);
        emit(EVENTS.STATE_CHANGE);
        updateMediaSessionPosition();
      });

      listen(audio, "timeupdate", () => {
        emit(EVENTS.TIME_UPDATE, {
          currentTime: getCurrentTime(),
          duration: getDuration(),
          progress: getProgress()
        });

        updateMediaSessionPosition();
      });

      listen(audio, "loadedmetadata", () => {
        emit(EVENTS.TIME_UPDATE, {
          currentTime: getCurrentTime(),
          duration: getDuration(),
          progress: getProgress()
        });

        updateMediaSessionPosition();
      });

      listen(audio, "ended", handleEnded);

      listen(audio, "volumechange", () => {
        muted = audio.muted;

        emit(EVENTS.VOLUME_CHANGE, {
          volume: audio.volume,
          muted: audio.muted
        });

        emit(EVENTS.STATE_CHANGE);
      });

      listen(audio, "error", () => {
        /*
         * Ignore an error event if a newer playback request
         * has already replaced the failed audio source.
         */
        const mediaError = audio?.error;

        if (!mediaError) {
          return;
        }

        const message = getMediaErrorMessage(mediaError);

        lastError = {
          code: mediaError.code || 0,
          message
        };

        emit(EVENTS.ERROR, {
          error: lastError,
          track: currentTrack
        });
      });

      listen(audio, "waiting", () => {
        emit(EVENTS.BUFFERING, {
          buffering: true
        });
      });

      listen(audio, "playing", () => {
        emit(EVENTS.BUFFERING, {
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
       QUEUE MANAGEMENT
       ===================================================== */

    function setQueue(tracks, startIndex = 0) {
      if (!Array.isArray(tracks)) {
        throw new TypeError(
          "The playback queue must be an array."
        );
      }

      queue = tracks
        .filter(track => (
          track &&
          typeof track === "object"
        ))
        .slice(0, getMaxQueue());

      originalQueueOrder = queue.slice();

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
        shuffleQueue(false);
      }

      emit(EVENTS.QUEUE_CHANGE, {
        queue: getQueue(),
        index: queueIndex
      });

      emit(EVENTS.STATE_CHANGE);

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

      if (queue.length >= getMaxQueue()) {
        throw new Error(
          "The playback queue has reached its maximum size."
        );
      }

      queue.push(track);
      originalQueueOrder.push(track);

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

      const removedTrack = queue[targetIndex];

      queue.splice(targetIndex, 1);

      const originalIndex = originalQueueOrder.findIndex(
        track => track === removedTrack
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

      emit(EVENTS.QUEUE_CHANGE, {
        queue: [],
        index: -1
      });

      emit(EVENTS.STATE_CHANGE);

      return true;
    }

    /* =====================================================
       SHUFFLE
       ===================================================== */

    function shuffleQueue(emitEvent = true) {
      if (queue.length < 2) {
        if (emitEvent) {
          emit(EVENTS.QUEUE_CHANGE, {
            queue: getQueue(),
            index: queueIndex,
            shuffled: true
          });
        }

        return;
      }

      const current =
        queueIndex >= 0
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

      if (emitEvent) {
        emit(EVENTS.QUEUE_CHANGE, {
          queue: getQueue(),
          index: queueIndex,
          shuffled: true
        });
      }
    }

    function setShuffle(enabled) {
      const nextValue = Boolean(enabled);

      if (nextValue === shuffleEnabled) {
        return shuffleEnabled;
      }

      if (nextValue) {
        originalQueueOrder = queue.slice();
        shuffleEnabled = true;
        shuffleQueue();
      } else {
        shuffleEnabled = false;

        const current = currentTrack;

        queue = originalQueueOrder.slice();

        queueIndex = current
          ? queue.findIndex(
              track => sameTrack(track, current)
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
       TRACK SELECTION AND PLAYBACK
       ===================================================== */

    function syncTrackToQueue(track) {
      const id = getTrackId(track);

      let index = id
        ? queue.findIndex(
            item => getTrackId(item) === id
          )
        : -1;

      if (index < 0) {
        index = queue.findIndex(
          item => item === track
        );
      }

      if (index >= 0) {
        queueIndex = index;
        return;
      }

      if (queue.length >= getMaxQueue()) {
        /*
         * Avoid growing the queue beyond its configured cap.
         * Replace the queue with the selected track.
         */
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

    async function playTrack(track, options = {}) {
      ensureInitialized();

      if (!track || typeof track !== "object") {
        throw new TypeError(
          "A valid track is required."
        );
      }

      const validation = validateTrack(track);

      if (!validation.valid) {
        reportError(validation.reason, track);
        throw new Error(validation.reason);
      }

      const requestId = ++playbackRequest;
      const previousTrack = currentTrack;

      lastError = null;

      try {
        /*
         * Validate before changing currentTrack so an invalid
         * track does not replace the currently selected track.
         */
        audio.pause();

        audio.src = validation.audioUrl;
        audio.load();

        currentTrack = track;

        if (options.updateQueue !== false) {
          syncTrackToQueue(track);
        } else {
          const index = queue.findIndex(
            item => sameTrack(item, track)
          );

          if (index >= 0) {
            queueIndex = index;
          }
        }

        emit(EVENTS.TRACK_CHANGE, {
          track,
          previousTrack
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
          lastError = {
            message:
              error?.message ||
              "Playback failed."
          };

          emit(EVENTS.ERROR, {
            error: lastError,
            track
          });
        }

        throw error;
      }
    }

    async function play() {
      ensureInitialized();

      if (!currentTrack) {
        if (queue.length && queueIndex >= 0) {
          return playTrack(queue[queueIndex], {
            updateQueue: false
          });
        }

        throw new Error(
          "There is no track selected for playback."
        );
      }

      const validation = validateTrack(currentTrack);

      if (!validation.valid) {
        reportError(validation.reason);
        throw new Error(validation.reason);
      }

      if (
        !audio.src ||
        audio.src !== new URL(
          validation.audioUrl,
          global.location.href
        ).href
      ) {
        audio.src = validation.audioUrl;
        audio.load();
      }

      try {
        await audio.play();

        emit(EVENTS.STATE_CHANGE);

        return true;
      } catch (error) {
        reportError(
          error?.message || "Unable to resume playback."
        );

        throw error;
      }
    }

    /*
     * Compatibility aliases for js/app.js.
     * These preserve the older names used by the coordinator.
     */

    async function resume() {
      return play();
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

    async function next() {
      return playNext();
    }

    async function previous() {
      return playPrevious();
    }

    function toggleRepeat() {
      return cycleRepeat();
    }

    async function playNext() {
      ensureInitialized();

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
          throw error;
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

    async function handleEnded() {
      emit(EVENTS.ENDED, {
        track: currentTrack
      });

      if (repeatMode === "one") {
        try {
          audio.currentTime = 0;
          await audio.play();
        } catch (error) {
          reportError(error?.message);
        }

        return;
      }

      try {
        await playNext();
      } catch (error) {
        reportError(error?.message);
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

      if (
        !Number.isFinite(audio.duration) ||
        audio.duration < 0
      ) {
        return false;
      }

      audio.currentTime = Math.min(
        audio.duration,
        Math.max(0, target)
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
      return audio
        ? audio.currentTime || 0
        : 0;
    }

    function getDuration() {
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
        Math.max(0, getCurrentTime() / duration)
      );
    }

    /* =====================================================
       VOLUME AND MUTE
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
        audio.volume =
          previousVolume || DEFAULTS.volume;
      }

      return true;
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
      if (!global.navigator?.mediaSession) {
        return;
      }

      const session = global.navigator.mediaSession;

      const actions = {
        play: () => resume(),
        pause: () => pause(),
        previoustrack: () => previous(),
        nexttrack: () => next(),

        seekbackward: details => {
          seek(
            getCurrentTime() -
            (details?.seekOffset || 10)
          );
        },

        seekforward: details => {
          seek(
            getCurrentTime() +
            (details?.seekOffset || 10)
          );
        },

        seekto: details => {
          if (Number.isFinite(details?.seekTime)) {
            seek(details.seekTime);
          }
        }
      };

      for (const [action, handler] of Object.entries(actions)) {
        try {
          session.setActionHandler(action, handler);
        } catch {
          // Unsupported Media Session actions are optional.
        }
      }
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

      if (artwork && validateHttpUrl(artwork)) {
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
        // Metadata support is optional.
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
        // Position reporting is optional.
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

    /* =====================================================
       CLEANUP
       ===================================================== */

    function destroy() {
      /*
       * Invalidate pending play requests so an older promise
       * cannot be treated as the current playback request.
       */
      playbackRequest++;

      if (audio) {
        audio.pause();

        for (const cleanup of audioCleanup) {
          try {
            cleanup();
          } catch {
            // Continue cleanup if one handler fails.
          }
        }

        audioCleanup = [];

        audio.removeAttribute("src");
        audio.load();
      }

      audio = null;
      initialized = false;
      currentTrack = null;
      queue = [];
      originalQueueOrder = [];
      queueIndex = -1;
      lastError = null;

      emit(EVENTS.STATE_CHANGE);
    }

    /* =====================================================
       PUBLIC API
       ===================================================== */

    return Object.freeze({
      EVENTS,

      init,
      destroy,

      on,
      getState,

      play,
      resume,
      pause,
      togglePlayback,

      playTrack,
      playNext,
      playPrevious,

      // Backward-compatible coordinator aliases.
      next,
      previous,

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
      toggleRepeat,
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
