const DEFAULT_FORMAT = "base64";
const SUPPORTED_PROTOCOLS = ["hysteria2:", "vless:", "trojan:", "vmess:", "ss:", "tuic:", "anytls:"];
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
    // Handle non-parseable URLs (e.g. old-format SS / VMess with raw base64 padding)
    const match = value.match(/^([a-z][a-z0-9+\-.]*:\/\/)/i);
    return match ? SUPPORTED_PROTOCOLS.includes(match[1].toLowerCase()) : false;
  }
}

function parseNodes(value) {
  const nodes = getLines(value).map(parseNode).filter(Boolean);
  makeNamesUnique(nodes);
  return nodes;
}

function parseNode(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    // URL constructor may fail on old-format SS / VMess with base64 padding
    if (value.startsWith("ss://")) return parseShadowsocks(value);
    if (value.startsWith("vmess://")) return parseVmess(value);
    return null;
  }

  if (url.protocol === "vless:") return parseVless(url);
  if (url.protocol === "hysteria2:") return parseHysteria2(url);
  if (url.protocol === "trojan:") return parseTrojan(url);
  if (url.protocol === "vmess:") return parseVmess(value);
  if (url.protocol === "ss:") return parseShadowsocks(value);
  if (url.protocol === "tuic:") return parseTuic(url);
  if (url.protocol === "anytls:") return parseAnytls(url);

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

function parseTrojan(url) {
  const password = decodeURIComponent(url.username || "");
  const port = parsePort(url);
  if (!password || !url.hostname || !port) return null;

  const params = url.searchParams;
  return {
    type: "trojan",
    name: nodeName(url, "trojan"),
    server: url.hostname,
    port,
    password,
    tls: tlsConfig(params, { defaultEnabled: true }),
    transport: v2rayTransport(params),
  };
}

// Handles both SIP002 (ss://base64(method:password)@host:port) and
// legacy format (ss://base64(method:password@host:port)).
function parseShadowsocks(rawValue) {
  // SIP002 format: URL parser gives us a valid hostname + port
  try {
    const url = new URL(rawValue);
    const port = parsePort(url);
    if (url.hostname && port) {
      const rawUserinfo = decodeURIComponent(url.username || "");
      let userinfo;
      try { userinfo = fromBase64(rawUserinfo); } catch { userinfo = rawUserinfo; }
      const colonIdx = userinfo.indexOf(":");
      if (colonIdx === -1) {
        // Plain SIP002: method in url.username, password in url.password (common for SS-2022)
        const passwordDirect = decodeURIComponent(url.password || "");
        if (!rawUserinfo || !passwordDirect) return null;
        return {
          type: "shadowsocks",
          name: nodeName(url, "shadowsocks"),
          server: url.hostname,
          port,
          method: rawUserinfo,
          password: passwordDirect,
          plugin: param(params, "plugin"),
          pluginOpts: param(params, "plugin-opts"),
        };
      }
      const method = userinfo.slice(0, colonIdx);
      const password = userinfo.slice(colonIdx + 1);
      if (!method || !password) return null;
      const params = url.searchParams;
      return {
        type: "shadowsocks",
        name: nodeName(url, "shadowsocks"),
        server: url.hostname,
        port,
        method,
        password,
        plugin: param(params, "plugin"),
        pluginOpts: param(params, "plugin-opts"),
      };
    }
  } catch {}

  // Legacy format: ss://base64(method:password@host:port)#name
  try {
    const schemeEnd = rawValue.indexOf("://") + 3;
    const hashIdx = rawValue.indexOf("#");
    const name = hashIdx !== -1 ? decodeURIComponent(rawValue.slice(hashIdx + 1)) : "";
    const encoded = rawValue.slice(schemeEnd, hashIdx !== -1 ? hashIdx : undefined).split("?")[0];
    const decoded = fromBase64(encoded);

    const atIdx = decoded.lastIndexOf("@");
    if (atIdx === -1) return null;
    const userinfo = decoded.slice(0, atIdx);
    const serverPart = decoded.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(":");
    if (colonIdx === -1) return null;
    const lastColon = serverPart.lastIndexOf(":");
    if (lastColon === -1) return null;

    const port = Number(serverPart.slice(lastColon + 1));
    if (!port || port < 1 || port > 65535) return null;
    const method = userinfo.slice(0, colonIdx);
    const password = userinfo.slice(colonIdx + 1);
    const server = serverPart.slice(0, lastColon);
    if (!method || !password || !server) return null;

    return { type: "shadowsocks", name: name || server, server, port, method, password, plugin: "", pluginOpts: "" };
  } catch {
    return null;
  }
}

