require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const SignatureUtils = require('./utils/signature');

/**
 * x402 客户端
 * 模拟买家发起支付和访问受保护的 API
 */
class X402Client {
  constructor(config) {
    this.serverUrl = config.serverUrl;
    this.network = config.network;
    this.privateKey = config.privateKey;

    // 创建钱包
    this.wallet = new ethers.Wallet(this.privateKey);
    this.address = this.wallet.address;

    // 获取网络配置
    this.networkConfig = SignatureUtils.getNetworkConfig(this.network);

    console.log('🔐 Client initialized');
    console.log(`   Address: ${this.address}`);
    console.log(`   Network: ${this.network}`);
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
        console.log('Payment Information:');
        console.log(`   Amount: ${paymentInfo.amount} ${paymentInfo.currency}`);
        console.log(`   Pay to: ${paymentInfo.payTo}`);
        console.log(`   Network: ${paymentInfo.network}`);
        console.log(`   Facilitator: ${paymentInfo.facilitator}\n`);

        // 步骤 3: 创建支付签名
        console.log('✍️  Step 3: Creating payment signature...\n');
        const payment = await this.createPayment(paymentInfo);

        // 步骤 4: 使用支付凭证重新请求
        console.log('📤 Step 4: Sending request with payment proof...\n');
        const paidResponse = await this.makeRequest(endpoint, method, data, payment);

        if (paidResponse.status === 200) {
          console.log('✅ Success! Access granted with payment.\n');
          console.log('Response:', JSON.stringify(paidResponse.data, null, 2));
          console.log(`\n💸 Payment will be settled on-chain by the facilitator.`);
          console.log(`   You can check the transaction on: ${this.networkConfig.explorerUrl}\n`);
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

    // 如果有支付凭证，添加到请求头
    if (payment) {
      headers['X-Payment'] = JSON.stringify(payment);
    }

    const config = {
      method,
      url,
      headers
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    return await axios(config);
  }

  /**
   * 解析支付要求
   */
  parsePaymentRequirement(response) {
    const acceptPaymentHeader = response.headers['x-accept-payment'];
    const body = response.data;

    if (!acceptPaymentHeader && !body.payment) {
      throw new Error('No payment information found in 402 response');
    }

    // 从响应体解析（更简单）
    if (body.payment) {
      return {
        amount: body.payment.amount,
        currency: body.payment.currency,
        network: body.payment.network,
        payTo: body.payment.payTo,
        facilitator: body.payment.facilitator,
        resource: response.config.url.replace(this.serverUrl, '')
      };
    }

    // 从 header 解析
    const parts = acceptPaymentHeader.split('; ');
    const info = {};

    parts.forEach(part => {
      const match = part.match(/(\w+)="([^"]+)"/);
      if (match) {
        info[match[1]] = match[2];
      }
    });

    return {
      amount: parseFloat(info.amount) / 1000000, // Convert from USDC base units
      currency: info.currencies?.split(':')[0] || 'USDC',
      network: info.networks,
      payTo: info.payTo,
      facilitator: info.facilitators,
      resource: info.resource
    };
  }

  /**
   * 创建支付签名
   */
  async createPayment(paymentInfo) {
    // 计算金额（USDC 6位小数）
    const value = Math.floor(paymentInfo.amount * 1000000).toString();

    // 生成 nonce
    const nonce = SignatureUtils.generateNonce();

    // 计算有效期（1小时）
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 3600;

    console.log('Signature parameters:');
    console.log(`   From: ${this.address}`);
    console.log(`   To: ${paymentInfo.payTo}`);
    console.log(`   Value: ${value} (${paymentInfo.amount} USDC)`);
    console.log(`   Valid until: ${new Date(validBefore * 1000).toISOString()}`);
    console.log(`   Nonce: ${nonce}\n`);

    // 创建签名
    const signatureData = await SignatureUtils.createTransferWithAuthorizationSignature({
      wallet: this.wallet,
      from: this.address,
      to: paymentInfo.payTo,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      domainName: this.networkConfig.domainName,
      domainVersion: this.networkConfig.domainVersion,
      chainId: this.networkConfig.chainId,
      verifyingContract: this.networkConfig.usdcAddress
    });

    console.log('✅ Signature created successfully');
    console.log('   v:', signatureData.v);
    console.log('   r:', signatureData.r);
    console.log('   s:', signatureData.s);
    console.log('');

    // 构造完整的支付数据
    return {
      x402Version: 1,
      scheme: 'exact',
      network: this.network,
      payment: signatureData,
      resource: paymentInfo.resource
    };
  }

  /**
   * 检查服务器健康状态
   */
  async checkHealth() {
    try {
      console.log('🏥 Checking server health...\n');
      const response = await axios.get(`${this.serverUrl}/health`);
      console.log('Server Status:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      throw error;
    }
  }
}

// ============================================================================
// 主程序
// ============================================================================

async function main() {
  // 检查必需的环境变量
  if (!process.env.CLIENT_PRIVATE_KEY) {
    console.error('❌ Error: CLIENT_PRIVATE_KEY is not set in .env file');
    process.exit(1);
  }

  // 初始化客户端
  const client = new X402Client({
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    network: process.env.NETWORK || 'base-sepolia',
    privateKey: process.env.CLIENT_PRIVATE_KEY
  });

  try {
    // 检查服务器健康状态
    await client.checkHealth();

    console.log('\n');

    // 解析命令行参数
    const command = process.argv[2] || 'protected';

    if (command === 'chat') {
      const message = process.argv[3] || 'Hello AI!';
      await client.requestProtectedResource('/api/chat', 'POST', { message });
    } else if (command === 'protected') {
      await client.requestProtectedResource('/api/protected', 'GET');
    } else {
      console.log('Usage:');
      console.log('  npm test                     - Test /api/protected endpoint');
      console.log('  npm run test:chat            - Test /api/chat endpoint');
      console.log('  node client.js protected     - Test /api/protected endpoint');
      console.log('  node client.js chat "Hello!" - Test /api/chat endpoint with message');
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
