importScripts("scripts/visible.js");

const CAPTURE_INTERVAL_MS = 550;
const MAX_FULL_PAGE_HEIGHT = 30000;

const HIDE_SCROLLBARS_CSS = `
    html,
    body,
    * {
        scrollbar-color: transparent transparent !important;
    }

    *::-webkit-scrollbar,
    *::-webkit-scrollbar-track,
    *::-webkit-scrollbar-thumb,
    *::-webkit-scrollbar-corner {
        background: transparent !important;
        border-color: transparent !important;
    }
`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "CAPTURE_VISIBLE") {
    captureVisiblePage()
      .then(() => sendResponse({
        ok: true
      }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }

  if (message.type === "CAPTURE_FULL_PAGE") {
    captureFullPage()
      .then(() => sendResponse({
        ok: true
      }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }

  if (message.type === "START_AREA_CAPTURE") {
    startAreaCapture()
      .then(() => sendResponse({
        ok: true
      }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message
      }));

    return true;
  }

  if (message.type === "AREA_SELECTED") {
    captureSelectedArea(message, sender)
      .catch((error) => {
        console.error(
          "[ViewportSnap] Area capture failed:",
          error
        );
      });

    return false;
  }

  return false;
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs.length || typeof tabs[0].id !== "number") {
    throw new Error("No active tab found.");
  }

  return tabs[0];
}

function assertCapturableTab(tab) {
  const url = tab.url || "";

  if (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  ) {
    throw new Error(
      "This page cannot be captured by an extension."
    );
  }
}

async function captureFullPage() {
  const tab = await getActiveTab();

  assertCapturableTab(tab);

  let prepared = false;
  let scrollbarsHidden = false;

  try {
    await hideScrollbars(tab.id);

    scrollbarsHidden = true;

    await sleep(80);

    await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      files: [
        "scripts/full-page.js"
      ]
    });

    const preparation = await sendTabMessage(
      tab.id,
      {
        type: "PAGE_CAPTURE_PREPARE"
      }
    );

    if (!preparation.ok) {
      throw new Error(
        preparation.error ||
        "Unable to prepare the page."
      );
    }

    prepared = true;

    const mode = preparation.mode;
    const viewportWidth = preparation.viewportWidth;
    const viewportHeight = preparation.viewportHeight;
    const scrollViewportHeight = preparation.scrollViewportHeight;

    const scrollHeight = Math.min(
      preparation.scrollHeight,
      MAX_FULL_PAGE_HEIGHT
    );

    const maxScroll = Math.max(
      0,
      Math.min(
        preparation.maxScroll,
        MAX_FULL_PAGE_HEIGHT
      )
    );

    const positions = buildCapturePositions(
      maxScroll,
      scrollViewportHeight
    );

    const captures = [];

    for (
      let index = 0;
      index < positions.length;
      index += 1
    ) {
      const scrollResult = await sendTabMessage(
        tab.id,
        {
          type: "PAGE_CAPTURE_SCROLL",
          y: positions[index],
          firstCapture: index === 0,
          lastCapture:
            index === positions.length - 1
        }
      );

      if (!scrollResult.ok) {
        throw new Error(
          scrollResult.error ||
          "Unable to scroll the page."
        );
      }

      if (index > 0) {
        await sleep(
          CAPTURE_INTERVAL_MS
        );
      }

      const dataUrl =
        await chrome.tabs.captureVisibleTab(
          tab.windowId,
          {
            format: "png"
          }
        );

      captures.push({
        dataUrl,
        scrollY: scrollResult.scrollY
      });
    }

    let stitchedDataUrl;

    if (mode === "element") {
      stitchedDataUrl =
        await stitchElementScroller({
          captures,
          viewportWidth,
          viewportHeight,
          scrollRect:
            preparation.scrollRect,
          scrollHeight,
          pageBackground:
            preparation.pageBackground,
          companionPanels:
            preparation.companionPanels
        });
    } else {
      stitchedDataUrl =
        await stitchWindowScroller({
          captures,
          viewportWidth,
          viewportHeight,
          pageHeight: Math.min(
            preparation.pageHeight,
            MAX_FULL_PAGE_HEIGHT
          ),
          pageBackground:
            preparation.pageBackground
        });
    }

    await downloadDataUrl(
      stitchedDataUrl,
      tab,
      "full-page"
    );
  } finally {
    if (prepared) {
      try {
        await sendTabMessage(
          tab.id,
          {
            type: "PAGE_CAPTURE_RESTORE"
          }
        );
      } catch (error) {
        console.warn(
          "[ViewportSnap] Could not restore the page:",
          error
        );
      }
    }

    if (scrollbarsHidden) {
      await showScrollbars(tab.id);
    }
  }
}

