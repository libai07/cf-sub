const SUBSCRIPTION_TIMEOUT_MS = 8000;

export async function onRequestGet(context) {
  const requestPath = normalizePath(context.params.path);
  const subPath = normalizePath(context.env.SUB_PATH);

  if (!subPath || requestPath !== subPath) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const subscription = await buildSubscription(
    context.env.NODES,
    context.request.url
  );
  const encoded = toBase64(subscription.nodes);

  return new Response(encoded, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Access-Control-Allow-Origin": "*",
      "X-Subscription-Failed-Count": String(subscription.failedCount),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function normalizePath(value) {
  if (!value) {
    return "";
  }

  return String(value).trim().replace(/^\/+|\/+$/g, "");
}

function normalizeNodes(value) {
  if (!value) {
    return "";
  }

  const lines = String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length ? `${lines.join("\n")}\n` : "";
}

async function buildSubscription(value, requestUrl) {
  const sources = getLines(value);
  const directNodes = [];
  const subscriptionUrls = [];
  let failedCount = 0;

  for (const source of sources) {
    const url = parseHttpUrl(source);

    if (!url) {
      directNodes.push(source);
      continue;
    }

    if (url.protocol !== "https:" || isCurrentRequestUrl(url, requestUrl)) {
      failedCount += 1;
      continue;
    }

    subscriptionUrls.push(source);
  }

  const remote = await fetchSubscriptions(subscriptionUrls);

  return {
    nodes: normalizeNodes([...directNodes, ...remote.nodes].join("\n")),
    failedCount: failedCount + remote.failedCount,
  };
}

function getLines(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isCurrentRequestUrl(url, requestUrl) {
  try {
    const currentUrl = new URL(requestUrl);

    return (
      url.origin === currentUrl.origin &&
      normalizePath(url.pathname) === normalizePath(currentUrl.pathname)
    );
  } catch {
    return false;
  }
}

async function fetchSubscriptions(urls) {
  if (!urls.length) {
    return {
      nodes: [],
      failedCount: 0,
    };
  }

  const results = await Promise.allSettled(
    urls.map((url) => fetchSubscription(url))
  );
  const nodes = [];
  let failedCount = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.ok) {
      nodes.push(...result.value.nodes);
    } else {
      failedCount += 1;
    }
  }

  return {
    nodes,
    failedCount,
  };
}

async function fetchSubscription(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SUBSCRIPTION_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        nodes: [],
      };
    }

    return {
      ok: true,
      nodes: parseSubscriptionContent(await response.text()),
    };
  } catch {
    return {
      ok: false,
      nodes: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseSubscriptionContent(value) {
  const text = String(value || "").trim();

  if (!text) {
    return [];
  }

  const decoded = fromBase64(text);
  return getLines(decoded && decoded.includes("://") ? decoded : text);
}

function fromBase64(value) {
  try {
    const normalized = String(value).replace(/\s+/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
