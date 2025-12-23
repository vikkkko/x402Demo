# x402 v2 协议接入指南

> 面向 Java 开发者的完整接入指南

## 概述

x402 是基于 HTTP 402 状态码的即时支付协议，允许客户端通过链下 EIP-712 签名授权支付，无需预先充值或复杂的钱包交互。本指南介绍如何在现有 Java 系统中集成 x402 v2 协议。

**适用场景**：您的系统既是服务提供方（收款），也需要访问其他 x402 服务（付款）。

## 协议流程

```
客户端请求受保护资源
    ↓
服务端返回 402 Payment Required（包含支付选项）
    ↓
客户端选择支付路线，创建 EIP-712 签名
    ↓
客户端携带签名重新请求
    ↓
服务端通过 Facilitator 验证签名
    ↓
验证通过，返回受保护内容
    ↓
Facilitator 异步结算到区块链
```

## 核心概念

### v2 协议特性

- **CAIP-2 网络标识**：统一的网络标识格式 `eip155:{chainId}`
- **多路线支付**：一次 402 响应可提供多种支付选项（多链、多币种）
- **动态配置**：服务端提供签名参数，客户端无需硬编码
- **Base64 头编码**：`PAYMENT-REQUIRED` 头使用 Base64 编码

### Facilitator（协调器）

Facilitator 是可信的中间服务，负责：
1. 验证 EIP-712 签名的有效性
2. 提交授权到区块链（调用 `transferWithAuthorization`）
3. 代付 gas 费用

**公共 Facilitator**：`https://x402.org/facilitator`（生产环境）

### EIP-3009 授权转账

支持 `transferWithAuthorization` 方法的 ERC-20 代币（如 USDC）允许通过链下签名授权转账，代币持有人无需支付 gas。

---

## 一、依赖与配置

### Maven 依赖

```xml
<!-- Web3j：EIP-712 签名 -->
<dependency>
    <groupId>org.web3j</groupId>
    <artifactId>core</artifactId>
    <version>4.10.0</version>
</dependency>

<!-- HTTP 客户端 -->
<dependency>
    <groupId>com.squareup.okhttp3</groupId>
    <artifactId>okhttp</artifactId>
    <version>4.12.0</version>
</dependency>

<!-- JSON 处理 -->
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.15.0</version>
</dependency>

<!-- Base64 编码（Java 8+ 内置，无需额外依赖） -->
```

### 配置文件（application.properties）

```properties
# Facilitator 配置
x402.facilitator.url=https://x402.org/facilitator

# 服务端配置（作为收款方）
x402.server.payToAddress=0xYourMerchantWalletAddress
x402.server.pricePerRequest=0.01

# DailyLedger Token（私链示例）
x402.token.dailyledger.address=0x9ab7CA8a88F8e351f9b0eEEA5777929210199295
x402.token.dailyledger.chainId=1337
x402.token.dailyledger.domainName=DailyLedger
x402.token.dailyledger.domainVersion=1
x402.token.dailyledger.explorerUrl=http://220.154.132.194:3001

# USDC Token（Base Sepolia 测试网）
x402.token.usdc.address=0x036cbd53842c5426634e7929541ec2318f3dcf7e
x402.token.usdc.chainId=84532
x402.token.usdc.domainName=USD Coin
x402.token.usdc.domainVersion=2
x402.token.usdc.explorerUrl=https://sepolia.basescan.org

# 客户端配置（作为付款方）
x402.client.privateKey=0xYourPrivateKey
```

---

## 二、服务端实现（收款方）

### 1. 定义数据结构

