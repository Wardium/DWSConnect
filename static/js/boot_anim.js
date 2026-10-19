function runPostBootChoreography() {
        // 1. Freeze the SVG on its exact final frame (2.45s)
        brandHeader.classList.add("svg-frozen");
        if (svgElement && typeof svgElement.pauseAnimations === "function") {
            svgElement.pauseAnimations();
        }

        // 2. Glide & shrink the frozen SVG to the top (2.1s) + slowly dissolve black curtain (2.8s)
        brandHeader.classList.remove("state-booting");
        brandHeader.classList.add("state-docked");
        curtain.classList.add("fade-away");

        // 3. Unfold the centered widget box along the X-axis (starts 750ms into the header glide)
        setTimeout(() => {
            appGrid.classList.add("box-open-x");
        }, 750);

        // 4. Cascade icons inside the box from top to bottom as the X-expansion settles
        setTimeout(() => {
            if (typeof window.recalculateTopToBottomStagger === "function") {
                window.recalculateTopToBottomStagger();
            }
            appGrid.classList.add("icons-revealed");
            settingsBtn.classList.add("chrome-visible");
        }, 1680);
    }
