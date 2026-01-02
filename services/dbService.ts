
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
    warZone: item.war_zone
  }));
};

export const saveTrackedAddress = async (addr: TrackedAddress) => {
  const { error } = await supabase
    .from('tracked_addresses')
    .upsert({
      address: addr.address.toLowerCase(),
      label: addr.label,
      war_zone: addr.warZone
    });
  if (error) throw error;
};

export const deleteTrackedAddress = async (address: string) => {
  const { error } = await supabase
    .from('tracked_addresses')
    .delete()
    .eq('address', address.toLowerCase());
  if (error) throw error;
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

  // 按日期分组汇总
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