```java
// v2 支付路线
public class PaymentRoute {
    private String scheme = "exact";
    private String network;        // CAIP-2 格式: eip155:84532
    private String asset;          // Token 合约地址
    private String amount;         // 最小单位，如 "10000" = 0.01 USDC
    private String payTo;          // 收款地址
    private String description;
    private int timeoutSeconds = 120;
    private RouteMeta meta;

    // getters/setters...
}

public class RouteMeta {
    private String domainName;     // EIP-712 域名
    private String domainVersion;  // EIP-712 版本
    private String contractType;   // 合约类型标识
    private String explorerUrl;    // 区块浏览器
    private String memo;           // 备注（通常是 resource）

    // getters/setters...
}

// v2 PAYMENT-REQUIRED 结构
public class PaymentRequired {
    private int version = 2;
    private ResourceInfo resourceInfo;
    private List<PaymentRoute> accepts;
    private List<FacilitatorInfo> facilitators;

    // getters/setters...
}

public class ResourceInfo {
    private String resource;       // 请求的 URL
    private String mimeType = "application/json";
    private String method;         // GET/POST

    // getters/setters...
}

public class FacilitatorInfo {
    private String url;
    private List<String> networks; // 支持的网络列表

    // getters/setters...
}
```

### 2. 拦截器/过滤器实现

```java
@Component
public class X402PaymentFilter implements Filter {

    @Autowired
    private X402Service x402Service;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;

        // 检查是否需要支付（根据路径判断）
        if (!requiresPayment(req.getRequestURI())) {
            chain.doFilter(request, response);
            return;
        }

        // 检查 PAYMENT-SIGNATURE 头
        String paymentSignature = req.getHeader("PAYMENT-SIGNATURE");

        if (paymentSignature == null || paymentSignature.isEmpty()) {
            // 没有支付凭证，返回 402
            send402Response(req, res);
            return;
        }

        // 验证支付
        try {
            PaymentPayload payment = parsePayment(paymentSignature);
            boolean isValid = x402Service.verifyPayment(payment, req.getRequestURI());

            if (!isValid) {
                res.setStatus(402);
                res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Payment verification failed\"}");
                return;
            }

            // 验证通过，异步结算
            CompletableFuture.runAsync(() ->
                x402Service.settlePayment(payment, req.getRequestURI())
            );

            // 继续处理请求
            chain.doFilter(request, response);

        } catch (Exception e) {
            res.setStatus(500);
            res.getWriter().write("{\"error\":\"Payment processing error\"}");
        }
    }

    private void send402Response(HttpServletRequest req, HttpServletResponse res)
            throws IOException {
        String resource = req.getRequestURL().toString();

        // 构建支付路线
        List<PaymentRoute> routes = buildPaymentRoutes(resource);

        // 构建 v2 PAYMENT-REQUIRED
        PaymentRequired paymentRequired = new PaymentRequired();
        paymentRequired.setResourceInfo(new ResourceInfo(resource, "application/json", req.getMethod()));
        paymentRequired.setAccepts(routes);
        paymentRequired.setFacilitators(List.of(
            new FacilitatorInfo(
                facilitatorUrl,
                routes.stream().map(PaymentRoute::getNetwork).collect(Collectors.toList())
            )
        ));

        // Base64 编码
        String json = objectMapper.writeValueAsString(paymentRequired);
        String base64 = Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));

        // 设置响应
        res.setStatus(402);
        res.setHeader("PAYMENT-REQUIRED", base64);
        res.setContentType("application/json");

        // 响应体（包含 v2 和 contractMetadata）
        Map<String, Object> body = new HashMap<>();
        body.put("error", "Payment Required");
        body.put("message", "This endpoint requires payment");
        body.put("v2", paymentRequired);
        body.put("contractMetadata", buildContractMetadata(routes.get(0)));

        res.getWriter().write(objectMapper.writeValueAsString(body));
    }

    private List<PaymentRoute> buildPaymentRoutes(String resource) {
        List<PaymentRoute> routes = new ArrayList<>();

        // DailyLedger 路线
        if (dailyLedgerAddress != null) {
            PaymentRoute route = new PaymentRoute();
            route.setScheme("exact");
            route.setNetwork("eip155:1337");
            route.setAsset(dailyLedgerAddress);
            route.setAmount(String.valueOf((int)(pricePerRequest * 1_000_000)));
            route.setPayTo(payToAddress);
            route.setDescription("Pay with DailyLedger (Private Chain)");
            route.setTimeoutSeconds(120);

            RouteMeta meta = new RouteMeta();
            meta.setDomainName("DailyLedger");
            meta.setDomainVersion("1");
            meta.setContractType("DailyLedger");
            meta.setExplorerUrl(dailyLedgerExplorerUrl);
            meta.setMemo(resource);
            route.setMeta(meta);

            routes.add(route);
        }

        // USDC 路线
        if (usdcAddress != null) {
            PaymentRoute route = new PaymentRoute();
            route.setScheme("exact");
            route.setNetwork("eip155:84532");
            route.setAsset(usdcAddress);
            route.setAmount(String.valueOf((int)(pricePerRequest * 1_000_000)));
            route.setPayTo(payToAddress);
            route.setDescription("Pay with USDC (Base Sepolia)");
            route.setTimeoutSeconds(120);

            RouteMeta meta = new RouteMeta();
            meta.setDomainName("USD Coin");
            meta.setDomainVersion("2");
            meta.setContractType("USDC");
            meta.setExplorerUrl(usdcExplorerUrl);
            meta.setMemo(resource);
            route.setMeta(meta);

            routes.add(route);
        }

        return routes;
    }
}
```

