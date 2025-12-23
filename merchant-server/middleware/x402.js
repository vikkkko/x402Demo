const axios = require('axios');

/**
 * x402 v2 支付中间件 (多 Token 版本)
 * 实现 HTTP 402 Payment Required v2 协议
 */
class X402Middleware {
  constructor(config) {
    this.facilitatorUrl = config.facilitatorUrl;
    this.payToAddress = config.payToAddress;
    this.pricePerRequest = config.pricePerRequest;
    this.supportedTokens = config.supportedTokens || [];
    this.scheme = 'exact';

    if (this.supportedTokens.length === 0) {
      throw new Error('No tokens configured in X402Middleware');
    }
  }

  /**
   * Express 中间件函数 (v2 多 Token)
   */
  middleware() {
    return async (req, res, next) => {
      const resource = `${req.protocol}://${req.get('host')}${req.originalUrl || req.path}`;

      // 检查 v2 支付凭证头
      const paymentSignatureHeader = req.headers['payment-signature'];

      if (!paymentSignatureHeader) {
        // 没有支付凭证，返回 402 Payment Required
        return this.sendPaymentRequired(req, res, resource);
      }

      // 解析支付凭证
      let payment;
      try {
        payment = typeof paymentSignatureHeader === 'string'
          ? JSON.parse(paymentSignatureHeader)
          : paymentSignatureHeader;
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid payment signature format',
          message: error.message
        });
      }