function buildCapturePositions(
  maxScroll,
  viewportHeight
) {
  const safeViewportHeight = Math.max(
    1,
    Math.floor(viewportHeight)
  );

  const positions = [0];

  let nextY = safeViewportHeight;

  while (nextY < maxScroll) {
    positions.push(nextY);

    nextY += safeViewportHeight;
  }

  if (
    maxScroll >
    positions[positions.length - 1]
  ) {
    positions.push(maxScroll);
  }

  return positions;
}

async function stitchElementScroller({
  captures,
  viewportWidth,
  viewportHeight,
  scrollRect,
  scrollHeight,
  pageBackground,
  companionPanels
}) {
  if (!captures.length) {
    throw new Error(
      "No screenshots were captured."
    );
  }

  const firstImage =
    await dataUrlToImageBitmap(
      captures[0].dataUrl
    );

  const scaleX =
    firstImage.width /
    viewportWidth;

  const scaleY =
    firstImage.height /
    viewportHeight;

  const bottomStaticHeight = Math.max(
    0,
    viewportHeight -
    (
      scrollRect.y +
      scrollRect.height
    )
  );

  const outputWidth =
    firstImage.width;

  const outputCssHeight =
    scrollRect.y +
    scrollHeight +
    bottomStaticHeight;

  const outputHeight = Math.max(
    firstImage.height,
    Math.round(
      outputCssHeight * scaleY
    )
  );

  const canvas = new OffscreenCanvas(
    outputWidth,
    outputHeight
  );

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Unable to create the full-page image canvas."
    );
  }

  fillCanvasBackground(
    context,
    outputWidth,
    outputHeight,
    pageBackground
  );

  drawCompanionPanels({
    context,
    panels: companionPanels,
    outputHeight,
    scaleX,
    scaleY,
    bottomStaticHeight
  });

  context.drawImage(
    firstImage,
    0,
    0
  );

  const sourceX = Math.round(
    scrollRect.x * scaleX
  );

  const sourceY = Math.round(
    scrollRect.y * scaleY
  );

  const sourceWidth = Math.round(
    scrollRect.width * scaleX
  );

  const sourceViewportHeight =
    Math.round(
      scrollRect.height * scaleY
    );

  for (
    let index = 1;
    index < captures.length;
    index += 1
  ) {
    const capture = captures[index];

    const image =
      await dataUrlToImageBitmap(
        capture.dataUrl
      );

    const remainingCssHeight =
      Math.max(
        0,
        scrollHeight -
        capture.scrollY
      );

    if (remainingCssHeight <= 0) {
      continue;
    }

    const sourceHeight = Math.min(
      sourceViewportHeight,
      Math.round(
        remainingCssHeight *
        scaleY
      )
    );

    if (sourceHeight <= 0) {
      continue;
    }

    const destinationY =
      Math.round(
        (
          scrollRect.y +
          capture.scrollY
        ) *
        scaleY
      );

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      sourceX,
      destinationY,
      sourceWidth,
      sourceHeight
    );
  }

  if (bottomStaticHeight > 0) {
    const bottomSourceY =
      Math.round(
        (
          scrollRect.y +
          scrollRect.height
        ) *
        scaleY
      );

    const bottomSourceHeight =
      Math.round(
        bottomStaticHeight *
        scaleY
      );

    const bottomDestinationY =
      Math.round(
        (
          scrollRect.y +
          scrollHeight
        ) *
        scaleY
      );

    if (bottomSourceHeight > 0) {
      context.drawImage(
        firstImage,
        0,
        bottomSourceY,
        firstImage.width,
        bottomSourceHeight,
        0,
        bottomDestinationY,
        firstImage.width,
        bottomSourceHeight
      );
    }
  }

  return canvasToDataUrl(canvas);
}

