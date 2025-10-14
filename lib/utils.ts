import { type ClassValue } from 'clsx';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 간단한 메모리 캐시 (TTL 기반)
type CacheEntry<T> = { value: T; expiresAt: number };
const memoryCache = new Map<string, CacheEntry<any>>();

export function cacheGet<T>(key: string): T | undefined {
  const e = memoryCache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) { memoryCache.delete(key); return undefined; }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  memoryCache.set(key, { value, expiresAt: Date.now() + Math.max(100, ttlMs) });
}


