
import { createClient } from '@supabase/supabase-js';

// 从环境变量读取配置
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PRECISION = 9;

// --- 基础 API 函数 (移植自 apiService.ts) ---

const formatStaking = (raw: string | number): number => {
  const val = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(Number(raw)));
  return Number(val) / Math.pow(10, PRECISION);
};

const fetchLevel = async (address: string) => {
  const res = await fetch(`https://apiv2.ocros.io/api/v1/community/${address}`, {
    method: "POST",
    headers: { "accept": "*/*", "Referer": "https://origindefi.io/" }
  });
  const data: any = await res.json();
  return data.level || 'Unknown';
};

const fetchInviteData = async (address: string) => {
  const res = await fetch(`https://apiv2.ocros.io/api/v1/communities/getInviteData?address=${address}&level=undefined`, {
    headers: { "accept": "application/json", "Referer": "https://origindefi.io/" }
  });
  return res.json();
};

const fetchStakingStatus = async (address: string) => {
  const res = await fetch(`https://api.ocros.io/v1/api/comm/queryStakingStatus?member=${address}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Referer": "https://origindefi.io/" }
  });
  return res.json();
};

const fetchReferrer = async (address: string): Promise<string | null> => {
  const addressParam = address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const data = "0x08ae4b0c" + addressParam;
  try {
    const res = await fetch("https://greatest-powerful-feather.matic.quiknode.pro/d05012eaa00b33a3aa3e8e7981b2d658f4281815/", {
      method: "POST",
      headers: { "content-type": "application/json", "Referer": "https://origindefi.io/" },
      body: JSON.stringify({
        "method": "eth_call",
        "params": [{ "to": "0x6757165973042541ebdec47b73283397b5afd90e", "data": data }, "latest"],
        "id": 44, "jsonrpc": "2.0"
      })
    });
    const resData: any = await res.json();
    if (resData.result && resData.result !== '0x') {
      const hex = resData.result.slice(2);
      if (hex.length < 128) return null;
      const referrer = '0x' + hex.slice(64, 128).slice(24);
      if (referrer === '0x' + '0'.repeat(40)) return null;
      return referrer.toLowerCase();
    }
  } catch (e) {}
  return null;
};

const fetchFullChain = async (address: string, cache: Map<string, string | null>) => {
  const chain: string[] = [];
  let current: string | null = address.toLowerCase();
  while (current && chain.length < 100) {
    let next = cache.has(current) ? cache.get(current)! : await fetchReferrer(current);
    cache.set(current, next);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
};

// --- 同步任务主逻辑 ---

async function runSync() {
  console.log('🚀 开始执行每日同步任务...');
  
  // 1. 获取所有待追踪地址
  const { data: dbAddresses, error: dbError } = await supabase.from('tracked_addresses').select('*');
  if (dbError || !dbAddresses) throw new Error('读取地址列表失败');
  
  console.log(`📊 共有 ${dbAddresses.length} 个地址待同步`);

  const today = new Date().toISOString().split('T')[0];
  const referralCache = new Map<string, string | null>();

  // 2. 抓取原始数据
  const rawData = await Promise.all(dbAddresses.map(async (item) => {
    console.log(`⏳ 正在同步: ${item.label} (${item.address})`);
    const [invite, stake, chain, level] = await Promise.all([
      fetchInviteData(item.address),
      fetchStakingStatus(item.address),
      fetchFullChain(item.address, referralCache),
      fetchLevel(item.address)
    ]);

    return {
      address: item.address.toLowerCase(),
      label: item.label,
      warZone: item.war_zone,
      level,
      directReferrals: invite.directReferralQuantity,
      teamNumber: parseInt(invite.teamNumber || '0'),
      teamStaking: formatStaking(stake.teamStaking),
      referrerChain: chain
    };
  }));

  // 3. 计算有效业绩 (核心扣除逻辑)
  const finalMetrics = rawData.map(A => {
    const nearestChildren: string[] = [];
    const others = rawData.filter(X => X.address !== A.address);
    
    others.forEach(B => {
      const idx = B.referrerChain.indexOf(A.address);
      if (idx !== -1) {
        const pathBetween = B.referrerChain.slice(0, idx);
        const hasOtherMarkedInBetween = pathBetween.some(mid => 
          rawData.some(r => r.address === mid)
        );
        if (!hasOtherMarkedInBetween) {
          nearestChildren.push(B.address);
        }
      }
    });

    const childrenStakingSum = nearestChildren.reduce((acc, childAddr) => {
      const child = rawData.find(r => r.address === childAddr);
      return acc + (child ? child.teamStaking : 0);
    }, 0);

    return {
      address: A.address,
      date: today,
      metrics: {
        label: A.label,
        warZone: A.warZone,
        level: A.level,
        directReferrals: A.directReferrals,
        teamNumber: A.teamNumber,
        teamStaking: A.teamStaking,
        effectiveStaking: Math.max(0, A.teamStaking - childrenStakingSum),
        referrer: A.referrerChain[0] || null,
        nearestLabeledChildren: nearestChildren
      }
    };
  });

  // 4. 写入 Supabase
  console.log('💾 正在保存快照到数据库...');
  for (const item of finalMetrics) {
    const { error } = await supabase.from('snapshots').upsert({
      address: item.address,
      date: item.date,
      metrics: item.metrics
    }, { onConflict: 'address,date' });
    if (error) console.error(`保存失败 ${item.address}:`, error.message);
  }

  // 5. 更新 tracked_addresses 中的等级
  for (const item of rawData) {
    await supabase.from('tracked_addresses').update({ level: item.level }).eq('address', item.address);
  }

  console.log('✅ 同步任务圆满完成！');
}

runSync().catch(err => {
  console.error('❌ 同步过程中出现致命错误:', err);
  // FIX: Cast 'process' to 'any' to call 'exit' as it might be missing from the 'Process' type in certain TS environments.
  (process as any).exit(1);
});
