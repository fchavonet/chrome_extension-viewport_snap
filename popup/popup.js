const captureVisibleButton = document.querySelector("#capture-visible-button");
const captureFullPageButton = document.querySelector("#capture-full-page-button");
const captureAreaButton = document.querySelector("#capture-area-button");

captureVisibleButton.addEventListener("click", async () => {
  await runCapture(
    captureVisibleButton,
    "CAPTURE_VISIBLE"
  );
});

captureFullPageButton.addEventListener("click", async () => {
  await runCapture(
    captureFullPageButton,
    "CAPTURE_FULL_PAGE"
  );
});

captureAreaButton.addEventListener("click", async () => {
  setButtonsDisabled(true);

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

    setButtonsDisabled(false);
  }
});

async function runCapture(button, messageType) {
  setButtonsDisabled(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType
    });

    if (!response) {
      throw new Error("No response from the extension.");
    }

    if (!response.ok) {
      throw new Error(response.error);
    }

    window.close();
  } catch (error) {
    console.error("Capture failed:", error);

    button.disabled = false;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  captureVisibleButton.disabled = disabled;
  captureFullPageButton.disabled = disabled;
  captureAreaButton.disabled = disabled;
}
