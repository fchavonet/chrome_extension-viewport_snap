const captureVisibleButton = document.querySelector("#capture-visible-button");
const captureAreaButton = document.querySelector("#capture-area-button");

captureVisibleButton.addEventListener("click", async () => {
  captureVisibleButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE"
    });

    if (!response) {
      throw new Error("No response from the extension.");
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    window.close();
  } catch (error) {
    console.error("Visible area capture failed:", error);

    captureVisibleButton.disabled = false;
  }
});

captureAreaButton.addEventListener("click", async () => {
  captureAreaButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_AREA_CAPTURE"
    });

    if (!response) {
      throw new Error("No response from the extension.");
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    window.close();
  } catch (error) {
    console.error("Area capture failed:", error);

    captureAreaButton.disabled = false;
  }
});
