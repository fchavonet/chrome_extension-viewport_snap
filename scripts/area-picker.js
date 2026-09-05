(function () {
  const existingOverlay = document.querySelector(
    "#viewportsnap-area-overlay"
  );

  if (existingOverlay) {
    existingOverlay.remove();
  }

  const overlay = document.createElement("div");
  const selection = document.createElement("div");

  overlay.id = "viewportsnap-area-overlay";

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0, 0, 0, 0.08)",
    userSelect: "none"
  });

  Object.assign(selection.style, {
    position: "absolute",
    display: "none",
    border: "2px solid rgb(14, 165, 233)",
    background: "rgba(14, 165, 233, 0.08)",
    boxShadow: "0 0 0 99999px rgba(0, 0, 0, 0.20)",
    pointerEvents: "none"
  });

  overlay.appendChild(selection);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let selecting = false;

  overlay.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    selecting = true;

    startX = event.clientX;
    startY = event.clientY;

    currentX = startX;
    currentY = startY;

    selection.style.display = "block";

    updateSelection();
  });

  overlay.addEventListener("mousemove", (event) => {
    if (!selecting) {
      return;
    }

    currentX = event.clientX;
    currentY = event.clientY;

    updateSelection();
  });

  overlay.addEventListener("mouseup", (event) => {
    if (!selecting || event.button !== 0) {
      return;
    }

    event.preventDefault();

    selecting = false;

    currentX = event.clientX;
    currentY = event.clientY;

    const rect = getSelectionRect();

    cleanup();

    if (rect.width < 2 || rect.height < 2) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "AREA_SELECTED",
      rect: rect,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    });
  });

  document.addEventListener(
    "keydown",
    handleKeydown,
    true
  );

  function updateSelection() {
    const rect = getSelectionRect();

    selection.style.left = `${rect.x}px`;
    selection.style.top = `${rect.y}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
  }

  function getSelectionRect() {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);

    const width = Math.abs(
      currentX - startX
    );

    const height = Math.abs(
      currentY - startY
    );

    return {
      x: x,
      y: y,
      width: width,
      height: height
    };
  }

  function handleKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    cleanup();
  }

  function cleanup() {
    document.removeEventListener(
      "keydown",
      handleKeydown,
      true
    );

    overlay.remove();
  }
})();
