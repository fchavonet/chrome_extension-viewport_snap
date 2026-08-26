/***********************************
* SYSTEM THEME ADAPTATION BEHAVIOR *
***********************************/

// Tags to which the theme class will be applied.
const targetedTags = [
  "body",
  "header",
  "#title-container",
  "header p",
  ".capture-button",
  ".button-description",
  "#status",
  "footer"
];

// Apply or remove the "dark" class on each targeted element.
function applySystemTheme(isDarkMode) {
  targetedTags.forEach(function (tagName) {
    const elements = document.querySelectorAll(tagName);

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];

      if (isDarkMode) {
        element.classList.add("dark");
      } else {
        element.classList.remove("dark");
      }
    }
  });
}

// Initialize system color-scheme query.
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

// Apply initial theme.
applySystemTheme(systemThemeQuery.matches);

// Listen for changes in system preference.
systemThemeQuery.addEventListener("change", function (event) {
  applySystemTheme(event.matches);
});


/********************
* CAPTURE BEHAVIOR *
********************/

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
