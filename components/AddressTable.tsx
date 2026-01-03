
import React from 'react';
import { AddressMetrics } from '../types';

interface Props {
  data: AddressMetrics[];
  onShowHistory: (metrics: AddressMetrics) => void;
  onShowPath: (address: string) => void;
  getAddressLabel: (addr: string) => string | null;
  // 传入原始数据用于查找扣除项的具体金额
  allRawData: AddressMetrics[];
}

const AddressTable: React.FC<Props> = ({ data, onShowHistory, onShowPath, getAddressLabel, allRawData }) => {
  const getAmountByAddress = (addr: string) => {
    const found = allRawData.find(d => d.address.toLowerCase() === addr.toLowerCase());
    return found ? found.teamStaking : 0;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-6 py-4 whitespace-nowrap">战区</th>
              <th className="px-6 py-4">等级</th>
              <th className="px-6 py-4">标注/地址</th>
              <th className="px-6 py-4">直推/团队人数</th>
              <th className="px-6 py-4">团队总质押</th>
              <th className="px-6 py-4">有效质押量</th>
              <th className="px-6 py-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((item) => (
              <tr key={item.address} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {item.warZone || '-'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                    {item.level || 'N/A'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{item.address}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-900">{item.directReferrals} / {item.teamNumber}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-900 font-medium">{item.teamStaking.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-bold text-blue-600 text-base">
                    {item.effectiveStaking.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  {item.nearestLabeledChildren.length > 0 && (
                    <div className="mt-2 pt-1 border-t border-slate-100">
                      <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">
                        扣除详情:
                      </div>
                      <div className="flex flex-col gap-1">
                        {item.nearestLabeledChildren.map(child => {
                          const childAmount = getAmountByAddress(child);
                          return (
                            <div key={child} className="flex justify-between items-center text-[10px] leading-none space-x-2">
                              <span className="text-orange-600 font-medium truncate max-w-[80px]" title={child}>
                                • {getAddressLabel(child) || '未知'}
                              </span>
                              <span className="text-slate-400 font-mono">-{childAmount.toLocaleString()}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => onShowPath(item.address)}
                      className="text-blue-500 hover:text-blue-700 font-medium text-xs py-1 px-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      邀请路径
                    </button>
                    <button 
                      onClick={() => onShowHistory(item)}
                      className="text-emerald-500 hover:text-emerald-700 font-medium text-xs py-1 px-2 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                      7天数据
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                  暂无匹配地址或尚未同步今日数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AddressTable;