async function stitchWindowScroller({
  captures,
  viewportWidth,
  viewportHeight,
  pageHeight,
  pageBackground
}) {
  if (!captures.length) {
    throw new Error(
      "No screenshots were captured."
    );
  }

  const firstImage =
    await dataUrlToImageBitmap(
      captures[0].dataUrl
    );

  const scaleX =
    firstImage.width /
    viewportWidth;

  const scaleY =
    firstImage.height /
    viewportHeight;

  const outputWidth =
    firstImage.width;

  const outputHeight = Math.max(
    firstImage.height,
    Math.round(
      pageHeight * scaleY
    )
  );

  const canvas = new OffscreenCanvas(
    outputWidth,
    outputHeight
  );

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Unable to create the full-page image canvas."
    );
  }

  fillCanvasBackground(
    context,
    outputWidth,
    outputHeight,
    pageBackground
  );

  context.drawImage(
    firstImage,
    0,
    0
  );

  for (
    let index = 1;
    index < captures.length;
    index += 1
  ) {
    const capture = captures[index];

    const image =
      await dataUrlToImageBitmap(
        capture.dataUrl
      );

    const destinationY =
      Math.round(
        capture.scrollY *
        scaleY
      );

    const remainingHeight =
      outputHeight -
      destinationY;

    if (remainingHeight <= 0) {
      continue;
    }

    const drawHeight =
      Math.min(
        image.height,
        remainingHeight
      );

    context.drawImage(
      image,
      0,
      0,
      Math.min(
        image.width,
        outputWidth
      ),
      drawHeight,
      0,
      destinationY,
      Math.min(
        image.width,
        outputWidth
      ),
      drawHeight
    );
  }

  return canvasToDataUrl(canvas);
}

function fillCanvasBackground(
  context,
  width,
  height,
  backgroundColor
) {
  context.save();

  if (
    typeof backgroundColor === "string" &&
    backgroundColor &&
    backgroundColor !==
    "rgba(0, 0, 0, 0)" &&
    backgroundColor !==
    "transparent"
  ) {
    context.fillStyle =
      backgroundColor;
  } else {
    context.fillStyle =
      "#ffffff";
  }

  context.fillRect(
    0,
    0,
    width,
    height
  );

  context.restore();
}

function drawCompanionPanels({
  context,
  panels,
  outputHeight,
  scaleX,
  scaleY,
  bottomStaticHeight
}) {
  if (!Array.isArray(panels)) {
    return;
  }

  for (const panel of panels) {
    if (!panel || !panel.rect) {
      continue;
    }

    const x = Math.round(
      panel.rect.x * scaleX
    );

    const y = Math.round(
      panel.rect.y * scaleY
    );

    const width = Math.round(
      panel.rect.width * scaleX
    );

    const maxPanelHeight =
      Math.max(
        0,
        outputHeight -
        y -
        Math.round(
          bottomStaticHeight *
          scaleY
        )
      );

    if (
      width <= 0 ||
      maxPanelHeight <= 0
    ) {
      continue;
    }

    context.save();

    if (
      panel.backgroundColor &&
      panel.backgroundColor !==
      "rgba(0, 0, 0, 0)" &&
      panel.backgroundColor !==
      "transparent"
    ) {
      context.fillStyle =
        panel.backgroundColor;

      context.fillRect(
        x,
        y,
        width,
        maxPanelHeight
      );
    }

    drawPanelBorder(
      context,
      panel,
      x,
      y,
      width,
      maxPanelHeight,
      scaleX,
      scaleY
    );

    context.restore();
  }
}

function drawPanelBorder(
  context,
  panel,
  x,
  y,
  width,
  height,
  scaleX,
  scaleY
) {
  const borders =
    panel.borders || {};

  if (
    borders.right &&
    borders.right.width > 0 &&
    borders.right.style !== "none" &&
    borders.right.color !==
    "rgba(0, 0, 0, 0)"
  ) {
    context.fillStyle =
      borders.right.color;

    context.fillRect(
      x +
      width -
      Math.max(
        1,
        Math.round(
          borders.right.width *
          scaleX
        )
      ),
      y,
      Math.max(
        1,
        Math.round(
          borders.right.width *
          scaleX
        )
      ),
      height
    );
  }

  if (
    borders.left &&
    borders.left.width > 0 &&
    borders.left.style !== "none" &&
    borders.left.color !==
    "rgba(0, 0, 0, 0)"
  ) {
    context.fillStyle =
      borders.left.color;

    context.fillRect(
      x,
      y,
      Math.max(
        1,
        Math.round(
          borders.left.width *
          scaleX
        )
      ),
      height
    );
  }
}

async function canvasToDataUrl(canvas) {
  const outputBlob =
    await canvas.convertToBlob({
      type: "image/png"
    });

  return blobToDataUrl(
    outputBlob
  );
}

async function sendTabMessage(
  tabId,
  message
) {
  return chrome.tabs.sendMessage(
    tabId,
    message
  );
}

async function dataUrlToImageBitmap(
  dataUrl
) {
  const response =
    await fetch(dataUrl);

  const blob =
    await response.blob();

  return createImageBitmap(blob);
}