### 3. 验证与结算服务

```java
@Service
public class X402Service {

    @Autowired
    private RestTemplate restTemplate;

    @Value("${x402.facilitator.url}")
    private String facilitatorUrl;

    public boolean verifyPayment(PaymentPayload payment, String resource) {
        try {
            // 构建验证请求（发送 v1 格式给 Facilitator）
            Map<String, Object> verifyRequest = new HashMap<>();
            verifyRequest.put("x402Version", 1);
            verifyRequest.put("paymentPayload", convertToV1Payload(payment));
            verifyRequest.put("paymentRequirements", buildPaymentRequirements(payment, resource));

            // 调用 Facilitator /verify
            String url = facilitatorUrl + "/verify";
            ResponseEntity<Map> response = restTemplate.postForEntity(
                url,
                verifyRequest,
                Map.class
            );

            Map<String, Object> result = response.getBody();
            return Boolean.TRUE.equals(result.get("isValid")) ||
                   Boolean.TRUE.equals(result.get("valid"));

        } catch (Exception e) {
            log.error("Payment verification failed", e);
            return false;
        }
    }

    public void settlePayment(PaymentPayload payment, String resource) {
        try {
            // 构建结算请求
            Map<String, Object> settleRequest = new HashMap<>();
            settleRequest.put("x402Version", 1);
            settleRequest.put("paymentPayload", convertToV1Payload(payment));
            settleRequest.put("paymentRequirements", buildPaymentRequirements(payment, resource));

            // 调用 Facilitator /settle
            String url = facilitatorUrl + "/settle";
            ResponseEntity<Map> response = restTemplate.postForEntity(
                url,
                settleRequest,
                Map.class
            );

            Map<String, Object> result = response.getBody();
            String txHash = (String) result.get("transactionHash");
            log.info("Payment settled: {}", txHash);

        } catch (Exception e) {
            log.error("Payment settlement failed", e);
        }
    }

    private Map<String, Object> convertToV1Payload(PaymentPayload v2Payment) {
        // v2 客户端 → v1 Facilitator 协议转换
        Map<String, Object> v1Payload = new HashMap<>();
        v1Payload.put("x402Version", 1);
        v1Payload.put("scheme", "exact");
        v1Payload.put("network", "base-sepolia"); // 提取实际网络名

        Map<String, Object> payload = new HashMap<>();
        payload.put("signature", v2Payment.getPaymentPayload().getPayload().getSignature());
        payload.put("authorization", v2Payment.getPaymentPayload().getPayload().getAuthorization());
        v1Payload.put("payload", payload);

        return v1Payload;
    }

    private Map<String, Object> buildPaymentRequirements(PaymentPayload payment, String resource) {
        Map<String, Object> requirements = new HashMap<>();
        requirements.put("scheme", "exact");
        requirements.put("network", "base-sepolia");
        requirements.put("payTo", payToAddress);
        requirements.put("resource", resource);

        // 从支付中提取金额
        String amount = payment.getPaymentPayload().getPayload().getAuthorization().getValue();
        requirements.put("maxAmountRequired", amount);

        // 从支付中识别使用的 token
        String usedToken = identifyTokenFromPayment(payment);
        requirements.put("asset", usedToken);

        // extra 参数
        Map<String, Object> extra = new HashMap<>();
        extra.put("name", getTokenDomainName(usedToken));
        extra.put("version", getTokenDomainVersion(usedToken));
        extra.put("contractType", getTokenContractType(usedToken));
        extra.put("allowNegativeBalance", "DailyLedger".equals(getTokenContractType(usedToken)));
        requirements.put("extra", extra);

        return requirements;
    }
}
```

