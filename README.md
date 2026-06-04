# cf-sub

Cloudflare Pages 订阅服务。

用于把 Cloudflare Pages 环境变量里的节点和远程订阅链接合并输出，默认返回 sing-box JSON，也可以返回 Base64 节点订阅。

## 文件

- `functions/[path].js`: 订阅接口。
- `public/robots.txt`: 禁止搜索引擎抓取。
- `wrangler.toml`: Cloudflare 兼容配置。

## 环境变量

在 Cloudflare Pages 项目里添加：

- `SUB_PATH`: 订阅路径，不要带开头的 `/`。
- `NODES`: 节点或远程订阅链接，一行一个。

`NODES` 支持：

- `hysteria2://`
- `tuic://`
- `vless://`
- `http://` 或 `https://` 开头的远程订阅链接

## 访问

```text
https://你的域名/SUB_PATH
https://你的域名/SUB_PATH?format=base64
https://你的域名/SUB_PATH?client=shadowrocket
https://你的域名/SUB_PATH?client=v2rayn
```

## Cloudflare Pages 设置

```text
框架预设: 无
构建命令: 留空
构建输出目录: public
```

如果直接上传，上传整个项目目录，确保包含：

```text
functions/
public/
wrangler.toml
```
