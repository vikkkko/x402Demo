## 依赖与工具
- EIP-712/ERC-3009 签名：`web3j`（4.10+）或其他能做 EIP-712 typed data 的库。
- 随机数：`SecureRandom` 生成 32 字节 nonce。

## 必要配置（env/properties）
- `FACILITATOR_URL`：x402 facilitator 地址（如 `https://facilitator.xxx/`）。
- `NETWORK`：`base-sepolia` 等。
- `CHAIN_ID`：与网络匹配（Base Sepolia=84532）。
- `PAY_TO`：本方收款地址。
- `TOKEN_ADDRESS`：USDC/目标 token 合约地址。
- `TOKEN_NAME` / `TOKEN_VERSION`：EIP-712 域参数（USDC V2 常见 `name=USDC/ USD Coin`，`version=2`）。
- `VALIDITY_SECONDS`：授权有效期（如 3600）。
- 私钥或外部签名服务。

## 客户端流程（请求其他连接器）
1. 发起请求（不带支付）。
2. 收到 402：
   - 从响应体 `payment`（推荐）或头 `X-Accept-Payment` 解析：`amount`、`network`、`payTo`、`facilitator`、`resource`。
3. 构造支付授权：
   - `from`=自己，`to`=payTo，`value`=金额（最小单位），`validAfter=0`，`validBefore=now+VALIDITY_SECONDS`，`nonce`=32 字节随机。
   - EIP-712 域：`name`=`TOKEN_NAME`，`version`=`TOKEN_VERSION`，`chainId`，`verifyingContract`=`TOKEN_ADDRESS`。
   - 对 `TransferWithAuthorization(from,to,value,validAfter,validBefore,nonce)` 做 EIP-712 哈希并签名，得到 65 字节签名或 v/r/s。
4. 组装 `X-Payment` JSON：
   ```json
   {
     "x402Version": 1,
     "scheme": "exact",
     "network": "base-sepolia",
     "payment": {
       "authorization": {
         "from": "0x...",
         "to": "0x...",
         "value": "1000000",
         "validAfter": 0,
         "validBefore": 1710000000,
         "nonce": "0x..."
       },
       "signature": "0x..."
     }
   }
   ```
5. 带 `X-Payment` 重试请求，200 即表示支付被接受；facilitator 会异步结算。

## 服务端流程（被请求方）
1. 收到请求检查 `X-Payment`：
   - 若存在，构造 `VerifyRequest` 调用 facilitator `/verify`：
     ```json
     {
       "paymentPayload": { ...X-Payment 同上 ... },
       "paymentRequirements": {
         "x402Version": 1,
         "scheme": "exact",
         "network": "base-sepolia",
         "payTo": "0xYourPayTo",
         "maxAmountRequired": { "amount": "1000000", "decimals": 6, "symbol": "USDC" },
         "asset": "0xTOKEN",
         "resource": "/api/xxx"
       }
     }
     ```
   - 校验通过则放行；可选择同步 `/settle`，或业务成功后再 `/settle`。
2. 若无支付或校验失败：
   - 返回 402，附带 body：
     ```json
     {
       "payment": {
         "amount": 1.0,
         "currency": "USDC",
         "network": "base-sepolia",
         "payTo": "0xYourPayTo",
         "facilitator": "https://facilitator.xxx/",
         "resource": "/api/xxx"
       },
       "message": "Payment required"
     }
     ```
   - 也可用 `X-Accept-Payment` 头，但 body 更易解析。
3. 注意：
   - `resource` 与校验时一致。
   - `payTo` 为自己控制的钱包地址。
   - 时间窗允许少量缓冲。