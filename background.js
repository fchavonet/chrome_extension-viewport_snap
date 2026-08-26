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

  if (message.type === "START_AREA_CAPTURE") {
    startAreaCapture()
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        console.error("Unable to start area capture:", error);

        sendResponse({
          ok: false,
          error: error.message
        });
      });

    return true;
  }

  if (message.type === "AREA_SELECTED") {
    captureSelectedArea(message, sender)
      .catch((error) => {
        console.error("Area capture failed:", error);
      });

    return false;
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
    saveAs: false,
    conflictAction: "uniquify"
  });
}

async function startAreaCapture() {
  const tab = await getActiveTab();

  validateTab(tab);

  if (typeof tab.id !== "number") {
    throw new Error("Unable to access the active tab.");
  }

  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    files: [
      "scripts/area-picker.js"
    ]
  });
}

async function captureSelectedArea(message, sender) {
  const tab = sender.tab;

  if (!tab) {
    throw new Error("Unable to find the source tab.");
  }

  validateTab(tab);

  if (!message.rect || !message.viewport) {
    throw new Error("Invalid area selection.");
  }

  await delay(50);

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(
    tab.windowId,
    {
      format: "png"
    }
  );

  const croppedDataUrl = await cropScreenshot(
    screenshotDataUrl,
    message.rect,
    message.viewport
  );

  await chrome.downloads.download({
    url: croppedDataUrl,
    filename: buildFilename(tab, "area"),
    saveAs: false,
    conflictAction: "uniquify"
  });
}

async function cropScreenshot(dataUrl, rect, viewport) {
  const image = await dataUrlToImageBitmap(dataUrl);

  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;

  const sourceX = Math.max(
    0,
    Math.round(rect.x * scaleX)
  );

  const sourceY = Math.max(
    0,
    Math.round(rect.y * scaleY)
  );

  const sourceWidth = Math.max(
    1,
    Math.round(rect.width * scaleX)
  );

  const sourceHeight = Math.max(
    1,
    Math.round(rect.height * scaleY)
  );

  const safeWidth = Math.min(
    sourceWidth,
    image.width - sourceX
  );

  const safeHeight = Math.min(
    sourceHeight,
    image.height - sourceY
  );

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error(
      "The selected area is outside the viewport."
    );
  }

  const canvas = new OffscreenCanvas(
    safeWidth,
    safeHeight
  );

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Unable to create the image canvas."
    );
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    safeWidth,
    safeHeight,
    0,
    0,
    safeWidth,
    safeHeight
  );

  image.close();

  return canvasToDataUrl(canvas);
}

async function dataUrlToImageBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return createImageBitmap(blob);
}

async function canvasToDataUrl(canvas) {
  const blob = await canvas.convertToBlob({
    type: "image/png"
  });

  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const chunkSize = 0x8000;

  let binary = "";

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    const chunk = bytes.subarray(
      index,
      index + chunkSize
    );

    binary += String.fromCharCode(...chunk);
  }

  return `data:image/png;base64,${btoa(binary)}`;
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
    throw new Error(
      "Chrome internal pages cannot be captured."
    );
  }

  if (tab.url.startsWith("chrome-extension://")) {
    throw new Error(
      "Chrome extension pages cannot be captured."
    );
  }
}

function buildFilename(tab, captureType) {
  let hostname = "page";

  if (tab.url) {
    try {
      const url = new URL(tab.url);

      if (url.hostname) {
        hostname = url.hostname;
      }
    } catch (error) {
      console.error(
        "Unable to determine page hostname:",
        error
      );
    }
  }

  const date = new Date();

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const filenameParts = [
    "viewportsnap",
    hostname
  ];

  if (captureType) {
    filenameParts.push(captureType);
  }

  filenameParts.push(
    `${year}-${month}-${day}`,
    `${hours}-${minutes}-${seconds}`
  );

  return filenameParts.join("_") + ".png";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}