// VMess URLs are base64-encoded JSON objects: vmess://base64(json)
function parseVmess(rawValue) {
  try {
    const encoded = rawValue.slice("vmess://".length).split("#")[0];
    const config = JSON.parse(fromBase64(encoded));

    const server = String(config.add || "").trim();
    const port = Number(config.port);
    const uuid = String(config.id || "").trim();
    if (!server || !uuid || port < 1 || port > 65535) return null;

    const net = String(config.net || "tcp").toLowerCase();
    const tls = String(config.tls || "").toLowerCase();
    const sni = String(config.sni || "").trim();
    const host = String(config.host || "").trim();
    const path = String(config.path || "").trim();
    const fp = String(config.fp || "").trim();
    const alpnStr = String(config.alpn || "").trim();

    let tlsConf = null;
    if (tls === "tls" || tls === "reality") {
      tlsConf = { enabled: true };
      if (sni) tlsConf.server_name = sni;
      if (alpnStr) tlsConf.alpn = alpnStr.split(",").map((s) => s.trim()).filter(Boolean);
      if (fp) tlsConf.utls = { enabled: true, fingerprint: fp };
      if (tls === "reality" && config.pbk) {
        tlsConf.reality = { enabled: true, public_key: String(config.pbk) };
        if (config.sid) tlsConf.reality.short_id = String(config.sid);
      }
    }

    let transport = null;
    if (net && net !== "tcp" && net !== "none") {
      if (net === "ws" || net === "websocket") {
        transport = { type: "ws" };
        if (path) transport.path = path;
        if (host) transport.headers = { Host: host };
      } else if (net === "grpc") {
        transport = { type: "grpc", service_name: path };
      } else if (net === "http" || net === "h2") {
        transport = { type: "http", network: net };
        if (host) transport.host = host.split(",").map((s) => s.trim()).filter(Boolean);
        if (path) transport.path = path;
      } else if (net === "quic") {
        transport = { type: "quic" };
      } else if (net === "httpupgrade") {
        transport = { type: "httpupgrade" };
        if (host) transport.host = host;
        if (path) transport.path = path;
      }
    }

    return {
      type: "vmess",
      name: String(config.ps || "").trim() || server,
      server,
      port,
      uuid,
      security: String(config.scy || config.security || "auto").toLowerCase(),
      alterId: Number(config.aid || 0),
      tls: tlsConf,
      transport,
    };
  } catch {
    return null;
  }
}

function parseTuic(url) {
  const uuid = decodeURIComponent(url.username || "");
  const password = decodeURIComponent(url.password || "");
  const port = parsePort(url);
  if (!uuid || !url.hostname || !port) return null;

  const params = url.searchParams;
  const alpn = splitList(param(params, "alpn"));
  return {
    type: "tuic",
    name: nodeName(url, "tuic"),
    server: url.hostname,
    port,
    uuid,
    password,
    congestionControl: param(params, "congestion_control", "congestionControl") || "cubic",
    udpRelayMode: param(params, "udp_relay_mode", "udpRelayMode") || "native",
    tls: {
      enabled: true,
      server_name: param(params, "sni", "server_name"),
      alpn: alpn.length ? alpn : ["h3"],
      insecure: boolParam(params, "allow_insecure", "allowInsecure", "skip-cert-verify"),
    },
  };
}

