const DEFAULT_FORMAT = "base64";
const SUPPORTED_PROTOCOLS = ["hysteria2:", "vless:"];
const CLIENTS = {
  base64: [
    "shadowrocket",
    "v2rayn",
    "v2rayng",
    "nekobox",
    "nekoray",
    "hiddify",
    "hiddify-next",
    "streisand",
    "loon",
    "quantumult",
    "quantumultx",
    "qv2ray",
  ],
  singBox: ["sing-box", "singbox", "sfa"],
  mihomo: [
    "mihomo",
    "clash",
    "clash-meta",
    "clashverge",
    "clash-verge",
    "clash-verge-rev",
    "clashx",
    "clash-for-windows",
    "cfw",
    "flclash",
    "stash",
    "openclash",
  ],
  surge: ["surge"],
};
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

export function onRequestGet(context) {
  const requestPath = normalizePath(context.params.path);
  const subPath = normalizePath(context.env.SUB_PATH);

  if (!subPath || requestPath !== subPath) {
    return textResponse("Not found", 0, { status: 404 });
  }

  const nodes = normalizeNodes(context.env.NODES);
  const format = detectFormat(context.request);

  if (format === "base64") {
    return textResponse(toBase64(toNodeSubscription(nodes)));
  }

  if (format === "mihomo") {
    return response(toMihomoConfig(nodes), "text/yaml; charset=utf-8");
  }

  if (format === "surge") {
    return textResponse(toSurgeConfig(nodes));
  }

  return response(JSON.stringify(toSingBoxConfig(nodes), null, 2), "application/json; charset=utf-8");
}

function textResponse(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: headers("text/plain; charset=utf-8"),
  });
}

function response(body, contentType) {
  return new Response(body, {
    headers: headers(contentType),
  });
}

function headers(contentType) {
  return {
    ...BASE_HEADERS,
    "Content-Type": contentType,
  };
}