async function hideScrollbars(tabId) {
  await chrome.scripting.insertCSS({
    target: {
      tabId
    },
    css: HIDE_SCROLLBARS_CSS,
    origin: "USER"
  });
}

async function showScrollbars(tabId) {
  try {
    await chrome.scripting.removeCSS({
      target: {
        tabId
      },
      css: HIDE_SCROLLBARS_CSS,
      origin: "USER"
    });
  } catch (error) {
    console.warn(
      "[ViewportSnap] Could not restore scrollbars:",
      error
    );
  }
}

async function startAreaCapture() {
  const tab = await getActiveTab();

  assertCapturableTab(tab);

  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    files: [
      "scripts/area-picker.js"
    ]
  });
}

async function captureSelectedArea(
  message,
  sender
) {
  const tab = sender.tab;

  if (
    !tab ||
    typeof tab.id !== "number"
  ) {
    throw new Error(
      "The source tab is unavailable."
    );
  }

  assertCapturableTab(tab);

  let scrollbarsHidden = false;

  try {
    await hideScrollbars(tab.id);

    scrollbarsHidden = true;

    await sleep(80);

    const screenshotDataUrl =
      await chrome.tabs.captureVisibleTab(
        tab.windowId,
        {
          format: "png"
        }
      );

    const croppedDataUrl =
      await cropScreenshot(
        screenshotDataUrl,
        message.rect,
        message.viewport
      );

    await downloadDataUrl(
      croppedDataUrl,
      tab,
      "area"
    );
  } finally {
    if (scrollbarsHidden) {
      await showScrollbars(
        tab.id
      );
    }
  }
}

async function cropScreenshot(
  dataUrl,
  rect,
  viewport
) {
  if (!rect || !viewport) {
    throw new Error(
      "Invalid selection."
    );
  }

  const image =
    await dataUrlToImageBitmap(
      dataUrl
    );

  const scaleX =
    image.width /
    viewport.width;

  const scaleY =
    image.height /
    viewport.height;

  const sourceX = Math.max(
    0,
    Math.round(
      rect.x * scaleX
    )
  );

  const sourceY = Math.max(
    0,
    Math.round(
      rect.y * scaleY
    )
  );

  const sourceWidth = Math.max(
    1,
    Math.round(
      rect.width * scaleX
    )
  );

  const sourceHeight = Math.max(
    1,
    Math.round(
      rect.height * scaleY
    )
  );

  const safeWidth = Math.min(
    sourceWidth,
    image.width -
    sourceX
  );

  const safeHeight = Math.min(
    sourceHeight,
    image.height -
    sourceY
  );

  if (
    safeWidth <= 0 ||
    safeHeight <= 0
  ) {
    throw new Error(
      "The selected area is outside the captured viewport."
    );
  }

  const canvas =
    new OffscreenCanvas(
      safeWidth,
      safeHeight
    );

  const context =
    canvas.getContext("2d");

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

  return canvasToDataUrl(
    canvas
  );
}

async function blobToDataUrl(blob) {
  const buffer =
    await blob.arrayBuffer();

  const bytes =
    new Uint8Array(buffer);

  const chunkSize =
    0x8000;

  let binary = "";

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    const chunk =
      bytes.subarray(
        index,
        index + chunkSize
      );

    binary +=
      String.fromCharCode(
        ...chunk
      );
  }

  return (
    `data:image/png;base64,${btoa(binary)}`
  );
}

async function downloadDataUrl(
  dataUrl,
  tab,
  captureType
) {
  const filename =
    buildFilename(
      tab,
      captureType
    );

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

function buildFilename(
  tab,
  captureType
) {
  let host = "page";

  try {
    host =
      new URL(tab.url).hostname ||
      "page";
  } catch (error) {
    host = "page";
  }

  const safeHost = host
    .replace(/^www\./, "")
    .replace(
      /[^a-zA-Z0-9.-]+/g,
      "-"
    );

  const now =
    new Date();

  const timestamp =
    [
      now.getFullYear(),
      pad(
        now.getMonth() + 1
      ),
      pad(
        now.getDate()
      )
    ].join("-") +
    "_" +
    [
      pad(
        now.getHours()
      ),
      pad(
        now.getMinutes()
      ),
      pad(
        now.getSeconds()
      )
    ].join("-");

  return (
    `viewportsnap_${safeHost}_${captureType}_${timestamp}.png`
  );
}

function pad(value) {
  return String(value)
    .padStart(2, "0");
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds
    );
  });
}
