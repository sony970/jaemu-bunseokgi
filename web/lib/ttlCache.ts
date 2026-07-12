// 여러 DART API 클라이언트 모듈(dart.ts, riskEvents.ts, stockPrice.ts)이 공유하는 TTL 캐시.
// 서버리스 웜 인스턴스가 재사용되는 동안만 유효하며, 콜드스타트 시에는 다시 채워진다.
export function makeTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { data: T; fetchedAt: number }>();
  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.fetchedAt > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return entry.data;
    },
    set(key: string, data: T) {
      store.set(key, { data, fetchedAt: Date.now() });
    },
  };
}
