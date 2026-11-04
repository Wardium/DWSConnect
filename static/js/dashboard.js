(function () {
    const workspace = document.getElementById("workspace");
    const appGrid = document.getElementById("app-grid");
    const appSearchInput = document.getElementById("app-search-input");
    const quickFileResults = document.getElementById("quick-file-search-results");
    const defaultSvg = document.getElementById("default-bg-svg");
    const customBgImg = document.getElementById("custom-bg-img");
    const timeSlotPill = document.getElementById("time-slot-pill");
    const mobileSwitchBtns = document.querySelectorAll(".mobile-switch-btn");

    const centerStage = document.getElementById("center-iframe-stage");
    const centerIframe = document.getElementById("center-app-iframe");
    const stageTitle = document.getElementById("stage-app-title");
    const stageBadge = document.getElementById("stage-subject-badge");
    const stageDockBtn = document.getElementById("stage-dock-dropdown");
    const stageReloadBtn = document.getElementById("stage-reload");
    const stageExtBtn = document.getElementById("stage-ext");
    const stageCloseBtn = document.getElementById("stage-close");

    const rightColWrapper = document.getElementById("right-column-wrapper");
    const dropdownDrawer = document.getElementById("dropdown-widget-drawer");
    const dropdownTitle = document.getElementById("dropdown-widget-title");
    const dropdownIframe = document.getElementById("dropdown-widget-iframe");
    const dropdownExpandBtn = document.getElementById("dropdown-widget-expand");
    const dropdownReloadBtn = document.getElementById("dropdown-widget-reload");
    const dropdownCloseBtn = document.getElementById("dropdown-widget-close");

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

    // OctoPrint Controls
    const octoprintForm = document.getElementById("octoprint-form");
    const saveOctoBtn = document.getElementById("btn-save-octoprint");
    const octoFeedbackBox = document.getElementById("octo-inline-feedback");

    // GitHub Updater Status Controls
    const updLastPulled = document.getElementById("upd-last-pulled");
    const updCommitHash = document.getElementById("upd-commit-hash");
    const updCommitMsg = document.getElementById("upd-commit-msg");
    const updLastChecked = document.getElementById("upd-last-checked");
    const checkGithubBtn = document.getElementById("btn-check-github-now");

    // Custom Theme Studio Inputs
    const ctBgBase = document.getElementById("ct-bg-base");
    const ctTextMain = document.getElementById("ct-text-main");
    const ctAccent1 = document.getElementById("ct-accent-1");
    const ctAccent2 = document.getElementById("ct-accent-2");
    const ctAccent3 = document.getElementById("ct-accent-3");
    const ctNameInput = document.getElementById("custom-theme-name");
    const saveCustomPresetBtn = document.getElementById("btn-save-custom-preset");
    const savedThemesListEl = document.getElementById("saved-custom-themes-list");

    const DROPDOWN_STORAGE_KEY = "dws_user_dropdown_widget_v1";
    const DEVICE_LAYOUT_KEY = "dws_device_layout_v1";

    let serverState = { ui: {}, octoprint: {}, background: {}, apps: [], servers: {}, drive_aliases: {} };
    let activeStageApp = null;
    let activeDropdownApp = null;
    let fileSearchTimer = null;
    let draggedAppId = null;
    let suppressNextAppClick = false;

    let resolveDashboardReady;
    window.dashboardReadyPromise = new Promise((resolve) => {
        resolveDashboardReady = resolve;
    });

    // =========================================================================
    // 0. PER-DEVICE LAYOUT ENGINE (VIEW MODE, ICON SIZE, APPS PER ROW) & RTSP
    // =========================================================================
    const DEFAULT_DEVICE_LAYOUT = {
        view_mode: "full",   // "full" or "sorted"
        icon_size: 70,       // 44px - 120px (step 1px for subtle adjustments)
        apps_per_row: 0      // 0 = Auto, 1..12 = fixed columns per row
    };

    function loadDeviceLayout() {
        try {
            const raw = localStorage.getItem(DEVICE_LAYOUT_KEY);
            if (!raw) return { ...DEFAULT_DEVICE_LAYOUT };
            const parsed = JSON.parse(raw);
            return {
                view_mode: parsed.view_mode === "sorted" ? "sorted" : "full",
                icon_size: Math.max(44, Math.min(120, Number(parsed.icon_size) || 70)),
                apps_per_row: Math.max(0, Math.min(12, Number(parsed.apps_per_row) || 0))
            };
        } catch (e) {
            return { ...DEFAULT_DEVICE_LAYOUT };
        }
    }

    let deviceLayout = loadDeviceLayout();

    function saveDeviceLayout(nextLayout) {
        deviceLayout = {
            ...deviceLayout,
            ...nextLayout
        };
        try {
            localStorage.setItem(DEVICE_LAYOUT_KEY, JSON.stringify(deviceLayout));
        } catch (e) {}
        applyDeviceGridLayout();
    }

    function isRtspUrl(url) {
        return /^rtsps?:\/\//i.test((url || "").trim());
    }

    function getPlayableAppUrl(app) {
        const rawUrl = (app && app.url ? app.url : "").trim();
        if (isRtspUrl(rawUrl)) {
            const title = encodeURIComponent(app.name || "RTSP Camera");
            return `/stream/player?url=${encodeURIComponent(rawUrl)}&title=${title}`;
        }
        return rawUrl;
    }

    function applyDeviceGridLayout() {
        if (!appGrid) return;
        const isSorted = deviceLayout.view_mode === "sorted";
        appGrid.classList.toggle("view-mode-sorted", isSorted);
        appGrid.classList.toggle("view-mode-full", !isSorted);

        const desiredIcon = Number(deviceLayout.icon_size) || 70;
        const desiredWidgetW = Math.round(desiredIcon * 1.36);
        const cols = Number(deviceLayout.apps_per_row) || 0;
        const colGap = 16;

        const gridStyle = window.getComputedStyle(appGrid);
        const padX = (parseFloat(gridStyle.paddingLeft) || 24) + (parseFloat(gridStyle.paddingRight) || 24);
        const sectionExtraPad = isSorted ? 34 : 0;
        const availWidth = Math.max(160, (appGrid.clientWidth || 640) - padX - sectionExtraPad);

        let effectiveWidgetW = desiredWidgetW;
        let effectiveIcon = desiredIcon;

        if (cols > 0) {
            // Calculate available width per column and auto-scale down if icons would overlap
            const maxColW = Math.floor((availWidth - (cols - 1) * colGap) / cols);
            effectiveWidgetW = Math.max(36, Math.min(desiredWidgetW, maxColW - 4));
            effectiveIcon = Math.max(28, Math.min(desiredIcon, Math.floor(effectiveWidgetW * 0.78)));
            appGrid.style.setProperty("--grid-template-cols", `repeat(${cols}, minmax(0, 1fr))`);
        } else {
            effectiveWidgetW = Math.max(48, Math.min(desiredWidgetW, availWidth));
            effectiveIcon = Math.max(32, Math.min(desiredIcon, Math.floor(effectiveWidgetW * 0.78)));
            appGrid.style.setProperty("--grid-template-cols", `repeat(auto-fill, minmax(${effectiveWidgetW}px, 1fr))`);
        }

        appGrid.style.setProperty("--app-widget-w", `${effectiveWidgetW}px`);
        appGrid.style.setProperty("--app-icon-size", `${effectiveIcon}px`);
        appGrid.style.setProperty("--app-icon-radius", `${Math.round(effectiveIcon * 0.31)}px`);
        appGrid.style.setProperty("--app-letter-size", `${Math.max(12, Math.round(effectiveIcon * 0.38))}px`);
        appGrid.style.setProperty("--app-title-size", `${Math.max(10, Math.min(14, Math.round(effectiveIcon * 0.17)))}px`);

        // Sync UI controls if present
        const viewSel = document.getElementById("device-view-mode-select");
        const iconSlider = document.getElementById("device-icon-size-range");
        const iconLabel = document.getElementById("device-icon-size-label");
        const rowSlider = document.getElementById("device-apps-per-row-range");
        const rowLabel = document.getElementById("device-apps-per-row-label");

        if (viewSel) viewSel.value = deviceLayout.view_mode;
        if (iconSlider) iconSlider.value = desiredIcon;
        if (iconLabel) {
            iconLabel.textContent = effectiveIcon < desiredIcon
                ? `${desiredIcon}px (Auto-fit: ${effectiveIcon}px)`
                : `${desiredIcon}px`;
        }
        if (rowSlider) rowSlider.value = cols;
        if (rowLabel) rowLabel.textContent = cols === 0 ? "Auto" : `${cols} / row`;
    }

    function injectDeviceLayoutControls() {
        // Ensure URL input in add-app-form accepts rtsp:// links without browser URL type rejection
        if (addAppForm) {
            const urlInp = addAppForm.querySelector('input[name="url"]');
            if (urlInp) {
                urlInp.setAttribute("type", "text");
                urlInp.setAttribute("placeholder", "https://... or rtsp://user:pass@ip:554/stream");
            }
        }
        // Ensure Video Notification form includes RTSP stream option
        const vidTypeSel = document.getElementById("vid-notif-type");
        if (vidTypeSel && !vidTypeSel.querySelector('option[value="rtsp"]')) {
            const opt = document.createElement("option");
            opt.value = "rtsp";
            opt.textContent = "RTSP Camera Stream (rtsp://)";
            vidTypeSel.appendChild(opt);
        }
        const vidUrlInp = document.getElementById("vid-notif-url");
        if (vidUrlInp) {
            vidUrlInp.setAttribute("type", "text");
            vidUrlInp.setAttribute("placeholder", "Stream URL (rtsp://, .mp4, MJPEG, or Iframe)");
        }

        // Inject Per-Device App Grid Layout Card inside tab-apps if not already in HTML
        const appsPane = document.getElementById("tab-apps");
        if (!appsPane || document.getElementById("device-layout-settings-card")) return;

        const card = document.createElement("div");
        card.id = "device-layout-settings-card";
        card.className = "glass-form";
        card.style.padding = "12px 14px";
        card.style.borderRadius = "18px";
        card.style.border = "1px solid rgba(255, 255, 255, 0.18)";
        card.style.background = "rgba(255, 255, 255, 0.04)";
        card.style.marginBottom = "10px";
        card.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <strong style="font-size:13px;">Per-Device Grid & View Settings</strong>
                <span class="glass-badge">Saved on this device</span>
            </div>
            <label class="select-label">
                <span>App Grid View Mode</span>
                <select id="device-view-mode-select" class="glass-select" style="width:auto;min-width:170px;">
                    <option value="full">Full View (Unified Grid)</option>
                    <option value="sorted">Sorted View (Grouped by Type)</option>
                </select>
            </label>
            <label class="range-label">
                <span>Icon Size (<span id="device-icon-size-label">70px</span>)</span>
                <input type="range" id="device-icon-size-range" min="44" max="120" step="1" value="70" />
            </label>
            <label class="range-label">
                <span>Apps Per Row (<span id="device-apps-per-row-label">Auto</span>)</span>
                <input type="range" id="device-apps-per-row-range" min="0" max="10" step="1" value="0" />
            </label>
            <div class="settings-help-text" style="font-size:11px;">
                Tip: Drag any app icon directly on the dashboard to rearrange apps. Paste any <code>rtsp://</code> link as an App URL to create an instant camera app.
            </div>
        `;
        appsPane.prepend(card);

        const viewSel = document.getElementById("device-view-mode-select");
        const iconSlider = document.getElementById("device-icon-size-range");
        const rowSlider = document.getElementById("device-apps-per-row-range");

        viewSel.addEventListener("change", (e) => {
            saveDeviceLayout({ view_mode: e.target.value });
            renderAppGrid(serverState.apps);
        });
        iconSlider.addEventListener("input", (e) => {
            saveDeviceLayout({ icon_size: Number(e.target.value) });
            window.recalculateTopToBottomStagger();
        });
        rowSlider.addEventListener("input", (e) => {
            saveDeviceLayout({ apps_per_row: Number(e.target.value) });
            window.recalculateTopToBottomStagger();
        });
    }

    if (window.ResizeObserver && appGrid) {
        const ro = new ResizeObserver(() => {
            applyDeviceGridLayout();
            window.recalculateTopToBottomStagger();
        });
        ro.observe(appGrid);
    }

    // =========================================================================
    // 1. GITHUB AUTO-UPDATER STATUS BAR
    // =========================================================================
    function renderUpdaterStatus(upd = {}) {
        if (!updLastPulled) return;
        updLastPulled.textContent = upd.last_updated || "Unknown";
        if (updCommitHash) updCommitHash.textContent = upd.current_commit || "--";
        if (updCommitMsg) updCommitMsg.textContent = upd.commit_message || "No commit message";
        if (updLastChecked) updLastChecked.textContent = upd.last_checked || "Never";
    }

    async function refreshUpdaterStatus() {
        try {
            const res = await fetch(`/api/updater/status?_=${Date.now()}`, { cache: "no-store" });
            const data = await res.json();
            if (data.ok && data.updater) {
                renderUpdaterStatus(data.updater);
            }
        } catch (e) {}
    }

    if (checkGithubBtn) {
        checkGithubBtn.addEventListener("click", async () => {
            const origText = checkGithubBtn.textContent;
            checkGithubBtn.textContent = "⏳ Checking...";
            try {
                const res = await fetch("/api/updater/check", { method: "POST" });
                const data = await res.json();
                if (data.updater) renderUpdaterStatus(data.updater);
                if (data.updated) {
                    checkGithubBtn.textContent = "🚀 Pulling & Restarting...";
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    checkGithubBtn.textContent = "✅ Up to Date";
                    setTimeout(() => {
                        checkGithubBtn.textContent = origText;
                    }, 2000);
                }
            } catch (err) {
                checkGithubBtn.textContent = "⚠️ Check Failed";
                setTimeout(() => {
                    checkGithubBtn.textContent = origText;
                }, 2000);
            }
        });
    }

    // =========================================================================
    // 2. OCTOPRINT SAVE & INSTANT INLINE + NOTIFICATION FEEDBACK
    // =========================================================================
    function showOctoFeedback(message, isError = false) {
        if (!octoFeedbackBox) return;
        octoFeedbackBox.classList.remove("hidden");
        octoFeedbackBox.style.background = isError
            ? "rgba(239, 68, 68, 0.25)"
            : "rgba(16, 185, 129, 0.25)";
        octoFeedbackBox.style.border = isError
            ? "1px solid rgba(248, 113, 113, 0.6)"
            : "1px solid rgba(52, 211, 153, 0.6)";
        octoFeedbackBox.textContent = message;
    }

    async function handleSaveOctoPrint(e) {
        if (e) e.preventDefault();
        const urlInput = document.getElementById("octo-url-input");
        const keyInput = document.getElementById("octo-key-input");
        const enabledToggle = document.getElementById("octo-enabled-toggle");

        const rawUrl = (urlInput ? urlInput.value : "").trim();
        const rawKey = (keyInput ? keyInput.value : "").trim();

        if (!rawUrl) {
            showOctoFeedback("⚠️ Please enter your OctoPrint URL first.", true);
            return;
        }

        if (saveOctoBtn) saveOctoBtn.textContent = "⏳ Testing OctoPrint Connection...";
        showOctoFeedback(`⏳ Connecting to ${rawUrl}...`, false);

        try {
            const res = await fetch("/api/octoprint/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: enabledToggle ? enabledToggle.checked : true,
                    url: rawUrl,
                    api_key: rawKey
                })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                serverState = data.settings;
                if (keyInput) keyInput.value = "";
                const stateMsg = `✅ Connected to OctoPrint! Current Printer State: ${data.printer_state || "Operational"}`;
                showOctoFeedback(stateMsg, false);
                if (window.DWSNotifications) {
                    window.DWSNotifications.push({
                        title: "OctoPrint Linked",
                        icon: "🖨️",
                        type: "success",
                        message: stateMsg,
                        timerSeconds: 6,
                        autoDismiss: true
                    });
                    if (typeof window.DWSNotifications.pollOctoPrint === "function") {
                        window.DWSNotifications.pollOctoPrint();
                    }
                }
            } else {
                const errMsg = data.error || "Failed to verify OctoPrint connection.";
                showOctoFeedback(`❌ ${errMsg}`, true);
                if (window.DWSNotifications) {
                    window.DWSNotifications.push({
                        title: "OctoPrint Error",
                        icon: "⚠️",
                        type: "error",
                        message: errMsg,
                        liveElapsed: true
                    });
                }
            }
        } catch (err) {
            showOctoFeedback(`❌ Network error: ${err.message}`, true);
        } finally {
            if (saveOctoBtn) saveOctoBtn.textContent = "💾 Save & Test OctoPrint Connection";
        }
    }

    if (saveOctoBtn) {
        saveOctoBtn.addEventListener("click", handleSaveOctoPrint);
    }
    if (octoprintForm) {
        octoprintForm.addEventListener("submit", handleSaveOctoPrint);
    }

    // =========================================================================
    // 3. PHONE / PORTRAIT TOP PANE SWITCHER
    // =========================================================================
    function switchMobilePane(paneName) {
        workspace.setAttribute("data-mobile-active", paneName);
        mobileSwitchBtns.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.mobilePane === paneName);
        });
    }
    window.switchMobilePane = switchMobilePane;
    mobileSwitchBtns.forEach((btn) => {
        btn.addEventListener("click", () => switchMobilePane(btn.dataset.mobilePane));
    });

    // =========================================================================
    // 4. THEME ENGINE & CUSTOM THEME STUDIO
    // =========================================================================
    const osDarkMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function applyCustomThemeVars(ct) {
        if (!ct) return;
        const root = document.documentElement.style;
        root.setProperty("--bg-base", ct.bg_base || "#070b19");
        root.setProperty("--text-main", ct.text_main || "#ffffff");
        root.setProperty("--accent-1", ct.accent_1 || "#38bdf8");
        root.setProperty("--accent-2", ct.accent_2 || "#a855f7");
        root.setProperty("--accent-3", ct.accent_3 || "#ec4899");
        root.setProperty("--accent-glow", `${ct.accent_1 || "#38bdf8"}73`);
    }

    function clearCustomThemeVars() {
        const root = document.documentElement.style;
        ["--bg-base", "--text-main", "--accent-1", "--accent-2", "--accent-3", "--accent-glow"].forEach((p) =>
            root.removeProperty(p)
        );
    }

    function applyThemeAndUI(ui = {}) {
        const mode = ui.theme || "auto";
        const accent = ui.accent || "aurora";

        if (mode === "custom" || accent === "custom") {
            document.documentElement.setAttribute("data-theme", "dark");
            document.documentElement.setAttribute("data-accent", "custom");
            applyCustomThemeVars(ui.custom_theme);
        } else {
            clearCustomThemeVars();
            const effectiveTheme = mode === "auto" ? (osDarkMedia.matches ? "dark" : "light") : mode;
            document.documentElement.setAttribute("data-theme", effectiveTheme);
            document.documentElement.setAttribute("data-accent", accent);
        }

        if (ui.glass_blur) {
            document.documentElement.style.setProperty("--glass-blur-px", `${ui.glass_blur}px`);
        }
        if (ui.parallax_intensity !== undefined) {
            window.dwsParallaxIntensity = Number(ui.parallax_intensity);
        }

        const themeSel = document.getElementById("ui-theme-select");
        const accentSel = document.getElementById("ui-accent-select");
        const blurRange = document.getElementById("ui-blur-range");
        const parallaxRange = document.getElementById("ui-parallax-range");

        if (themeSel) themeSel.value = mode;
        if (accentSel) accentSel.value = accent;
        if (blurRange && ui.glass_blur) {
            blurRange.value = ui.glass_blur;
            document.getElementById("blur-val-label").textContent = `${ui.glass_blur}px`;
        }
        if (parallaxRange && ui.parallax_intensity !== undefined) {
            parallaxRange.value = ui.parallax_intensity;
            document.getElementById("parallax-val-label").textContent = `${ui.parallax_intensity}`;
        }

        if (ui.custom_theme && ctBgBase) {
            ctBgBase.value = ui.custom_theme.bg_base || "#070b19";
            ctTextMain.value = ui.custom_theme.text_main || "#ffffff";
            ctAccent1.value = ui.custom_theme.accent_1 || "#38bdf8";
            ctAccent2.value = ui.custom_theme.accent_2 || "#a855f7";
            ctAccent3.value = ui.custom_theme.accent_3 || "#ec4899";
        }
        renderSavedCustomThemes(ui.saved_themes || []);
    }

    function getCurrentPickerTheme() {
        return {
            bg_base: ctBgBase.value,
            text_main: ctTextMain.value,
            accent_1: ctAccent1.value,
            accent_2: ctAccent2.value,
            accent_3: ctAccent3.value
        };
    }

    [ctBgBase, ctTextMain, ctAccent1, ctAccent2, ctAccent3].forEach((input) => {
        if (!input) return;
        input.addEventListener("input", () => {
            document.getElementById("ui-theme-select").value = "custom";
            document.getElementById("ui-accent-select").value = "custom";
            applyCustomThemeVars(getCurrentPickerTheme());
        });
    });

    function renderSavedCustomThemes(list) {
        if (!savedThemesListEl) return;
        savedThemesListEl.innerHTML = "";
        list.forEach((preset, idx) => {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "glass-pill-btn";
            pill.style.borderLeft = `4px solid ${preset.accent_1 || "#38bdf8"}`;
            pill.textContent = preset.name || `Theme ${idx + 1}`;
            pill.addEventListener("click", () => {
                ctBgBase.value = preset.bg_base;
                ctTextMain.value = preset.text_main;
                ctAccent1.value = preset.accent_1;
                ctAccent2.value = preset.accent_2;
                ctAccent3.value = preset.accent_3;
                document.getElementById("ui-theme-select").value = "custom";
                document.getElementById("ui-accent-select").value = "custom";
                applyCustomThemeVars(preset);
            });
            savedThemesListEl.appendChild(pill);
        });
    }

    if (saveCustomPresetBtn) {
        saveCustomPresetBtn.addEventListener("click", async () => {
            const name = (ctNameInput.value || "").trim() || "Custom Theme";
            const saved = Array.isArray(serverState.ui?.saved_themes) ? [...serverState.ui.saved_themes] : [];
            saved.push({ name, ...getCurrentPickerTheme() });
            ctNameInput.value = "";
            const res = await fetch("/api/ui", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    theme: "custom",
                    accent: "custom",
                    custom_theme: getCurrentPickerTheme(),
                    saved_themes: saved
                })
            });
            if (res.ok) {
                const data = await res.json();
                serverState = data.settings;
                applyThemeAndUI(serverState.ui);
            }
        });
    }

    osDarkMedia.addEventListener("change", () => {
        if ((serverState.ui && serverState.ui.theme) === "auto") {
            applyThemeAndUI(serverState.ui || {});
        }
    });

    // =========================================================================
    // 5. TIME-OF-DAY DYNAMIC WALLPAPER ENGINE
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
            const timeout = setTimeout(resolve, 350);
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

    // =========================================================================
    // 6. EXPANDING CENTER STAGE & DROPDOWN WIDGET DRAWER (WITH RTSP SUPPORT)
    // =========================================================================
    function openCenterStageApp(app) {
        activeStageApp = app;
        const playableUrl = getPlayableAppUrl(app);
        stageTitle.textContent = app.name || "Application";
        stageBadge.textContent = isRtspUrl(app.url) ? "RTSP Camera" : (app.subject_type || "Interactive Stage");
        centerIframe.src = playableUrl;
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
        requestAnimationFrame(() => {
            applyDeviceGridLayout();
            window.recalculateTopToBottomStagger();
        });
    }

    function openDropdownWidget(app, persist = true) {
        activeDropdownApp = {
            id: app.id || "custom",
            name: app.name || "Background Widget",
            url: app.url,
            subject_type: app.subject_type || (isRtspUrl(app.url) ? "RTSP Camera" : "Widget")
        };
        const playableUrl = getPlayableAppUrl(activeDropdownApp);
        dropdownTitle.textContent = activeDropdownApp.name;
        if (dropdownIframe.src !== playableUrl) {
            dropdownIframe.src = playableUrl;
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
            window.open(getPlayableAppUrl(activeStageApp), "_blank", "noopener");
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
    // 7. APP GRID (FULL & SORTED VIEWS, DRAG-TO-REORDER & SHALLOW FILE SEARCH)
    // =========================================================================
    window.recalculateTopToBottomStagger = function () {
        const widgets = Array.from(appGrid.querySelectorAll(".app-widget"));
        if (!widgets.length) return;
        const rowTops = [...new Set(widgets.map((w) => w.offsetTop))].sort((a, b) => a - b);
        widgets.forEach((widget, idx) => {
            const rowIndex = rowTops.indexOf(widget.offsetTop);
            const delayMs = rowIndex * 45 + (idx % 6) * 14;
            widget.style.setProperty("--stagger-delay", `${delayMs}ms`);
        });
    };

    async function persistAppOrder(subjectTypeUpdates = {}) {
        const order = (serverState.apps || []).map((a) => a.id);
        try {
            const res = await fetch("/api/apps/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order, subject_types: subjectTypeUpdates })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.settings) {
                    serverState = data.settings;
                    renderSettingsAppList(serverState.apps);
                }
            }
        } catch (e) {}
    }

    function createAppWidgetElement(app) {
        const widget = document.createElement("div");
        widget.className = "app-widget";
        widget.dataset.appId = app.id;
        widget.setAttribute("draggable", "true");

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
            fallback.textContent = isRtspUrl(app.url)
                ? "📹"
                : (app.name || "?").charAt(0).toUpperCase();
            squircle.appendChild(fallback);
        }

        const mode = app.launch_mode || (app.iframe ? "center" : "tab");
        if (mode === "dropdown") {
            const badge = document.createElement("span");
            badge.className = "app-mode-dot";
            badge.textContent = "▾";
            squircle.appendChild(badge);
        }

        if (isRtspUrl(app.url)) {
            const rtspBadge = document.createElement("span");
            rtspBadge.className = "app-rtsp-dot";
            rtspBadge.textContent = "LIVE";
            squircle.appendChild(rtspBadge);
        }

        const title = document.createElement("div");
        title.className = "app-title";
        title.textContent = app.name;

        widget.appendChild(squircle);
        widget.appendChild(title);

        // Click to launch (suppressed if just finished dragging)
        widget.addEventListener("click", (e) => {
            if (suppressNextAppClick) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            handleAppLaunch(app);
        });

        // HTML5 Drag & Drop to rearrange apps
        widget.addEventListener("dragstart", (e) => {
            draggedAppId = app.id;
            widget.classList.add("dragging");
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(app.id));
            }
        });

        widget.addEventListener("dragend", () => {
            widget.classList.remove("dragging");
            appGrid.querySelectorAll(".drag-over-app").forEach((el) => el.classList.remove("drag-over-app"));
            appGrid.querySelectorAll(".drag-over-section").forEach((el) => el.classList.remove("drag-over-section"));
            draggedAppId = null;
            suppressNextAppClick = true;
            setTimeout(() => {
                suppressNextAppClick = false;
            }, 120);
        });

        widget.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!draggedAppId || draggedAppId === app.id) return;
            widget.classList.add("drag-over-app");
        });

        widget.addEventListener("dragleave", () => {
            widget.classList.remove("drag-over-app");
        });

        widget.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            widget.classList.remove("drag-over-app");
            if (!draggedAppId || draggedAppId === app.id) return;

            const apps = [...(serverState.apps || [])];
            const fromIdx = apps.findIndex((a) => String(a.id) === String(draggedAppId));
            const toIdx = apps.findIndex((a) => String(a.id) === String(app.id));
            if (fromIdx === -1 || toIdx === -1) return;

            const [moved] = apps.splice(fromIdx, 1);
            const subjectUpdates = {};

            // If in Sorted View and dropped onto an app in another category, adopt that section's type
            if (deviceLayout.view_mode === "sorted" && app.subject_type && moved.subject_type !== app.subject_type) {
                moved.subject_type = app.subject_type;
                subjectUpdates[moved.id] = app.subject_type;
            }

            apps.splice(toIdx, 0, moved);
            serverState.apps = apps;
            renderAppGrid(serverState.apps);
            persistAppOrder(subjectUpdates);
        });

        return widget;
    }

    function renderAppGrid(apps) {
        const query = (appSearchInput ? appSearchInput.value : "").trim().toLowerCase();
        appGrid.innerHTML = "";
        applyDeviceGridLayout();

        const filtered = (apps || []).filter(
            (app) =>
                !query ||
                (app.name || "").toLowerCase().includes(query) ||
                (app.subject_type || "").toLowerCase().includes(query) ||
                (app.url || "").toLowerCase().includes(query)
        );

        if (deviceLayout.view_mode === "sorted") {
            // Group apps into sections by subject_type (with automatic "RTSP Camera" fallback for rtsp:// links)
            const groups = new Map();
            filtered.forEach((app) => {
                const rawType = (app.subject_type || "").trim();
                const groupName = rawType || (isRtspUrl(app.url) ? "RTSP Camera" : "Web App");
                if (!groups.has(groupName)) groups.set(groupName, []);
                groups.get(groupName).push(app);
            });

            groups.forEach((groupApps, groupName) => {
                const section = document.createElement("div");
                section.className = "app-type-section";
                section.dataset.sectionType = groupName;

                const header = document.createElement("div");
                header.className = "app-type-header";
                header.innerHTML = `
                    <div class="app-type-title">
                        <span>📂</span>
                        <span>${groupName}</span>
                    </div>
                    <span class="glass-badge">${groupApps.length} App${groupApps.length === 1 ? "" : "s"}</span>
                `;

                const grid = document.createElement("div");
                grid.className = "app-type-grid";

                groupApps.forEach((app) => {
                    grid.appendChild(createAppWidgetElement(app));
                });

                // Allow dropping an app directly onto a section box to move it into that category
                section.addEventListener("dragover", (e) => {
                    e.preventDefault();
                    if (!draggedAppId) return;
                    section.classList.add("drag-over-section");
                });
                section.addEventListener("dragleave", () => {
                    section.classList.remove("drag-over-section");
                });
                section.addEventListener("drop", (e) => {
                    e.preventDefault();
                    section.classList.remove("drag-over-section");
                    if (!draggedAppId) return;
                    const appsList = [...(serverState.apps || [])];
                    const idx = appsList.findIndex((a) => String(a.id) === String(draggedAppId));
                    if (idx === -1) return;
                    const [moved] = appsList.splice(idx, 1);
                    moved.subject_type = groupName;
                    appsList.push(moved);
                    serverState.apps = appsList;
                    renderAppGrid(serverState.apps);
                    persistAppOrder({ [moved.id]: groupName });
                });

                section.appendChild(header);
                section.appendChild(grid);
                appGrid.appendChild(section);
            });
        } else {
            filtered.forEach((app) => {
                appGrid.appendChild(createAppWidgetElement(app));
            });
        }

        requestAnimationFrame(() => window.recalculateTopToBottomStagger());
    }

    function handleAppLaunch(app) {
        const mode = app.launch_mode || (app.iframe ? "center" : "tab");
        if (mode === "tab") {
            window.open(getPlayableAppUrl(app), "_blank", "noopener");
        } else if (mode === "dropdown") {
            openDropdownWidget(app, true);
            if (window.innerWidth <= 920) switchMobilePane("notifs");
        } else {
            openCenterStageApp(app);
        }
    }

    async function runShallowFileSearch(query) {
        if (!quickFileResults) return;
        if (!query || query.length < 2) {
            quickFileResults.classList.add("hidden");
            quickFileResults.innerHTML = "";
            return;
        }
        try {
            const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            const items = data.results || [];
            if (!items.length) {
                quickFileResults.classList.add("hidden");
                return;
            }
            quickFileResults.innerHTML = "";
            items.forEach((item) => {
                const row = document.createElement("div");
                row.className = "quick-file-item";
                const icon = item.is_dir ? "📁" : "📄";
                row.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                        <span>${icon}</span>
                        <div style="min-width:0;">
                            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
                            <div style="font-size:10.5px;color:var(--text-muted);">${item.server_name} • ${item.drive_label}</div>
                        </div>
                    </div>
                    <span class="glass-badge">${item.is_dir ? "Open Folder" : "⬇ Download"}</span>
                `;
                row.addEventListener("click", () => {
                    quickFileResults.classList.add("hidden");
                    if (item.is_dir && typeof window.openDriveAndPath === "function") {
                        window.openDriveAndPath(item.drive_id, item.path);
                    } else if (!item.is_dir) {
                        const dlUrl = `/api/files/download?server_id=${encodeURIComponent(item.server_id)}&path=${encodeURIComponent(item.path)}`;
                        window.open(dlUrl, "_blank");
                    }
                });
                quickFileResults.appendChild(row);
            });
            quickFileResults.classList.remove("hidden");
        } catch (e) {}
    }

    if (appSearchInput) {
        appSearchInput.addEventListener("input", () => {
            renderAppGrid(serverState.apps);
            clearTimeout(fileSearchTimer);
            const q = appSearchInput.value.trim();
            fileSearchTimer = setTimeout(() => runShallowFileSearch(q), 240);
        });
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".center-search-wrapper") && quickFileResults) {
                quickFileResults.classList.add("hidden");
            }
        });
    }

    // =========================================================================
    // 8. SETTINGS MODAL NAVIGATION
    // =========================================================================
    function openSettingsToTab(tabId = "tab-apps", serverIdToEdit = null) {
        settingsModal.classList.remove("hidden");
        refreshUpdaterStatus();
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
            const isRtsp = isRtspUrl(app.url);
            const row = document.createElement("div");
            row.className = "settings-item-row";
            row.innerHTML = `
                <div style="min-width:0;flex:1;">
                    <strong>${app.name}</strong>
                    <span class="glass-badge" style="margin-left:6px;">${app.subject_type || (isRtsp ? "RTSP Camera" : "Web App")}</span>
                    ${isRtsp ? `<span class="glass-badge" style="margin-left:4px;border-color:#34d399;color:#34d399;">RTSP</span>` : ""}
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
                    <strong>#${srv.id} • ${srv.name}</strong>
                    <div style="font-size:11px;color:var(--text-muted);">${srv.user}@${srv.host} • ${srv.shell_url}</div>
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
                    <div style="font-size:11px;color:var(--text-muted);">${d.server_name} • Original: ${d.original_label}</div>
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

    addAppForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(addAppForm);
        const rawUrl = (formData.get("url") || "").toString().trim();
        const rawType = (formData.get("subject_type") || "").toString().trim();
        if (isRtspUrl(rawUrl) && (!rawType || rawType.toLowerCase() === "web app")) {
            formData.set("subject_type", "RTSP Camera");
        }
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
            parallax_intensity: Number(document.getElementById("ui-parallax-range").value),
            custom_theme: getCurrentPickerTheme()
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
        const type = isRtspUrl(url) ? "rtsp" : document.getElementById("vid-notif-type").value;
        if (window.DWSNotifications && url) {
            window.DWSNotifications.pushVideoStream(title, url, type, false);
            settingsModal.classList.add("hidden");
            videoNotifForm.reset();
        }
    });

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeCenterStage();
            settingsModal.classList.add("hidden");
            if (quickFileResults) quickFileResults.classList.add("hidden");
        } else if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
            e.preventDefault();
            if (appSearchInput) appSearchInput.focus();
        }
    });

    async function loadServerState() {
        injectDeviceLayoutControls();
        injectGatekeeperSettingsTab();
        applyDeviceGridLayout();
        try {
            const res = await fetch(`/api/settings?_=${Date.now()}`, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            serverState = await res.json();
            populateGatekeeperForm(serverState.auth || {});
            applyThemeAndUI(serverState.ui);
            renderAppGrid(serverState.apps);
            renderSettingsAppList(serverState.apps);
            renderSettingsServersList(serverState.servers);
            restoreSavedDropdownWidget();
            if (serverState.updater) {
                renderUpdaterStatus(serverState.updater);
            }
            if (serverState.octoprint) {
                document.getElementById("octo-enabled-toggle").checked = Boolean(serverState.octoprint.enabled);
                document.getElementById("octo-url-input").value =
                    serverState.octoprint.url || "https://octoprint-rfdtq2xvdwq.teamexist.com";
                if (serverState.octoprint.has_key) {
                    document.getElementById("octo-key-input").placeholder =
                        "API Key stored on server (paste new key to replace)";
                }
            }
            await renderBackground(serverState.background);
        } catch (err) {
            console.error("[DASHBOARD] Error loading state:", err);
        } finally {
            resolveDashboardReady();
        }
    }

    window.addEventListener("resize", () => {
        applyDeviceGridLayout();
        window.recalculateTopToBottomStagger();
    });
    window.addEventListener("DOMContentLoaded", loadServerState);

// =========================================================================
    // 9. GATEKEEPER AUTH REDIRECT SETTINGS & LIVE REVOCATION INTERCEPTOR
    // =========================================================================
    const _nativeFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const response = await _nativeFetch(...args);
        if (response.status === 401) {
            try {
                const clone = response.clone();
                const data = await clone.json();
                if (data && data.unauthorized && data.redirect_url) {
                    window.location.replace(data.redirect_url);
                }
            } catch (e) {
                window.location.reload();
            }
        }
        return response;
    };

    function injectGatekeeperSettingsTab() {
        const navTabs = document.querySelector(".settings-nav-tabs");
        const modalBody = document.querySelector("#settings-modal .modal-body");
        if (!navTabs || !modalBody || document.getElementById("tab-gatekeeper")) return;

        // 1. Create Tab Button
        const tabBtn = document.createElement("button");
        tabBtn.type = "button";
        tabBtn.className = "settings-tab-btn";
        tabBtn.dataset.tab = "tab-gatekeeper";
        tabBtn.textContent = "🔒 Gatekeeper";
        navTabs.appendChild(tabBtn);

        // 2. Create Tab Pane
        const pane = document.createElement("div");
        pane.id = "tab-gatekeeper";
        pane.className = "settings-tab-pane hidden";
        pane.innerHTML = `
            <form id="gatekeeper-auth-form" class="glass-form">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <strong style="font-size:13.5px;">Gatekeeper Unauthorized Redirect</strong>
                    <span class="glass-badge">Server-Side Enforced</span>
                </div>
                <p class="settings-help-text">
                    Any visitor without a valid <code>dws_auth</code> session token on
                    <code>auth.teamexist.com</code> is redirected to this URL on the backend before
                    any HTML, scripts, or API data can load.
                </p>

                <label class="select-label" style="flex-direction:column;align-items:stretch;gap:6px;">
                    <span>Unauthorized Redirect Destination URL</span>
                    <input type="text" id="gk-redirect-url-input" placeholder="https://teamexist.com" required />
                </label>

                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    <button type="button" class="glass-pill-btn gk-preset-btn" data-url="https://teamexist.com" data-ret="false">
                        Preset: teamexist.com
                    </button>
                    <button type="button" class="glass-pill-btn gk-preset-btn" data-url="https://auth.teamexist.com/login" data-ret="true">
                        Preset: Gatekeeper Login
                    </button>
                    <button type="button" class="glass-pill-btn gk-preset-btn" data-url="https://www.google.com" data-ret="false">
                        Preset: Google (Decoy)
                    </button>
                </div>

                <label class="checkbox-label" style="margin-top:4px;">
                    <span>Append <code>?redirect=</code> return URL (for Gatekeeper Login page)</span>
                    <input type="checkbox" id="gk-append-return-toggle" />
                </label>

                <div class="settings-divider"></div>

                <label class="select-label" style="flex-direction:column;align-items:stretch;gap:6px;">
                    <span>Gatekeeper Verify API Endpoint</span>
                    <input type="text" id="gk-verify-url-input" placeholder="https://auth.teamexist.com/api/verify" />
                </label>

                <div id="gk-inline-feedback" class="hidden" style="padding:9px 12px;border-radius:12px;font-size:12px;font-weight:600;"></div>

                <button type="submit" id="btn-save-gatekeeper" class="glass-submit-btn">
                    💾 Save Gatekeeper Redirect Settings
                </button>
            </form>
        `;
        modalBody.appendChild(pane);

        // Wire up tab switching for the newly injected tab
        tabBtn.addEventListener("click", () => {
            document.querySelectorAll(".settings-tab-btn").forEach((b) => b.classList.toggle("active", b === tabBtn));
            document.querySelectorAll(".settings-tab-pane").forEach((p) => p.classList.toggle("hidden", p !== pane));
            populateGatekeeperForm(serverState.auth || {});
        });

        // Keep new tab synced when existing tabs are clicked
        settingsTabBtns.forEach((btn) => {
            btn.addEventListener("click", () => {
                tabBtn.classList.remove("active");
                pane.classList.add("hidden");
            });
        });

        // Preset buttons
        pane.querySelectorAll(".gk-preset-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.getElementById("gk-redirect-url-input").value = btn.dataset.url;
                document.getElementById("gk-append-return-toggle").checked = btn.dataset.ret === "true";
            });
        });

        // Form submit handler
        const gkForm = document.getElementById("gatekeeper-auth-form");
        gkForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const feedback = document.getElementById("gk-inline-feedback");
            const saveBtn = document.getElementById("btn-save-gatekeeper");
            const redirectUrl = document.getElementById("gk-redirect-url-input").value.trim();
            const verifyUrl = document.getElementById("gk-verify-url-input").value.trim();
            const appendReturn = document.getElementById("gk-append-return-toggle").checked;

            saveBtn.textContent = "⏳ Saving...";
            try {
                const res = await fetch("/api/auth/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        redirect_url: redirectUrl,
                        verify_url: verifyUrl,
                        append_redirect_param: appendReturn
                    })
                });
                const data = await res.json();
                feedback.classList.remove("hidden");
                if (res.ok && data.ok) {
                    serverState = data.settings || serverState;
                    serverState.auth = data.auth;
                    populateGatekeeperForm(data.auth);
                    feedback.style.background = "rgba(16, 185, 129, 0.25)";
                    feedback.style.border = "1px solid rgba(52, 211, 153, 0.6)";
                    feedback.textContent = `✅ Saved! Unauthenticated visitors will redirect to: ${data.auth.redirect_url}`;
                } else {
                    feedback.style.background = "rgba(239, 68, 68, 0.25)";
                    feedback.style.border = "1px solid rgba(248, 113, 113, 0.6)";
                    feedback.textContent = `❌ ${data.error || "Failed to save settings"}`;
                }
            } catch (err) {
                feedback.classList.remove("hidden");
                feedback.style.background = "rgba(239, 68, 68, 0.25)";
                feedback.style.border = "1px solid rgba(248, 113, 113, 0.6)";
                feedback.textContent = `❌ Network error: ${err.message}`;
            } finally {
                saveBtn.textContent = "💾 Save Gatekeeper Redirect Settings";
            }
        });
    }

    function populateGatekeeperForm(auth = {}) {
        const redirInput = document.getElementById("gk-redirect-url-input");
        const verifyInput = document.getElementById("gk-verify-url-input");
        const retToggle = document.getElementById("gk-append-return-toggle");
        if (redirInput) redirInput.value = auth.redirect_url || "https://teamexist.com";
        if (verifyInput) verifyInput.value = auth.verify_url || "https://auth.teamexist.com/api/verify";
        if (retToggle) retToggle.checked = Boolean(auth.append_redirect_param);
    }
})();
