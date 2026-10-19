(function () {
    const layers = document.querySelectorAll(".parallax-layer");
    const orb1 = document.getElementById("svg-orb-1");
    const orb2 = document.getElementById("svg-orb-2");
    const orb3 = document.getElementById("svg-orb-3");

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let tick = 0;

    window.addEventListener("mousemove", (e) => {
        // Normalize mouse coordinates to [-1, 1]
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    function animateParallax() {
        tick += 0.012;
        // Smooth spring lerp
        currentX += (targetX - currentX) * 0.075;
        currentY += (targetY - currentY) * 0.075;

        layers.forEach((layer) => {
            const depth = parseFloat(layer.dataset.depth || 0.05);
            const moveX = -currentX * (window.innerWidth * depth);
            const moveY = -currentY * (window.innerHeight * depth);
            layer.style.transform = `translate3d(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px, 0)`;
        });

        // Subtle autonomous drift for the default SVG background orbs
        if (orb1 && orb2 && orb3) {
            orb1.setAttribute("cx", 550 + Math.sin(tick) * 90);
            orb1.setAttribute("cy", 380 + Math.cos(tick * 0.8) * 70);
            orb2.setAttribute("cx", 1350 + Math.cos(tick * 0.9) * 110);
            orb2.setAttribute("cy", 700 + Math.sin(tick * 0.7) * 85);
            orb3.setAttribute("cx", 960 + Math.sin(tick * 1.1) * 75);
        }

        requestAnimationFrame(animateParallax);
    }

    requestAnimationFrame(animateParallax);
})();
