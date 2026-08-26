async function captureVisiblePage() {
  const tab = await getActiveTab();
  assertCapturableTab(tab);

  let scrollbarsHidden = false;

  try {
    await hideScrollbars(tab.id);
    scrollbarsHidden = true;
    await sleep(80);

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    await downloadDataUrl(dataUrl, tab, "page");
  } finally {
    if (scrollbarsHidden) {
      await showScrollbars(tab.id);
    }
  }
}
