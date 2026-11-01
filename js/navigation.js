/* =========================================================
   RESONA NAVIGATION
   Version: 2.0.0

   Responsibilities:
   - Shared header and navigation
   - Mobile navigation
   - Footer
   - Page navigation
   - Persistent shell integration
   - Toast notifications
========================================================= */

(function () {
  "use strict";

  if (window.ResonaNavigation) return;

  const VERSION = "2.0.0";

  const NAV_ITEMS = [
    {
      label: "Home",
      href: "index.html",
      icon: "⌂",
      page: "home"
    },
    {
      label: "Explore",
      href: "explore.html",
      icon: "◈",
      page: "explore"
    },
    {
      label: "Search",
      href: "search.html",
      icon: "⌕",
      page: "search"
    },
    {
      label: "Library",
      href: "library.html",
      icon: "▤",
      page: "library"
    },
    {
      label: "Playlists",
      href: "playlists.html",
      icon: "☷",
      page: "playlists"
    }
  ];

  let toastTimer = null;

  /* =======================================================
     UTILITIES
  ======================================================= */

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      function (character) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[character];
      }
    );
  }

  function getPageName() {
    const bodyPage =
      document.body.dataset.page;

    if (bodyPage) return bodyPage;

    const filename = location.pathname
      .split("/")
      .pop()
      .replace(".html", "");

    return filename === "index"
      ? "home"
      : filename;
  }

  function getShellBridge() {
    return window.ResonaShellBridge || null;
  }

  /* =======================================================
     NAVIGATION
  ======================================================= */

  function navigate(href) {
    if (!href) return;

    const bridge = getShellBridge();

    /*
      If this page is inside shell.html,
      navigate through the persistent shell.
    */

    if (
      bridge &&
      bridge.isInsideShell()
    ) {
      const parts = href.split("?");

      const page = parts[0];

      const query = parts[1] || "";

      bridge.navigate(page, query);

      return;
    }

    /*
      Normal navigation when opened outside shell.
    */

    window.location.href = href;
  }

  /* =======================================================
     HEADER
  ======================================================= */

  function renderHeader() {
    const container = document.querySelector(
      "[data-resona-header]"
    );

    if (!container) return;

    const page = getPageName();

    container.innerHTML = `
      <header class="resona-header">

        <a
          class="resona-brand"
          href="index.html"
          data-resona-link
          aria-label="Resona Home"
        >
          <span class="resona-brand-icon">R</span>
          <span>resona</span>
        </a>

        <nav class="resona-desktop-nav">

          ${NAV_ITEMS.map(function (item) {
            const active =
              page === item.page
                ? "active"
                : "";

            return `
              <a
                href="${item.href}"
                class="${active}"
                data-resona-link
              >
                <span>${item.icon}</span>
                ${item.label}
              </a>
            `;
          }).join("")}

        </nav>

        <div class="resona-header-actions">

          <a
            href="profile.html"
            class="resona-profile-button"
            data-resona-link
            aria-label="Profile"
          >
            <span>◉</span>
          </a>

        </div>

      </header>
    `;
  }

  /* =======================================================
     MOBILE NAVIGATION
  ======================================================= */

  function renderMobileNavigation() {
    const container = document.querySelector(
      "[data-resona-mobile-nav]"
    );

    if (!container) return;

    const page = getPageName();

    container.innerHTML = `
      <nav class="resona-mobile-nav">

        ${NAV_ITEMS.map(function (item) {
          const active =
            page === item.page
              ? "active"
              : "";

          return `
            <a
              href="${item.href}"
              class="${active}"
              data-resona-link
            >
              <span class="mobile-nav-icon">
                ${item.icon}
              </span>

              <span class="mobile-nav-label">
                ${item.label}
              </span>
            </a>
          `;
        }).join("")}

      </nav>
    `;
  }

  /* =======================================================
     FOOTER
  ======================================================= */

  function renderFooter() {
    const container = document.querySelector(
      "[data-resona-footer]"
    );

    if (!container) return;

    container.innerHTML = `
      <footer class="resona-footer">

        <div class="resona-footer-brand">
          <span class="resona-brand-icon">R</span>
          <strong>resona</strong>
        </div>

        <p>
          Music connects the world.
        </p>

        <div class="resona-footer-links">

          <a href="index.html" data-resona-link>
            Home
          </a>

          <a href="explore.html" data-resona-link>
            Explore
          </a>

          <a href="profile.html" data-resona-link>
            Profile
          </a>

          <a href="settings.html" data-resona-link>
            Settings
          </a>

        </div>

        <small>
          © ${new Date().getFullYear()} Resona.
          All rights reserved.
        </small>

      </footer>
    `;
  }

  /* =======================================================
     TOAST NOTIFICATIONS
  ======================================================= */

  function showToast(message, type) {
    let container = document.querySelector(
      "#resona-toast-container"
    );

    if (!container) {
      container = document.createElement("div");

      container.id = "resona-toast-container";

      container.className =
        "resona-toast-container";

      document.body.appendChild(container);
    }

    container.innerHTML = `
      <div class="resona-toast ${escapeHTML(type || "info")}">
        ${escapeHTML(message)}
      </div>
    `;

    container.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(function () {
      container.classList.remove("visible");
    }, 3200);
  }

  /* =======================================================
     LINK INTERCEPTION
  ======================================================= */

  function setupNavigation() {
    document.addEventListener(
      "click",
      function (event) {
        const link = event.target.closest(
          "a[data-resona-link]"
        );

        if (!link) return;

        if (
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        if (link.target === "_blank") return;

        if (link.hasAttribute("download")) return;

        const href = link.getAttribute("href");

        if (
          !href ||
          href.startsWith("#") ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:") ||
          href.startsWith("javascript:")
        ) {
          return;
        }

        const destination = new URL(
          href,
          window.location.href
        );

        if (
          destination.origin !==
          window.location.origin
        ) {
          return;
        }

        event.preventDefault();

        navigate(
          destination.pathname.split("/").pop() +
          destination.search +
          destination.hash
        );
      }
    );
  }

  /* =======================================================
     PAGE INITIALIZATION
  ======================================================= */

  function initialize() {
    renderHeader();

    renderMobileNavigation();

    renderFooter();

    setupNavigation();

    document.body.classList.add(
      "resona-navigation-ready"
    );

    console.info(
      "[Resona Navigation] Loaded v" + VERSION
    );
  }

  /* =======================================================
     PUBLIC API
  ======================================================= */

  window.ResonaNavigation = Object.freeze({

    version: VERSION,

    initialize: initialize,

    navigate: navigate,

    toast: showToast,

    getPageName: getPageName,

    renderHeader: renderHeader,

    renderMobileNavigation:
      renderMobileNavigation,

    renderFooter: renderFooter

  });

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );
  } else {
    initialize();
  }

})();
