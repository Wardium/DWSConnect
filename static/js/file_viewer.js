(function () {
    const drivesListView = document.getElementById("drives-list-view");
    const fileBrowserView = document.getElementById("file-browser-view");
    const panelTitle = document.getElementById("file-panel-title");
    const drivesCountBadge = document.getElementById("drives-count-badge");
    const statusDot = document.getElementById("drives-status-dot");
    const backToDrivesBtn = document.getElementById("btn-back-to-drives");
    const refreshBtn = document.getElementById("btn-refresh-files");

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

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
    }

    async function loadDrives(silent = false) {
        if (!silent && !currentDrive) {
            drivesListView.innerHTML = `<div class="panel-empty-state">Scanning 3 SSH servers for disks...</div>`;
        }
        try {
            const res = await fetch("/api/files/drives");
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Failed scanning drives");

            const drives = data.drives || [];
            drivesCountBadge.textContent = `${drives.length} Disk${drives.length === 1 ? "" : "s"}`;

            // Detect newly connected or disconnected drives
            const nextIds = new Set(drives.map((d) => d.id));
            if (initialScanDone && window.DWSNotifications) {
                drives.forEach((d) => {
                    if (!knownDriveIds.has(d.id)) {
                        window.DWSNotifications.push({
                            title: "Drive Connected",
                            icon: "💽",
                            type: "success",
                            message: `${d.label} connected on ${d.server_name} (${formatBytes(d.free)} free).`,
                            timerSeconds: 12,
                            autoDismiss: true
                        });
                    }
                });
                knownDriveIds.forEach((oldId) => {
                    if (!nextIds.has(oldId)) {
                        window.DWSNotifications.push({
                            title: "Drive Disconnected",
                            icon: "🔌",
                            type: "warn",
                            message: `Disk ${oldId} was disconnected.`,
                            liveElapsed: true
                        });
                    }
                });
            }
            knownDriveIds = nextIds;
            initialScanDone = true;

            // Check if any server is offline
            const offlineServers = Object.values(data.servers || {}).filter((s) => !s.online);
            statusDot.classList.toggle("warn", offlineServers.length > 0);

            renderDrivesList(drives, data.servers || {});
        } catch (err) {
            statusDot.classList.add("warn");
            if (window.DWSNotifications && !silent) {
                window.DWSNotifications.push({
                    title: "Drive Scan Error",
                    icon: "⚠",
                    type: "error",
                    message: err.message,
                    liveElapsed: true
                });
            }
        }
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
            const osLabel = drive.os === "linux" ? "Linux / Pi" : "Windows";

            card.innerHTML = `
                <div class="drive-card-top">
                    <div class="drive-title-wrap">
                        <div class="drive-icon">💽</div>
                        <div>
                            <div class="drive-name">${drive.label}</div>
                            <div class="drive-server-sub">${drive.server_name} · ${drive.host}</div>
                        </div>
                    </div>
                    <span class="drive-os-tag">${osLabel}</span>
                </div>
                <div class="drive-meter-track">
                    <div class="drive-meter-fill ${meterClass}" style="width: ${Math.min(100, drive.percent)}%"></div>
                </div>
                <div class="drive-stats-row">
                    <span>${formatBytes(drive.used)} used of ${formatBytes(drive.total)}</span>
                    <span><strong>${formatBytes(drive.free)}</strong> free (${drive.percent}%)</span>
                </div>
            `;

            card.addEventListener("click", () => openDrive(drive));
            drivesListView.appendChild(card);
        });

        // Show offline server notices at the bottom of the drive list
        Object.entries(serversMap).forEach(([sid, info]) => {
            if (!info.online) {
                const off = document.createElement("div");
                off.className = "drive-card";
                off.style.borderColor = "rgba(248, 113, 113, 0.4)";
                off.innerHTML = `
                    <div class="drive-card-top">
                        <div class="drive-title-wrap">
                            <div class="drive-icon" style="border-color:#f87171;background:rgba(239,68,68,0.2);">⚠</div>
                            <div>
                                <div class="drive-name">${info.name} (${info.host})</div>
                                <div class="drive-server-sub">SSH Unreachable: ${info.error || "Timeout"}</div>
                            </div>
                        </div>
                    </div>
                `;
                drivesListView.appendChild(off);
            }
        });
    }

    async function openDrive(drive) {
        currentDrive = drive;
        panelTitle.textContent = drive.label;
        backToDrivesBtn.classList.remove("hidden");
        drivesListView.classList.add("hidden");
        fileBrowserView.classList.remove("hidden");
        await navigateToPath(drive.sftp_root);
    }

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
        fileItemsList.innerHTML = `<div class="panel-empty-state">Loading directory...</div>`;

        try {
            const url = `/api/files/list?server_id=${encodeURIComponent(currentDrive.server_id)}&path=${encodeURIComponent(targetPath)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "Unable to open folder");

            currentPath = data.path;
            currentItems = data.items || [];
            renderBreadcrumbs(currentPath);
            renderFileItems();
        } catch (err) {
            fileItemsList.innerHTML = `<div class="panel-empty-state">Error: ${err.message}</div>`;
            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: `SFTP Error (${currentDrive.server_name})`,
                    icon: "⚠",
                    type: "error",
                    message: err.message,
                    liveElapsed: true
                });
            }
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

        let acc = clean.startsWith("/") ? "" : "";
        parts.forEach((part, idx) => {
            acc += "/" + part;
            // Skip repeating Windows drive letter root
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

        // Parent '..' row if not at drive root
        if (currentPath !== currentDrive.sftp_root && currentPath !== "/") {
            const upRow = document.createElement("div");
            upRow.className = "file-row";
            upRow.innerHTML = `
                <div class="file-row-left">
                    <span class="file-row-icon">↩</span>
                    <span class="file-row-name">.. (Parent Folder)</span>
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
            empty.textContent = query ? "No matching files." : "Folder is empty (Drag files here to upload).";
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
                  message: `Uploading ${fileList.length} file(s) to ${currentPath}...`,
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
                    message: `Uploaded ${(data.uploaded || []).join(", ")}`,
                    timerSeconds: 8,
                    autoDismiss: true
                });
            }
            await navigateToPath(currentPath);
            loadDrives(true);
        } catch (err) {
            if (notif) window.DWSNotifications.remove(notif.id);
            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: "Upload Failed",
                    icon: "⚠",
                    type: "error",
                    message: err.message,
                    liveElapsed: true
                });
            }
        }
    }

    // Event bindings
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

    // Drag and Drop upload support
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
        try {
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
            if (!data.ok) throw new Error(data.error);
            navigateToPath(currentPath);
        } catch (err) {
            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: "Create Folder Failed",
                    icon: "⚠",
                    type: "error",
                    message: err.message
                });
            }
        }
    });

    downloadBtn.addEventListener("click", () => {
        if (!currentDrive || !selectedItem) return;
        const dlUrl = `/api/files/download?server_id=${encodeURIComponent(currentDrive.server_id)}&path=${encodeURIComponent(selectedItem.path)}`;
        window.open(dlUrl, "_blank");
    });

    deleteBtn.addEventListener("click", async () => {
        if (!currentDrive || !selectedItem) return;
        if (!confirm(`Delete "${selectedItem.name}" from ${currentDrive.server_name}?`)) return;
        try {
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
            if (!data.ok) throw new Error(data.error);
            navigateToPath(currentPath);
        } catch (err) {
            if (window.DWSNotifications) {
                window.DWSNotifications.push({
                    title: "Delete Failed",
                    icon: "⚠",
                    type: "error",
                    message: err.message
                });
            }
        }
    });

    // Quick SSH Terminal Launcher buttons
    document.querySelectorAll("[data-shell-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sid = btn.dataset.shellId;
            if (typeof window.openCustomIframe === "function") {
                window.openCustomIframe(`SSH Terminal · Server ${sid}`, `/shell/${sid}`, btn);
            } else {
                window.open(`/shell/${sid}`, "_blank");
            }
        });
    });

    // Initial load + automatic background drive hotplug polling every 15s
    window.addEventListener("DOMContentLoaded", () => {
        loadDrives(false);
        setInterval(() => {
            if (!document.hidden) loadDrives(true);
        }, 15000);
    });
})();
