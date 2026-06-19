import { createMMKV, type MMKV } from 'react-native-mmkv';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

export const storage: MMKV = createMMKV({ id: 'aas-mobile-storage' });

export const mmkvStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.remove(name),
};

export const zustandStorage = createJSONStorage(() => mmkvStorage);

export const KV_KEYS = {
  DB: 'aas_db_v1',
  AUTH: 'aas_auth',
  ONBOARDING: 'aas_onboarding',
} as const;

export function getJson<T>(key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}
