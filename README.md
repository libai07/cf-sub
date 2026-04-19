# Cloudflare Pages 订阅服务

这个项目用 Cloudflare Pages Function 读取普通环境变量，输出 Base64 格式的订阅内容。

## 文件

- `functions/[path].js`：订阅接口，只有访问 `SUB_PATH` 指定的路径才会返回订阅。
- `public/_headers`：基础安全响应头。
- `public/robots.txt`：阻止爬虫抓取。

## 订阅地址

绑定自定义域后，客户端订阅地址是：

```text
https://your-sub-domain.example/your-sub-path
```

## Cloudflare 环境变量

进入 Cloudflare Pages 项目，打开：

```text
设置 -> 变量和机密 -> 添加变量
```

添加 `SUB_PATH` 环境变量：

```text
Name: SUB_PATH
Value: your-sub-path
```

添加 `NODES` 环境变量：

```text
Name: NODES
Value:
vless://node-link-1
ss://node-link-2
https://example.com/subscription-link
```

`SUB_PATH` 是订阅路径，不要加开头的 `/`。

建议 `SUB_PATH` 只使用英文字母和数字，并且不要包含 `/`、空格或符号。

`NODES` 是节点和订阅链接列表，一行一个。可以直接填写节点，也可以填写 `https://` 开头的远程订阅链接。

远程订阅支持两种常见格式：

- Base64 编码的一行一个节点订阅。
- 明文的一行一个节点订阅。

每个远程订阅最多等待 8 秒。超时、访问失败、使用 `http://` 或指向当前订阅地址时，会跳过对应链接，不影响其它节点输出。

以后添加节点或订阅链接就加一行，删除时删掉对应那一行。

保存变量后，重新部署 Pages 项目，让变量生效。

## Cloudflare Pages 设置

如果连接 Git 仓库：

```text
框架预设：无
构建命令：留空
构建输出目录：public
```

如果使用直接上传，需要上传整个项目目录，确保同时包含：

```text
functions/
public/
```

## 注意

- 如果 `NODES` 只放普通节点，可以使用普通环境变量，Cloudflare 后台可见，方便编辑。
- 如果 `NODES` 里放远程订阅链接，建议使用加密变量或 Secret，因为订阅链接通常带有 token。
- `SUB_PATH` 泄露后，改成新路径并重新部署即可。
- 这个项目会合并 `NODES` 里的直接节点和远程订阅内容，最后统一返回 Base64 内容，不会在浏览器里直接显示明文节点。
- 响应头 `X-Subscription-Failed-Count` 会显示失败或被安全规则跳过的远程订阅数量。
- 如果访问订阅地址返回 `Not found`，检查 `SUB_PATH` 是否配置正确。
- 如果订阅为空，检查 `NODES` 是否配置在生产环境，远程订阅链接是否可访问，并重新部署。
