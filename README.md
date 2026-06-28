# cf-sub
Cloudflare Pages 上的轻量订阅聚合服务。
它把环境变量里的节点整理成一个私人订阅入口。默认输出通用 Base64 节点订阅；也会根据 `format`、`target`、`client` 参数或客户端 `User-Agent` 自动返回主流客户端格式。

## 功能
- 默认通用订阅：适合 Shadowrocket、v2rayN、v2rayNG、NekoBox、NekoRay、Hiddify、Streisand、Loon、Quantumult X 等客户端。
- 自适应输出：支持 sing-box JSON、Mihomo/Clash YAML、Surge 配置。
- 私人路径访问：只有请求路径匹配 `SUB_PATH` 才返回订阅。
- 无构建部署：直接部署到 Cloudflare Pages Functions。

## 环境变量
在 Cloudflare Pages 项目中配置：
```text
SUB_PATH=你的订阅路径
NODES=一行一个节点链接
```

`NODES` 示例：
```text
vless://...
hysteria2://...
trojan://...
vmess://...
ss://...
tuic://...
```

支持的节点协议：
- `vless://`
- `hysteria2://`
- `trojan://`
- `vmess://`（base64 JSON 格式）
- `ss://`（SIP002 及旧版 base64 格式）
- `tuic://`

## 访问
默认通用订阅：
```text
https://你的域名/SUB_PATH
```

指定输出格式：
```text
https://你的域名/SUB_PATH?format=base64
https://你的域名/SUB_PATH?format=sing-box
https://你的域名/SUB_PATH?format=mihomo
https://你的域名/SUB_PATH?format=surge
```

指定客户端：
```text
https://你的域名/SUB_PATH?client=shadowrocket
https://你的域名/SUB_PATH?client=v2rayn
https://你的域名/SUB_PATH?client=clash-verge
https://你的域名/SUB_PATH?client=sing-box
https://你的域名/SUB_PATH?client=surge
```

输出格式优先级：
```text
format/target/client 参数 > User-Agent 自动识别 > base64 默认兜底
```

常用别名：
```text
?format=base64
?format=b64
?format=sing-box
?format=singbox
?format=mihomo
?format=clash
?format=yaml
?target=clash
```

## 各格式协议支持情况

| 协议 | Base64 | sing-box | Mihomo | Surge |
|---|---|---|---|---|
| vless | ✅ | ✅ | ✅ | ❌ |
| hysteria2 | ✅ | ✅ | ✅ | ✅ |
| trojan | ✅ | ✅ | ✅ | ✅ |
| vmess | ✅ | ✅ | ✅ | ✅ |
| ss | ✅ | ✅ | ✅ | ✅ |
| tuic | ✅ | ✅ | ✅ | ✅ ⁽¹⁾ |

⁽¹⁾ TUIC 在 Surge 中输出为 `tuic-v5`，需要 Surge 5.9 或更高版本。

## Cloudflare Pages
项目设置：
```text
框架预设: 无
构建命令: 留空
构建输出目录: public
```

直接上传时确保包含：
```text
functions/
public/
wrangler.toml
```

## 说明
- 默认响应会设置 `Cache-Control: no-store`，避免订阅被缓存。
- Surge 不支持 VLESS，对应节点会跳过并在配置末尾注释说明。
- `ss://` 同时兼容 SIP002（`base64(method:pass)@host:port`）和旧版（`base64(method:pass@host:port)`）两种链接格式。
- `public/robots.txt` 和响应头会阻止搜索引擎索引订阅入口。
