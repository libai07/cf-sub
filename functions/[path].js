const SUBSCRIPTION_TIMEOUT_MS = 8000;
const SUPPORTED_NODE_PROTOCOLS = ["hysteria2:", "tuic:", "vless:"];
const BASE64_CLIENTS = ["shadowrocket", "v2rayn"];
const SING_BOX_CLIENTS = ["sing-box", "singbox", "sfa"];
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

export async function onRequestGet(context) {
  const requestPath = normalizePath(context.params.path);
  const subPath = normalizePath(context.env.SUB_PATH);

  if (!subPath || requestPath !== subPath) {
    return textResponse("Not found", 0, { status: 404 });
  }

  const subscription = await buildSubscription(
    context.env.NODES,
    context.request.url
  );
  const format = getSubscriptionFormat(context.request);

  if (format === "base64") {
    const encoded = toBase64(toNodeSubscription(subscription.nodes));

    return textResponse(encoded, subscription.failedCount);
  }

  const singBoxConfig = toSingBoxConfig(subscription.nodes);

  return jsonResponse(singBoxConfig, subscription.failedCount);
}

function textResponse(body, failedCount, init = {}) {
  return new Response(body, {
    ...init,
    headers: responseHeaders("text/plain; charset=utf-8", failedCount),
  });
}

function jsonResponse(body, failedCount) {
  return new Response(JSON.stringify(body, null, 2), {
    headers: responseHeaders("application/json; charset=utf-8", failedCount),
  });
}

function responseHeaders(contentType, failedCount) {
  return {
    ...BASE_HEADERS,
    "Content-Type": contentType,
    "X-Subscription-Failed-Count": String(failedCount),
  };
}

function normalizePath(value) {
  if (!value) {
    return "";
  }

  return String(value).trim().replace(/^\/+|\/+$/g, "");
}

