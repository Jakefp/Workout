// Thin IndexedDB layer. All data is small, so the app loads everything into
// memory at start-up and writes through on each change.
const DB_NAME = 'setlog';
const DB_VERSION = 1;
export const STORES = ['exercises', 'routines', 'sessions', 'weights', 'meta'];

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: s === 'weights' ? 'date' : (s === 'meta' ? 'key' : 'id') });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  all(store) { return tx(store, 'readonly', s => s.getAll()); },
  put(store, value) { return tx(store, 'readwrite', s => s.put(structuredClone(value))); },
  del(store, key) { return tx(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return tx(store, 'readwrite', s => s.clear()); },
  async replaceAll(data) {
    const conn = await open();
    return new Promise((resolve, reject) => {
      const t = conn.transaction(STORES, 'readwrite');
      for (const name of STORES) {
        const s = t.objectStore(name);
        s.clear();
        for (const row of (data[name] || [])) s.put(row);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
};