---

## 三、客户端实现（付款方）

### 1. 解析 402 响应

```java
@Service
public class X402Client {

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private Credentials credentials; // Web3j 钱包凭证

    public <T> T requestWithPayment(String url, Class<T> responseType) throws Exception {
        OkHttpClient client = new OkHttpClient();

        // 第一次请求（不带支付）
        Request request = new Request.Builder().url(url).build();
        Response response = client.newCall(request).execute();

        if (response.code() != 402) {
            // 不需要支付或其他错误
            return objectMapper.readValue(response.body().string(), responseType);
        }

        // 解析 402 响应
        PaymentRequired paymentRequired = parse402Response(response);

        // 选择支付路线（这里选择第一个）
        PaymentRoute selectedRoute = paymentRequired.getAccepts().get(0);
        System.out.println("Selected route: " + selectedRoute.getDescription());

        // 创建支付签名
        PaymentPayload payment = createPayment(selectedRoute, paymentRequired.getResourceInfo());

        // 第二次请求（带支付）
        String paymentJson = objectMapper.writeValueAsString(payment);
        Request retryRequest = new Request.Builder()
            .url(url)
            .header("PAYMENT-SIGNATURE", paymentJson)
            .build();

        Response retryResponse = client.newCall(retryRequest).execute();

        if (retryResponse.code() != 200) {
            throw new RuntimeException("Payment failed: " + retryResponse.body().string());
        }

        return objectMapper.readValue(retryResponse.body().string(), responseType);
    }

    private PaymentRequired parse402Response(Response response) throws Exception {
        // 优先从 PAYMENT-REQUIRED 头解析
        String paymentRequiredHeader = response.header("PAYMENT-REQUIRED");
        if (paymentRequiredHeader != null) {
            byte[] decoded = Base64.getDecoder().decode(paymentRequiredHeader);
            String json = new String(decoded, StandardCharsets.UTF_8);
            return objectMapper.readValue(json, PaymentRequired.class);
        }

        // 回退到响应体
        String body = response.body().string();
        JsonNode root = objectMapper.readTree(body);
        JsonNode v2Node = root.get("v2");

        if (v2Node != null) {
            return objectMapper.treeToValue(v2Node, PaymentRequired.class);
        }

        throw new RuntimeException("Invalid 402 response format");
    }
}
```

### 2. 创建 EIP-712 签名

