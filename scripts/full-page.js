(() => {
  if (window.__pageCaptureFullPageInstalled) {
    return;
  }

  window.__pageCaptureFullPageInstalled = true;

  const state = {
    active: false,
    mode: "window",
    scrollElement: null,
    originalWindowScrollX: 0,
    originalWindowScrollY: 0,
    originalElementScrollTop: 0,
    originalElementScrollLeft: 0,
    originalStyles: new Map(),
    hiddenFixedElements: [],
    fixedElements: []
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "PAGE_CAPTURE_PREPARE") {
      preparePage()
        .then((result) => sendResponse({
          ok: true,
          ...result
        }))
        .catch((error) => sendResponse({
          ok: false,
          error: error.message
        }));

      return true;
    }

    if (message.type === "PAGE_CAPTURE_SCROLL") {
      scrollPage(
        message.y,
        message.firstCapture === true,
        message.lastCapture === true
      )
        .then((result) => sendResponse({
          ok: true,
          ...result
        }))
        .catch((error) => sendResponse({
          ok: false,
          error: error.message
        }));

      return true;
    }

    if (message.type === "PAGE_CAPTURE_RESTORE") {
      restorePage()
        .then(() => sendResponse({
          ok: true
        }))
        .catch((error) => sendResponse({
          ok: false,
          error: error.message
        }));

      return true;
    }

    return false;
  });

  async function preparePage() {
    if (state.active) {
      await restorePage();
    }

    state.active = true;
    state.originalWindowScrollX = window.scrollX;
    state.originalWindowScrollY = window.scrollY;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    rememberStyle(document.documentElement);
    rememberStyle(document.body);

    setImportant(
      document.documentElement,
      "scroll-behavior",
      "auto"
    );

    setImportant(
      document.body,
      "scroll-behavior",
      "auto"
    );

    const scrollTarget = findPrimaryScrollTarget(
      viewportWidth,
      viewportHeight
    );

    state.mode = scrollTarget.mode;
    state.scrollElement = scrollTarget.element;

    let result;

    if (
      state.mode === "element" &&
      state.scrollElement
    ) {
      const element =
        state.scrollElement;

      state.originalElementScrollTop =
        element.scrollTop;

      state.originalElementScrollLeft =
        element.scrollLeft;

      rememberStyle(element);

      setImportant(
        element,
        "scroll-behavior",
        "auto"
      );

      element.scrollTop = 0;
      element.scrollLeft = 0;

      await settleScroll();

      collectFixedElements(
        viewportWidth,
        viewportHeight
      );

      const rect =
        getClippedViewportRect(
          element.getBoundingClientRect(),
          viewportWidth,
          viewportHeight
        );

      const scrollHeight =
        Math.ceil(
          element.scrollHeight
        );

      const maxScroll =
        Math.max(
          0,
          scrollHeight -
          element.clientHeight
        );

      const companionPanels =
        findCompanionPanels(
          element,
          rect,
          viewportWidth,
          viewportHeight
        );

      result = {
        mode: "element",
        viewportWidth,
        viewportHeight,
        scrollViewportHeight:
          Math.max(
            1,
            element.clientHeight
          ),
        scrollHeight,
        maxScroll,
        scrollRect: rect,
        pageHeight: Math.ceil(
          rect.y +
          scrollHeight +
          Math.max(
            0,
            viewportHeight -
            (
              rect.y +
              rect.height
            )
          )
        ),
        pageBackground:
          getPageBackground(),
        companionPanels
      };
    } else {
      window.scrollTo(0, 0);

      await settleScroll();

      collectFixedElements(
        viewportWidth,
        viewportHeight
      );

      const pageHeight =
        getPageHeight();

      const maxScroll =
        Math.max(
          0,
          pageHeight -
          viewportHeight
        );

      result = {
        mode: "window",
        viewportWidth,
        viewportHeight,
        scrollViewportHeight:
          viewportHeight,
        scrollHeight:
          pageHeight,
        maxScroll,
        scrollRect: {
          x: 0,
          y: 0,
          width:
            viewportWidth,
          height:
            viewportHeight
        },
        pageHeight,
        pageBackground:
          getPageBackground(),
        companionPanels: []
      };
    }

    return result;
  }

  async function scrollPage(
    targetY,
    firstCapture,
    lastCapture
  ) {
    if (!state.active) {
      throw new Error(
        "Full-page capture is not prepared."
      );
    }

    let actualScrollY = 0;

    if (
      state.mode === "element" &&
      state.scrollElement
    ) {
      state.scrollElement.scrollTop =
        Math.max(
          0,
          targetY
        );

      await settleScroll();

      actualScrollY =
        state.scrollElement.scrollTop;
    } else {
      window.scrollTo(
        0,
        Math.max(
          0,
          targetY
        )
      );

      await settleScroll();

      actualScrollY =
        window.scrollY;
    }

    updateOverlayVisibility(
      actualScrollY,
      firstCapture,
      lastCapture
    );

    await settleVisibility();

    return {
      scrollY: actualScrollY
    };
  }

  function findPrimaryScrollTarget(
    viewportWidth,
    viewportHeight
  ) {
    const documentOverflow =
      Math.max(
        0,
        getPageHeight() -
        viewportHeight
      );

    let bestElement = null;
    let bestScore = 0;
    let bestOverflow = 0;

    const elements =
      document.querySelectorAll("*");

    for (const element of elements) {
      if (
        element ===
        document.documentElement ||
        element ===
        document.body ||
        element instanceof
        HTMLTextAreaElement ||
        element instanceof
        HTMLSelectElement
      ) {
        continue;
      }

      const style =
        getComputedStyle(
          element
        );

      if (
        style.overflowY !== "auto" &&
        style.overflowY !== "scroll"
      ) {
        continue;
      }

      const overflow =
        element.scrollHeight -
        element.clientHeight;

      if (overflow <= 4) {
        continue;
      }

      const rect =
        element.getBoundingClientRect();

      const clipped =
        getClippedViewportRect(
          rect,
          viewportWidth,
          viewportHeight
        );

      if (
        clipped.width <
        viewportWidth * 0.35 ||
        clipped.height <
        viewportHeight * 0.25
      ) {
        continue;
      }

      const visibleArea =
        clipped.width *
        clipped.height;

      const viewportArea =
        viewportWidth *
        viewportHeight;

      let coverage = 0;

      if (viewportArea > 0) {
        coverage =
          visibleArea /
          viewportArea;
      }

      const score =
        overflow *
        Math.max(
          0.25,
          coverage
        ) *
        Math.max(
          1,
          clipped.width /
          viewportWidth
        );

      if (score > bestScore) {
        bestScore = score;
        bestOverflow =
          overflow;
        bestElement =
          element;
      }
    }

    if (
      bestElement &&
      (
        documentOverflow <= 4 ||
        bestOverflow >
        documentOverflow *
        0.65
      )
    ) {
      return {
        mode: "element",
        element:
          bestElement
      };
    }

    return {
      mode: "window",
      element: null
    };
  }

  function collectFixedElements(
    viewportWidth,
    viewportHeight
  ) {
    state.fixedElements = [];

    const elements =
      document.querySelectorAll("*");

    for (const element of elements) {
      const style =
        getComputedStyle(
          element
        );

      const position =
        style.position;

      if (
        position !== "fixed" &&
        position !== "sticky"
      ) {
        continue;
      }

      if (
        style.visibility === "hidden" ||
        style.display === "none"
      ) {
        continue;
      }

      const rawRect =
        element.getBoundingClientRect();

      if (
        rawRect.width <= 0 ||
        rawRect.height <= 0
      ) {
        continue;
      }

      const clipped =
        getClippedViewportRect(
          rawRect,
          viewportWidth,
          viewportHeight
        );

      if (
        position === "fixed" &&
        (
          clipped.width <= 0 ||
          clipped.height <= 0
        )
      ) {
        continue;
      }

      const anchor =
        getOverlayAnchor(
          style,
          rawRect,
          viewportHeight
        );

      const stickyContext =
        getStickyContext(
          element
        );

      let naturalOffset = 0;

      if (position === "sticky") {
        naturalOffset =
          getStickyNaturalOffset(
            element,
            rawRect,
            stickyContext
          );
      }

      state.fixedElements.push({
        element,
        position,
        anchor,
        stickyContext,
        naturalOffset
      });
    }
  }

  function getOverlayAnchor(
    style,
    rect,
    viewportHeight
  ) {
    const hasTop =
      style.top !== "auto";

    const hasBottom =
      style.bottom !== "auto";

    if (hasTop && !hasBottom) {
      return "top";
    }

    if (hasBottom && !hasTop) {
      return "bottom";
    }

    if (hasTop && hasBottom) {
      const topDistance =
        Math.max(
          0,
          rect.top
        );

      const bottomDistance =
        Math.max(
          0,
          viewportHeight -
          rect.bottom
        );

      if (
        topDistance <=
        bottomDistance
      ) {
        return "top";
      }

      return "bottom";
    }

    const centerY =
      rect.top +
      rect.height / 2;

    if (
      centerY <=
      viewportHeight / 2
    ) {
      return "top";
    }

    return "bottom";
  }

  function getStickyContext(element) {
    if (
      state.mode === "element" &&
      state.scrollElement &&
      state.scrollElement.contains(
        element
      )
    ) {
      return "element";
    }

    if (state.mode === "window") {
      return "window";
    }

    return "static";
  }

  function getStickyNaturalOffset(
    element,
    rect,
    stickyContext
  ) {
    if (
      stickyContext === "element" &&
      state.scrollElement
    ) {
      const scrollRect =
        state.scrollElement
          .getBoundingClientRect();

      return Math.max(
        0,
        rect.top -
        scrollRect.top +
        state.scrollElement
          .scrollTop
      );
    }

    if (
      stickyContext === "window"
    ) {
      return Math.max(
        0,
        rect.top +
        window.scrollY
      );
    }

    return Number.POSITIVE_INFINITY;
  }

  function updateOverlayVisibility(
    scrollY,
    firstCapture,
    lastCapture
  ) {
    restoreHiddenFixedElements();

    if (
      firstCapture &&
      lastCapture
    ) {
      return;
    }

    for (
      const item of
      state.fixedElements
    ) {
      if (
        !item.element ||
        !item.element.isConnected
      ) {
        continue;
      }

      if (
        item.position ===
        "fixed"
      ) {
        let shouldShow =
          firstCapture;

        if (
          item.anchor ===
          "bottom"
        ) {
          shouldShow =
            lastCapture;
        }

        if (!shouldShow) {
          hideElement(
            item.element
          );
        }

        continue;
      }

      if (
        item.position !==
        "sticky"
      ) {
        continue;
      }

      if (
        item.stickyContext ===
        "static"
      ) {
        continue;
      }

      if (
        item.anchor === "top"
      ) {
        const passedNaturalPosition =
          scrollY >
          item.naturalOffset +
          1;

        if (
          passedNaturalPosition
        ) {
          hideElement(
            item.element
          );
        }

        continue;
      }

      let viewportHeight =
        window.innerHeight;

      if (
        state.mode === "element" &&
        state.scrollElement
      ) {
        viewportHeight =
          state.scrollElement
            .clientHeight;
      }

      const naturalPositionIsBelowViewport =
        scrollY +
        viewportHeight <
        item.naturalOffset -
        1;

      if (
        naturalPositionIsBelowViewport &&
        !lastCapture
      ) {
        hideElement(
          item.element
        );
      }
    }
  }

  function hideElement(element) {
    if (
      !element ||
      !element.isConnected
    ) {
      return;
    }

    const currentVisibility =
      element.style
        .getPropertyValue(
          "visibility"
        );

    const currentPriority =
      element.style
        .getPropertyPriority(
          "visibility"
        );

    state.hiddenFixedElements.push({
      element,
      visibility:
        currentVisibility,
      priority:
        currentPriority
    });

    element.style.setProperty(
      "visibility",
      "hidden",
      "important"
    );
  }

  function restoreHiddenFixedElements() {
    for (
      const item of
      state.hiddenFixedElements
    ) {
      if (
        !item.element ||
        !item.element.isConnected
      ) {
        continue;
      }

      if (!item.visibility) {
        item.element.style
          .removeProperty(
            "visibility"
          );
      } else {
        item.element.style
          .setProperty(
            "visibility",
            item.visibility,
            item.priority || ""
          );
      }
    }

    state.hiddenFixedElements = [];
  }

  function findCompanionPanels(
    scrollElement,
    scrollRect,
    viewportWidth,
    viewportHeight
  ) {
    const parent =
      scrollElement.parentElement;

    if (!parent) {
      return [];
    }

    const panels = [];

    const siblings =
      Array.from(
        parent.children
      );

    for (
      const sibling of siblings
    ) {
      if (
        sibling ===
        scrollElement ||
        sibling.contains(
          scrollElement
        )
      ) {
        continue;
      }

      const style =
        getComputedStyle(
          sibling
        );

      if (
        style.display === "none" ||
        style.visibility ===
        "hidden"
      ) {
        continue;
      }

      const rawRect =
        sibling
          .getBoundingClientRect();

      const rect =
        getClippedViewportRect(
          rawRect,
          viewportWidth,
          viewportHeight
        );

      if (
        rect.width <= 0 ||
        rect.height <
        scrollRect.height *
        0.55
      ) {
        continue;
      }

      const isLeftPanel =
        rect.x <
        scrollRect.x &&
        rect.x +
        rect.width <=
        scrollRect.x +
        4;

      const isRightPanel =
        rect.x >=
        scrollRect.x +
        scrollRect.width -
        4;

      if (
        !isLeftPanel &&
        !isRightPanel
      ) {
        continue;
      }

      const backgroundColor =
        findVisibleBackgroundColor(
          sibling
        );

      panels.push({
        rect,
        backgroundColor,
        borders: {
          left:
            getBorder(
              style,
              "left"
            ),
          right:
            getBorder(
              style,
              "right"
            )
        }
      });
    }

    return panels;
  }

  function findVisibleBackgroundColor(
    element
  ) {
    let current = element;

    while (
      current &&
      current !==
      document.documentElement
    ) {
      const color =
        getComputedStyle(
          current
        ).backgroundColor;

      if (
        color &&
        color !==
        "rgba(0, 0, 0, 0)" &&
        color !==
        "transparent"
      ) {
        return color;
      }

      current =
        current.firstElementChild;
    }

    return "rgba(0, 0, 0, 0)";
  }

  function getBorder(
    style,
    side
  ) {
    return {
      width:
        parseFloat(
          style.getPropertyValue(
            `border-${side}-width`
          )
        ) || 0,

      style:
        style.getPropertyValue(
          `border-${side}-style`
        ),

      color:
        style.getPropertyValue(
          `border-${side}-color`
        )
    };
  }

  async function restorePage() {
    if (!state.active) {
      return;
    }

    restoreHiddenFixedElements();

    const entries =
      Array.from(
        state.originalStyles
          .entries()
      ).reverse();

    for (
      const [
        element,
        originalStyle
      ] of entries
    ) {
      if (
        !element ||
        !element.isConnected
      ) {
        continue;
      }

      if (
        originalStyle === null
      ) {
        element.removeAttribute(
          "style"
        );
      } else {
        element.setAttribute(
          "style",
          originalStyle
        );
      }
    }

    if (
      state.scrollElement &&
      state.scrollElement.isConnected
    ) {
      state.scrollElement.scrollTop =
        state.originalElementScrollTop;

      state.scrollElement.scrollLeft =
        state.originalElementScrollLeft;
    }

    window.scrollTo(
      state.originalWindowScrollX,
      state.originalWindowScrollY
    );

    state.active = false;
    state.mode = "window";
    state.scrollElement = null;
    state.originalStyles.clear();
    state.fixedElements = [];
    state.hiddenFixedElements = [];

    await settleScroll();
  }

  function rememberStyle(element) {
    if (
      !element ||
      state.originalStyles.has(
        element
      )
    ) {
      return;
    }

    state.originalStyles.set(
      element,
      element.getAttribute(
        "style"
      )
    );
  }

  function setImportant(
    element,
    property,
    value
  ) {
    element.style.setProperty(
      property,
      value,
      "important"
    );
  }

  function getClippedViewportRect(
    rect,
    viewportWidth,
    viewportHeight
  ) {
    const left =
      Math.max(
        0,
        rect.left
      );

    const top =
      Math.max(
        0,
        rect.top
      );

    const right =
      Math.min(
        viewportWidth,
        rect.right
      );

    const bottom =
      Math.min(
        viewportHeight,
        rect.bottom
      );

    return {
      x: left,
      y: top,
      width:
        Math.max(
          0,
          right - left
        ),
      height:
        Math.max(
          0,
          bottom - top
        )
    };
  }

  function getPageHeight() {
    const root =
      document.documentElement;

    const body =
      document.body;

    let bodyScrollHeight = 0;
    let bodyOffsetHeight = 0;
    let bodyClientHeight = 0;

    if (body) {
      bodyScrollHeight =
        body.scrollHeight;

      bodyOffsetHeight =
        body.offsetHeight;

      bodyClientHeight =
        body.clientHeight;
    }

    return Math.ceil(
      Math.max(
        root.scrollHeight,
        root.offsetHeight,
        root.clientHeight,
        bodyScrollHeight,
        bodyOffsetHeight,
        bodyClientHeight,
        window.innerHeight
      )
    );
  }

  function getPageBackground() {
    const body =
      document.body;

    const root =
      document.documentElement;

    if (body) {
      const bodyColor =
        getComputedStyle(
          body
        ).backgroundColor;

      if (
        bodyColor &&
        bodyColor !==
        "rgba(0, 0, 0, 0)" &&
        bodyColor !==
        "transparent"
      ) {
        return bodyColor;
      }
    }

    const rootColor =
      getComputedStyle(
        root
      ).backgroundColor;

    if (
      rootColor &&
      rootColor !==
      "rgba(0, 0, 0, 0)" &&
      rootColor !==
      "transparent"
    ) {
      return rootColor;
    }

    return "#ffffff";
  }

  function settleScroll() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(
            resolve,
            140
          );
        });
      });
    });
  }

  function settleVisibility() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(
          resolve
        );
      });
    });
  }
})();