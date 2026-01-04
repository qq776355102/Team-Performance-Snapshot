
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

const ITEMS_PER_PAGE = 100;
const SYNC_BATCH_SIZE = 5;

const App: React.FC = () => {
  const [addresses, setAddresses] = useState<TrackedAddress[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPathLoading, setIsPathLoading] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newWarZone, setNewWarZone] = useState('1');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [filterWarZone, setFilterWarZone] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [showHistoryModal, setShowHistoryModal] = useState<AddressMetrics | null>(null);
  const [showPathModal, setShowPathModal] = useState<{
    address: string, 
    chain: string[], 
    isDeepSearch?: boolean,
    chainMetrics?: Record<string, AddressMetrics | null>
  } | null>(null);
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
    // 按钮已禁用，此函数理论上不会被触发
    if (addresses.length === 0) {
      alert("请先添加需要追踪的地址");
      return;
    }
    
    setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const referralCache = new Map<string, string | null>();
      const rawData: any[] = [];

      for (let i = 0; i < addresses.length; i += SYNC_BATCH_SIZE) {
        const batch = addresses.slice(i, i + SYNC_BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (item) => {
          try {
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
              referrerChain: chain, 
              referrer: chain[0] || null
            };
          } catch (e) {
            console.warn(`同步地址 ${item.address} 失败，将跳过快照。`, e);
            return null;
          }
        }));
        rawData.push(...batchResults.filter(r => r !== null));
      }

      if (rawData.length === 0) {
        throw new Error("同步失败：未能获取任何有效数据");
      }

      await Promise.all(rawData.map(r => db.saveTrackedAddress({
        address: r.address,
        label: r.label,
        warZone: r.warZone,
        level: r.level
      })));

      const metrics: AddressMetrics[] = rawData.map(A => {
        const nearestChildren: string[] = [];
        const otherLabeledAddresses = rawData.filter(X => X.address.toLowerCase() !== A.address.toLowerCase());
        
        otherLabeledAddresses.forEach(B => {
          const aAddr = A.address.toLowerCase();
          if (B.referrerChain.some(anc => anc.toLowerCase() === aAddr)) {
            const idx = B.referrerChain.findIndex(anc => anc.toLowerCase() === aAddr);
            const pathBetween = B.referrerChain.slice(0, idx);
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
      alert("同步完成");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "同步失败，请检查网络。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAddress = async () => {
    if (!newAddr || !newLabel) return;
    const addrFormatted = newAddr.trim().toLowerCase();
    
    if (!api.isValidAddress(addrFormatted)) {
      alert("请输入合法的钱包地址 (0x 开头的 40 位 16 进制字符)");
      return;
    }

    if (addresses.some(a => a.address.toLowerCase() === addrFormatted)) {
      alert("地址已存在于标记列表中");
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

      const today = new Date().toISOString().split('T')[0];
      const [invite, stake, chain] = await Promise.all([
        api.fetchInviteData(addrFormatted),
        api.fetchStakingStatus(addrFormatted),
        api.fetchFullChain(addrFormatted)
      ]);

      const teamStaking = api.formatStaking(stake.teamStaking);
      
      await db.saveSnapshotRecord(addrFormatted, today, {
        label: item.label,
        warZone: item.warZone,
        level: item.level,
        directReferrals: invite.directReferralQuantity,
        teamNumber: parseInt(invite.teamNumber || '0'),
        teamStaking: teamStaking,
        effectiveStaking: teamStaking,
        referrer: chain[0] || null,
        nearestLabeledChildren: []
      });

      await loadData();
      setNewAddr('');
      setNewLabel('');
      alert(`已成功添加标记并同步数据: ${item.label}`);
    } catch (err) {
      console.error(err);
      alert("添加失败，请检查网络连接");
    } finally {
      setIsLoading(false);
    }
  };

  const getTodayMetric = (addr: string): AddressMetrics | null => {
    const todayStr = new Date().toISOString().split('T')[0];
    const latest = snapshots.find(s => s.date === todayStr) || snapshots[0];
    if (!latest) return null;
    return latest.data.find(d => d.address.toLowerCase() === addr.toLowerCase()) || null;
  };

  const getAddressLabel = (addr: string) => {
    const found = addresses.find(a => a.address.toLowerCase() === addr.toLowerCase());
    return found ? found.label : null;
  };

  const warZoneOptions = useMemo(() => {
    const zones = Array.from(new Set(addresses.map(a => a.warZone).filter(Boolean)));
    return zones.sort();
  }, [addresses]);

  const levelOptions = useMemo(() => {
    const levels = Array.from(new Set(addresses.map(a => a.level).filter(Boolean)));
    return levels.sort();
  }, [addresses]);

  const { filteredFull, paginatedData, totalCount } = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const latest = snapshots.find(s => s.date === todayStr) || snapshots[0];
    if (!latest) return { filteredFull: [], paginatedData: [], totalCount: 0 };
    
    const full = latest.data.filter(item => {
      const search = searchTerm.toLowerCase();
      const matchesSearch = item.label.toLowerCase().includes(search) || 
                            item.address.toLowerCase().includes(search) || 
                            item.warZone?.toLowerCase().includes(search) ||
                            item.level?.toLowerCase().includes(search);
      
      const matchesWarZone = filterWarZone === 'all' || item.warZone === filterWarZone;
      const matchesLevel = filterLevel === 'all' || item.level === filterLevel;
      
      return matchesSearch && matchesWarZone && matchesLevel;
    });

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginated = full.slice(start, start + ITEMS_PER_PAGE);

    return { 
      filteredFull: full, 
      paginatedData: paginated, 
      totalCount: full.length 
    };
  }, [snapshots, searchTerm, filterWarZone, filterLevel, currentPage]);

  const fetchPath = async (address: string) => {
    if (isPathLoading) return;
    setIsPathLoading(true);
    setLoadingAddress(address);
    try {
      const chain = await api.fetchFullChain(address);
      const metrics: Record<string, AddressMetrics | null> = {};
      chain.forEach(addr => {
        metrics[addr] = getTodayMetric(addr);
      });
      setShowPathModal({ address, chain, chainMetrics: metrics });
    } catch (err) {
      alert("路径查询失败");
    } finally {
      setIsPathLoading(false);
      setLoadingAddress(null);
    }
  };

  const handleTraceInputPath = async () => {
    const searchAddr = searchTerm.trim().toLowerCase();
    if (!api.isValidAddress(searchAddr)) {
      alert("请输入正确的钱包地址进行路径追溯");
      return;
    }
    setIsPathLoading(true);
    setLoadingAddress('search_input');
    try {
      const chain = await api.fetchChainUntilLabeled(
        searchAddr, 
        (addr) => !!getAddressLabel(addr)
      );
      const metrics: Record<string, AddressMetrics | null> = {};
      chain.forEach(addr => {
        metrics[addr] = getTodayMetric(addr);
      });
      setShowPathModal({ address: searchAddr, chain, isDeepSearch: true, chainMetrics: metrics });
    } catch (err) {
      alert("追溯失败");
    } finally {
      setIsPathLoading(false);
      setLoadingAddress(null);
    }
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
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase">已标记地址</span>
              <span className="text-sm font-bold text-indigo-600">{addresses.length}</span>
            </div>
            {isSupabaseConfigured && (
              <span className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${isTodaySynced ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                {isTodaySynced ? '今日已同步' : '待同步'}
              </span>
            )}
            <button
              onClick={runSync}
              disabled={true}
              className="px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
              title="手动同步已禁用，请依赖 GitHub Action 自动同步"
            >
              同步今日数据
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

          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">🔍</div>
                <input
                  type="text"
                  placeholder="搜索标记、等级、地址或输入地址进行追溯..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="block w-full pl-10 pr-24 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none"
                />
                {searchTerm.trim().startsWith('0x') && searchTerm.trim().length >= 40 && (
                   <button 
                    onClick={handleTraceInputPath}
                    disabled={isPathLoading}
                    className="absolute right-2 top-1.5 bottom-1.5 px-3 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center"
                   >
                     {isPathLoading && loadingAddress === 'search_input' ? (
                       <>
                         <div className="w-2 h-2 border border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div>
                         追溯中
                       </>
                     ) : '邀请路径追溯'}
                   </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">战区:</span>
                  <select 
                    value={filterWarZone}
                    onChange={(e) => { setFilterWarZone(e.target.value); setCurrentPage(1); }}
                    className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">全部战区</option>
                    {warZoneOptions.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">等级:</span>
                  <select 
                    value={filterLevel}
                    onChange={(e) => { setFilterLevel(e.target.value); setCurrentPage(1); }}
                    className="text-xs font-semibold border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">全部等级</option>
                    {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
            </div>
            
            {(searchTerm || filterWarZone !== 'all' || filterLevel !== 'all') && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center">
                  <span className="w-1 h-1 bg-indigo-400 rounded-full mr-2"></span>
                  查询结果：共 <span className="text-indigo-600 mx-1">{totalCount}</span> 条匹配
                </div>
                {searchTerm && (
                   <button 
                    onClick={() => { setSearchTerm(''); setFilterWarZone('all'); setFilterLevel('all'); }}
                    className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 underline"
                   >
                     清空所有筛选
                   </button>
                )}
              </div>
            )}
          </div>

          <AddressTable 
            data={paginatedData} 
            onShowHistory={(m) => setShowHistoryModal(m)}
            onShowPath={fetchPath}
            getAddressLabel={getAddressLabel}
            allRawData={snapshots.length > 0 ? (snapshots.find(s => s.date === new Date().toISOString().split('T')[0]) || snapshots[0]).data : []}
            currentPage={currentPage}
            totalPages={Math.ceil(totalCount / ITEMS_PER_PAGE)}
            onPageChange={setCurrentPage}
            isPathLoading={isPathLoading}
            loadingAddress={loadingAddress}
          />
        </section>
      </main>

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
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
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl max-h-[90vh] flex flex-col border border-slate-100 animate-in slide-in-from-bottom-4 duration-300">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                  </span>
                  {showPathModal.isDeepSearch ? '邀请路径深度搜索' : '邀请链条溯源'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  从该地址向上追溯，识别出路径中的已标记管理节点
                </p>
              </div>
              <button onClick={() => setShowPathModal(null)} className="text-slate-400 text-3xl px-2 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <div className="p-8 overflow-y-auto bg-slate-50/30">
              <div className="relative space-y-10">
                <div className="absolute left-[7px] top-3 bottom-3 w-0.5 bg-slate-200"></div>
                
                {/* Starting Node */}
                <div className="relative flex items-start space-x-6">
                  <div className="w-4 h-4 bg-indigo-600 rounded-full mt-1.5 shrink-0 z-10 ring-4 ring-indigo-50 shadow-sm"></div>
                  <div className="flex-1">
                    <div className="text-[10px] text-indigo-600 font-bold uppercase tracking-widest mb-1">起始查询节点</div>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="font-bold text-slate-900 text-lg">{getAddressLabel(showPathModal.address) || '未知用户'}</div>
                      <div className="text-xs text-slate-400 font-mono mt-1 break-all">{showPathModal.address}</div>
                    </div>
                  </div>
                </div>

                {/* Ancestors */}
                {showPathModal.chain.map((addr, idx) => {
                  const label = getAddressLabel(addr);
                  const metric = showPathModal.chainMetrics?.[addr];
                  return (
                    <div key={idx} className="relative flex items-start space-x-6">
                      <div className={`w-4 h-4 ${label ? 'bg-emerald-500 ring-4 ring-emerald-50 shadow-sm' : 'bg-slate-300'} rounded-full mt-1.5 shrink-0 z-10 transition-colors`}></div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                          {idx === 0 ? '直接推荐人 (L1)' : `推荐人 (L${idx + 1})`}
                        </div>
                        <div className={`p-4 rounded-2xl border ${label ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'} shadow-sm transition-all`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <div className={`font-bold ${label ? 'text-emerald-800 text-lg' : 'text-slate-700 font-medium'}`}>
                                {label ? `[已标记] ${label}` : '未标记上级'}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 break-all">{addr}</div>
                            </div>
                            {label && metric && (
                              <span className="px-2 py-1 bg-white text-emerald-600 text-[10px] font-bold rounded-lg border border-emerald-100 shadow-xs">
                                {metric.warZone}战区 | {metric.level}
                              </span>
                            )}
                          </div>
                          
                          {label && metric && (
                            <div className="mt-3 pt-3 border-t border-emerald-100 grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-[9px] text-emerald-600 uppercase font-bold">团队总质押</p>
                                <p className="text-xs font-bold text-slate-700">{metric.teamStaking.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-indigo-600 uppercase font-bold">有效业绩</p>
                                <p className="text-xs font-bold text-indigo-600">{metric.effectiveStaking.toLocaleString()}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {showPathModal.chain.length === 0 && !isPathLoading && (
                   <div className="text-center py-10 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                     <p className="text-slate-400 italic">该地址为顶级节点，暂无上级推荐人</p>
                   </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Syncing Toast */}
      {isLoading && (
        <div className="fixed bottom-8 right-8 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-50 flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
          <span className="text-xs font-bold tracking-widest uppercase">区块链大数据同步中...</span>
        </div>
      )}
    </div>
  );
};

export default App;
