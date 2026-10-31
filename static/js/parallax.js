(function () {
    const layers = document.querySelectorAll(".parallax-layer");
    const orb1 = document.getElementById("svg-orb-1");
    const orb2 = document.getElementById("svg-orb-2");
    const orb3 = document.getElementById("svg-orb-3");

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let tick = 0;
    let rafId = null;

    window.addEventListener("mousemove", (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) {
            targetX = (e.touches[0].clientX / window.innerWidth - 0.5) * 1.5;
            targetY = (e.touches[0].clientY / window.innerHeight - 0.5) * 1.5;
        }
    }, { passive: true });

    function animateParallax() {
        if (document.hidden) {
            rafId = null;
            return;
        }
        tick += 0.012;
        currentX += (targetX - currentX) * 0.075;
        currentY += (targetY - currentY) * 0.075;

        layers.forEach((layer) => {
            const depth = parseFloat(layer.dataset.depth || 0.05);
            const moveX = -currentX * (window.innerWidth * depth);
            const moveY = -currentY * (window.innerHeight * depth);
            layer.style.transform = `translate3d(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px, 0)`;
        });

        if (orb1 && orb2 && orb3) {
            orb1.setAttribute("cx", (550 + Math.sin(tick) * 90).toFixed(1));
            orb1.setAttribute("cy", (380 + Math.cos(tick * 0.8) * 70).toFixed(1));
            orb2.setAttribute("cx", (1350 + Math.cos(tick * 0.9) * 110).toFixed(1));
            orb2.setAttribute("cy", (700 + Math.sin(tick * 0.7) * 85).toFixed(1));
            orb3.setAttribute("cx", (960 + Math.sin(tick * 1.1) * 75).toFixed(1));
        }

        rafId = requestAnimationFrame(animateParallax);
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !rafId) {
            rafId = requestAnimationFrame(animateParallax);
        }
    });

    rafId = requestAnimationFrame(animateParallax);
})();
