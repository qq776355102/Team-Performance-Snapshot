
import { InviteData, StakingData } from '../types';

const PRECISION = 9;

export const formatStaking = (raw: string | number): number => {
  const val = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(raw));
  return Number(val) / Math.pow(10, PRECISION);
};

// 获取地址等级 Level
export const fetchLevel = async (address: string): Promise<string> => {
  try {
    const res = await fetch(`https://apiv2.ocros.io/api/v1/community/${address}`, {
      method: "POST",
      headers: {
        "accept": "*/*",
        "Referer": "https://origindefi.io/",
      }
    });
    const data = await res.json();
    return data.level || 'Unknown';
  } catch (error) {
    console.error("Fetch level error:", error);
    return 'Error';
  }
};

export const fetchInviteData = async (address: string): Promise<InviteData> => {
  const url = `https://apiv2.ocros.io/api/v1/communities/getInviteData?address=${address}&level=undefined`;
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "Referer": "https://origindefi.io/",
    }
  });
  return res.json();
};

export const fetchStakingStatus = async (address: string): Promise<StakingData> => {
  const res = await fetch(`https://api.ocros.io/v1/api/comm/queryStakingStatus?member=${address}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Referer": "https://origindefi.io/",
    }
  });
  return res.json();
};

export const fetchReferrer = async (address: string): Promise<string | null> => {
  const addressParam = address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = "0x08ae4b0c" + addressParam;

  try {
    const res = await fetch("https://greatest-powerful-feather.matic.quiknode.pro/d05012eaa00b33a3aa3e8e7981b2d658f4281815/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Referer": "https://origindefi.io/",
      },
      body: JSON.stringify({
        "method": "eth_call",
        "params": [
          {
            "to": "0x6757165973042541ebdec47b73283397b5afd90e",
            "data": data
          },
          "latest"
        ],
        "id": 44,
        "jsonrpc": "2.0"
      })
    });
    
    const resData = await res.json();
    const result = resData.result;
    if (result && result !== '0x') {
      const hex = result.startsWith("0x") ? result.slice(2) : result;
      if (hex.length < 128) return null;
      const referrerHex = hex.slice(64, 128);
      const referrer = '0x' + referrerHex.slice(24);
      const zeroAddr = '0x' + '0'.repeat(40);
      if (referrer.toLowerCase() === zeroAddr) return null;
      return '0x' + referrer.slice(2).toLowerCase();
    }
  } catch (error) {
    console.error("Referrer fetch error:", error);
  }
  return null;
};

export const fetchFullChain = async (
  address: string, 
  cache: Map<string, string | null> = new Map()
): Promise<string[]> => {
  const chain: string[] = [];
  let current: string | null = address.toLowerCase();
  const maxDepth = 100;

  while (current && chain.length < maxDepth) {
    let next: string | null;
    if (cache.has(current)) {
      next = cache.get(current)!;
    } else {
      next = await fetchReferrer(current);
      cache.set(current, next);
    }
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
};
