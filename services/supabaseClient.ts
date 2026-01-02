
import { createClient } from '@supabase/supabase-js';

// 从环境变量中读取 Supabase 配置
// 在 Vercel 或其他部署平台中，请确保配置了 SUPABASE_URL 和 SUPABASE_ANON_KEY
const supabaseUrl = (process.env as any).SUPABASE_URL || '';
const supabaseAnonKey = (process.env as any).SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase 配置缺失，请检查环境变量 SUPABASE_URL 和 SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
