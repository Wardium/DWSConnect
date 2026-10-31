(function () {
    const appGrid = document.getElementById("app-grid");
    const appSearchInput = document.getElementById("app-search-input");
    const defaultSvg = document.getElementById("default-bg-svg");
    const customBgImg = document.getElementById("custom-bg-img");
    const iframeStage = document.getElementById("iframe-Stage");
    const iframeWindow = document.getElementById("iframe-window");
    const appIframe = document.getElementById("app-iframe");
    const iframeTitle = document.getElementById("iframe-title");
    const iframeClose = document.getElementById("iframe-close");
    const iframeReload = document.getElementById("iframe-reload");
    const iframeExt = document.getElementById("iframe-ext");
    const settingsTrigger = document.getElementById("settings-trigger");
    const settingsModal = document.getElementById("settings-modal");
    const settingsClose = document.getElementById("settings-close");
    const addAppForm = document.getElementById("add-app-form");
    const bgForm = document.getElementById("bg-form");
    const resetBgBtn = document.getElementById("btn-reset-bg");
    const settingsAppList = document.getElementById("settings-app-list");

    let serverState = { background: {}, apps: [] };
    let resolveDashboardReady;

    window.dashboardReadyPromise = new Promise((resolve) => {
        resolveDashboardReady = resolve;
    });

    async function loadServerState() {
        try {
            const res = await fetch("/api/settings");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            serverState = await res.json();
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            await renderBackground(serverState.background);
        } catch (err) {
            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: "Settings Load Error",
                    icon: "⚠",
                    type: "error",
                    message: err.message
                });
            }
        } finally {
            resolveDashboardReady();
        }
    }

    function renderBackground(bg) {
        return new Promise((resolve) => {
            const timeout = setTimeout(resolve, 450);
            if (bg && bg.url) {
                customBgImg.onload = () => {
                    clearTimeout(timeout);
                    customBgImg.classList.remove("hidden");
                    defaultSvg.classList.add("hidden");
                    resolve();
                };
                customBgImg.onerror = () => {
                    clearTimeout(timeout);
                    customBgImg.classList.add("hidden");
                    defaultSvg.classList.remove("hidden");
                    resolve();
                };
                customBgImg.src = bg.url;
                if (customBgImg.complete) {
                    clearTimeout(timeout);
                    customBgImg.classList.remove("hidden");
                    defaultSvg.classList.add("hidden");
                    resolve();
                }
            } else {
                clearTimeout(timeout);
                customBgImg.classList.add("hidden");
                defaultSvg.classList.remove("hidden");
                resolve();
            }
        });
    }

    window.recalculateTopToBottomStagger = function () {
        const widgets = Array.from(appGrid.querySelectorAll(".app-widget"));
        if (!widgets.length) return;
        const rowTops = [...new Set(widgets.map((w) => w.offsetTop))].sort((a, b) => a - b);
        widgets.forEach((widget, idx) => {
            const rowIndex = rowTops.indexOf(widget.offsetTop);
            const delayMs = rowIndex * 90 + (idx % 6) * 25;
            widget.style.setProperty("--stagger-delay", `${delayMs}ms`);
        });
    };

    function renderAppGrid(apps) {
        const query = (appSearchInput ? appSearchInput.value : "").trim().toLowerCase();
        appGrid.innerHTML = "";
        (apps || [])
            .filter((app) => !query || (app.name || "").toLowerCase().includes(query))
            .forEach((app) => {
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

    window.openCustomIframe = function (title, url, originEl) {
        if (originEl) {
            const rect = originEl.getBoundingClientRect();
            iframeWindow.style.setProperty("--origin-x", `${rect.left + rect.width / 2}px`);
            iframeWindow.style.setProperty("--origin-y", `${rect.top + rect.height / 2}px`);
        }
        iframeTitle.textContent = title;
        appIframe.src = url;
        iframeStage.classList.remove("hidden");
    };

    function handleAppLaunch(app, squircleEl) {
        if (!app.iframe) {
            window.open(app.url, "_blank", "noopener");
            return;
        }
        window.openCustomIframe(app.name, app.url, squircleEl);
    }

    function closeIframeModal() {
        if (iframeStage.classList.contains("hidden")) return;
        iframeStage.classList.add("hidden");
        appIframe.src = "about:blank";
    }

    iframeClose.addEventListener("click", closeIframeModal);
    iframeReload.addEventListener("click", () => {
        if (appIframe.src && appIframe.src !== "about:blank") {
            appIframe.src = appIframe.src;
        }
    });
    iframeExt.addEventListener("click", () => {
        if (appIframe.src && appIframe.src !== "about:blank") {
            window.open(appIframe.src, "_blank", "noopener");
        }
    });

    if (appSearchInput) {
        appSearchInput.addEventListener("input", () => renderAppGrid(serverState.apps));
        appSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const firstWidget = appGrid.querySelector(".app-widget");
                if (firstWidget) firstWidget.click();
            }
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeIframeModal();
            settingsModal.classList.add("hidden");
        } else if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
            e.preventDefault();
            if (appSearchInput) appSearchInput.focus();
        }
    });

    settingsTrigger.addEventListener("click", () => settingsModal.classList.remove("hidden"));
    settingsClose.addEventListener("click", () => settingsModal.classList.add("hidden"));

    addAppForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(addAppForm);
        formData.set("iframe", document.getElementById("iframe-toggle").checked ? "true" : "false");
        const res = await fetch("/api/apps", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
            serverState = data.settings;
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            addAppForm.reset();
            document.getElementById("iframe-toggle").checked = true;
        } else if (window.DWSNotifications) {
            window.DWSNotifications.push({ title: "App Error", icon: "⚠", type: "error", message: data.error });
        }
    });

    bgForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(bgForm);
        const res = await fetch("/api/background", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
            serverState.background = data.background;
            await renderBackground(serverState.background);
            bgForm.reset();
        } else if (window.DWSNotifications) {
            window.DWSNotifications.push({ title: "Background Error", icon: "⚠", type: "error", message: data.error });
        }
    });

    if (resetBgBtn) {
        resetBgBtn.addEventListener("click", async () => {
            const fd = new FormData();
            fd.set("reset_default", "true");
            const res = await fetch("/api/background", { method: "POST", body: fd });
            if (res.ok) {
                const data = await res.json();
                serverState.background = data.background;
                await renderBackground(serverState.background);
            }
        });
    }

    function renderSettingsAppList(apps) {
        settingsAppList.innerHTML = "";
        (apps || []).forEach((app) => {
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