function parseAnytls(url) {
  const password = decodeURIComponent(url.username || "");
  const port = parsePort(url);
  if (!password || !url.hostname || !port) return null;

  const params = url.searchParams;
  return {
    type: "anytls",
    name: nodeName(url, "anytls"),
    server: url.hostname,
    port,
    password,
    tls: tlsConfig(params, { defaultEnabled: true }),
    idleSessionCheckInterval: param(params, "idle-session-check-interval", "idle_session_check_interval"),
    idleSessionTimeout: param(params, "idle-session-timeout", "idle_session_timeout"),
    minIdleSession: positiveNumber(param(params, "min-idle-session", "min_idle_session")),
  };
}

// Decode URL-safe or standard base64
function fromBase64(value) {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
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

  if (type === "xhttp" || type === "splithttp") {
    const transport = { type: "xhttp" };
    setIf(transport, "host", host);
    setIf(transport, "path", path);
    const mode = param(params, "mode");
    setIf(transport, "mode", mode);
    const rawExtra = param(params, "extra");
    if (rawExtra) {
      try {
        transport.extra = JSON.parse(rawExtra);
      } catch {
        try { transport.extra = JSON.parse(fromBase64(rawExtra)); } catch {}
      }
    }
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

  if (node.type === "trojan") {
    const outbound = { type: "trojan", tag: node.name, server: node.server, server_port: node.port, password: node.password };
    setIf(outbound, "tls", node.tls);
    setIf(outbound, "transport", node.transport);
    return outbound;
  }

  if (node.type === "shadowsocks") {
    const outbound = { type: "shadowsocks", tag: node.name, server: node.server, server_port: node.port, method: node.method, password: node.password };
    if (node.plugin) {
      outbound.plugin = node.plugin;
      if (node.pluginOpts) outbound.plugin_opts = node.pluginOpts;
    }
    return outbound;
  }

  if (node.type === "vmess") {
    const outbound = { type: "vmess", tag: node.name, server: node.server, server_port: node.port, uuid: node.uuid, security: node.security || "auto", alter_id: node.alterId || 0 };
    setIf(outbound, "tls", node.tls);
    setIf(outbound, "transport", node.transport);
    return outbound;
  }

  if (node.type === "tuic") {
    const outbound = { type: "tuic", tag: node.name, server: node.server, server_port: node.port, uuid: node.uuid, password: node.password };
    setIf(outbound, "congestion_control", node.congestionControl);
    setIf(outbound, "udp_relay_mode", node.udpRelayMode);
    setIf(outbound, "tls", node.tls);
    return outbound;
  }

  if (node.type === "anytls") {
    const outbound = { type: "anytls", tag: node.name, server: node.server, server_port: node.port, password: node.password };
    setIf(outbound, "tls", node.tls);
    setIf(outbound, "idle_session_check_interval", node.idleSessionCheckInterval);
    setIf(outbound, "idle_session_timeout", node.idleSessionTimeout);
    if (node.minIdleSession) outbound.min_idle_session = node.minIdleSession;
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

  if (node.type === "trojan") {
    const proxy = { name: node.name, type: "trojan", server: node.server, port: node.port, password: node.password, udp: true };
    applyMihomoTls(proxy, node.tls, { serverNameKey: "sni", fingerprint: true, reality: true });
    applyMihomoTransport(proxy, node.transport);
    return proxy;
  }

  if (node.type === "shadowsocks") {
    const proxy = { name: node.name, type: "ss", server: node.server, port: node.port, cipher: node.method, password: node.password, udp: true };
    if (node.plugin) {
      // SIP002 plugin string: "plugin-name;key=value;..."
      const parts = String(node.plugin).split(";");
      const pluginName = parts[0].trim();
      proxy.plugin = pluginName.replace(/^obfs-local$/, "obfs");
      if (parts.length > 1) {
        const opts = {};
        for (const part of parts.slice(1)) {
          const eqIdx = part.indexOf("=");
          if (eqIdx !== -1) opts[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
        }
        const pluginOpts = {};
        if (opts.obfs) pluginOpts.mode = opts.obfs;
        if (opts["obfs-host"]) pluginOpts.host = opts["obfs-host"];
        if (opts.mode) pluginOpts.mode = opts.mode;
        if (Object.keys(pluginOpts).length) proxy["plugin-opts"] = pluginOpts;
      }
    }
    return proxy;
  }

  if (node.type === "vmess") {
    const proxy = { name: node.name, type: "vmess", server: node.server, port: node.port, uuid: node.uuid, alterId: node.alterId || 0, cipher: node.security || "auto", udp: true };
    applyMihomoTls(proxy, node.tls, { serverNameKey: "servername", fingerprint: true, reality: true });
    applyMihomoTransport(proxy, node.transport);
    return proxy;
  }

  if (node.type === "tuic") {
    const proxy = { name: node.name, type: "tuic", server: node.server, port: node.port, uuid: node.uuid, password: node.password };
    setIf(proxy, "congestion-controller", node.congestionControl);
    setIf(proxy, "udp-relay-mode", node.udpRelayMode);
    if (node.tls) {
      setIf(proxy, "sni", node.tls.server_name);
      setIf(proxy, "alpn", node.tls.alpn);
      if (node.tls.insecure) proxy["skip-cert-verify"] = true;
    }
    return proxy;
  }

  if (node.type === "anytls") {
    const proxy = { name: node.name, type: "anytls", server: node.server, port: node.port, password: node.password };
    applyMihomoTls(proxy, node.tls, { serverNameKey: "sni", fingerprint: true, reality: true });
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
  } else if (transport.type === "xhttp") {
    proxy.network = "xhttp";
    proxy["xhttp-opts"] = {};
    setIf(proxy["xhttp-opts"], "host", transport.host);
    setIf(proxy["xhttp-opts"], "path", transport.path);
    setIf(proxy["xhttp-opts"], "mode", transport.mode);
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

  if (node.type === "trojan") {
    const password = surgeParam(node.password);
    if (!password) return null;
    const params = [surgeName(node.name), "trojan", node.server, node.port, `password=${password}`];
    if (node.tls) {
      setSurge(params, "sni", node.tls.server_name);
      if (node.tls.insecure) params.push("skip-cert-verify=true");
    }
    if (node.transport && node.transport.type === "ws") {
      params.push("ws=true");
      setSurge(params, "ws-path", node.transport.path);
    }
    return { name: params[0], line: `${params.shift()} = ${params.join(", ")}` };
  }

  if (node.type === "shadowsocks") {
    const password = surgeParam(node.password);
    if (!password) return null;
    const params = [surgeName(node.name), "ss", node.server, node.port, `encrypt-method=${node.method}`, `password=${password}`, "udp-relay=true"];
    return { name: params[0], line: `${params.shift()} = ${params.join(", ")}` };
  }

  if (node.type === "vmess") {
    const params = [surgeName(node.name), "vmess", node.server, node.port, `username=${node.uuid}`];
    if (node.tls) {
      params.push("tls=true");
      setSurge(params, "sni", node.tls.server_name);
      if (node.tls.insecure) params.push("skip-cert-verify=true");
      if (node.tls.utls) setSurge(params, "tls-fingerprint", node.tls.utls.fingerprint);
    }
    if (node.transport) {
      if (node.transport.type === "ws") {
        params.push("ws=true");
        setSurge(params, "ws-path", node.transport.path);
        if (node.transport.headers) setSurge(params, "ws-headers", `Host:${node.transport.headers.Host}`);
      }
    }
    return { name: params[0], line: `${params.shift()} = ${params.join(", ")}` };
  }

  if (node.type === "tuic") {
    // Requires Surge 5.9+
    const password = surgeParam(node.password);
    if (!password) return null;
    const params = [surgeName(node.name), "tuic-v5", node.server, node.port, `uuid=${node.uuid}`, `password=${password}`];
    if (node.tls) {
      setSurge(params, "sni", node.tls.server_name);
      if (node.tls.insecure) params.push("skip-cert-verify=true");
      if (node.tls.alpn && node.tls.alpn.length) setSurge(params, "alpn", node.tls.alpn.join(","));
    }
    setSurge(params, "congestion-control", node.congestionControl);
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