```java
public class EIP712Signer {

    public static PaymentPayload createPayment(
            Credentials credentials,
            PaymentRoute route,
            ResourceInfo resourceInfo) throws Exception {

        String from = credentials.getAddress();
        String to = route.getPayTo();
        String value = route.getAmount();

        // 时间范围
        long validAfter = 0;
        long validBefore = System.currentTimeMillis() / 1000 + route.getTimeoutSeconds();

        // 生成随机 nonce
        byte[] nonceBytes = new byte[32];
        new SecureRandom().nextBytes(nonceBytes);
        String nonce = Numeric.toHexString(nonceBytes);

        String memo = route.getMeta().getMemo();

        // 从 route.meta 获取签名参数
        String domainName = route.getMeta().getDomainName();
        String domainVersion = route.getMeta().getDomainVersion();
        int chainId = extractChainIdFromCAIP2(route.getNetwork());
        String verifyingContract = route.getAsset();

        // EIP-712 Domain
        EIP712Domain domain = new EIP712Domain(
            domainName,
            domainVersion,
            BigInteger.valueOf(chainId),
            verifyingContract
        );

        // EIP-712 Message
        TransferWithAuthorization message = new TransferWithAuthorization(
            from,
            to,
            new BigInteger(value),
            BigInteger.valueOf(validAfter),
            BigInteger.valueOf(validBefore),
            Numeric.hexStringToByteArray(nonce),
            memo
        );

        // 签名
        String signature = signTypedData(credentials, domain, message);

        // 构建 v2 支付载荷
        PaymentPayload payment = new PaymentPayload();
        payment.setX402Version(2);

        PaymentPayloadData payloadData = new PaymentPayloadData();
        payloadData.setX402Version(2);
        payloadData.setScheme(route.getScheme());
        payloadData.setNetwork(route.getNetwork());

        PaymentPayloadContent content = new PaymentPayloadContent();

        Authorization auth = new Authorization();
        auth.setFrom(from);
        auth.setTo(to);
        auth.setValue(value);
        auth.setValidAfter(validAfter);
        auth.setValidBefore(validBefore);
        auth.setNonce(nonce);
        content.setAuthorization(auth);
        content.setSignature(signature);

        payloadData.setPayload(content);
        payment.setPaymentPayload(payloadData);
        payment.setMemo(memo);
        payment.setResource(resourceInfo.getResource());

        return payment;
    }

    private static int extractChainIdFromCAIP2(String caip2Network) {
        // "eip155:84532" -> 84532
        String[] parts = caip2Network.split(":");
        return Integer.parseInt(parts[1]);
    }

    private static String signTypedData(
            Credentials credentials,
            EIP712Domain domain,
            TransferWithAuthorization message) throws Exception {

        // 使用 Web3j 的 StructuredData 进行 EIP-712 签名
        StructuredDataEncoder encoder = new StructuredDataEncoder(
            buildEIP712Json(domain, message)
        );

        byte[] hash = encoder.hashStructuredData();
        Sign.SignatureData signature = Sign.signMessage(hash, credentials.getEcKeyPair(), false);

        // 组装签名 (r + s + v)
        byte[] r = signature.getR();
        byte[] s = signature.getS();
        byte v = signature.getV()[0];

        byte[] combined = new byte[65];
        System.arraycopy(r, 0, combined, 0, 32);
        System.arraycopy(s, 0, combined, 32, 32);
        combined[64] = v;

        return Numeric.toHexString(combined);
    }

    private static String buildEIP712Json(
            EIP712Domain domain,
            TransferWithAuthorization message) {
        // 构建 EIP-712 JSON 结构（略，参考 Web3j 文档）
        // ...
    }
}

// EIP-712 类型定义
class TransferWithAuthorization {
    private String from;
    private String to;
    private BigInteger value;
    private BigInteger validAfter;
    private BigInteger validBefore;
    private byte[] nonce;
    private String memo;

    // constructor, getters...
}

class EIP712Domain {
    private String name;
    private String version;
    private BigInteger chainId;
    private String verifyingContract;

    // constructor, getters...
}
```

---

## 四、完整请求示例

### 服务端日志（收到 402 请求）

```
📤 Request: GET /api/protected
❌ No payment signature found
📋 Returning 402 with 2 payment routes:
   1. Pay with DailyLedger (Private Chain)
      Network: eip155:1337
      Amount: 10000 (0.01 token)
   2. Pay with USDC (Base Sepolia)
      Network: eip155:84532
      Amount: 10000 (0.01 USDC)
```

### 客户端日志（接收 402 并支付）

