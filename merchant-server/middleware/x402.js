const axios = require('axios');

/**
 * x402 支付中间件
 * 实现 HTTP 402 Payment Required 协议
 */
class X402Middleware {
  constructor(config) {
    this.facilitatorUrl = config.facilitatorUrl;
    this.network = config.network;
    this.payToAddress = config.payToAddress;
    this.pricePerRequest = config.pricePerRequest;
    this.currency = config.currency || 'USDC';
    this.currencyAddress = config.currencyAddress;
    this.scheme = config.scheme || 'exact';
  }

  /**
   * Express 中间件函数
   */
  middleware() {
    return async (req, res, next) => {
      // 检查请求头中是否包含支付凭证
      const paymentHeader = req.headers['x-payment'];

      if (!paymentHeader) {
        // 没有支付凭证，返回 402 Payment Required
        return this.sendPaymentRequired(req, res);
      }

      // 解析支付凭证
      let payment;
      try {
        payment = typeof paymentHeader === 'string'
          ? JSON.parse(paymentHeader)
          : paymentHeader;
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid payment header format',
          message: error.message
        });
      }
      
      // 验证支付 "http://localhost:3000/api/protected",// 
      try {
        const resource = "http://localhost:3000/api/protected";// req.path;
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
          // 结算失败不影响当前请求，但应该记录日志
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
   * 发送 402 Payment Required 响应
   */
  sendPaymentRequired(req, res) {
    const amount = Math.floor(this.pricePerRequest * 1000000);

    // 构造 X-Accept-Payment 头
    const acceptPaymentHeader = [
      '1 x402',
      `facilitators="${this.facilitatorUrl}"`,
      `schemes="${this.scheme}"`,
      `networks="${this.network}"`,
      `currencies="${this.currency}:${this.currencyAddress}"`,
      `amount="${amount}"`,
      `resource="${req.path}"`,
      `payTo="${this.payToAddress}"`
    ].join('; ');

    res.status(402)
      .header('X-Accept-Payment', acceptPaymentHeader)
      .json({
        error: 'Payment Required',
        message: 'This endpoint requires payment',
        payment: {
          amount: this.pricePerRequest,
          currency: this.currency,
          network: this.network,
          payTo: this.payToAddress,
          facilitator: this.facilitatorUrl
        }
      });
  }

  /**
   * 验证支付签名
   */
  async verifyPayment(payment, resource) {
    try {
      console.log('Received payment.payment.v:', payment.payment.v, 'type:', typeof payment.payment.v);

      const verifyPayload = {
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: payment.scheme || this.scheme,
          network: payment.network || this.network,
          payload: {
            signature: `${payment.payment.r}${payment.payment.s.slice(2)}${payment.payment.v.toString(16).padStart(2, '0')}`,
            authorization: {
              from: payment.payment.from,
              to: payment.payment.to,
              value: payment.payment.value,
              validAfter: payment.payment.validAfter.toString(),
              validBefore: payment.payment.validBefore.toString(),
              nonce: payment.payment.nonce
            }
          }
        },
        paymentRequirements: {
          scheme: payment.scheme || this.scheme,
          network: payment.network || this.network,
          maxAmountRequired: payment.payment.value,
          resource: resource,
          description:"test",
          mimeType: "application/json",
          maxTimeoutSeconds: 60,
          // recipient: this.payToAddress,
          payTo: payment.payment.to,
          asset: this.currencyAddress,
          extra: {
            name: 'YZF Token',
            version: '1'
          }
        }
      };

      console.log('Verifying payment with facilitator:', this.facilitatorUrl);
      console.log('Payload:', JSON.stringify(verifyPayload, null, 2));

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
   * 结算支付到链上
   */
  async settlePayment(payment, resource) {
    try {
      const settlePayload = {
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: payment.scheme || this.scheme,
          network: payment.network || this.network,
          payload: {
            signature: `${payment.payment.r}${payment.payment.s.slice(2)}${payment.payment.v.toString(16).padStart(2, '0')}`,
            authorization: {
              from: payment.payment.from,
              to: payment.payment.to,
              value: payment.payment.value,
              validAfter: payment.payment.validAfter.toString(),
              validBefore: payment.payment.validBefore.toString(),
              nonce: payment.payment.nonce
            }
          }
        },
        paymentRequirements: {
          scheme: payment.scheme || this.scheme,
          network: payment.network || this.network,
          maxAmountRequired: payment.payment.value,
          resource: resource,
          description: "test",
          mimeType: "application/json",
          payTo: payment.payment.to,
          maxTimeoutSeconds : 60,
          // recipient: this.payToAddress,
          // resource: payment.resource,
          asset: this.currencyAddress,
          extra: {
            name: 'YZF Token',
            version: '1'
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
      console.log(`Transaction hash: ${response.data.transactionHash}`);
      console.log(`View on explorer: https://sepolia.basescan.org/tx/${response.data.transactionHash}`);

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
