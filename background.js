chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "CAPTURE_VISIBLE") {
    captureVisible()
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        console.error("Visible area capture failed:", error);

        sendResponse({
          ok: false,
          error: error.message
        });
      });

    return true;
  }

  return false;
});

async function captureVisible() {
  const tab = await getActiveTab();

  validateTab(tab);

  const dataUrl = await chrome.tabs.captureVisibleTab(
    tab.windowId,
    {
      format: "png"
    }
  );

  await chrome.downloads.download({
    url: dataUrl,
    filename: buildFilename(tab),
    saveAs: false
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];

  if (!tab) {
    throw new Error("Unable to find the active tab.");
  }

  return tab;
}

function validateTab(tab) {
  if (!tab.url) {
    return;
  }

  if (tab.url.startsWith("chrome://")) {
    throw new Error("Chrome internal pages cannot be captured.");
  }

  if (tab.url.startsWith("chrome-extension://")) {
    throw new Error("Chrome extension pages cannot be captured.");
  }
}

function buildFilename(tab) {
  let hostname = "page";

  if (tab.url) {
    try {
      const url = new URL(tab.url);

      if (url.hostname) {
        hostname = url.hostname;
      }
    } catch (error) {
      console.error("Unable to determine page hostname:", error);
    }
  }

  const date = new Date();

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return [
    "viewportsnap",
    hostname,
    `${year}-${month}-${day}`,
    `${hours}-${minutes}-${seconds}`
  ].join("_") + ".png";
}

function pad(value) {
  return String(value).padStart(2, "0");
}