      // 验证支付
      try {
        const isValid = await this.verifyPayment(payment, resource);

        if (!isValid) {
          return res.status(402).json({
            error: 'Payment verification failed',
            message: 'The payment signature is invalid or has been used'
          });
        }

        // 支付有效，异步结算并继续处理请求
        this.settlePayment(payment, resource).catch(err => {
          console.error('Settlement failed:', err);
        });

        // 将支付信息附加到请求对象
        req.x402Payment = payment;

        next();
      } catch (error) {
        console.error('Payment verification error:', error);
        return res.status(500).json({
          error: 'Payment verification error',
          message: error.message
        });
      }
    };
  }

  /**
   * 发送 402 Payment Required v2 响应
   */
  sendPaymentRequired(req, res, resource) {
    const amount = Math.floor(this.pricePerRequest * 1000000).toString();
    const memo = resource || req.path;

    // v2 resourceInfo
    const resourceInfo = {
      resource: resource,
      mimeType: 'application/json',
      method: req.method
    };

    // v2 accepts 数组：为每种 token 创建一条路线
    const accepts = this.supportedTokens.map((token) => {
      const caip2Network = `eip155:${token.chainId}`;
      return {
        scheme: this.scheme,
        network: caip2Network,
        asset: token.address,
        amount: token.amount || amount,
        payTo: this.payToAddress,
        description: token.description,
        timeoutSeconds: 120,
        meta: {
          domainName: token.domainName,
          domainVersion: token.domainVersion,
          contractType: token.contractType,
          explorerUrl: token.explorerUrl,
          memo: memo
        }
      };
    });

    // 收集所有支持的网络
    const supportedNetworks = accepts.map(route => route.network);

    // v2 PAYMENT-REQUIRED 头内容
    const paymentRequired = {
      version: 2,
      resourceInfo: resourceInfo,
      accepts: accepts,
      facilitators: [
        {
          url: this.facilitatorUrl,
          networks: supportedNetworks
        }
      ]
    };

    // Base64 编码
    const paymentRequiredBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');

    // 构建 contractMetadata（取第一个 token 作为默认值）
    const firstRoute = accepts[0];
    const firstToken = this.supportedTokens[0];
    const contractMetadata = {
      domainName: firstRoute.meta.domainName,
      domainVersion: firstRoute.meta.domainVersion,
      chainId: firstToken.chainId,
      verifyingContract: firstRoute.asset,
      contractType: firstRoute.meta.contractType,
      explorerUrl: firstRoute.meta.explorerUrl,
      caip2Network: firstRoute.network
    };

    // v2 响应体
    const responseBody = {
      error: 'Payment Required',
      message: 'This endpoint requires payment',
      v2: {
        version: 2,
        resourceInfo: resourceInfo,
        accepts: accepts
      },
      contractMetadata: contractMetadata
    };

    res.status(402)
      .header('PAYMENT-REQUIRED', paymentRequiredBase64)
      .json(responseBody);
  }

  /**
   * 验证支付签名 (v2)
   */
  async verifyPayment(payment, resource) {
    try {
      console.log('Received v2 payment');

      // 提取 v2 支付载荷
      const paymentData = payment.paymentPayload?.payload || {};
      const authData = paymentData.authorization || {};

      const memo = payment.memo || authData.memo || resource;
      const signature = paymentData.signature;

      if (!signature || !authData.from) {
        throw new Error('Invalid payment structure: missing signature or from address');
      }

      // 从客户端支付中提取使用的 token 信息
      // 通过 verifyingContract 地址匹配到对应的 token
      const usedToken = this.supportedTokens.find(t =>
        payment.paymentPayload?.network?.includes(t.chainId.toString())
      ) || this.supportedTokens[0];

      // 向 Facilitator 发送 v1 格式（Facilitator 目前只支持 v1）
      const verifyPayload = {
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: this.scheme,
          network: `base-sepolia`, // Facilitator 需要原始网络名
          payload: {
            signature: signature,
            authorization: {
              from: authData.from,
              to: this.payToAddress,
              value: authData.value,
              validAfter: authData.validAfter.toString(),
              validBefore: authData.validBefore.toString(),
              nonce: authData.nonce,
              memo: memo
            }
          }
        },
        paymentRequirements: {
          scheme: this.scheme,
          network: `base-sepolia`,
          maxAmountRequired: authData.value,
          resource: resource,
          description: "payment",
          mimeType: "application/json",
          maxTimeoutSeconds: 60,
          payTo: this.payToAddress,
          asset: usedToken.address,
          extra: {
            name: usedToken.domainName,
            version: usedToken.domainVersion,
            contractType: usedToken.contractType,
            allowNegativeBalance: usedToken.contractType === 'DailyLedger' ? true : false
          }
        }
      };

      console.log('Verifying payment with facilitator:', this.facilitatorUrl);

      const response = await axios.post(
        `${this.facilitatorUrl}/verify`,
        verifyPayload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('Verification response:', response.data);
      return response.data.isValid === true || response.data.valid === true;
    } catch (error) {
      console.error('Verification request failed:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * 结算支付到链上 (v2)
   */
  async settlePayment(payment, resource) {
    try {
      const paymentData = payment.paymentPayload?.payload || {};
      const authData = paymentData.authorization || {};

      const memo = payment.memo || authData.memo || resource;
      const signature = paymentData.signature;

      // 从客户端支付中提取使用的 token 信息
      const usedToken = this.supportedTokens.find(t =>
        payment.paymentPayload?.network?.includes(t.chainId.toString())
      ) || this.supportedTokens[0];

      // 向 Facilitator 发送 v1 格式
      const settlePayload = {
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: this.scheme,
          network: `base-sepolia`,
          payload: {
            signature: signature,
            authorization: {
              from: authData.from,
              to: this.payToAddress,
              value: authData.value,
              validAfter: authData.validAfter.toString(),
              validBefore: authData.validBefore.toString(),
              nonce: authData.nonce,
              memo: memo
            }
          }
        },
        paymentRequirements: {
          scheme: this.scheme,
          network: `base-sepolia`,
          maxAmountRequired: authData.value,
          resource: resource,
          description: "payment",
          mimeType: "application/json",
          payTo: this.payToAddress,
          maxTimeoutSeconds: 60,
          asset: usedToken.address,
          extra: {
            name: usedToken.domainName,
            version: usedToken.domainVersion,
            contractType: usedToken.contractType,
            allowNegativeBalance: usedToken.contractType === 'DailyLedger' ? true : false
          }
        }
      };

      console.log('Settling payment with facilitator:', this.facilitatorUrl);

      const response = await axios.post(
        `${this.facilitatorUrl}/settle`,
        settlePayload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('Settlement response:', response.data);
      const txHash = response.data.transactionHash || response.data.transaction;
      if (txHash) {
        console.log(`Transaction hash: ${txHash}`);
        console.log(`View on explorer: ${usedToken.explorerUrl}/tx/${txHash}`);
      }

      return response.data;
    } catch (error) {
      console.error('Settlement request failed:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * 查询 Facilitator 支持的能力
   */
  async getSupportedSchemes() {
    try {
      const response = await axios.get(`${this.facilitatorUrl}/supported`);
      return response.data;
    } catch (error) {
      console.error('Failed to get supported schemes:', error.message);
      throw error;
    }
  }
}

module.exports = X402Middleware;
