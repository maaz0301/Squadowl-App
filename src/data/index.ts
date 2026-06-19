import { APP_CONFIG } from '@/config/app';
import type { DataSource } from './datasource';
import { mockDataSource } from './mock/MockDataSource';

let instance: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!instance) {
    switch (APP_CONFIG.dataSource) {
      case 'mock':
        instance = mockDataSource;
        break;
      case 'supabase':
        throw new Error('Supabase data source not yet implemented. Set dataSource to "mock".');
      default:
        instance = mockDataSource;
    }
  }
  return instance;
}

export { mockDataSource };
