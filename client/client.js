require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const SignatureUtils = require('./utils/signature');

/**
 * x402 v2 客户端 (多 Token 版本)
 */
class X402Client {
  constructor(config) {
    this.serverUrl = config.serverUrl;
    this.privateKey = config.privateKey;

    // 创建钱包
    this.wallet = new ethers.Wallet(this.privateKey);
    this.address = this.wallet.address;

    console.log('🔐 Client initialized (v2)');
    console.log(`   Address: ${this.address}`);
  }

  /**
   * 请求受保护的资源
   */
  async requestProtectedResource(endpoint, method = 'GET', data = null) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Requesting: ${method} ${endpoint}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // 步骤 1: 发起初始请求（不带支付）
      console.log('📤 Step 1: Sending initial request without payment...\n');
      const initialResponse = await this.makeRequest(endpoint, method, data);

      if (initialResponse.status === 200) {
        console.log('✅ Success! Resource is free or payment already made.\n');
        console.log('Response:', JSON.stringify(initialResponse.data, null, 2));
        return initialResponse.data;
      }
    } catch (error) {
      if (error.response && error.response.status === 402) {
        console.log('💰 Step 2: Payment Required (402 response received)\n');

        // 解析支付要求
        const paymentInfo = this.parsePaymentRequirement(error.response);

        console.log('✍️  Step 3: Creating payment signature...\n');

        // 创建支付签名
        const payment = await this.createPayment(paymentInfo);

        // 步骤 4: 使用支付凭证重新请求
        console.log('📤 Step 4: Sending request with payment proof...\n');
        const paidResponse = await this.makeRequest(endpoint, method, data, payment);

        if (paidResponse.status === 200) {
          console.log('✅ Success! Access granted with payment.\n');
          console.log('Response:', JSON.stringify(paidResponse.data, null, 2));
          console.log(`\n💸 Payment will be settled on-chain by the facilitator.\n`);
          return paidResponse.data;
        }
      } else {
        console.error('❌ Error:', error.message);
        if (error.response) {
          console.error('Response:', error.response.data);
        }
        throw error;
      }
    }
  }

  /**
   * 发起 HTTP 请求
   */
  async makeRequest(endpoint, method, data, payment = null) {
    const url = `${this.serverUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json'
    };

    // v2: 使用 PAYMENT-SIGNATURE 头
    if (payment) {
      headers['PAYMENT-SIGNATURE'] = JSON.stringify(payment);
    }

    const config = {
      method,
      url,
      headers,
      maxRedirects: 0
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    return await axios(config);
  }

  /**
   * 解析 v2 支付要求
   */
  parsePaymentRequirement(response) {
    const paymentRequiredHeader = response.headers['payment-required'];
    const body = response.data;

    if (!paymentRequiredHeader) {
      throw new Error('No PAYMENT-REQUIRED header found in 402 response');
    }

    // v2: 解码 Base64 头
    const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8');
    const v2Data = JSON.parse(decoded);

    if (v2Data.version !== 2 || !v2Data.accepts || v2Data.accepts.length === 0) {
      throw new Error('Invalid v2 payment requirement format');
    }

    return {
      resourceInfo: v2Data.resourceInfo,
      accepts: v2Data.accepts,
      facilitators: v2Data.facilitators,
      contractMetadata: body.contractMetadata
    };
  }

  /**
   * 创建 v2 支付签名
   */
  async createPayment(paymentInfo) {
    const metadata = paymentInfo.contractMetadata;

    if (!metadata) {
      throw new Error('Contract metadata not provided by server');
    }

    // 显示可用的支付路线
    console.log(`📋 Available payment routes (${paymentInfo.accepts.length}):`);
    paymentInfo.accepts.forEach((route, index) => {
      console.log(`   ${index + 1}. ${route.description || 'Route ' + (index + 1)}`);
      console.log(`      Network: ${route.network}`);
      console.log(`      Asset: ${route.asset}`);
      console.log(`      Amount: ${route.amount} (${parseFloat(route.amount) / 1000000} USDC)`);
      console.log(`      Pay to: ${route.payTo}`);
    });

    // 选择第一个路线（可以扩展为用户选择）
    const selectedRoute = paymentInfo.accepts[0];
    console.log(`\n✅ Selected route 1: ${selectedRoute.description}\n`);

    return await this.createPaymentV2(selectedRoute, paymentInfo.resourceInfo);
  }

  /**
   * 创建 v2 支付签名
   */
  async createPaymentV2(route, resourceInfo) {
    // 生成 nonce
    const nonce = SignatureUtils.generateNonce();

    // 计算有效期
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + (route.timeoutSeconds || 3600);

    const memo = route.meta?.memo || resourceInfo.resource || 'x402-payment-v2';

    // 使用 route.meta 中的签名参数
    const signingParams = {
      domainName: route.meta.domainName,
      domainVersion: route.meta.domainVersion,
      contractType: route.meta.contractType,
      chainId: this.extractChainIdFromCAIP2(route.network),
      verifyingContract: route.asset
    };

    console.log('Signature parameters (v2):');
    console.log(`   From: ${this.address}`);
    console.log(`   To: ${route.payTo}`);
    console.log(`   Value: ${route.amount}`);
    console.log(`   Memo: ${memo}`);
    console.log(`   Valid until: ${new Date(validBefore * 1000).toISOString()}`);
    console.log(`   Nonce: ${nonce}`);
    console.log(`   Network: ${route.network} (CAIP-2)`);
    console.log(`   Contract: ${signingParams.contractType} (${signingParams.verifyingContract})`);
    console.log(`   Domain: ${signingParams.domainName} v${signingParams.domainVersion}\n`);

    // 创建签名
    const signatureData = await SignatureUtils.createTransferWithAuthorizationSignature({
      wallet: this.wallet,
      from: this.address,
      to: route.payTo,
      value: route.amount,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      memo: memo,
      domainName: signingParams.domainName,
      domainVersion: signingParams.domainVersion,
      chainId: signingParams.chainId,
      verifyingContract: signingParams.verifyingContract
    });

    console.log('✅ Signature created successfully (v2)');
    console.log('   v:', signatureData.v);
    console.log('   r:', signatureData.r);
    console.log('   s:', signatureData.s);
    console.log('');

    // 构造 v2 支付载荷
    return {
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        scheme: route.scheme,
        network: route.network,
        payload: {
          authorization: {
            from: signatureData.from,
            to: signatureData.to,
            value: signatureData.value,
            validAfter: signatureData.validAfter,
            validBefore: signatureData.validBefore,
            nonce: signatureData.nonce
          },
          signature: `${signatureData.r}${signatureData.s.slice(2)}${signatureData.v.toString(16).padStart(2, '0')}`
        }
      },
      memo: memo,
      resource: resourceInfo.resource
    };
  }

  /**
   * 从 CAIP-2 格式提取 chainId
   */
  extractChainIdFromCAIP2(caip2Network) {
    if (!caip2Network || typeof caip2Network !== 'string') {
      return null;
    }

    const parts = caip2Network.split(':');
    if (parts.length === 2 && parts[0] === 'eip155') {
      return parseInt(parts[1]);
    }

    return null;
  }
}

// 主程序入口
async function main() {
  const command = process.argv[2];
  const message = process.argv[3];

  // 初始化客户端
  const client = new X402Client({
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    privateKey: process.env.CLIENT_PRIVATE_KEY
  });

  try {
    if (command === 'chat') {
      // 测试聊天端点
      await client.requestProtectedResource('/api/chat', 'POST', { message });
    } else if (command === 'protected') {
      // 测试受保护端点
      await client.requestProtectedResource('/api/protected', 'GET');
    } else {
      // 默认测试受保护端点
      await client.requestProtectedResource('/api/protected', 'GET');
    }

    console.log('\n✨ Test completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// 运行主程序
if (require.main === module) {
  main();
}

module.exports = X402Client;
