const { ethers } = require('ethers');

/**
 * EIP-712 签名工具
 * 用于创建 transferWithAuthorization 签名
 */
class SignatureUtils {
  /**
   * 创建 EIP-712 类型化数据签名
   * @param {Object} params - 签名参数
   * @returns {Object} - 包含签名的完整支付数据
   */
  static async createTransferWithAuthorizationSignature(params) {
    const {
      wallet,
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      memo,
      domainName,
      domainVersion,
      chainId,
      verifyingContract
    } = params;

    // 定义 EIP-712 域
    const domain = {
      name: domainName,  // 应该是 "USDC"
      version: domainVersion,  // 应该是 "2"
      chainId: chainId,
      verifyingContract: verifyingContract
    };

    // 定义类型
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
        { name: 'memo', type: 'string' }
      ]
    };

    // 定义消息
    const message = {
      from: from,
      to: to,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      memo: memo
    };

    // 签名（兼容 ethers v5 和 v6）
    let signature;
    if (wallet._signTypedData) {
      // ethers v5
      signature = await wallet._signTypedData(domain, types, message);
    } else {
      // ethers v6
      signature = await wallet.signTypedData(domain, types, message);
    }

    // 拆分签名（兼容 ethers v5 和 v6）
    let sig;
    if (ethers.utils && ethers.utils.splitSignature) {
      // ethers v5
      sig = ethers.utils.splitSignature(signature);
    } else {
      // ethers v6
      sig = ethers.Signature.from(signature);
    }

    console.log('signature:', signature);
    console.log('sig.v:', sig.v);
    console.log('sig.r:', sig.r);
    console.log('sig.s:', sig.s);
    return {
      from: from,
      to: to,
      value: value,
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      memo: memo,
      v: sig.v,
      r: sig.r,
      s: sig.s
    };
  }

  /**
   * 生成随机 nonce (基于时间戳的 bytes32)
   */
  static generateNonce() {
    const timestamp = Math.floor(Date.now() / 1000);
    // 兼容 ethers v5 和 v6
    if (ethers.utils && ethers.utils.hexZeroPad) {
      // ethers v5
      return ethers.utils.hexZeroPad(ethers.utils.hexlify(timestamp), 32);
    } else {
      // ethers v6
      return ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
    }
  }
}

module.exports = SignatureUtils;