function getSubscriptionFormat(request) {
  try {
    const requestUrl = typeof request === "string" ? request : request.url;
    const url = new URL(requestUrl);
    const client = String(url.searchParams.get("client") || "").toLowerCase();
    const format = String(url.searchParams.get("format") || "").toLowerCase();
    const userAgent = String(
      typeof request === "string" ? "" : request.headers.get("User-Agent") || ""
    ).toLowerCase();

    if (format === "base64" || url.searchParams.has("base64") || url.searchParams.has("b64")) {
      return "base64";
    }

    if (format === "sing-box" || format === "singbox") {
      return "sing-box";
    }

    if (BASE64_CLIENTS.includes(client)) {
      return "base64";
    }

    if (SING_BOX_CLIENTS.includes(client)) {
      return "sing-box";
    }

    if (BASE64_CLIENTS.some((value) => userAgent.includes(value))) {
      return "base64";
    }

    if (SING_BOX_CLIENTS.some((value) => userAgent.includes(value))) {
      return "sing-box";
    }

    return "sing-box";
  } catch {
    return "sing-box";
  }
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

    if (isCurrentRequestUrl(url, requestUrl)) {
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

function toSingBoxConfig(value) {
  const proxyOutbounds = getLines(value)
    .map(parseNode)
    .filter(Boolean)
    .map(formatSingBoxOutbound);
  ensureUniqueTags(proxyOutbounds);

  const proxyTags = proxyOutbounds.map((outbound) => outbound.tag);
  const selectorOutbounds = proxyTags.length ? proxyTags : ["direct"];

  return {
    log: {
      level: "info",
      timestamp: true,
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.19.0.1/30"],
        auto_route: true,
        strict_route: true,
      },
    ],
    outbounds: [
      {
        type: "selector",
        tag: "proxy",
        outbounds: selectorOutbounds,
        default: selectorOutbounds[0],
      },
      ...proxyOutbounds,
      {
        type: "direct",
        tag: "direct",
      },
    ],
    route: {
      rules: [
        {
          inbound: "tun-in",
          action: "sniff",
        },
      ],
      final: "proxy",
      auto_detect_interface: true,
    },
  };
}

function toNodeSubscription(value) {
  const nodes = getLines(value).filter(isSupportedNodeLink);

  return normalizeNodes(nodes.join("\n"));
}

function isSupportedNodeLink(value) {
  try {
    const protocol = new URL(value).protocol;

    return SUPPORTED_NODE_PROTOCOLS.includes(protocol);
  } catch {
    return false;
  }
}

function parseNode(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  switch (url.protocol) {
    case "hysteria2:":
      return parseHysteria2Node(url);
    case "tuic:":
      return parseTuicNode(url);
    case "vless:":
      return parseVlessNode(url);
    default:
      return null;
  }
}

function parseTuicNode(url) {
  const credentials = parseUserCredentials(url);
  const port = Number(url.port);

  if (
    !credentials.username ||
    !credentials.password ||
    !url.hostname ||
    !Number.isInteger(port)
  ) {
    return null;
  }

  const params = url.searchParams;
  const name = decodeURIComponent(url.hash ? url.hash.slice(1) : "") || url.hostname;
  const alpn = normalizeTuicAlpn(getListParam(params, "alpn", ["h3"]));

  return {
    name,
    type: "tuic",
    server: url.hostname,
    port,
    uuid: credentials.username,
    password: credentials.password,
    alpn,
    sni: getParam(params, "sni", "server_name", "servername", "peer", "host"),
    udpRelayMode: getParam(params, "udp_relay_mode", "udp-relay-mode") || "native",
    congestionController:
      getParam(params, "congestion_control", "congestion-controller") || "bbr",
    skipCertVerify: getBooleanParam(
      params,
      "allow_insecure",
      "allowInsecure",
      "skip-cert-verify",
      "skip_cert_verify",
      "insecure"
    ),
    reduceRtt: getBooleanParam(params, "reduce_rtt", "reduce-rtt"),
  };
}

function parseUserCredentials(url) {
  const username = decodeURIComponent(url.username || "");
  const password = decodeURIComponent(url.password || "");

  if (password) {
    return {
      username,
      password,
    };
  }

  const separator = username.indexOf(":");

  if (separator === -1) {
    return {
      username,
      password: "",
    };
  }

  return {
    username: username.slice(0, separator),
    password: username.slice(separator + 1),
  };
}

function parseVlessNode(url) {
  const uuid = decodeURIComponent(url.username || "");
  const port = Number(url.port);

  if (!uuid || !url.hostname || !Number.isInteger(port)) {
    return null;
  }

  const params = url.searchParams;
  const outbound = {
    type: "vless",
    tag: getNodeName(url, "vless"),
    server: url.hostname,
    server_port: port,
    uuid,
  };
  const flow = getParam(params, "flow");
  const packetEncoding = getParam(params, "packetEncoding", "packet_encoding");
  const tls = buildTlsConfig(params);
  const transport = buildV2RayTransport(params);

  if (flow) {
    outbound.flow = flow;
  }

  if (packetEncoding) {
    outbound.packet_encoding = packetEncoding;
  }

  if (tls) {
    outbound.tls = tls;
  }

  if (transport) {
    outbound.transport = transport;
  }

  return outbound;
}

function parseHysteria2Node(url) {
  const password = decodeURIComponent(url.username || "");
  const port = Number(url.port);

  if (!password || !url.hostname || !Number.isInteger(port)) {
    return null;
  }

  const params = url.searchParams;
  const outbound = {
    type: "hysteria2",
    tag: getNodeName(url, "hysteria2"),
    server: url.hostname,
    server_port: port,
    password,
  };
  const tls = buildTlsConfig(params, { defaultEnabled: true });
  const obfsType = getParam(params, "obfs", "obfs_type", "obfsType");
  const obfsPassword = getParam(
    params,
    "obfs-password",
    "obfs_password",
    "obfsPassword"
  );
  const serverPorts = getParam(params, "mport", "server_ports", "serverPorts");
  const hopInterval = getParam(params, "hop_interval", "hopInterval");
  const upMbps = Number(getParam(params, "upmbps", "up_mbps", "up"));
  const downMbps = Number(getParam(params, "downmbps", "down_mbps", "down"));

  if (tls) {
    outbound.tls = tls;
  }

  if (obfsType) {
    outbound.obfs = {
      type: obfsType,
      password: obfsPassword,
    };
  }

  if (serverPorts) {
    outbound.server_ports = serverPorts
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (hopInterval) {
    outbound.hop_interval = hopInterval;
  }

  if (Number.isFinite(upMbps) && upMbps > 0) {
    outbound.up_mbps = upMbps;
  }

  if (Number.isFinite(downMbps) && downMbps > 0) {
    outbound.down_mbps = downMbps;
  }

  return outbound;
}

function getParam(params, ...names) {
  for (const name of names) {
    const value = params.get(name);

    if (value) {
      return value;
    }
  }

  const normalizedNames = names.map((name) => name.toLowerCase());

  for (const [key, value] of params.entries()) {
    if (value && normalizedNames.includes(key.toLowerCase())) {
      return value;
    }
  }

  return "";
}

function getListParam(params, name, fallback) {
  const value = params.get(name);

  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTuicAlpn(value) {
  return value.some((item) => item.toLowerCase() === "h3") ? ["h3"] : value;
}

function getBooleanParam(params, ...names) {
  const value = getParam(params, ...names);

  if (!value) {
    return false;
  }

  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function getNodeName(url, fallback) {
  return decodeURIComponent(url.hash ? url.hash.slice(1) : "") || url.hostname || fallback;
}

function buildTlsConfig(params, options = {}) {
  const security = getParam(params, "security", "tls");
  const enabled =
    options.defaultEnabled ||
    security === "tls" ||
    security === "reality" ||
    getBooleanParam(params, "tls");

  if (!enabled) {
    return null;
  }

  const tls = {
    enabled: true,
  };
  const serverName = getParam(
    params,
    "sni",
    "server_name",
    "servername",
    "peer",
    "host"
  );
  const alpn = getListParam(params, "alpn", []);
  const fingerprint = getParam(params, "fp", "fingerprint");
  const publicKey = getParam(params, "pbk", "public_key", "publicKey");
  const shortId = getParam(params, "sid", "short_id", "shortId");

  if (serverName) {
    tls.server_name = serverName;
  }

  if (
    getBooleanParam(
      params,
      "allow_insecure",
      "allowInsecure",
      "skip-cert-verify",
      "skip_cert_verify",
      "insecure"
    )
  ) {
    tls.insecure = true;
  }

  if (alpn.length) {
    tls.alpn = alpn;
  }

  if (fingerprint) {
    tls.utls = {
      enabled: true,
      fingerprint,
    };
  }

  if (security === "reality" || publicKey) {
    tls.reality = {
      enabled: true,
      public_key: publicKey,
    };

    if (shortId) {
      tls.reality.short_id = shortId;
    }
  }

  return tls;
}

function buildV2RayTransport(params) {
  const type = getParam(params, "type", "network", "net");
  const host = getParam(params, "host");
  const path = getParam(params, "path", "serviceName", "service_name");

  if (!type || type === "tcp") {
    return null;
  }

  if (type === "ws" || type === "websocket") {
    const transport = {
      type: "ws",
    };

    if (path) {
      transport.path = path;
    }

    if (host) {
      transport.headers = {
        Host: host,
      };
    }

    return transport;
  }

  if (type === "grpc") {
    return {
      type: "grpc",
      service_name: path,
    };
  }

  if (type === "httpupgrade") {
    const transport = {
      type: "httpupgrade",
    };

    if (host) {
      transport.host = host;
    }

    if (path) {
      transport.path = path;
    }

    return transport;
  }

  if (type === "http" || type === "h2") {
    const transport = {
      type: "http",
    };

    if (host) {
      transport.host = host
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (path) {
      transport.path = path;
    }

    return transport;
  }

  if (type === "quic") {
    return {
      type: "quic",
    };
  }

  return null;
}

function formatSingBoxOutbound(proxy) {
  if (proxy.type !== "tuic") {
    return proxy;
  }

  const outbound = {
    type: "tuic",
    tag: proxy.name,
    server: proxy.server,
    server_port: proxy.port,
    uuid: proxy.uuid,
    password: proxy.password,
    congestion_control: proxy.congestionController,
    udp_relay_mode: proxy.udpRelayMode,
    tls: {
      enabled: true,
      alpn: proxy.alpn,
    },
  };

  if (proxy.sni) {
    outbound.tls.server_name = proxy.sni;
  }

  if (proxy.skipCertVerify) {
    outbound.tls.insecure = true;
  }

  if (proxy.reduceRtt) {
    outbound.zero_rtt_handshake = true;
  }

  return outbound;
}

function ensureUniqueTags(outbounds) {
  const seen = new Map();

  for (const outbound of outbounds) {
    const baseTag = outbound.tag || outbound.server || outbound.type;
    const count = seen.get(baseTag) || 0;

    seen.set(baseTag, count + 1);
    outbound.tag = count ? `${baseTag}-${count + 1}` : baseTag;
  }
}

function fromBase64(value) {
  try {
    const normalized = normalizeBase64(value);
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function normalizeBase64(value) {
  const normalized = String(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;

  return normalized + "=".repeat(paddingLength);
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
