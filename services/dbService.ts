
import { TrackedAddress, Snapshot } from '../types';
import { supabase } from './supabaseClient';

export const getTrackedAddresses = async (): Promise<TrackedAddress[]> => {
  const { data, error } = await supabase
    .from('tracked_addresses')
    .select('*');
  
  if (error) {
    console.error('Fetch addresses error:', error);
    return [];
  }
  return data.map(item => ({
    address: item.address,
    label: item.label,
    warZone: item.war_zone,
    level: item.level
  }));
};

export const saveTrackedAddress = async (addr: TrackedAddress) => {
  const { error } = await supabase
    .from('tracked_addresses')
    .upsert({
      address: addr.address.toLowerCase(),
      label: addr.label,
      war_zone: addr.warZone,
      level: addr.level
    });
  if (error) throw error;
};

/**
 * 更新已标记地址的信息
 */
export const updateTrackedAddress = async (oldAddress: string, addr: TrackedAddress) => {
  const { error } = await supabase
    .from('tracked_addresses')
    .update({
      address: addr.address.toLowerCase(),
      label: addr.label,
      war_zone: addr.warZone,
      level: addr.level
    })
    .eq('address', oldAddress.toLowerCase());
  
  if (error) throw error;
};

export const deleteTrackedAddress = async (address: string) => {
  // 同时删除地址标记和该地址的所有历史快照
  const { error: addrError } = await supabase
    .from('tracked_addresses')
    .delete()
    .eq('address', address.toLowerCase());
    
  const { error: snapError } = await supabase
    .from('snapshots')
    .delete()
    .eq('address', address.toLowerCase());

  if (addrError) throw addrError;
  if (snapError) throw snapError;
};

export const getSnapshots = async (): Promise<Snapshot[]> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('snapshots')
    .select('*')
    .gte('date', dateStr)
    .order('date', { ascending: false });

  if (error) {
    console.error('Fetch snapshots error:', error);
    return [];
  }

  const grouped = data.reduce((acc: Record<string, any[]>, curr) => {
    if (!acc[curr.date]) acc[curr.date] = [];
    acc[curr.date].push({
      ...curr.metrics,
      address: curr.address,
      date: curr.date
    });
    return acc;
  }, {});

  return Object.keys(grouped).map(date => ({
    date,
    data: grouped[date]
  }));
};

export const saveSnapshotRecord = async (address: string, date: string, metrics: any) => {
  const { error } = await supabase
    .from('snapshots')
    .upsert({
      address: address.toLowerCase(),
      date: date,
      metrics: metrics
    }, { onConflict: 'address,date' });
  
  if (error) throw error;
};

export const cleanupOldSnapshots = async () => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString().split('T')[0];

  await supabase
    .from('snapshots')
    .delete()
    .lt('date', dateStr);
};
