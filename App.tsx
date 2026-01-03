
import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrackedAddress, 
  AddressMetrics, 
  Snapshot 
} from './types';
import * as db from './services/dbService';
import * as api from './services/apiService';
import { isSupabaseConfigured } from './services/supabaseClient';
import AddressTable from './components/AddressTable';

const App: React.FC = () => {
  const [addresses, setAddresses] = useState<TrackedAddress[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPathLoading, setIsPathLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newWarZone, setNewWarZone] = useState('1');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showHistoryModal, setShowHistoryModal] = useState<AddressMetrics | null>(null);
  const [showPathModal, setShowPathModal] = useState<{address: string, chain: string[]} | null>(null);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  const loadData = async () => {
    if (!isSupabaseConfigured) {
      setInitError("【环境变量缺失】未检测到 Supabase 配置。");
      return;
    }

    setIsLoading(true);
    try {
      const [addrs, history] = await Promise.all([
        db.getTrackedAddresses(),
        db.getSnapshots()
      ]);
      setAddresses(addrs);
      setSnapshots(history);
      if (history.length > 0) {
        setLastSyncDate(history[0].date);
      }
      setInitError(null);
    } catch (err: any) {
      console.error(err);
      setInitError(`连接异常: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const runSync = async () => {
    if (addresses.length === 0) {
      alert("请先添加需要追踪的地址");
      return;
    }
    
    setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const referralCache = new Map<string, string | null>();
      
      const rawData = await Promise.all(addresses.map(async (item) => {
        const [invite, stake, chain, level] = await Promise.all([
          api.fetchInviteData(item.address),
          api.fetchStakingStatus(item.address),
          api.fetchFullChain(item.address, referralCache),
          api.fetchLevel(item.address)
        ]);
        
        return {
          ...item,
          level, 
          directReferrals: invite.directReferralQuantity,
          teamNumber: parseInt(invite.teamNumber || '0'),
          teamStaking: api.formatStaking(stake.teamStaking),
          referrerChain: chain, // [Parent, Grandparent, ...]
          referrer: chain[0] || null
        };
      }));

      // 更新地址基础信息（主要是等级）
      await Promise.all(rawData.map(r => db.saveTrackedAddress({
        address: r.address,
        label: r.label,
        warZone: r.warZone,
        level: r.level
      })));

      /**
       * 核心计算逻辑：有效质押量
       * 规则：减去其所有分支上【距离最近的一个】已标记地址的【总质押量】
       */
      const metrics: AddressMetrics[] = rawData.map(A => {
        const nearestChildren: string[] = [];
        const otherLabeledAddresses = rawData.filter(X => X.address.toLowerCase() !== A.address.toLowerCase());
        
        otherLabeledAddresses.forEach(B => {
          const aAddr = A.address.toLowerCase();
          // 检查 B 是否是 A 的后代：A 是否在 B 的推荐链条中
          if (B.referrerChain.some(anc => anc.toLowerCase() === aAddr)) {
            const idx = B.referrerChain.findIndex(anc => anc.toLowerCase() === aAddr);
            // pathBetween 是 B 到 A 之间的所有中间地址 (不包含 B 和 A)
            const pathBetween = B.referrerChain.slice(0, idx);
            
            // 如果 pathBetween 中没有任何一个地址是【已标记】的，说明 B 是距离 A 最近的那个标记后代
            const isNearest = !pathBetween.some(mid => 
              otherLabeledAddresses.some(label => label.address.toLowerCase() === mid.toLowerCase())
            );

            if (isNearest) {
              nearestChildren.push(B.address);
            }
          }
        });

        const childrenStakingSum = nearestChildren.reduce((acc, childAddr) => {
          const childData = rawData.find(r => r.address.toLowerCase() === childAddr.toLowerCase());
          return acc + (childData ? childData.teamStaking : 0);
        }, 0);

        return {
          address: A.address,
          label: A.label,
          warZone: A.warZone,
          level: A.level,
          directReferrals: A.directReferrals,
          teamNumber: A.teamNumber,
          teamStaking: A.teamStaking,
          effectiveStaking: Math.max(0, A.teamStaking - childrenStakingSum),
          referrer: A.referrer,
          nearestLabeledChildren: nearestChildren
        };
      });

      // 保存快照
      await Promise.all(metrics.map(m => {
        const { address, label, warZone, level, ...rest } = m;
        return db.saveSnapshotRecord(m.address, today, {
          ...rest,
          label,
          warZone,
          level
        });
      }));

      await db.cleanupOldSnapshots();
      await loadData();
      alert("同步完成：穿透式业绩已重新计算");
    } catch (err) {
      console.error(err);
      alert("同步失败，请检查网络。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!newAddr || !newLabel) return;
    const addrFormatted = newAddr.trim().toLowerCase();
    if (addresses.some(a => a.address.toLowerCase() === addrFormatted)) {
      alert("地址已存在");
      return;
    }
    setIsLoading(true);
    try {
      const level = await api.fetchLevel(addrFormatted);
      const item: TrackedAddress = { 
        address: addrFormatted, 
        label: newLabel.trim(), 
        warZone: newWarZone,
        level: level 
      };
      await db.saveTrackedAddress(item);
      await loadData();
      setNewAddr('');
      setNewLabel('');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const latest = snapshots.find(s => s.date === todayStr) || snapshots[0];
    if (!latest) return [];
    
    return latest.data.filter(item => {
      const search = searchTerm.toLowerCase();
      return item.label.toLowerCase().includes(search) || 
             item.address.toLowerCase().includes(search) || 
             item.warZone?.toLowerCase().includes(search) ||
             item.level?.toLowerCase().includes(search);
    });
  }, [snapshots, searchTerm]);

  // 获取原始数据的快照，用于表格显示扣除详情
  const todayRawData = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const latest = snapshots.find(s => s.date === todayStr) || snapshots[0];
    return latest ? latest.data : [];
  }, [snapshots]);

  const fetchPath = async (address: string) => {
    if (isPathLoading) return;
    setIsPathLoading(true);
    try {
      const chain = await api.fetchFullChain(address);
      setShowPathModal({ address, chain });
    } catch (err) {
      alert("路径查询失败");
    } finally {
      setIsPathLoading(false);
    }
  };

  const getAddressLabel = (addr: string) => {
    const found = addresses.find(a => a.address.toLowerCase() === addr.toLowerCase());
    return found ? found.label : null;
  };

  const isTodaySynced = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return snapshots.some(s => s.date === todayStr);
  }, [snapshots]);

  return (
    <div className="min-h-screen pb-12 bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-md">TR</div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">团队业绩快照</h1>
          </div>
          <div className="flex items-center space-x-4">
            {isSupabaseConfigured && (
              <span className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${isTodaySynced ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                {isTodaySynced ? '已同步' : '未同步'}
              </span>
            )}
            <button
              onClick={runSync}
              disabled={isLoading || !isSupabaseConfigured}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm ${
                isLoading || !isSupabaseConfigured
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
              }`}
            >
              {isLoading ? '同步中...' : '同步今日数据'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {initError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center space-x-3">
            <span className="font-bold">!</span>
            <span>{initError}</span>
          </div>
        )}

        <section className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-bold text-slate-400 mb-5 uppercase tracking-[0.2em] flex items-center space-x-2">
              <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
              <span>地址标记管理</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-5">
              <div className="md:col-span-1">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase">所属战区</label>
                <div className="relative">
                  <select 
                    value={['1','2','3','4','5','6'].includes(newWarZone) ? newWarZone : 'custom'} 
                    onChange={(e) => setNewWarZone(e.target.value)}
                    className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 appearance-none shadow-sm outline-none"
                  >
                    {[1,2,3,4,5,6].map(v => <option key={v} value={v.toString()}>{v} 战区</option>)}
                    <option value="custom">自定义名称</option>
                  </select>
                  {!['1','2','3','4','5','6'].includes(newWarZone) && (
                    <input 
                      type="text" 
                      value={newWarZone}
                      placeholder="输入战区名"
                      onChange={(e) => setNewWarZone(e.target.value)}
                      className="absolute inset-0 w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none"
                    />
                  )}
                </div>
              </div>
              <div className="md:col-span-1">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase">标注名称</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="例如: 明月社区"
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase">钱包地址 (0x)</label>
                <input
                  type="text"
                  value={newAddr}
                  onChange={(e) => setNewAddr(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 font-mono shadow-sm outline-none"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAddAddress}
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 bg-slate-900 text-white text-sm rounded-xl font-bold hover:bg-black disabled:opacity-50 transition-all shadow-md active:scale-95"
                >
                  添加标记
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full max-w-lg">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                🔍
              </div>
              <input
                type="text"
                placeholder="搜索标注、地址、战区、等级..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 shadow-sm outline-none"
              />
            </div>
            <button
              onClick={() => {
                const csv = "战区,等级,标注,地址\n" + addresses.map(a => `${a.warZone},${a.level},${a.label},${a.address}`).join("\n");
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `地址列表_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
              }}
              className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-4 py-2.5 rounded-xl hover:bg-indigo-100 transition-colors border border-indigo-100 shadow-sm"
            >
              导出标注列表 (CSV)
            </button>
          </div>

          <AddressTable 
            data={filteredData} 
            onShowHistory={(m) => setShowHistoryModal(m)}
            onShowPath={fetchPath}
            getAddressLabel={getAddressLabel}
            allRawData={todayRawData}
          />
        </section>
      </main>

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl overflow-hidden border border-slate-100">
            <div className="px-8 py-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-xl font-bold text-slate-900">{showHistoryModal.label} - 历史波动</h3>
                <p className="text-xs text-slate-400 font-mono mt-1">{showHistoryModal.address}</p>
              </div>
              <button onClick={() => setShowHistoryModal(null)} className="text-slate-400 text-3xl px-2 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <div className="p-8">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-50">
                    <tr>
                      <th className="pb-4 pr-4">同步日期</th>
                      <th className="pb-4 pr-4">等级</th>
                      <th className="pb-4 pr-4 text-right">直推 / 团队</th>
                      <th className="pb-4 pr-4 text-right">团队总质押</th>
                      <th className="pb-4 pr-4 text-right text-indigo-600">有效业绩</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {snapshots.map(s => {
                      const m = s.data.find(d => d.address.toLowerCase() === showHistoryModal.address.toLowerCase());
                      if (!m) return null;
                      return (
                        <tr key={s.date} className="hover:bg-slate-50 transition-colors">
                          <td className="py-4 pr-4 font-bold text-slate-600">{s.date}</td>
                          <td className="py-4 pr-4">
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-xs font-bold">{m.level || '-'}</span>
                          </td>
                          <td className="py-4 pr-4 text-right font-medium text-slate-500">
                            {m.directReferrals} / {m.teamNumber}
                          </td>
                          <td className="py-4 pr-4 text-right font-mono">{m.teamStaking.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="py-4 pr-4 text-right font-bold text-indigo-600 font-mono">{m.effectiveStaking.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Path Modal */}
      {showPathModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl max-h-[85vh] flex flex-col border border-slate-100">
            <div className="px-8 py-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold">邀请链条溯源</h3>
              <button onClick={() => setShowPathModal(null)} className="text-slate-400 text-3xl px-2 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <div className="p-10 overflow-y-auto bg-white">
              <div className="relative space-y-8">
                <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-100"></div>
                <div className="relative flex items-start space-x-6">
                  <div className="w-4 h-4 bg-indigo-600 rounded-full mt-1.5 shrink-0 z-10 ring-4 ring-indigo-50 shadow-sm"></div>
                  <div>
                    <div className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest">起始查询节点</div>
                    <div className="font-bold text-slate-900 text-lg">{getAddressLabel(showPathModal.address) || '当前地址'}</div>
                    <div className="text-xs text-slate-400 font-mono mt-1">{showPathModal.address}</div>
                  </div>
                </div>
                {showPathModal.chain.map((addr, idx) => {
                  const label = getAddressLabel(addr);
                  return (
                    <div key={idx} className="relative flex items-start space-x-6">
                      <div className={`w-4 h-4 ${label ? 'bg-emerald-500 ring-4 ring-emerald-50 shadow-sm' : 'bg-slate-200'} rounded-full mt-1.5 shrink-0 z-10 transition-colors`}></div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                          {idx === 0 ? '直接推荐人 (L1)' : `间接推荐人 (L${idx + 1})`}
                        </div>
                        <div className={`font-bold ${label ? 'text-emerald-700 text-lg' : 'text-slate-700 font-medium'}`}>
                          {label ? `[标记] ${label}` : '未标记地址'}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{addr}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Syncing Toast */}
      {isLoading && (
        <div className="fixed bottom-8 right-8 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-50 flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
          <span className="text-xs font-bold tracking-widest uppercase">区块链大数据分析中...</span>
        </div>
      )}
    </div>
  );
};

export default App;
