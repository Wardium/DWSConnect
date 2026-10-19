(function () {
    const appGrid = document.getElementById("app-grid");
    const defaultSvg = document.getElementById("default-bg-svg");
    const customBgImg = document.getElementById("custom-bg-img");

    const iframeStage = document.getElementById("iframe-Stage");
    const iframeWindow = document.getElementById("iframe-window");
    const appIframe = document.getElementById("app-iframe");
    const iframeTitle = document.getElementById("iframe-title");
    const iframeClose = document.getElementById("iframe-close");

    const settingsTrigger = document.getElementById("settings-trigger");
    const settingsModal = document.getElementById("settings-modal");
    const settingsClose = document.getElementById("settings-close");
    const addAppForm = document.getElementById("add-app-form");
    const bgForm = document.getElementById("bg-form");
    const settingsAppList = document.getElementById("settings-app-list");

    let serverState = { background: {}, apps: [] };

    async function loadServerState() {
        const res = await fetch("/api/settings");
        serverState = await res.json();
        renderBackground(serverState.background);
        renderAppGrid(serverState.apps);
        renderSettingsAppList(serverState.apps);
    }

    function renderBackground(bg) {
        if (bg && bg.url) {
            customBgImg.src = bg.url;
            customBgImg.classList.remove("hidden");
            defaultSvg.classList.add("hidden");
        } else {
            customBgImg.classList.add("hidden");
            defaultSvg.classList.remove("hidden");
        }
    }

// Assigns slower, smoother top-to-bottom stagger delays based on Y row coordinates
    window.recalculateTopToBottomStagger = function () {
        const widgets = Array.from(appGrid.querySelectorAll(".app-widget"));
        if (!widgets.length) return;

        const rowTops = [...new Set(widgets.map((w) => w.offsetTop))].sort((a, b) => a - b);

        widgets.forEach((widget, idx) => {
            const rowIndex = rowTops.indexOf(widget.offsetTop);
            // 150ms per vertical row + 35ms gentle horizontal wave
            const delayMs = rowIndex * 150 + (idx % 6) * 35;
            widget.style.setProperty("--stagger-delay", `${delayMs}ms`);
        });
    };

    function renderAppGrid(apps) {
        appGrid.innerHTML = "";
        apps.forEach((app) => {
            const widget = document.createElement("div");
            widget.className = "app-widget";

            const squircle = document.createElement("div");
            squircle.className = "app-squircle";

            if (app.icon) {
                const img = document.createElement("img");
                img.src = app.icon;
                img.alt = app.name;
                squircle.appendChild(img);
            } else {
                const fallback = document.createElement("span");
                fallback.className = "app-fallback-letter";
                fallback.textContent = (app.name || "?").charAt(0).toUpperCase();
                squircle.appendChild(fallback);
            }

            const title = document.createElement("div");
            title.className = "app-title";
            title.textContent = app.name;

            widget.appendChild(squircle);
            widget.appendChild(title);

            widget.addEventListener("click", () => handleAppLaunch(app, squircle));
            appGrid.appendChild(widget);
        });

        requestAnimationFrame(() => window.recalculateTopToBottomStagger());
    }

    function handleAppLaunch(app, squircleEl) {
        if (!app.iframe) {
            window.open(app.url, "_blank", "noopener");
            return;
        }

        const rect = squircleEl.getBoundingClientRect();
        const originX = rect.left + rect.width / 2;
        const originY = rect.top + rect.height / 2;

        iframeWindow.style.setProperty("--origin-x", `${originX}px`);
        iframeWindow.style.setProperty("--origin-y", `${originY}px`);
        iframeWindow.classList.remove("closing");

        iframeTitle.textContent = app.name;
        appIframe.src = app.url;
        iframeStage.classList.remove("hidden");
    }

    function closeIframeModal() {
        if (iframeStage.classList.contains("hidden")) return;
        iframeWindow.classList.add("closing");
        setTimeout(() => {
            iframeStage.classList.add("hidden");
            iframeWindow.classList.remove("closing");
            appIframe.src = "about:blank";
        }, 320);
    }

    iframeClose.addEventListener("click", closeIframeModal);
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeIframeModal();
            settingsModal.classList.add("hidden");
        }
    });

    settingsTrigger.addEventListener("click", () => settingsModal.classList.remove("hidden"));
    settingsClose.addEventListener("click", () => settingsModal.classList.add("hidden"));

    addAppForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(addAppForm);
        formData.set("iframe", document.getElementById("iframe-toggle").checked ? "true" : "false");

        const res = await fetch("/api/apps", { method: "POST", body: formData });
        if (res.ok) {
            const data = await res.json();
            serverState = data.settings;
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            addAppForm.reset();
            document.getElementById("iframe-toggle").checked = true;
        }
    });

    bgForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(bgForm);
        const res = await fetch("/api/background", { method: "POST", body: formData });
        if (res.ok) {
            const data = await res.json();
            serverState.background = data.background;
            renderBackground(serverState.background);
            bgForm.reset();
        }
    });

    function renderSettingsAppList(apps) {
        settingsAppList.innerHTML = "";
        apps.forEach((app) => {
            const row = document.createElement("div");
            row.className = "settings-app-item";
            row.innerHTML = `
                <span><strong>${app.name}</strong> (${app.iframe ? "Iframe" : "Tab"})</span>
                <button class="liquid-close-btn" data-id="${app.id}" title="Delete">✕</button>
            `;
            row.querySelector("button").addEventListener("click", async () => {
                const res = await fetch(`/api/apps/${app.id}`, { method: "DELETE" });
                if (res.ok) {
                    const data = await res.json();
                    serverState = data.settings;
                    renderAppGrid(serverState.apps);
                    renderSettingsAppList(serverState.apps);
                }
            });
            settingsAppList.appendChild(row);
        });
    }

    window.addEventListener("resize", () => window.recalculateTopToBottomStagger());
    window.addEventListener("DOMContentLoaded", loadServerState);
})();