function normalizePath(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function detectFormat(request) {
  try {
    const url = new URL(typeof request === "string" ? request : request.url);
    const format = normalizeName(url.searchParams.get("format") || url.searchParams.get("target"));
    const client = normalizeName(url.searchParams.get("client"));
    const userAgent = String(typeof request === "string" ? "" : request.headers.get("User-Agent") || "").toLowerCase();

    if (url.searchParams.has("base64") || url.searchParams.has("b64")) {
      return "base64";
    }

    return normalizeFormat(format) || normalizeFormat(client) || detectFormatFromUserAgent(userAgent) || DEFAULT_FORMAT;
  } catch {
    return DEFAULT_FORMAT;
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFormat(value) {
  if (!value) return "";
  if (CLIENTS.base64.includes(value) || ["base64", "b64", "uri", "uris"].includes(value)) return "base64";
  if (CLIENTS.singBox.includes(value)) return "sing-box";
  if (CLIENTS.mihomo.includes(value) || ["yaml", "yml", "meta"].includes(value)) return "mihomo";
  if (CLIENTS.surge.includes(value)) return "surge";
  return "";
}

function detectFormatFromUserAgent(userAgent) {
  if (CLIENTS.base64.some((name) => userAgent.includes(name))) return "base64";
  if (CLIENTS.singBox.some((name) => userAgent.includes(name))) return "sing-box";
  if (CLIENTS.mihomo.some((name) => userAgent.includes(name))) return "mihomo";
  if (CLIENTS.surge.some((name) => userAgent.includes(name))) return "surge";
  return "";
}

function getLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function normalizeNodes(value) {
  const lines = getLines(value);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function toNodeSubscription(value) {
  return normalizeNodes(getLines(value).filter(isSupportedNodeLink).join("\n"));
}

function isSupportedNodeLink(value) {
  try {
    return SUPPORTED_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function parseNodes(value) {
  const nodes = getLines(value).map(parseNode).filter(Boolean);
  makeNamesUnique(nodes);
  return nodes;
}

function parseNode(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "vless:") return parseVless(url);
    if (url.protocol === "hysteria2:") return parseHysteria2(url);
  } catch {
    return null;
  }

  return null;
}

function parseVless(url) {
  const uuid = decodeURIComponent(url.username || "");
  const port = parsePort(url);
  if (!uuid || !url.hostname || !port) return null;

  const params = url.searchParams;
  return {
    type: "vless",
    name: nodeName(url, "vless"),
    server: url.hostname,
    port,
    uuid,
    flow: param(params, "flow"),
    packetEncoding: param(params, "packetEncoding", "packet_encoding"),
    tls: tlsConfig(params),
    transport: v2rayTransport(params),
  };
}

function parseHysteria2(url) {
  const password = decodeURIComponent(url.username || "");
  const port = parsePort(url);
  if (!password || !url.hostname || !port) return null;

  const params = url.searchParams;
  return {
    type: "hysteria2",
    name: nodeName(url, "hysteria2"),
    server: url.hostname,
    port,
    password,
    tls: tlsConfig(params, { defaultEnabled: true }),
    obfsType: param(params, "obfs", "obfs_type", "obfsType"),
    obfsPassword: param(params, "obfs-password", "obfs_password", "obfsPassword"),
    serverPorts: splitList(param(params, "mport", "server_ports", "serverPorts")),
    hopInterval: param(params, "hop_interval", "hopInterval"),
    upMbps: positiveNumber(param(params, "upmbps", "up_mbps", "up")),
    downMbps: positiveNumber(param(params, "downmbps", "down_mbps", "down")),
  };
}

function parsePort(url) {
  const port = Number(url.port);
  return url.port && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0;
}

function param(params, ...names) {
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }

  const normalized = names.map((name) => name.toLowerCase());
  for (const [key, value] of params.entries()) {
    if (value && normalized.includes(key.toLowerCase())) return value;
  }

  return "";
}

function listParam(params, name, fallback = []) {
  const items = splitList(params.get(name));
  return items.length ? items : fallback;
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function boolParam(params, ...names) {
  return ["1", "true", "yes"].includes(param(params, ...names).toLowerCase());
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function nodeName(url, fallback) {
  return decodeURIComponent(url.hash ? url.hash.slice(1) : "") || url.hostname || fallback;
}

function makeNamesUnique(nodes) {
  const seen = new Map();

  for (const node of nodes) {
    const base = node.name || node.server || node.type;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    node.name = count ? `${base}-${count + 1}` : base;
  }
}

function tlsConfig(params, options = {}) {
  const security = param(params, "security", "tls");
  const enabled = options.defaultEnabled || security === "tls" || security === "reality" || boolParam(params, "tls");
  if (!enabled) return null;

  const tls = { enabled: true };
  setIf(tls, "server_name", param(params, "sni", "server_name", "servername", "peer", "host"));
  setIf(tls, "alpn", listParam(params, "alpn"));
  if (boolParam(params, "allow_insecure", "allowInsecure", "skip-cert-verify", "skip_cert_verify", "insecure")) {
    tls.insecure = true;
  }

  const fingerprint = param(params, "fp", "fingerprint");
  if (fingerprint) tls.utls = { enabled: true, fingerprint };

  const publicKey = param(params, "pbk", "public_key", "publicKey");
  if (security === "reality" || publicKey) {
    tls.reality = { enabled: true, public_key: publicKey };
    setIf(tls.reality, "short_id", param(params, "sid", "short_id", "shortId"));
  }

  return tls;
}

function v2rayTransport(params) {
  const type = param(params, "type", "network", "net");
  const host = param(params, "host");
  const path = param(params, "path", "serviceName", "service_name");
  if (!type || type === "tcp") return null;

  if (type === "ws" || type === "websocket") {
    const transport = { type: "ws" };
    setIf(transport, "path", path);
    if (host) transport.headers = { Host: host };
    return transport;
  }

  if (type === "grpc") return { type: "grpc", service_name: path };
  if (type === "quic") return { type: "quic" };

  if (type === "httpupgrade") {
    const transport = { type: "httpupgrade" };
    setIf(transport, "host", host);
    setIf(transport, "path", path);
    return transport;
  }

  if (type === "http" || type === "h2") {
    const transport = { type: "http", network: type };
    setIf(transport, "host", splitList(host));
    setIf(transport, "path", path);
    return transport;
  }

  return null;
}

function toSingBoxConfig(value) {
  const outbounds = parseNodes(value).map(singBoxOutbound).filter(Boolean);
  const tags = outbounds.map((outbound) => outbound.tag);
  const selector = tags.length ? tags : ["direct"];

  return {
    log: { level: "info", timestamp: true },
    inbounds: [{ type: "tun", tag: "tun-in", address: ["172.19.0.1/30"], auto_route: true, strict_route: true }],
    outbounds: [{ type: "selector", tag: "proxy", outbounds: selector, default: selector[0] }, ...outbounds, { type: "direct", tag: "direct" }],
    route: { rules: [{ inbound: "tun-in", action: "sniff" }], final: "proxy", auto_detect_interface: true },
  };
}

function singBoxOutbound(node) {
  if (node.type === "vless") {
    const outbound = { type: "vless", tag: node.name, server: node.server, server_port: node.port, uuid: node.uuid };
    setIf(outbound, "flow", node.flow);
    setIf(outbound, "packet_encoding", node.packetEncoding);
    setIf(outbound, "tls", node.tls);
    setIf(outbound, "transport", node.transport);
    return outbound;
  }

  if (node.type === "hysteria2") {
    const outbound = { type: "hysteria2", tag: node.name, server: node.server, server_port: node.port, password: node.password };
    setIf(outbound, "tls", node.tls);
    if (node.obfsType) outbound.obfs = { type: node.obfsType, password: node.obfsPassword };
    setIf(outbound, "server_ports", node.serverPorts);
    setIf(outbound, "hop_interval", node.hopInterval);
    setIf(outbound, "up_mbps", node.upMbps);
    setIf(outbound, "down_mbps", node.downMbps);
    return outbound;
  }

  return null;
}

function toMihomoConfig(value) {
  const proxies = parseNodes(value).map(mihomoProxy).filter(Boolean);
  const names = proxies.map((proxy) => proxy.name);

  return yaml({
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    proxies,
    "proxy-groups": [{ name: "PROXY", type: "select", proxies: names.length ? names : ["DIRECT"] }],
    rules: ["MATCH,PROXY"],
  });
}

function mihomoProxy(node) {
  if (node.type === "vless") {
    const proxy = { name: node.name, type: "vless", server: node.server, port: node.port, uuid: node.uuid, udp: true };
    setIf(proxy, "flow", node.flow);
    setIf(proxy, "packet-encoding", node.packetEncoding);
    applyMihomoTls(proxy, node.tls, { serverNameKey: "servername", fingerprint: true, reality: true });
    applyMihomoTransport(proxy, node.transport);
    return proxy;
  }

  if (node.type === "hysteria2") {
    const proxy = { name: node.name, type: "hysteria2", server: node.server, port: node.port, password: node.password, udp: true };
    setIf(proxy, "ports", node.serverPorts.join(","));
    setIf(proxy, "hop-interval", node.hopInterval);
    if (node.upMbps) proxy.up = `${node.upMbps} Mbps`;
    if (node.downMbps) proxy.down = `${node.downMbps} Mbps`;
    setIf(proxy, "obfs", node.obfsType);
    setIf(proxy, "obfs-password", node.obfsPassword);
    applyMihomoTls(proxy, node.tls, { serverNameKey: "sni" });
    return proxy;
  }

  return null;
}

function applyMihomoTls(proxy, tls, options = {}) {
  if (!tls || !tls.enabled) return;
  proxy.tls = true;
  setIf(proxy, options.serverNameKey || "sni", tls.server_name);
  setIf(proxy, "alpn", tls.alpn);
  if (tls.insecure) proxy["skip-cert-verify"] = true;
  if (options.fingerprint && tls.utls) proxy["client-fingerprint"] = tls.utls.fingerprint;
  if (options.reality && tls.reality) {
    proxy["reality-opts"] = { "public-key": tls.reality.public_key };
    setIf(proxy["reality-opts"], "short-id", tls.reality.short_id);
  }
}

function applyMihomoTransport(proxy, transport) {
  if (!transport) return;
  if (transport.type === "ws") {
    proxy.network = "ws";
    proxy["ws-opts"] = {};
    setIf(proxy["ws-opts"], "path", transport.path);
    setIf(proxy["ws-opts"], "headers", transport.headers);
  } else if (transport.type === "grpc") {
    proxy.network = "grpc";
    proxy["grpc-opts"] = {};
    setIf(proxy["grpc-opts"], "grpc-service-name", transport.service_name);
  } else if (transport.type === "http") {
    const network = transport.network === "http" ? "http" : "h2";
    const opts = network === "http" ? "http-opts" : "h2-opts";
    proxy.network = network;
    proxy[opts] = {};
    setIf(proxy[opts], "host", transport.host);
    setIf(proxy[opts], "path", transport.path);
  } else if (transport.type === "httpupgrade") {
    proxy.network = "httpupgrade";
    proxy["httpupgrade-opts"] = {};
    setIf(proxy["httpupgrade-opts"], "host", transport.host);
    setIf(proxy["httpupgrade-opts"], "path", transport.path);
  } else {
    proxy.network = transport.type;
  }
}

function toSurgeConfig(value) {
  const supported = [];
  const unsupported = [];

  for (const node of parseNodes(value)) {
    const line = surgeProxy(node);
    if (line) supported.push(line);
    else unsupported.push(node.name);
  }

  const names = supported.map((item) => item.name);
  const lines = ["[General]", "loglevel = notify", "", "[Proxy]"];
  lines.push(...(supported.length ? supported.map((item) => item.line) : ["# No Surge-compatible proxies were found."]));
  if (unsupported.length) lines.push("", "# Unsupported by this Surge renderer:", ...unsupported.map((name) => `# ${name}`));
  lines.push("", "[Proxy Group]", `PROXY = select, ${names.length ? names.join(", ") : "DIRECT"}`, "", "[Rule]", "FINAL,PROXY");
  return `${lines.join("\n")}\n`;
}

function surgeProxy(node) {
  if (node.type === "hysteria2") {
    const password = surgeParam(node.password);
    if (!password) return null;

    const params = [surgeName(node.name), "hysteria2", node.server, node.port, `password=${password}`];
    if (node.tls) {
      setSurge(params, "sni", node.tls.server_name);
      if (node.tls.insecure) params.push("skip-cert-verify=true");
      setSurge(params, "alpn", node.tls.alpn && node.tls.alpn.join(";"));
    }
    setSurge(params, "download-bandwidth", node.downMbps);
    setSurge(params, "port-hopping", node.serverPorts.join(";"));
    setSurge(params, "port-hopping-interval", node.hopInterval);
    setSurge(params, "salamander-password", node.obfsPassword);
    return { name: params[0], line: `${params.shift()} = ${params.join(", ")}` };
  }

  return null;
}

function setSurge(params, key, value) {
  if (value) params.push(`${key}=${surgeParam(value)}`);
}

function surgeName(value) {
  return String(value || "proxy").replace(/[\r\n,=]/g, " ").replace(/\s+/g, " ").trim() || "proxy";
}

function surgeParam(value) {
  const text = String(value || "").trim();
  return text && !/[\r\n,]/.test(text) ? text : "";
}

function setIf(target, key, value) {
  if (Array.isArray(value) ? value.length : value) target[key] = value;
}

function yaml(value) {
  return `${formatYaml(value, 0)}\n`;
}

function formatYaml(value, indent) {
  if (Array.isArray(value)) {
    return value.map((item) => formatYamlArrayItem(item, indent)).filter(Boolean).join("\n");
  }

  return Object.entries(value)
    .filter(([, item]) => shouldWriteYaml(item))
    .map(([key, item]) => formatYamlEntry(key, item, indent))
    .join("\n");
}

function formatYamlArrayItem(value, indent) {
  const spaces = " ".repeat(indent);
  if (!isYamlBlock(value)) return `${spaces}- ${yamlScalar(value)}`;

  const entries = Object.entries(value).filter(([, item]) => shouldWriteYaml(item));
  if (!entries.length) return "";

  const [[firstKey, firstValue], ...rest] = entries;
  const lines = [isYamlBlock(firstValue)
    ? `${spaces}- ${firstKey}:\n${formatYaml(firstValue, indent + 4)}`
    : `${spaces}- ${firstKey}: ${yamlScalar(firstValue)}`];
  lines.push(...rest.map(([key, item]) => formatYamlEntry(key, item, indent + 2)));
  return lines.join("\n");
}

function formatYamlEntry(key, value, indent) {
  const spaces = " ".repeat(indent);
  return isYamlBlock(value)
    ? `${spaces}${key}:\n${formatYaml(value, indent + 2)}`
    : `${spaces}${key}: ${yamlScalar(value)}`;
}

function isYamlBlock(value) {
  return Array.isArray(value) || (value && typeof value === "object");
}

function shouldWriteYaml(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).some((key) => shouldWriteYaml(value[key]));
  return true;
}

function yamlScalar(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  return text && /^[A-Za-z0-9._/@:+-]+$/.test(text) && !["true", "false", "null", "yes", "no", "on", "off"].includes(text)
    ? text
    : JSON.stringify(text);
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
