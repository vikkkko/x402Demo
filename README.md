# x402 快速验证项目

这是一个完整的 x402 支付协议验证项目，包含商家服务器和客户端实现。

## 项目结构

```
x402/
├── merchant-server/        # 商家服务器（提供付费 API）
│   ├── server.js          # 主服务器
│   ├── middleware/
│   │   └── x402.js        # x402 支付中间件
│   ├── package.json
│   └── .env.example
│
├── client/                # 客户端（模拟买家支付）
│   ├── client.js         # 主客户端
│   ├── utils/
│   │   └── signature.js  # EIP-712 签名工具
│   ├── package.json
│   └── .env.example
│
├── setup.sh              # 快速设置脚本
├── start-all.sh          # 启动所有服务
└── README.md             # 本文件
```

## 快速开始

### 方式 1: 使用自动化脚本（推荐）

```bash
# 1. 运行设置脚本
chmod +x setup.sh
./setup.sh

# 2. 按照提示配置钱包地址和私钥

# 3. 启动测试
chmod +x start-all.sh
./start-all.sh
```

### 方式 2: 手动设置

#### 步骤 1: 准备测试钱包

1. **创建两个测试钱包**（使用 MetaMask）：
   - 钱包 A：商家收款地址
   - 钱包 B：客户支付地址

2. **配置 Base Sepolia 网络**：
   - 网络名称：Base Sepolia
   - RPC URL：https://sepolia.base.org
   - Chain ID：84532
   - 货币符号：ETH
   - 区块浏览器：https://sepolia.basescan.org

3. **领取测试资产**（钱包 B）：
   - ETH：https://www.alchemy.com/faucets/base-sepolia
   - USDC：https://faucet.circle.com/ （选择 Base Sepolia）

#### 步骤 2: 配置商家服务器

```bash
cd merchant-server

# 安装依赖
npm install

# 复制并编辑配置
cp .env.example .env
nano .env  # 或使用其他编辑器
```

编辑 `.env` 文件：
```bash
PORT=3000
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=base-sepolia
PAY_TO_ADDRESS=0xYourMerchantWalletAddress  # 钱包 A 的地址
PRICE_PER_REQUEST=0.01
CURRENCY_ADDRESS=0xDE87AF9156a223404885002669D3bE239313Ae33
```

#### 步骤 3: 配置客户端

```bash
cd ../client

# 安装依赖
npm install

# 复制并编辑配置
cp .env.example .env
nano .env  # 或使用其他编辑器
```

编辑 `.env` 文件：
```bash
SERVER_URL=http://localhost:3000
NETWORK=base-sepolia
CLIENT_PRIVATE_KEY=0xYourClientPrivateKey  # 钱包 B 的私钥
```

#### 步骤 4: 启动商家服务器

```bash
cd merchant-server
npm start
```

服务器将在 http://localhost:3000 启动。

#### 步骤 5: 测试客户端（新终端）

```bash
cd client

# 测试受保护端点
npm test

# 测试聊天端点
npm run test:chat
```

## 测试端点

### 免费端点（无需支付）

- `GET /` - 服务器信息
- `GET /health` - 健康检查
- `GET /api/free` - 免费示例端点

### 付费端点（需要支付）

- `GET /api/protected` - 受保护的数据
- `POST /api/chat` - AI 聊天接口（需要支付 0.01 USDC）

## 工作流程

```
1. 客户端请求受保护资源
   ↓
2. 服务器返回 402 Payment Required
   ↓
3. 客户端创建 EIP-712 支付签名
   ↓
4. 客户端使用签名重新请求
   ↓
5. 服务器验证签名（通过 Facilitator）
   ↓
6. 服务器返回受保护内容
   ↓
7. Facilitator 异步结算到链上
```

## 核心概念

### 什么是 x402？

x402 是基于 HTTP 402 状态码的即时支付协议，允许客户端通过链下签名授权支付，无需预先充值或复杂的钱包交互。

### 什么是 Facilitator？

Facilitator（协调器）是中间服务，负责：
1. 验证支付签名的有效性
2. 将支付授权提交到区块链
3. 代付 gas 费用

### 什么是 EIP-3009？

EIP-3009 是一个以太坊改进提案，定义了 `transferWithAuthorization` 方法，允许通过链下签名授权代币转账。

## 验证成功标志

运行客户端后，你应该看到：

✅ 服务器健康检查通过
✅ 第一次请求收到 402 响应
✅ 客户端创建支付签名
✅ Facilitator 验证签名成功
✅ 第二次请求返回 200 和受保护内容
✅ Facilitator 返回交易哈希

## 查看链上交易

在客户端输出中找到交易哈希，然后访问：

```
https://sepolia.basescan.org/tx/[交易哈希]
```

你应该能看到：
- 从客户端地址到商家地址的 USDC 转账
- 方法：`transferWithAuthorization`
- 金额：0.01 USDC

## 常见问题

### 1. 客户端报错 "insufficient funds"

**解决方案**：确保客户端钱包有足够的 USDC 余额（至少 0.01 USDC）。

### 2. 验证失败 "Payment verification failed"

**可能原因**：
- 客户端和服务器的 `NETWORK` 配置不一致
- 客户端钱包 USDC 余额不足
- nonce 已被使用（重复支付）

### 3. Facilitator 连接失败

**解决方案**：
- 检查网络连接
- 确认 `FACILITATOR_URL` 配置正确
- 尝试访问 https://x402.org/facilitator/supported 检查服务是否可用

### 4. 签名无效

**检查项**：
- `CURRENCY_ADDRESS` 是否正确（Base Sepolia USDC）
- `PAY_TO_ADDRESS` 是否与服务器配置一致
- 客户端私钥是否正确

## 扩展功能

### 多链支持

修改 `.env` 文件切换到其他网络：

**Polygon Amoy 测试网**：
```bash
NETWORK=polygon-amoy
CURRENCY_ADDRESS=0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582
FACILITATOR_URL=https://facilitator.payai.network
```

### 自建 Facilitator

如果想完全控制支付流程，可以部署自己的 facilitator：

```bash
# 使用 x402-rs
docker run --env-file .env -p 8080:8080 ukstv/x402-facilitator

# 然后修改 FACILITATOR_URL
FACILITATOR_URL=http://localhost:8080
```

### 添加自定义端点

在 `merchant-server/server.js` 中添加：

```javascript
app.get('/api/your-endpoint', x402.middleware(), (req, res) => {
  res.json({
    message: 'Your custom protected content',
    payment: req.x402Payment
  });
});
```

## 安全注意事项

⚠️ **警告**：

1. 本项目仅用于测试和学习
2. 不要在生产环境使用测试网私钥
3. 不要将包含真实资产的私钥写入 `.env` 文件
4. 生产环境应使用：
   - 硬件钱包或 KMS 管理私钥
   - HTTPS 加密通信
   - 速率限制和防欺诈检测
   - 数据库记录所有支付交易

## 技术栈

- **Node.js** - 运行时环境
- **Express** - Web 框架
- **ethers.js** - 以太坊库（EIP-712 签名）
- **axios** - HTTP 客户端
- **x402 协议** - 支付协议规范

## 参考资源

- [x402 官方文档](https://docs.cdp.coinbase.com/x402/welcome)
- [x402 协议规范](https://github.com/coinbase/x402)
- [EIP-3009 标准](https://eips.ethereum.org/EIPS/eip-3009)
- [EIP-712 签名](https://eips.ethereum.org/EIPS/eip-712)
- [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
- [Circle USDC Faucet](https://faucet.circle.com/)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
