import { APP_CONFIG } from '@/config/app';
import type { DataSource } from './datasource';
import { mockDataSource } from './mock/MockDataSource';
import { supabaseDataSource } from './supabase/SupabaseDataSource';

let instance: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!instance) {
    switch (APP_CONFIG.dataSource) {
      case 'mock':
        instance = mockDataSource;
        break;
      case 'supabase':
        instance = supabaseDataSource;
        break;
      default:
        instance = mockDataSource;
    }
  }
  return instance;
}

export { mockDataSource, supabaseDataSource };
