/* =========================================================
   RESONA — SHARED UI UTILITIES
   File: js/ui.js

   Features:
   - Safe HTML escaping
   - Notifications and toast messages
   - Loading and empty states
   - Modal dialogs
   - Number, date, and duration formatting
   - Image fallbacks
   - Track-card rendering
   - Button loading states
   - Accessible DOM helpers
   - Confirmation dialogs

   Public API:
   window.ResonaUI
   ========================================================= */

(function (window, document) {
  "use strict";

  if (window.ResonaUI) {
    console.warn("[Resona UI] Already initialized.");
    return;
  }

  const activeToasts = new Map();
  const activeModals = new Set();

  let toastContainer = null;
  let modalContainer = null;
  let toastCounter = 0;

  const DEFAULTS = {
    toastDuration: 3500,
    maxVisibleToasts: 5,
    imageFallback:
      "data:image/svg+xml;charset=UTF-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#171717"/><circle cx="160" cy="128" r="48" fill="#b9913b" opacity=".35"/><path d="M105 215c0-30 25-54 55-54s55 24 55 54" fill="#b9913b" opacity=".35"/><text x="160" y="270" fill="#d5b56a" font-family="Arial,sans-serif" font-size="20" text-anchor="middle">RESONA</text></svg>'
      )
  };

  /* =========================================================
     BASIC HELPERS
     ========================================================= */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from(
      (root || document).querySelectorAll(selector)
    );
  }

  function createElement(tag, attributes, children) {
    const element = document.createElement(tag);

    const attrs = attributes || {};

    Object.keys(attrs).forEach(function (key) {
      const value = attrs[key];

      if (value === undefined || value === null) {
        return;
      }

      if (key === "className") {
        element.className = String(value);
      } else if (key === "textContent") {
        element.textContent = String(value);
      } else if (key === "htmlFor") {
        element.htmlFor = String(value);
      } else if (key === "dataset" && typeof value === "object") {
        Object.keys(value).forEach(function (dataKey) {
          element.dataset[dataKey] = String(value[dataKey]);
        });
      } else if (key === "style" && typeof value === "object") {
        Object.assign(element.style, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in element && key !== "srcdoc") {
        try {
          element[key] = value;
        } catch (_) {
          element.setAttribute(key, String(value));
        }
      } else {
        element.setAttribute(key, String(value));
      }
    });

    if (children !== undefined && children !== null) {
      const items = Array.isArray(children) ? children : [children];

      items.forEach(function (child) {
        if (child instanceof Node) {
          element.appendChild(child);
        } else if (child !== undefined && child !== null) {
          element.appendChild(
            document.createTextNode(String(child))
          );
        }
      });
    }

    return element;
  }

  function escapeHTML(value) {
    const text = value === undefined || value === null
      ? ""
      : String(value);

    return text.replace(/[&<>"']/g, function (character) {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };

      return entities[character];
    });
  }

  function normalizeText(value, fallback) {
    if (value === undefined || value === null) {
      return fallback || "";
    }

    const text = String(value).trim();

    return text || fallback || "";
  }

  function clamp(value, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return min;
    }

    return Math.min(max, Math.max(min, number));
  }

  function debounce(callback, delay) {
    let timer = null;

    return function () {
      const context = this;
      const args = arguments;

      clearTimeout(timer);

      timer = setTimeout(function () {
        callback.apply(context, args);
      }, Math.max(0, Number(delay) || 0));
    };
  }

  function throttle(callback, delay) {
    let lastRun = 0;
    let timer = null;

    return function () {
      const context = this;
      const args = arguments;
      const now = Date.now();
      const wait = Math.max(0, Number(delay) || 0);
      const remaining = wait - (now - lastRun);

      if (remaining <= 0) {
        clearTimeout(timer);
        timer = null;
        lastRun = now;
        callback.apply(context, args);
      } else if (!timer) {
        timer = setTimeout(function () {
          timer = null;
          lastRun = Date.now();
          callback.apply(context, args);
        }, remaining);
      }
    };
  }

  function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return new Intl.NumberFormat().format(number);
  }

  function formatDuration(seconds) {
    const total = Math.floor(Number(seconds));

    if (!Number.isFinite(total) || total < 0) {
      return "0:00";
    }

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    const paddedSeconds = String(remainingSeconds).padStart(2, "0");

    if (hours > 0) {
      return (
        hours +
        ":" +
        String(minutes).padStart(2, "0") +
        ":" +
        paddedSeconds
      );
    }

    return minutes + ":" + paddedSeconds;
  }

  function formatDate(value, options) {
    if (!value) {
      return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    try {
      return new Intl.DateTimeFormat(
        undefined,
        options || {
          year: "numeric",
          month: "short",
          day: "numeric"
        }
      ).format(date);
    } catch (_) {
      return date.toLocaleDateString();
    }
  }

  function formatRelativeTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const difference = date.getTime() - Date.now();
    const seconds = Math.round(difference / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (Math.abs(seconds) < 45) {
      return "just now";
    }

    if (Math.abs(minutes) < 60) {
      return minutes < 0
        ? Math.abs(minutes) + " minutes ago"
        : "in " + minutes + " minutes";
    }

    if (Math.abs(hours) < 24) {
      return hours < 0
        ? Math.abs(hours) + " hours ago"
        : "in " + hours + " hours";
    }

    if (Math.abs(days) < 7) {
      return days < 0
        ? Math.abs(days) + " days ago"
        : "in " + days + " days";
    }

    return formatDate(date);
  }

  function getTrackId(track) {
    if (!track || typeof track !== "object") {
      return "";
    }

    return String(
      track.id ||
      track.track_id ||
      track.trackId ||
      track.uuid ||
      ""
    ).trim();
  }

  function getTrackTitle(track) {
    if (!track || typeof track !== "object") {
      return "Unknown track";
    }

    return normalizeText(
      track.title || track.name,
      "Untitled track"
    );
  }

  function getArtistName(track) {
    if (!track || typeof track !== "object") {
      return "Unknown artist";
    }

    const artist = track.artist;

    if (typeof artist === "string") {
      return normalizeText(artist, "Unknown artist");
    }

    if (artist && typeof artist === "object") {
      return normalizeText(
        artist.name || artist.display_name,
        "Unknown artist"
      );
    }

    return normalizeText(
      track.artistName ||
      track.artist_name ||
      track.artist_display_name,
      "Unknown artist"
    );
  }

  function getTrackArtwork(track) {
    if (!track || typeof track !== "object") {
      return DEFAULTS.imageFallback;
    }

    const artwork =
      track.artwork ||
      track.cover ||
      track.cover_url ||
      track.coverUrl ||
      track.image ||
      track.image_url ||
      track.artwork_url ||
      track.thumbnail;

    if (typeof artwork === "string" && artwork.trim()) {
      return safeImageURL(artwork);
    }

    if (artwork && typeof artwork === "object") {
      const url =
        artwork.url ||
        artwork.src ||
        artwork.original ||
        artwork.large ||
        artwork.medium;

      if (typeof url === "string" && url.trim()) {
        return safeImageURL(url);
      }
    }

    return DEFAULTS.imageFallback;
  }

  /* =========================================================
     SAFE URL HELPERS
     ========================================================= */

  function safeURL(value, options) {
    const settings = options || {};

    if (typeof value !== "string" || !value.trim()) {
      return "";
    }

    const raw = value.trim();

    if (/^(javascript|vbscript|file):/i.test(raw)) {
      return "";
    }

    if (/^data:/i.test(raw)) {
      return settings.allowDataImages &&
        /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(raw)
        ? raw
        : "";
    }

    try {
      const parsed = new URL(raw, window.location.href);

      if (
        parsed.protocol !== "https:" &&
        parsed.protocol !== "http:"
      ) {
        return "";
      }

      if (
        window.location.protocol === "https:" &&
        parsed.protocol === "http:" &&
        parsed.origin !== window.location.origin
      ) {
        return "";
      }

      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function safeImageURL(value) {
    const result = safeURL(value, {
      allowDataImages: true
    });

    return result || DEFAULTS.imageFallback;
  }

  function safeExternalURL(value) {
    const result = safeURL(value);

    if (!result) {
      return "";
    }

    try {
      const parsed = new URL(result);

      if (
        parsed.protocol !== "https:" &&
        parsed.origin !== window.location.origin
      ) {
        return "";
      }

      return result;
    } catch (_) {
      return "";
    }
  }

  function setSafeImage(image, source, fallback) {
    if (!image || image.tagName !== "IMG") {
      return false;
    }

    const fallbackURL = safeImageURL(
      fallback || DEFAULTS.imageFallback
    );

    const imageURL = safeImageURL(source);

    image.onerror = function () {
      image.onerror = null;
      image.src = fallbackURL;
    };

    image.src = imageURL;

    return true;
  }

  /* =========================================================
     TOAST NOTIFICATIONS
     ========================================================= */

  function ensureToastContainer() {
    if (
      toastContainer &&
      document.documentElement.contains(toastContainer)
    ) {
      return toastContainer;
    }

    toastContainer = document.getElementById(
      "resona-toast-container"
    );

    if (toastContainer) {
      return toastContainer;
    }

    toastContainer = createElement("div", {
      id: "resona-toast-container",
      className: "resona-toast-container",
      role: "region",
      "aria-label": "Notifications",
      "aria-live": "polite"
    });

    document.body.appendChild(toastContainer);

    return toastContainer;
  }

  function ensureToastStyles() {
    if (document.getElementById("resona-ui-toast-styles")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "resona-ui-toast-styles";

    style.textContent = `
      .resona-toast-container {
        position: fixed;
        z-index: 99990;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(380px, calc(100vw - 32px));
        pointer-events: none;
      }

      .resona-toast {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        color: #f7f4ed;
        background: #191919;
        border: 1px solid rgba(213, 181, 106, .32);
        border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, .32);
        font: inherit;
        font-size: 14px;
        line-height: 1.5;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(12px);
        transition: opacity .2s ease, transform .2s ease;
      }

      .resona-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .resona-toast__message {
        flex: 1;
        overflow-wrap: anywhere;
      }

      .resona-toast__close {
        flex-shrink: 0;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-size: 19px;
        line-height: 1;
        padding: 0 2px;
      }

      .resona-toast--success {
        border-left: 4px solid #50c878;
      }

      .resona-toast--error {
        border-left: 4px solid #ef6262;
      }

      .resona-toast--warning {
        border-left: 4px solid #e8b84d;
      }

      .resona-toast--info {
        border-left: 4px solid #8cacf7;
      }

      @media (prefers-reduced-motion: reduce) {
        .resona-toast {
          transition: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function dismissToast(id) {
    const toast = activeToasts.get(id);

    if (!toast) {
      return false;
    }

    activeToasts.delete(id);

    toast.element.classList.remove("is-visible");

    setTimeout(function () {
      if (toast.element.parentNode) {
        toast.element.parentNode.removeChild(toast.element);
      }
    }, 220);

    return true;
  }

  function toast(message, options) {
    const settings = options || {};

    ensureToastStyles();

    const container = ensureToastContainer();

    while (
      activeToasts.size >= DEFAULTS.maxVisibleToasts
    ) {
      const oldestId = activeToasts.keys().next().value;

      if (oldestId === undefined) {
        break;
      }

      dismissToast(oldestId);
    }

    const id = "resona-toast-" + (++toastCounter);

    const type = [
      "success",
      "error",
      "warning",
      "info"
    ].includes(settings.type)
      ? settings.type
      : "info";

    const element = createElement("div", {
      id: id,
      className: "resona-toast resona-toast--" + type,
      role: type === "error" ? "alert" : "status"
    });

    const messageElement = createElement("div", {
      className: "resona-toast__message",
      textContent: normalizeText(message, "")
    });

    element.appendChild(messageElement);

    const closeButton = createElement("button", {
      type: "button",
      className: "resona-toast__close",
      "aria-label": "Dismiss notification",
      textContent: "×"
    });

    closeButton.addEventListener("click", function () {
      dismissToast(id);
    });

    element.appendChild(closeButton);
    container.appendChild(element);

    const duration = settings.duration === 0
      ? 0
      : Math.max(
          500,
          Number(settings.duration) || DEFAULTS.toastDuration
        );

    const timer = duration
      ? setTimeout(function () {
          dismissToast(id);
        }, duration)
      : null;

    activeToasts.set(id, {
      element: element,
      timer: timer
    });

    requestAnimationFrame(function () {
      element.classList.add("is-visible");
    });

    return {
      id: id,
      dismiss: function () {
        if (timer) {
          clearTimeout(timer);
        }

        return dismissToast(id);
      }
    };
  }

  function success(message, options) {
    return toast(message, Object.assign({}, options, {
      type: "success"
    }));
  }

  function error(message, options) {
    return toast(message, Object.assign({}, options, {
      type: "error"
    }));
  }

  function warning(message, options) {
    return toast(message, Object.assign({}, options, {
      type: "warning"
    }));
  }

  function info(message, options) {
    return toast(message, Object.assign({}, options, {
      type: "info"
    }));
  }

  /* =========================================================
     LOADING AND EMPTY STATES
     ========================================================= */

  function showLoading(target, options) {
    const element = typeof target === "string"
      ? $(target)
      : target;

    if (!element) {
      return false;
    }

    const settings = options || {};

    element.setAttribute("aria-busy", "true");

    const loading = createElement("div", {
      className: "resona-loading",
      role: "status",
      "aria-live": "polite"
    });

    const spinner = createElement("span", {
      className: "resona-loading__spinner",
      "aria-hidden": "true"
    });

    const label = createElement("span", {
      className: "resona-loading__label",
      textContent: settings.message || "Loading..."
    });

    loading.appendChild(spinner);
    loading.appendChild(label);

    clearState(element);
    element.appendChild(loading);

    return loading;
  }

  function showEmpty(target, options) {
    const element = typeof target === "string"
      ? $(target)
      : target;

    if (!element) {
      return false;
    }

    const settings = options || {};

    const empty = createElement("div", {
      className: "resona-empty-state"
    });

    if (settings.icon) {
      empty.appendChild(
        createElement("div", {
          className: "resona-empty-state__icon",
          "aria-hidden": "true",
          textContent: settings.icon
        })
      );
    }

    empty.appendChild(
      createElement("h3", {
        className: "resona-empty-state__title",
        textContent: settings.title || "Nothing here yet"
      })
    );

    if (settings.message) {
      empty.appendChild(
        createElement("p", {
          className: "resona-empty-state__message",
          textContent: settings.message
        })
      );
    }

    if (settings.actionLabel && typeof settings.onAction === "function") {
      const action = createElement("button", {
        type: "button",
        className: "resona-button resona-button--primary",
        textContent: settings.actionLabel
      });

      action.addEventListener("click", settings.onAction);

      empty.appendChild(action);
    }

    clearState(element);
    element.appendChild(empty);

    return empty;
  }

  function showErrorState(target, options) {
    const settings = Object.assign({
      title: "Something went wrong",
      message: "We couldn't load this content. Please try again.",
      actionLabel: "Try again"
    }, options || {});

    return showEmpty(target, {
      icon: "!",
      title: settings.title,
      message: settings.message,
      actionLabel: settings.actionLabel,
      onAction: settings.onAction
    });
  }

  function clearState(target) {
    const element = typeof target === "string"
      ? $(target)
      : target;

    if (!element) {
      return false;
    }

    const states = element.querySelectorAll(
      ":scope > .resona-loading, " +
      ":scope > .resona-empty-state"
    );

    states.forEach(function (state) {
      state.remove();
    });

    element.removeAttribute("aria-busy");

    return true;
  }

  function ensureLoadingStyles() {
    if (document.getElementById("resona-ui-loading-styles")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "resona-ui-loading-styles";

    style.textContent = `
      .resona-loading,
      .resona-empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
        min-height: 140px;
        padding: 28px 18px;
        text-align: center;
        color: #bdb8ad;
      }

      .resona-loading__spinner {
        width: 28px;
        height: 28px;
        border: 3px solid rgba(213, 181, 106, .2);
        border-top-color: #d5b56a;
        border-radius: 50%;
        animation: resona-spin .75s linear infinite;
      }

      .resona-loading__label {
        font-size: 14px;
      }

      .resona-empty-state__icon {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        color: #d5b56a;
        background: rgba(213, 181, 106, .1);
        font-size: 22px;
        font-weight: 700;
      }

      .resona-empty-state__title {
        margin: 0;
        color: #f4f0e8;
        font-size: 18px;
      }

      .resona-empty-state__message {
        max-width: 440px;
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
      }

      @keyframes resona-spin {
        to { transform: rotate(360deg); }
      }

      @media (prefers-reduced-motion: reduce) {
        .resona-loading__spinner {
          animation: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     BUTTON LOADING STATES
     ========================================================= */

  function setButtonLoading(button, loading, label) {
    if (!button) {
      return false;
    }

    if (loading) {
      if (!button.dataset.resonaOriginalText) {
        button.dataset.resonaOriginalText =
          button.textContent || "";
      }

      button.dataset.resonaWasDisabled =
        button.disabled ? "true" : "false";

      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("is-loading");

      button.textContent = label || "Please wait...";

      return true;
    }

    if (button.dataset.resonaOriginalText !== undefined) {
      button.textContent = button.dataset.resonaOriginalText;
      delete button.dataset.resonaOriginalText;
    }

    button.disabled =
      button.dataset.resonaWasDisabled === "true";

    delete button.dataset.resonaWasDisabled;

    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");

    return true;
  }

  /* =========================================================
     MODAL DIALOGS
     ========================================================= */

  function ensureModalStyles() {
    if (document.getElementById("resona-ui-modal-styles")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "resona-ui-modal-styles";

    style.textContent = `
      .resona-modal-container {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, .72);
        backdrop-filter: blur(6px);
      }

      .resona-modal {
        width: min(100%, 520px);
        max-height: min(85vh, 760px);
        overflow: auto;
        color: #f4f0e8;
        background: #171717;
        border: 1px solid rgba(213, 181, 106, .35);
        border-radius: 18px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .5);
      }

      .resona-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 22px;
        border-bottom: 1px solid rgba(255, 255, 255, .08);
      }

      .resona-modal__title {
        margin: 0;
        font-size: 20px;
      }

      .resona-modal__close {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        border: 0;
        border-radius: 10px;
        color: inherit;
        background: rgba(255, 255, 255, .06);
        cursor: pointer;
        font-size: 23px;
      }

      .resona-modal__body {
        padding: 22px;
        line-height: 1.6;
      }

      .resona-modal__footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 22px 22px;
      }

      .resona-modal__body p:first-child {
        margin-top: 0;
      }

      .resona-modal__body p:last-child {
        margin-bottom: 0;
      }

      .resona-modal__footer button {
        min-height: 42px;
        padding: 10px 16px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 10px;
        color: inherit;
        background: rgba(255, 255, 255, .06);
        cursor: pointer;
        font: inherit;
      }

      .resona-modal__footer .resona-modal__primary {
        color: #17130b;
        background: #d5b56a;
        border-color: #d5b56a;
        font-weight: 700;
      }

      .resona-modal__footer button:focus-visible,
      .resona-modal__close:focus-visible {
        outline: 2px solid #d5b56a;
        outline-offset: 3px;
      }

      @media (max-width: 480px) {
        .resona-modal-container {
          padding: 12px;
        }

        .resona-modal__header,
        .resona-modal__body {
          padding: 16px;
        }

        .resona-modal__footer {
          padding: 12px 16px 16px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function openModal(options) {
    const settings = options || {};

    ensureModalStyles();

    if (!modalContainer || !document.documentElement.contains(modalContainer)) {
      modalContainer = createElement("div", {
        className: "resona-modal-container",
        role: "presentation"
      });

      document.body.appendChild(modalContainer);
    }

    const previousFocus = document.activeElement;

    const modal = createElement("section", {
      className: "resona-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "resona-modal-title-" + createUniqueId()
    });

    const titleId = modal.getAttribute("aria-labelledby");

    const header = createElement("header", {
      className: "resona-modal__header"
    });

    const title = createElement("h2", {
      id: titleId,
      className: "resona-modal__title",
      textContent: settings.title || "Resona"
    });

    const closeButton = createElement("button", {
      type: "button",
      className: "resona-modal__close",
      "aria-label": "Close dialog",
      textContent: "×"
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    const body = createElement("div", {
      className: "resona-modal__body"
    });

    if (settings.content instanceof Node) {
      body.appendChild(settings.content);
    } else if (settings.html !== undefined) {
      // Deliberately do not insert arbitrary HTML.
      // Use settings.content with DOM nodes for rich content.
      body.textContent = String(settings.html);
    } else {
      body.textContent = String(settings.message || "");
    }

    modal.appendChild(header);
    modal.appendChild(body);

    const footer = createElement("footer", {
      className: "resona-modal__footer"
    });

    const buttons = Array.isArray(settings.buttons)
      ? settings.buttons
      : [];

    buttons.forEach(function (buttonConfig) {
      const config = buttonConfig || {};

      const button = createElement("button", {
        type: "button",
        className: config.primary
          ? "resona-modal__primary"
          : "",
        textContent: config.label || "OK"
      });

      button.addEventListener("click", function () {
        if (typeof config.onClick === "function") {
          config.onClick(close);
        }

        if (config.closeOnClick !== false) {
          close();
        }
      });

      footer.appendChild(button);
    });

    if (buttons.length > 0) {
      modal.appendChild(footer);
    }

    modalContainer.appendChild(modal);
    activeModals.add(modal);

    function onKeyDown(event) {
      if (event.key === "Escape" && settings.dismissible !== false) {
        close();
      }

      if (event.key === "Tab") {
        const focusable = $$(
          'button:not([disabled]), input:not([disabled]), ' +
          'select:not([disabled]), textarea:not([disabled]), ' +
          'a[href], [tabindex]:not([tabindex="-1"])',
          modal
        );

        if (!focusable.length) {
          event.preventDefault();
          modal.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    function close() {
      if (!activeModals.has(modal)) {
        return false;
      }

      activeModals.delete(modal);
      document.removeEventListener("keydown", onKeyDown);

      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }

      if (
        modalContainer &&
        modalContainer.children.length === 0
      ) {
        modalContainer.remove();
        modalContainer = null;
      }

      if (
        previousFocus &&
        typeof previousFocus.focus === "function" &&
        document.documentElement.contains(previousFocus)
      ) {
        previousFocus.focus();
      }

      if (typeof settings.onClose === "function") {
        settings.onClose();
      }

      return true;
    }

    closeButton.addEventListener("click", close);

    if (settings.dismissible !== false) {
      modalContainer.addEventListener("click", function backdropHandler(event) {
        if (
          event.target === modalContainer &&
          activeModals.has(modal)
        ) {
          close();
          modalContainer.removeEventListener(
            "click",
            backdropHandler
          );
        }
      });
    }

    document.addEventListener("keydown", onKeyDown);

    const initialFocus = $(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
      modal
    );

    (initialFocus || modal).focus();

    return {
      element: modal,
      close: close
    };
  }

  function createUniqueId() {
    return (
      "modal-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function confirm(options) {
    const settings = typeof options === "string"
      ? { message: options }
      : (options || {});

    return new Promise(function (resolve) {
      let resolved = false;

      function finish(value) {
        if (resolved) {
          return;
        }

        resolved = true;
        resolve(value);
      }

      openModal({
        title: settings.title || "Are you sure?",
        message:
          settings.message ||
          "Do you want to continue?",
        dismissible: settings.dismissible !== false,
        buttons: [
          {
            label: settings.cancelLabel || "Cancel",
            onClick: function () {
              finish(false);
            }
          },
          {
            label: settings.confirmLabel || "Continue",
            primary: true,
            onClick: function () {
              finish(true);
            }
          }
        ],
        onClose: function () {
          finish(false);
        }
      });
    });
  }

  /* =========================================================
     TRACK CARD RENDERING
     ========================================================= */

  function renderTrackCard(track, options) {
    if (!track || typeof track !== "object") {
      return null;
    }

    const settings = options || {};
    const trackId = getTrackId(track);

    const card = createElement("article", {
      className: "resona-track-card",
      dataset: {
        trackId: trackId
      }
    });

    const artworkButton = createElement("button", {
      type: "button",
      className: "resona-track-card__artwork-button",
      "aria-label": "Play " + getTrackTitle(track)
    });

    const artwork = createElement("img", {
      className: "resona-track-card__artwork",
      alt: getTrackTitle(track) + " cover artwork",
      loading: "lazy",
      decoding: "async"
    });

    setSafeImage(artwork, getTrackArtwork(track));

    artworkButton.appendChild(artwork);

    if (typeof settings.onPlay === "function") {
      artworkButton.addEventListener("click", function () {
        settings.onPlay(track);
      });
    }

    card.appendChild(artworkButton);

    const details = createElement("div", {
      className: "resona-track-card__details"
    });

    const title = createElement("h3", {
      className: "resona-track-card__title",
      textContent: getTrackTitle(track)
    });

    const artist = createElement("p", {
      className: "resona-track-card__artist",
      textContent: getArtistName(track)
    });

    details.appendChild(title);
    details.appendChild(artist);

    if (track.album || track.albumTitle || track.album_name) {
      const album = createElement("p", {
        className: "resona-track-card__album",
        textContent: normalizeText(
          track.albumTitle ||
          track.album_name ||
          track.album,
          ""
        )
      });

      details.appendChild(album);
    }

    card.appendChild(details);

    const actions = createElement("div", {
      className: "resona-track-card__actions"
    });

    if (settings.showLike !== false) {
      const liked = Boolean(
        window.ResonaLibrary &&
        typeof window.ResonaLibrary.isLiked === "function" &&
        window.ResonaLibrary.isLiked(trackId)
      );

      const likeButton = createElement("button", {
        type: "button",
        className: "resona-track-card__like",
        "aria-label": liked
          ? "Unlike " + getTrackTitle(track)
          : "Like " + getTrackTitle(track),
        "aria-pressed": liked ? "true" : "false",
        textContent: liked ? "♥" : "♡"
      });

      likeButton.addEventListener("click", function () {
        if (typeof settings.onLike === "function") {
          settings.onLike(track, likeButton);
          return;
        }

        if (
          window.ResonaLibrary &&
          typeof window.ResonaLibrary.toggleLike === "function"
        ) {
          const result = window.ResonaLibrary.toggleLike(track);

          if (result && result.success) {
            const nowLiked = result.liked === true;

            likeButton.textContent = nowLiked ? "♥" : "♡";

            likeButton.setAttribute(
              "aria-pressed",
              nowLiked ? "true" : "false"
            );

            likeButton.setAttribute(
              "aria-label",
              (nowLiked ? "Unlike " : "Like ") +
              getTrackTitle(track)
            );
          }
        }
      });

      actions.appendChild(likeButton);
    }

    if (settings.showSave === true) {
      const saved = Boolean(
        window.ResonaLibrary &&
        typeof window.ResonaLibrary.isSaved === "function" &&
        window.ResonaLibrary.isSaved(trackId)
      );

      const saveButton = createElement("button", {
        type: "button",
        className: "resona-track-card__save",
        "aria-label": saved
          ? "Remove from saved tracks"
          : "Save track",
        "aria-pressed": saved ? "true" : "false",
        textContent: saved ? "Saved" : "Save"
      });

      saveButton.addEventListener("click", function () {
        if (typeof settings.onSave === "function") {
          settings.onSave(track, saveButton);
          return;
        }

        if (
          window.ResonaLibrary &&
          typeof window.ResonaLibrary.toggleSaved === "function"
        ) {
          const result = window.ResonaLibrary.toggleSaved(track);

          if (result && result.success) {
            const nowSaved = result.saved === true;

            saveButton.textContent = nowSaved ? "Saved" : "Save";

            saveButton.setAttribute(
              "aria-pressed",
              nowSaved ? "true" : "false"
            );

            saveButton.setAttribute(
              "aria-label",
              nowSaved
                ? "Remove from saved tracks"
                : "Save track"
            );
          }
        }
      });

      actions.appendChild(saveButton);
    }

    if (typeof settings.onMore === "function") {
      const moreButton = createElement("button", {
        type: "button",
        className: "resona-track-card__more",
        "aria-label": "More options for " + getTrackTitle(track),
        textContent: "⋯"
      });

      moreButton.addEventListener("click", function () {
        settings.onMore(track, moreButton);
      });

      actions.appendChild(moreButton);
    }

    card.appendChild(actions);

    return card;
  }

  function renderTrackList(target, tracks, options) {
    const container = typeof target === "string"
      ? $(target)
      : target;

    if (!container) {
      return false;
    }

    const list = Array.isArray(tracks) ? tracks : [];
    const settings = options || {};

    container.replaceChildren();

    if (list.length === 0) {
      showEmpty(container, {
        icon: settings.emptyIcon || "♫",
        title: settings.emptyTitle || "No tracks found",
        message:
          settings.emptyMessage ||
          "Music will appear here when it becomes available."
      });

      return true;
    }

    const fragment = document.createDocumentFragment();

    list.forEach(function (track, index) {
      const card = typeof settings.renderTrack === "function"
        ? settings.renderTrack(track, index)
        : renderTrackCard(track, settings);

      if (card instanceof Node) {
        fragment.appendChild(card);
      }
    });

    container.appendChild(fragment);

    return true;
  }

  /* =========================================================
     ACCESSIBILITY HELPERS
     ========================================================= */

  function announce(message, options) {
    const settings = options || {};

    let region = document.getElementById(
      "resona-live-announcer"
    );

    if (!region) {
      region = createElement("div", {
        id: "resona-live-announcer",
        className: "resona-visually-hidden",
        "aria-live": settings.assertive ? "assertive" : "polite",
        "aria-atomic": "true"
      });

      document.body.appendChild(region);
    } else {
      region.setAttribute(
        "aria-live",
        settings.assertive ? "assertive" : "polite"
      );
    }

    region.textContent = "";

    setTimeout(function () {
      region.textContent = String(message || "");
    }, 30);
  }

  function ensureAccessibilityStyles() {
    if (
      document.getElementById("resona-ui-accessibility-styles")
    ) {
      return;
    }

    const style = document.createElement("style");

    style.id = "resona-ui-accessibility-styles";

    style.textContent = `
      .resona-visually-hidden {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }

      .resona-track-card__artwork-button {
        display: block;
        padding: 0;
        width: 100%;
        overflow: hidden;
        border: 0;
        border-radius: 12px;
        background: #171717;
        cursor: pointer;
      }

      .resona-track-card__artwork {
        display: block;
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
      }

      .resona-track-card__title {
        margin: 8px 0 4px;
        overflow-wrap: anywhere;
      }

      .resona-track-card__artist,
      .resona-track-card__album {
        margin: 0 0 4px;
        color: #aaa49a;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .resona-track-card__actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }

      .resona-track-card__actions button {
        min-height: 34px;
        padding: 6px 10px;
        border: 1px solid rgba(213, 181, 106, .3);
        border-radius: 8px;
        color: inherit;
        background: rgba(255, 255, 255, .04);
        cursor: pointer;
      }

      .resona-track-card__actions button[aria-pressed="true"] {
        color: #d5b56a;
        border-color: #d5b56a;
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  const ResonaUI = {
    // DOM
    $: $,
    $$: $$,
    createElement: createElement,

    // Text and formatting
    escapeHTML: escapeHTML,
    normalizeText: normalizeText,
    clamp: clamp,
    debounce: debounce,
    throttle: throttle,
    formatNumber: formatNumber,
    formatDuration: formatDuration,
    formatDate: formatDate,
    formatRelativeTime: formatRelativeTime,

    // Track helpers
    getTrackId: getTrackId,
    getTrackTitle: getTrackTitle,
    getArtistName: getArtistName,
    getTrackArtwork: getTrackArtwork,
    renderTrackCard: renderTrackCard,
    renderTrackList: renderTrackList,

    // URLs and images
    safeURL: safeURL,
    safeImageURL: safeImageURL,
    safeExternalURL: safeExternalURL,
    setSafeImage: setSafeImage,

    // Notifications
    toast: toast,
    success: success,
    error: error,
    warning: warning,
    info: info,
    dismissToast: dismissToast,

    // Loading and empty states
    showLoading: showLoading,
    showEmpty: showEmpty,
    showErrorState: showErrorState,
    clearState: clearState,

    // Buttons
    setButtonLoading: setButtonLoading,

    // Modals
    openModal: openModal,
    confirm: confirm,

    // Accessibility
    announce: announce,

    // Initialization
    init: function () {
      ensureToastStyles();
      ensureLoadingStyles();
      ensureModalStyles();
      ensureAccessibilityStyles();

      return true;
    }
  };

  window.ResonaUI = ResonaUI;

  // Add shared styles without replacing the existing stylesheet.
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        ResonaUI.init();
      },
      { once: true }
    );
  } else {
    ResonaUI.init();
  }

})(window, document);