```
📤 Requesting: http://localhost:3000/api/protected
📋 Received 402 Payment Required
📋 Available payment routes (2):
   1. Pay with DailyLedger (Private Chain)
   2. Pay with USDC (Base Sepolia)
✅ Selected route 1: Pay with DailyLedger (Private Chain)
🔐 Creating EIP-712 signature...
   Domain: DailyLedger v1 (chainId: 1337)
   Contract: 0x9ab7CA8a88F8e351f9b0eEEA5777929210199295
   From: 0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73
   To: 0x0CBdDc750fB3a1A5CD38EA6d0786408f4251f880
   Value: 10000
✅ Signature created
📤 Retrying with payment signature...
✅ Access granted (200 OK)
```

### 服务端日志（验证支付）

```
📥 Received payment signature
🔍 Verifying with Facilitator: http://localhost:8080/verify
✅ Payment verified: isValid=true, payer=0xFE3B...
⚡ Settling payment asynchronously...
✅ Payment settled: tx=0x89f7fac4fc854cfec9c920de54ba88bb567cc5f9...
🔗 Explorer: http://220.154.132.194:3001/tx/0x89f7fac4...
```

---

## 五、关键要点

### 1. 多 Token 支持

- 在 402 响应的 `accepts` 数组中返回多条路线
- 每条路线包含独立的签名参数（`route.meta`）
- 客户端根据选择的路线使用对应的参数创建签名

### 2. 协议转换

- 客户端 ↔ 服务端：使用 v2 协议
- 服务端 ↔ Facilitator：使用 v1 协议（服务端负责转换）
- Facilitator 不感知 v2 协议

### 3. CAIP-2 网络标识

- 格式：`eip155:{chainId}`
- 示例：`eip155:84532` (Base Sepolia), `eip155:1337` (私链)
- 提取 chainId：`Integer.parseInt(caip2.split(":")[1])`

### 4. EIP-712 签名参数

必须使用 `route.meta` 中的参数：
- `domainName`：合约的域名（如 "USD Coin"）
- `domainVersion`：域版本（如 "2"）
- `chainId`：从 CAIP-2 提取
- `verifyingContract`：`route.asset` 地址

### 5. 金额单位

- 配置文件中：小数形式（如 `0.01`）
- 支付签名中：最小单位整数（如 `10000` = 0.01 × 10^6）
- USDC decimals = 6

---

## 六、测试

### 测试网络配置

**Base Sepolia 测试网**：
- RPC: `https://sepolia.base.org`
- Chain ID: `84532`
- USDC: `0x036cbd53842c5426634e7929541ec2318f3dcf7e`
- 浏览器: `https://sepolia.basescan.org`

**领取测试资产**：
- ETH: https://www.alchemy.com/faucets/base-sepolia
- USDC: https://faucet.circle.com/

### 本地测试流程

1. 启动 Facilitator（可选，或使用公共服务）
2. 启动您的 Java 服务（配置好 token 地址）
3. 使用客户端代码请求受保护资源
4. 查看日志确认支付流程
5. 在区块浏览器查看链上交易

---

## 七、生产环境注意事项

1. **安全性**
   - 使用 HTTPS
   - 私钥使用 KMS 或硬件钱包管理
   - 实现速率限制和防重放攻击

2. **可靠性**
   - 数据库记录所有支付交易
   - 实现支付状态查询接口
   - 处理 Facilitator 超时和重试

3. **监控**
   - 监控支付成功率
   - 监控 Facilitator 可用性
   - 记录失败原因和异常

4. **合规**
   - 了解所在地区的支付相关法律法规
   - 实现必要的 KYC/AML 流程（如需要）

---

## 参考资源

- **x402 协议规范**: https://github.com/coinbase/x402
- **EIP-712 标准**: https://eips.ethereum.org/EIPS/eip-712
- **EIP-3009 标准**: https://eips.ethereum.org/EIPS/eip-3009
- **Web3j 文档**: https://docs.web3j.io/
- **CAIP-2 规范**: https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md

---

**文档版本**: 1.0
**协议版本**: x402 v2
**更新日期**: 2025-12-24
