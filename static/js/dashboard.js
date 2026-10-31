(function () {
    const workspace = document.getElementById("workspace");
    const appGrid = document.getElementById("app-grid");
    const appSearchInput = document.getElementById("app-search-input");
    const defaultSvg = document.getElementById("default-bg-svg");
    const customBgImg = document.getElementById("custom-bg-img");
    const timeSlotPill = document.getElementById("time-slot-pill");

    // Expanding Center Stage Iframe Elements
    const centerStage = document.getElementById("center-iframe-stage");
    const centerIframe = document.getElementById("center-app-iframe");
    const stageTitle = document.getElementById("stage-app-title");
    const stageBadge = document.getElementById("stage-subject-badge");
    const stageDockBtn = document.getElementById("stage-dock-dropdown");
    const stageReloadBtn = document.getElementById("stage-reload");
    const stageExtBtn = document.getElementById("stage-ext");
    const stageCloseBtn = document.getElementById("stage-close");

    // Right Column Dropdown Widget Drawer Elements
    const rightColWrapper = document.getElementById("right-column-wrapper");
    const dropdownDrawer = document.getElementById("dropdown-widget-drawer");
    const dropdownTitle = document.getElementById("dropdown-widget-title");
    const dropdownIframe = document.getElementById("dropdown-widget-iframe");
    const dropdownExpandBtn = document.getElementById("dropdown-widget-expand");
    const dropdownReloadBtn = document.getElementById("dropdown-widget-reload");
    const dropdownCloseBtn = document.getElementById("dropdown-widget-close");

    // Settings Modal Elements
    const settingsTrigger = document.getElementById("settings-trigger");
    const settingsModal = document.getElementById("settings-modal");
    const settingsClose = document.getElementById("settings-close");
    const settingsTabBtns = document.querySelectorAll(".settings-tab-btn");
    const settingsPanes = document.querySelectorAll(".settings-tab-pane");

    const addAppForm = document.getElementById("add-app-form");
    const settingsAppList = document.getElementById("settings-app-list");
    const serverForm = document.getElementById("server-form");
    const settingsServerList = document.getElementById("settings-server-list");
    const settingsDrivesList = document.getElementById("settings-drives-list");
    const bgForm = document.getElementById("bg-form");
    const resetBgBtn = document.getElementById("btn-reset-bg");
    const videoNotifForm = document.getElementById("video-notif-form");

    const DROPDOWN_STORAGE_KEY = "dws_user_dropdown_widget_v1";
    let serverState = { ui: {}, background: {}, apps: [], servers: {}, drive_aliases: {} };
    let activeStageApp = null;
    let activeDropdownApp = null;
    let resolveDashboardReady;

    window.dashboardReadyPromise = new Promise((resolve) => {
        resolveDashboardReady = resolve;
    });

    // =========================================================================
    // 1. OS-SYNCED DYNAMIC DARK / LIGHT MODE & LIQUID FX
    // =========================================================================
    const osDarkMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function applyThemeAndUI(ui = {}) {
        const mode = ui.theme || "auto";
        const effectiveTheme = mode === "auto" ? (osDarkMedia.matches ? "dark" : "light") : mode;
        document.documentElement.setAttribute("data-theme", effectiveTheme);
        document.documentElement.setAttribute("data-accent", ui.accent || "aurora");

        if (ui.glass_blur) {
            document.documentElement.style.setProperty("--glass-blur-px", `${ui.glass_blur}px`);
        }
        if (ui.parallax_intensity !== undefined) {
            window.dwsParallaxIntensity = Number(ui.parallax_intensity);
        }

        // Sync inputs in Settings
        const themeSel = document.getElementById("ui-theme-select");
        const accentSel = document.getElementById("ui-accent-select");
        const blurRange = document.getElementById("ui-blur-range");
        const parallaxRange = document.getElementById("ui-parallax-range");
        if (themeSel) themeSel.value = mode;
        if (accentSel) accentSel.value = ui.accent || "aurora";
        if (blurRange && ui.glass_blur) {
            blurRange.value = ui.glass_blur;
            document.getElementById("blur-val-label").textContent = `${ui.glass_blur}px`;
        }
        if (parallaxRange && ui.parallax_intensity !== undefined) {
            parallaxRange.value = ui.parallax_intensity;
            document.getElementById("parallax-val-label").textContent = `${ui.parallax_intensity}`;
        }
    }

    osDarkMedia.addEventListener("change", () => {
        if ((serverState.ui && serverState.ui.theme) === "auto" || !serverState.ui?.theme) {
            applyThemeAndUI(serverState.ui || {});
        }
    });

    // =========================================================================
    // 2. TIME-OF-DAY DYNAMIC WALLPAPER ENGINE
    // =========================================================================
    function getCurrentTimeSlot() {
        const hr = new Date().getHours();
        if (hr >= 6 && hr < 12) return { key: "morning", label: "🌅 Morning" };
        if (hr >= 12 && hr < 17) return { key: "afternoon", label: "☀️ Afternoon" };
        if (hr >= 17 && hr < 21) return { key: "evening", label: "🌇 Evening" };
        return { key: "night", label: "🌙 Night" };
    }

    function resolveActiveWallpaperUrl(bg = {}) {
        if (bg.time_based_enabled && bg.time_wallpapers) {
            const slot = getCurrentTimeSlot();
            const candidate = (bg.time_wallpapers[slot.key] || "").trim();
            if (timeSlotPill) {
                timeSlotPill.textContent = slot.label;
                timeSlotPill.classList.remove("hidden");
            }
            if (candidate) return candidate;
        } else if (timeSlotPill) {
            timeSlotPill.classList.add("hidden");
        }
        return (bg.url || "").trim();
    }

    function renderBackground(bg = {}) {
        // Sync form fields
        const timeToggle = document.getElementById("time-bg-toggle");
        const staticUrlInput = document.getElementById("bg-static-url");
        if (timeToggle) timeToggle.checked = Boolean(bg.time_based_enabled);
        if (staticUrlInput) staticUrlInput.value = bg.url || "";
        if (bg.time_wallpapers) {
            ["morning", "afternoon", "evening", "night"].forEach((slot) => {
                const el = document.getElementById(`tw-${slot}-url`);
                if (el) el.value = bg.time_wallpapers[slot] || "";
            });
        }

        const targetUrl = resolveActiveWallpaperUrl(bg);
        return new Promise((resolve) => {
            const timeout = setTimeout(resolve, 380);
            if (targetUrl) {
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
                if (customBgImg.src !== targetUrl) {
                    customBgImg.src = targetUrl;
                } else {
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

    // Re-evaluate time-of-day wallpaper every 60 seconds
    setInterval(() => {
        if (!document.hidden && serverState.background?.time_based_enabled) {
            renderBackground(serverState.background);
        }
    }, 60000);

    // =========================================================================
    // 3. EXPANDING CENTER STAGE IFRAME & BOTTOM DROPDOWN WIDGET DRAWER
    // =========================================================================
    function openCenterStageApp(app) {
        activeStageApp = app;
        stageTitle.textContent = app.name || "Application";
        stageBadge.textContent = app.subject_type || "Interactive Stage";
        centerIframe.src = app.url;

        appGrid.classList.add("hidden");
        centerStage.classList.remove("hidden");
        workspace.classList.add("stage-expanded");
    }

    function closeCenterStage() {
        if (centerStage.classList.contains("hidden")) return;
        centerStage.classList.add("hidden");
        appGrid.classList.remove("hidden");
        workspace.classList.remove("stage-expanded");
        centerIframe.src = "about:blank";
        activeStageApp = null;
        requestAnimationFrame(() => window.recalculateTopToBottomStagger());
    }

    function openDropdownWidget(app, persist = true) {
        activeDropdownApp = {
            id: app.id || "custom",
            name: app.name || "Background Widget",
            url: app.url,
            subject_type: app.subject_type || "Widget"
        };
        dropdownTitle.textContent = activeDropdownApp.name;
        if (dropdownIframe.src !== activeDropdownApp.url) {
            dropdownIframe.src = activeDropdownApp.url;
        }
        dropdownDrawer.classList.remove("hidden");
        rightColWrapper.classList.add("has-dropdown-widget");

        if (persist) {
            try {
                localStorage.setItem(DROPDOWN_STORAGE_KEY, JSON.stringify(activeDropdownApp));
            } catch (e) {}
        }
    }

    function closeDropdownWidget() {
        dropdownDrawer.classList.add("hidden");
        rightColWrapper.classList.remove("has-dropdown-widget");
        dropdownIframe.src = "about:blank";
        activeDropdownApp = null;
        try {
            localStorage.removeItem(DROPDOWN_STORAGE_KEY);
        } catch (e) {}
    }

    function restoreSavedDropdownWidget() {
        try {
            const raw = localStorage.getItem(DROPDOWN_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved && saved.url) {
                openDropdownWidget(saved, false);
            }
        } catch (e) {}
    }

    stageCloseBtn.addEventListener("click", closeCenterStage);
    stageReloadBtn.addEventListener("click", () => {
        if (centerIframe.src && centerIframe.src !== "about:blank") {
            centerIframe.src = centerIframe.src;
        }
    });
    stageExtBtn.addEventListener("click", () => {
        if (activeStageApp && activeStageApp.url) {
            window.open(activeStageApp.url, "_blank", "noopener");
        }
    });
    stageDockBtn.addEventListener("click", () => {
        if (activeStageApp) {
            const appToDock = { ...activeStageApp };
            closeCenterStage();
            openDropdownWidget(appToDock, true);
        }
    });

    dropdownCloseBtn.addEventListener("click", closeDropdownWidget);
    dropdownReloadBtn.addEventListener("click", () => {
        if (dropdownIframe.src && dropdownIframe.src !== "about:blank") {
            dropdownIframe.src = dropdownIframe.src;
        }
    });
    dropdownExpandBtn.addEventListener("click", () => {
        if (activeDropdownApp) {
            const appToExpand = { ...activeDropdownApp };
            closeDropdownWidget();
            openCenterStageApp(appToExpand);
        }
    });

    window.openCenterStageApp = openCenterStageApp;
    window.openDropdownWidget = openDropdownWidget;

    // =========================================================================
    // 4. APP GRID RENDERING & LAUNCH ROUTING
    // =========================================================================
    window.recalculateTopToBottomStagger = function () {
        const widgets = Array.from(appGrid.querySelectorAll(".app-widget"));
        if (!widgets.length) return;
        const rowTops = [...new Set(widgets.map((w) => w.offsetTop))].sort((a, b) => a - b);
        widgets.forEach((widget, idx) => {
            const rowIndex = rowTops.indexOf(widget.offsetTop);
            const delayMs = rowIndex * 75 + (idx % 6) * 22;
            widget.style.setProperty("--stagger-delay", `${delayMs}ms`);
        });
    };

    function renderAppGrid(apps) {
        const query = (appSearchInput ? appSearchInput.value : "").trim().toLowerCase();
        appGrid.innerHTML = "";
        (apps || [])
            .filter((app) => !query || (app.name || "").toLowerCase().includes(query) || (app.subject_type || "").toLowerCase().includes(query))
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

                const mode = app.launch_mode || (app.iframe ? "center" : "tab");
                if (mode === "dropdown") {
                    const badge = document.createElement("span");
                    badge.className = "app-mode-dot";
                    badge.textContent = "↓";
                    badge.title = "Opens in Bottom-Right Dropdown Widget";
                    squircle.appendChild(badge);
                }

                const title = document.createElement("div");
                title.className = "app-title";
                title.textContent = app.name;

                widget.appendChild(squircle);
                widget.appendChild(title);
                widget.addEventListener("click", () => handleAppLaunch(app));
                appGrid.appendChild(widget);
            });
        requestAnimationFrame(() => window.recalculateTopToBottomStagger());
    }

    function handleAppLaunch(app) {
        const mode = app.launch_mode || (app.iframe ? "center" : "tab");
        if (mode === "tab") {
            window.open(app.url, "_blank", "noopener");
        } else if (mode === "dropdown") {
            openDropdownWidget(app, true);
        } else {
            openCenterStageApp(app);
        }
    }

    // =========================================================================
    // 5. SETTINGS CONTROL CENTER TABS & CRUD HANDLERS
    // =========================================================================
    function openSettingsToTab(tabId = "tab-apps", serverIdToEdit = null) {
        settingsModal.classList.remove("hidden");
        settingsTabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
        settingsPanes.forEach((pane) => pane.classList.toggle("hidden", pane.id !== tabId));

        if (tabId === "tab-servers" && serverIdToEdit && serverState.servers?.[serverIdToEdit]) {
            populateServerForm(serverState.servers[serverIdToEdit]);
        }
        if (tabId === "tab-drives" && typeof window.getLatestDWSDrives === "function") {
            renderSettingsDrivesList(window.getLatestDWSDrives());
        }
    }

    window.openSettingsToTab = openSettingsToTab;

    settingsTabBtns.forEach((btn) => {
        btn.addEventListener("click", () => openSettingsToTab(btn.dataset.tab));
    });

    settingsTrigger.addEventListener("click", () => openSettingsToTab("tab-apps"));
    settingsClose.addEventListener("click", () => settingsModal.classList.add("hidden"));

    function renderSettingsAppList(apps) {
        settingsAppList.innerHTML = "";
        (apps || []).forEach((app) => {
            const mode = app.launch_mode || (app.iframe ? "center" : "tab");
            const row = document.createElement("div");
            row.className = "settings-item-row";
            row.innerHTML = `
                <div>
                    <strong>${app.name}</strong>
                    <span class="glass-badge" style="margin-left:6px;">${app.subject_type || "Web App"}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <select class="glass-select app-mode-changer" style="width:auto;padding:4px 8px;font-size:11px;">
                        <option value="center" ${mode === "center" ? "selected" : ""}>Center Stage</option>
                        <option value="dropdown" ${mode === "dropdown" ? "selected" : ""}>Dropdown Widget</option>
                        <option value="tab" ${mode === "tab" ? "selected" : ""}>New Tab</option>
                    </select>
                    <button class="liquid-close-btn" title="Delete App">✕</button>
                </div>
            `;

            row.querySelector(".app-mode-changer").addEventListener("change", async (e) => {
                const res = await fetch(`/api/apps/${app.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ launch_mode: e.target.value })
                });
                if (res.ok) {
                    const data = await res.json();
                    serverState = data.settings;
                    renderAppGrid(serverState.apps);
                }
            });

            row.querySelector(".liquid-close-btn").addEventListener("click", async () => {
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

    function populateServerForm(srv) {
        document.getElementById("srv-form-id").value = srv.id || "";
        document.getElementById("srv-form-name").value = srv.name || "";
        document.getElementById("srv-form-host").value = srv.host || "";
        document.getElementById("srv-form-user").value = srv.user || "";
        document.getElementById("srv-form-pass").value = "";
        document.getElementById("srv-form-shell").value = srv.shell_url || `https://device.teamexist.com/shell/${srv.id}`;
    }

    document.getElementById("srv-form-clear").addEventListener("click", () => serverForm.reset());

    function renderSettingsServersList(serversMap) {
        if (!settingsServerList) return;
        settingsServerList.innerHTML = "";
        Object.values(serversMap || {}).forEach((srv) => {
            const row = document.createElement("div");
            row.className = "settings-item-row";
            row.innerHTML = `
                <div>
                    <strong>#${srv.id} — ${srv.name}</strong>
                    <div style="font-size:11px;color:var(--text-muted);">${srv.user}@${srv.host} · ${srv.shell_url}</div>
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="glass-action-btn edit-srv-btn">Edit / Rename</button>
                    <button class="liquid-close-btn del-srv-btn" title="Remove Server">✕</button>
                </div>
            `;
            row.querySelector(".edit-srv-btn").addEventListener("click", () => populateServerForm(srv));
            row.querySelector(".del-srv-btn").addEventListener("click", async () => {
                if (!confirm(`Remove server "${srv.name}"?`)) return;
                const res = await fetch(`/api/servers/${srv.id}`, { method: "DELETE" });
                if (res.ok) {
                    const data = await res.json();
                    serverState = data.settings;
                    renderSettingsServersList(serverState.servers);
                    if (typeof window.reloadDWSDrives === "function") window.reloadDWSDrives();
                }
            });
            settingsServerList.appendChild(row);
        });
    }

    function renderSettingsDrivesList(drives) {
        if (!settingsDrivesList) return;
        settingsDrivesList.innerHTML = "";
        if (!drives || drives.length === 0) {
            settingsDrivesList.innerHTML = `<div class="panel-empty-state">No drives detected yet.</div>`;
            return;
        }
        drives.forEach((d) => {
            const row = document.createElement("div");
            row.className = "settings-item-row";
            row.innerHTML = `
                <div style="min-width:0;flex:1;">
                    <strong>${d.label}</strong>
                    <div style="font-size:11px;color:var(--text-muted);">${d.server_name} · Original: ${d.original_label}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <input type="text" class="glass-mini-input drive-alias-input" value="${d.alias || ""}" placeholder="Custom server-wide name..." />
                    <button class="glass-action-btn primary save-alias-btn">Save</button>
                </div>
            `;
            const input = row.querySelector(".drive-alias-input");
            row.querySelector(".save-alias-btn").addEventListener("click", async () => {
                const res = await fetch("/api/drives/alias", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ drive_id: d.id, alias: input.value.trim() })
                });
                if (res.ok && typeof window.reloadDWSDrives === "function") {
                    window.reloadDWSDrives();
                }
            });
            settingsDrivesList.appendChild(row);
        });
    }

    window.renderSettingsDrivesList = renderSettingsDrivesList;

    // Form Submissions
    addAppForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(addAppForm);
        const res = await fetch("/api/apps", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
            serverState = data.settings;
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            addAppForm.reset();
        }
    });

    serverForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            id: document.getElementById("srv-form-id").value.trim(),
            name: document.getElementById("srv-form-name").value.trim(),
            host: document.getElementById("srv-form-host").value.trim(),
            user: document.getElementById("srv-form-user").value.trim(),
            password: document.getElementById("srv-form-pass").value,
            shell_url: document.getElementById("srv-form-shell").value.trim()
        };
        const res = await fetch("/api/servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            serverState = data.settings;
            renderSettingsServersList(serverState.servers);
            serverForm.reset();
            if (typeof window.reloadDWSDrives === "function") window.reloadDWSDrives();
        }
    });

    bgForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(bgForm);
        formData.set("time_based_enabled", document.getElementById("time-bg-toggle").checked ? "true" : "false");
        const res = await fetch("/api/background", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
            serverState.background = data.background;
            await renderBackground(serverState.background);
        }
    });

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

    document.getElementById("ui-blur-range").addEventListener("input", (e) => {
        document.getElementById("blur-val-label").textContent = `${e.target.value}px`;
        document.documentElement.style.setProperty("--glass-blur-px", `${e.target.value}px`);
    });

    document.getElementById("ui-parallax-range").addEventListener("input", (e) => {
        document.getElementById("parallax-val-label").textContent = `${e.target.value}`;
        window.dwsParallaxIntensity = Number(e.target.value);
    });

    document.getElementById("btn-save-ui").addEventListener("click", async () => {
        const payload = {
            theme: document.getElementById("ui-theme-select").value,
            accent: document.getElementById("ui-accent-select").value,
            glass_blur: Number(document.getElementById("ui-blur-range").value),
            parallax_intensity: Number(document.getElementById("ui-parallax-range").value)
        };
        const res = await fetch("/api/ui", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const data = await res.json();
            serverState = data.settings;
            applyThemeAndUI(serverState.ui);
        }
    });

    videoNotifForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = document.getElementById("vid-notif-title").value.trim();
        const url = document.getElementById("vid-notif-url").value.trim();
        const type = document.getElementById("vid-notif-type").value;
        if (window.DWSNotifications && url) {
            window.DWSNotifications.pushVideoStream(title, url, type, false);
            settingsModal.classList.add("hidden");
            videoNotifForm.reset();
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
            closeCenterStage();
            settingsModal.classList.add("hidden");
        } else if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
            e.preventDefault();
            if (appSearchInput) appSearchInput.focus();
        }
    });

    async function loadServerState() {
        try {
            const res = await fetch("/api/settings");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            serverState = await res.json();
            applyThemeAndUI(serverState.ui);
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            renderSettingsServersList(serverState.servers);
            restoreSavedDropdownWidget();
            await renderBackground(serverState.background);
        } catch (err) {
            console.error("[DASHBOARD] Error loading state:", err);
        } finally {
            resolveDashboardReady();
        }
    }

    window.addEventListener("resize", () => window.recalculateTopToBottomStagger());
    window.addEventListener("DOMContentLoaded", loadServerState);
})();
