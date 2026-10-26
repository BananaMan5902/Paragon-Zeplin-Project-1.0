
const CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID";

const SCOPE =
  "https://www.googleapis.com/auth/presentations";

const API =
  "https://slides.googleapis.com/v1/presentations";

let tokenClient;
let accessToken = "";
let currentPresentation = null;
let busy = false;

const $ = (id) => document.getElementById(id);

function showMessage(message, isError = false) {
  $("message").textContent = message;
  $("message").style.color = isError ? "#ff8278" : "#a9efb6";
}

function getPresentationId() {
  const url = $("slidesUrl").value.trim();

  // Accept a Google Slides URL or a presentation ID.
  const match = url.match(
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/
  );

  if (match) return match[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) {
    return url;
  }

  throw new Error("Please enter a valid Google Slides link.");
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Google API error: ${response.status}`
    );
  }

  return data;
}

function connectGoogle() {
  if (
    !CLIENT_ID ||
    CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID"
  ) {
    showMessage(
      "Set up your Google OAuth client ID first.",
      true
    );
    return;
  }

  if (!window.google?.accounts?.oauth2) {
    showMessage(
      "Google sign-in is loading. Please try again.",
      true
    );
    return;
  }

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,

      callback: (response) => {
        if (response.error) {
          showMessage("Google authorization failed.", true);
          return;
        }

        accessToken = response.access_token;
        $("accountStatus").textContent =
          "Connected — Google Slides access granted";
        $("connectBtn").textContent = "🔐 Reconnect Google";
        $("previewBtn").disabled = false;

        showMessage("Google account connected successfully.");
      }
    });
  }

  tokenClient.requestAccessToken();
}

async function previewPresentation() {
  try {
    if (!accessToken) {
      throw new Error("Connect your Google account first.");
    }

    const id = getPresentationId();

    showMessage("Loading presentation...");

    const data = await apiRequest(
      `${encodeURIComponent(id)}?fields= presentationId,title,slides(objectId,pageElements(objectId)),pageSize`
        .replace("?fields= ", "?fields=")
    );

    currentPresentation = data;

    $("preview").textContent =
      `Presentation: ${data.title}\n` +
      `Slides: ${data.slides?.length ?? 0}\n\n` +
      "Preview only — no slides have been changed.";

    $("bombBtn").disabled = !data.slides?.length;

    showMessage("Presentation loaded. Review it before continuing.");
  } catch (error) {
    currentPresentation = null;
    $("bombBtn").disabled = true;
    showMessage(error.message, true);
  }
}

async function bombPresentation() {
  if (busy) return;

  if (!accessToken || !currentPresentation) {
    showMessage("Connect Google and preview a presentation first.", true);
    return;
  }

  const presentation = currentPresentation;
  const slides = presentation.slides || [];
  const emoji = $("emoji").value;

  if (!slides.length) {
    showMessage("This presentation has no slides.", true);
    return;
  }

  const approved = confirm(
    `BOMBER ZEPPELIN\n\n` +
    `Presentation: ${presentation.title}\n` +
    `Slides to replace: ${slides.length}\n\n` +
    `Existing content on these slides will be removed ` +
    `and replaced with ${emoji}.\n\n` +
    `Make sure you have a backup. Continue?`
  );

  if (!approved) return;

  busy = true;
  $("bombBtn").disabled = true;

  try {
    const requests = [];

    const width =
      presentation.pageSize?.width?.magnitude || 9144000;
    const height =
      presentation.pageSize?.height?.magnitude || 5143500;

    // Google Slides uses EMU for page dimensions.
    // These text boxes are 300 x 100 points.
    const boxWidth = 300 * 12700;
    const boxHeight = 100 * 12700;

    slides.forEach((slide, index) => {
      // Remove each existing slide element.
      for (const element of slide.pageElements || []) {
        requests.push({
          deleteObject: {
            objectId: element.objectId
          }
        });
      }

      const shapeId = `bz_${Date.now()}_${index}`;

      // Create a centered text box.
      requests.push({
        createShape: {
          objectId: shapeId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: slide.objectId,
            size: {
              width: {
                magnitude: boxWidth,
                unit: "EMU"
              },
              height: {
                magnitude: boxHeight,
                unit: "EMU"
              }
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: Math.max(0, (width - boxWidth) / 2),
              translateY: Math.max(0, (height - boxHeight) / 2),
              unit: "EMU"
            }
          }
        }
      });

      requests.push({
        insertText: {
          objectId: shapeId,
          text: emoji
        }
      });

      requests.push({
        updateTextStyle: {
          objectId: shapeId,
          style: {
            fontSize: {
              magnitude: 50,
              unit: "PT"
            }
          },
          textRange: {
            type: "ALL"
          },
          fields: "fontSize"
        }
      });

      requests.push({
        updateParagraphStyle: {
          objectId: shapeId,
          style: {
            alignment: "CENTER"
          },
          textRange: {
            type: "ALL"
          },
          fields: "alignment"
        }
      });

      requests.push({
        updateShapeProperties: {
          objectId: shapeId,
          shapeProperties: {
            shapeBackgroundFill: {
              propertyState: "NOT_RENDERED"
            },
            outline: {
              propertyState: "NOT_RENDERED"
            }
          },
          fields: "shapeBackgroundFill,outline"
        }
      });
    });

    // Submit changes in batches to avoid oversized requests.
    const BATCH_SIZE = 100;

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);

      await apiRequest(
        `${encodeURIComponent(presentation.presentationId)}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({ requests: batch })
        }
      );
    }

    showMessage(
      `💥 Complete! Processed ${slides.length} slides. ` +
      "Reopen or refresh your presentation to see the changes."
    );

    await previewPresentation();
  } catch (error) {
    showMessage(
      "The operation did not finish successfully: " +
      error.message +
      ". Some earlier batches may already have been applied. " +
      "Check your presentation before retrying.",
      true
    );
  } finally {
    busy = false;
    $("bombBtn").disabled = !currentPresentation?.slides?.length;
  }
}

$("connectBtn").addEventListener("click", connectGoogle);
$("previewBtn").addEventListener("click", previewPresentation);
$("bombBtn").addEventListener("click", bombPresentation);

$("previewBtn").disabled = true;
$("bombBtn").disabled = true;
