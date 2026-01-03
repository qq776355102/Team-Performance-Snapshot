
import { createClient } from '@supabase/supabase-js';

// 从环境变量中读取 Supabase 配置
const supabaseUrl = (process.env as any).SUPABASE_URL || '';
const supabaseAnonKey = (process.env as any).SUPABASE_ANON_KEY || '';

// 导出配置状态，供前端判断 UI 显示
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', // 防止 URL 为空导致客户端创建失败
  supabaseAnonKey || 'placeholder'
);
