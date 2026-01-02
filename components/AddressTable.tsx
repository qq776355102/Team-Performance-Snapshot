
import React from 'react';
import { AddressMetrics } from '../types';

interface Props {
  data: AddressMetrics[];
  onRemove: (address: string) => void;
  onShowHistory: (metrics: AddressMetrics) => void;
  onShowPath: (address: string) => void;
  getAddressLabel: (addr: string) => string | null;
}

const AddressTable: React.FC<Props> = ({ data, onRemove, onShowHistory, onShowPath, getAddressLabel }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-6 py-4 whitespace-nowrap">战区</th>
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
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <div className="text-xs text-slate-500 font-mono mt-1">{item.address}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-900">{item.directReferrals} / {item.teamNumber}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-900">{item.teamStaking.toLocaleString()}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-bold text-blue-600">{item.effectiveStaking.toLocaleString()}</div>
                  {item.nearestLabeledChildren.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-tight">
                        扣除:
                      </div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {item.nearestLabeledChildren.map(child => (
                          <div key={child} className="text-[10px] text-orange-500 font-medium leading-none truncate max-w-[120px]" title={child}>
                            • {getAddressLabel(child) || child}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => onShowPath(item.address)}
                      className="text-blue-500 hover:text-blue-700 font-medium text-xs py-1 px-2 border border-blue-200 rounded hover:bg-blue-50"
                    >
                      邀请路径
                    </button>
                    <button 
                      onClick={() => onShowHistory(item)}
                      className="text-emerald-500 hover:text-emerald-700 font-medium text-xs py-1 px-2 border border-emerald-200 rounded hover:bg-emerald-50"
                    >
                      7天数据
                    </button>
                    <button 
                      onClick={() => onRemove(item.address)}
                      className="text-red-400 hover:text-red-600 font-medium text-xs p-1"
                    >
                      移除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  暂无匹配地址
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AddressTable;
