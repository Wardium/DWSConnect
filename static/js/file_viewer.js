(function () {
    const drivesListView = document.getElementById("drives-list-view");
    const fileBrowserView = document.getElementById("file-browser-view");
    const panelTitle = document.getElementById("file-panel-title");
    const drivesCountBadge = document.getElementById("drives-count-badge");
    const statusDot = document.getElementById("drives-status-dot");
    const backToDrivesBtn = document.getElementById("btn-back-to-drives");
    const refreshBtn = document.getElementById("btn-refresh-files");
    const serverShellBar = document.getElementById("server-shell-bar");

    const breadcrumbsEl = document.getElementById("file-breadcrumbs");
    const filterInput = document.getElementById("file-filter-input");
    const fileListContainer = document.getElementById("file-list-container");
    const fileItemsList = document.getElementById("file-items-list");
    const newFolderBtn = document.getElementById("btn-new-folder");
    const uploadTriggerBtn = document.getElementById("btn-upload-trigger");
    const hiddenFileInput = document.getElementById("hidden-file-upload");

    const selectionBar = document.getElementById("file-selection-bar");
    const selectedLabel = document.getElementById("selected-file-label");
    const downloadBtn = document.getElementById("btn-download-selected");
    const deleteBtn = document.getElementById("btn-delete-selected");

    let knownDriveIds = new Set();
    let initialScanDone = false;
    let currentDrive = null;
    let currentPath = "/";
    let currentItems = [];
    let selectedItem = null;
    let latestDrives = [];

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
    }

    function renderServerShellButtons(serversMap) {
        if (!serverShellBar) return;
        serverShellBar.innerHTML = "";
        Object.values(serversMap || {}).forEach((srv) => {
            const btn = document.createElement("button");
            btn.className = "glass-pill-btn";
            btn.textContent = `⌘ ${srv.name || "Srv " + srv.id}`;
            btn.title = `Open SSH Terminal: ${srv.shell_url || "https://device.teamexist.com/shell/" + srv.id}`;
            btn.addEventListener("click", () => {
                const targetUrl = srv.shell_url || `https://device.teamexist.com/shell/${srv.id}`;
                if (typeof window.openCenterStageApp === "function") {
                    if (typeof window.switchMobilePane === "function") {
                        window.switchMobilePane("center");
                    }
                    window.openCenterStageApp({
                        name: `${srv.name} — SSH Shell`,
                        url: targetUrl,
                        subject_type: `SSH Node ${srv.id}`
                    });
                } else {
                    window.open(targetUrl, "_blank", "noopener");
                }
            });
            serverShellBar.appendChild(btn);
        });
    }

    async function loadDrives(silent = false) {
        if (!silent && !currentDrive) {
            drivesListView.innerHTML = `<div class="panel-empty-state">Scanning SSH servers for disks...</div>`;
        }
        try {
            const res = await fetch("/api/files/drives");
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Failed scanning drives");

            const drives = data.drives || [];
            latestDrives = drives;
            drivesCountBadge.textContent = `${drives.length} Disk${drives.length === 1 ? "" : "s"}`;

            renderServerShellButtons(data.servers || {});
            if (window.DWSNotifications && typeof window.DWSNotifications.updateServerClusterCard === "function") {
                window.DWSNotifications.updateServerClusterCard(data.servers || {});
            }
            if (typeof window.renderSettingsDrivesList === "function") {
                window.renderSettingsDrivesList(drives);
            }

            const nextIds = new Set(drives.map((d) => d.id));
            if (initialScanDone && window.DWSNotifications) {
                drives.forEach((d) => {
                    if (!knownDriveIds.has(d.id)) {
                        window.DWSNotifications.push({
                            title: "Drive Connected",
                            icon: "💽",
                            type: "success",
                            message: `${d.label} connected on ${d.server_name} (${formatBytes(d.free)} free).`,
                            timerSeconds: 10,
                            autoDismiss: true
                        });
                    }
                });
            }
            knownDriveIds = nextIds;
            initialScanDone = true;

            const offlineServers = Object.values(data.servers || {}).filter((s) => !s.online);
            statusDot.classList.toggle("warn", offlineServers.length > 0);

            renderDrivesList(drives, data.servers || {});
        } catch (err) {
            statusDot.classList.add("warn");
        }
    }

    async function promptDriveRename(drive, e) {
        if (e) e.stopPropagation();
        const nextName = prompt(
            `Enter a server-wide display name for ${drive.original_label} on ${drive.server_name} (leave empty to reset):`,
            drive.alias || drive.label
        );
        if (nextName === null) return;

        try {
            const res = await fetch("/api/drives/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    drive_id: drive.id,
                    alias: nextName.trim()
                })
            });
            const data = await res.json();
            if (data.ok) {
                await loadDrives(true);
                if (currentDrive && currentDrive.id === drive.id) {
                    panelTitle.textContent = nextName.trim() || drive.original_label;
                }
            }
        } catch (err) {}
    }

    function renderDrivesList(drives, serversMap) {
        drivesListView.innerHTML = "";

        if (drives.length === 0) {
            drivesListView.innerHTML = `<div class="panel-empty-state">No reachable drives found across SSH servers.</div>`;
        }

        drives.forEach((drive) => {
            const card = document.createElement("div");
            card.className = "drive-card";

            const meterClass = drive.percent >= 90 ? "crit" : drive.percent >= 78 ? "warn" : "";
            const osLabel = drive.os === "linux" ? "Linux" : "Win";

            card.innerHTML = `
                <div class="drive-card-top">
                    <div class="drive-title-wrap">
                        <div class="drive-icon">💽</div>
                        <div style="min-width:0;">
                            <div class="drive-name" title="${drive.label}">${drive.label}</div>
                            <div class="drive-server-sub">${drive.server_name} · ${drive.mount}</div>
                        </div>
                    </div>
                    <div class="drive-card-actions">
                        <button class="drive-rename-btn" title="Rename Drive Locally on Server">✎</button>
                        <span class="drive-os-tag">${osLabel}</span>
                    </div>
                </div>
                <div class="drive-meter-track">
                    <div class="drive-meter-fill ${meterClass}" style="width: ${Math.min(100, drive.percent)}%"></div>
                </div>
                <div class="drive-stats-row">
                    <span>${formatBytes(drive.used)} / ${formatBytes(drive.total)}</span>
                    <span><strong>${formatBytes(drive.free)}</strong> free (${drive.percent}%)</span>
                </div>
            `;

            card.querySelector(".drive-rename-btn").addEventListener("click", (e) => promptDriveRename(drive, e));
            card.addEventListener("click", () => openDrive(drive));
            drivesListView.appendChild(card);
        });

        Object.values(serversMap).forEach((info) => {
            if (!info.online) {
                const off = document.createElement("div");
                off.className = "drive-card";
                off.style.borderColor = "rgba(248, 113, 113, 0.45)";
                off.innerHTML = `
                    <div class="drive-card-top">
                        <div class="drive-title-wrap">
                            <div class="drive-icon">⚠</div>
                            <div>
                                <div class="drive-name">${info.name} (${info.host})</div>
                                <div class="drive-server-sub">SSH Offline — Click to configure</div>
                            </div>
                        </div>
                    </div>
                `;
                off.addEventListener("click", () => {
                    if (typeof window.openSettingsToTab === "function") {
                        window.openSettingsToTab("tab-servers", info.id);
                    }
                });
                drivesListView.appendChild(off);
            }
        });
    }

    async function openDrive(drive, customStartPath = null) {
        currentDrive = drive;
        panelTitle.textContent = drive.label;
        backToDrivesBtn.classList.remove("hidden");
        drivesListView.classList.add("hidden");
        fileBrowserView.classList.remove("hidden");
        await navigateToPath(customStartPath || drive.sftp_root);
    }

    window.openDriveAndPath = async function (driveId, folderPath) {
        const targetDrive = latestDrives.find((d) => d.id === driveId);
        if (!targetDrive) return;
        if (typeof window.switchMobilePane === "function") {
            window.switchMobilePane("drives");
        }
        await openDrive(targetDrive, folderPath);
    };

    function closeDriveToOverview() {
        currentDrive = null;
        selectedItem = null;
        panelTitle.textContent = "Server Drives";
        backToDrivesBtn.classList.add("hidden");
        fileBrowserView.classList.add("hidden");
        drivesListView.classList.remove("hidden");
        selectionBar.classList.add("hidden");
        loadDrives(true);
    }

    async function navigateToPath(targetPath) {
        if (!currentDrive) return;
        selectedItem = null;
        selectionBar.classList.add("hidden");
        fileItemsList.innerHTML = `<div class="panel-empty-state">Opening folder...</div>`;

        try {
            const url = `/api/files/list?server_id=${encodeURIComponent(currentDrive.server_id)}&path=${encodeURIComponent(targetPath)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Unable to list directory");

            currentPath = data.path;
            currentItems = data.items || [];
            renderBreadcrumbs(currentPath);
            renderFileItems();
        } catch (err) {
            fileItemsList.innerHTML = `<div class="panel-empty-state">Error: ${err.message}</div>`;
        }
    }

    function renderBreadcrumbs(pathStr) {
        breadcrumbsEl.innerHTML = "";
        const clean = pathStr.replace(/\\/g, "/");
        const parts = clean.split("/").filter(Boolean);

        const rootCrumb = document.createElement("span");
        rootCrumb.className = "breadcrumb-crumb";
        rootCrumb.textContent = currentDrive.mount || "/";
        rootCrumb.onclick = () => navigateToPath(currentDrive.sftp_root);
        breadcrumbsEl.appendChild(rootCrumb);

        let acc = "";
        parts.forEach((part, idx) => {
            acc += "/" + part;
            if (idx === 0 && part.endsWith(":")) return;
            const crumb = document.createElement("span");
            crumb.className = "breadcrumb-crumb";
            crumb.textContent = part;
            const navTarget = acc;
            crumb.onclick = () => navigateToPath(navTarget);
            breadcrumbsEl.appendChild(crumb);
        });
    }

    function renderFileItems() {
        const query = (filterInput.value || "").trim().toLowerCase();
        fileItemsList.innerHTML = "";

        if (currentPath !== currentDrive.sftp_root && currentPath !== "/") {
            const upRow = document.createElement("div");
            upRow.className = "file-row";
            upRow.innerHTML = `
                <div class="file-row-left">
                    <span class="file-row-icon">↩</span>
                    <span class="file-row-name">.. (Parent Directory)</span>
                </div>
            `;
            upRow.onclick = () => {
                const trimmed = currentPath.replace(/\/+$/, "");
                const parent = trimmed.substring(0, trimmed.lastIndexOf("/")) || "/";
                navigateToPath(parent);
            };
            fileItemsList.appendChild(upRow);
        }

        const filtered = currentItems.filter((item) => item.name.toLowerCase().includes(query));
        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "panel-empty-state";
            empty.textContent = query ? "No matching files." : "Empty directory (Drop files here to upload).";
            fileItemsList.appendChild(empty);
            return;
        }

        filtered.forEach((item) => {
            const row = document.createElement("div");
            row.className = "file-row";
            const icon = item.is_dir ? "📁" : "📄";
            const meta = item.is_dir ? "Folder" : formatBytes(item.size);

            row.innerHTML = `
                <div class="file-row-left">
                    <span class="file-row-icon">${icon}</span>
                    <span class="file-row-name" title="${item.name}">${item.name}</span>
                </div>
                <span class="file-row-meta">${meta}</span>
            `;

            row.addEventListener("click", () => {
                if (item.is_dir) {
                    navigateToPath(item.path);
                } else {
                    document.querySelectorAll(".file-row.selected").forEach((el) => el.classList.remove("selected"));
                    row.classList.add("selected");
                    selectedItem = item;
                    selectedLabel.textContent = `${item.name} (${formatBytes(item.size)})`;
                    selectionBar.classList.remove("hidden");
                }
            });

            fileItemsList.appendChild(row);
        });
    }

    async function uploadFilesList(fileList) {
        if (!currentDrive || !fileList || fileList.length === 0) return;
        const formData = new FormData();
        formData.append("server_id", currentDrive.server_id);
        formData.append("path", currentPath);
        Array.from(fileList).forEach((f) => formData.append("file", f));

        const notif = window.DWSNotifications
            ? window.DWSNotifications.push({
                  title: "Uploading to " + currentDrive.label,
                  icon: "↑",
                  type: "live",
                  message: `Transferring ${fileList.length} file(s)...`,
                  liveElapsed: true
              })
            : null;

        try {
            const res = await fetch("/api/files/upload", { method: "POST", body: formData });
            const data = await res.json();
            if (notif) window.DWSNotifications.remove(notif.id);
            if (!data.ok) throw new Error(data.error || "Upload failed");

            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: "Upload Complete",
                    icon: "✓",
                    type: "success",
                    message: `Saved ${(data.uploaded || []).join(", ")}`,
                    timerSeconds: 6,
                    autoDismiss: true
                });
            }
            await navigateToPath(currentPath);
            loadDrives(true);
        } catch (err) {
            if (notif) window.DWSNotifications.remove(notif.id);
        }
    }

    backToDrivesBtn.addEventListener("click", closeDriveToOverview);
    refreshBtn.addEventListener("click", () => {
        if (currentDrive) navigateToPath(currentPath);
        else loadDrives(false);
    });

    filterInput.addEventListener("input", renderFileItems);
    uploadTriggerBtn.addEventListener("click", () => hiddenFileInput.click());
    hiddenFileInput.addEventListener("change", () => {
        if (hiddenFileInput.files.length > 0) {
            uploadFilesList(hiddenFileInput.files);
            hiddenFileInput.value = "";
        }
    });

    fileListContainer.addEventListener("dragover", (e) => {
        e.preventDefault();
        fileListContainer.classList.add("drag-over");
    });
    fileListContainer.addEventListener("dragleave", () => {
        fileListContainer.classList.remove("drag-over");
    });
    fileListContainer.addEventListener("drop", (e) => {
        e.preventDefault();
        fileListContainer.classList.remove("drag-over");
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            uploadFilesList(e.dataTransfer.files);
        }
    });

    newFolderBtn.addEventListener("click", async () => {
        if (!currentDrive) return;
        const name = prompt("New folder name:");
        if (!name || !name.trim()) return;
        const res = await fetch("/api/files/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                server_id: currentDrive.server_id,
                path: currentPath,
                name: name.trim()
            })
        });
        const data = await res.json();
        if (data.ok) navigateToPath(currentPath);
    });

    downloadBtn.addEventListener("click", () => {
        if (!currentDrive || !selectedItem) return;
        const dlUrl = `/api/files/download?server_id=${encodeURIComponent(currentDrive.server_id)}&path=${encodeURIComponent(selectedItem.path)}`;
        window.open(dlUrl, "_blank");
    });

    deleteBtn.addEventListener("click", async () => {
        if (!currentDrive || !selectedItem) return;
        if (!confirm(`Delete "${selectedItem.name}"?`)) return;
        const res = await fetch("/api/files/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                server_id: currentDrive.server_id,
                path: selectedItem.path,
                is_dir: selectedItem.is_dir
            })
        });
        const data = await res.json();
        if (data.ok) navigateToPath(currentPath);
    });

    window.reloadDWSDrives = () => loadDrives(false);
    window.getLatestDWSDrives = () => latestDrives;

    window.addEventListener("DOMContentLoaded", () => {
        loadDrives(false);
        setInterval(() => {
            if (!document.hidden) loadDrives(true);
        }, 15000);
    });
})();
