/******************************************************
 * Service Worker
 * 
 *  - Cache First（キャッシュ優先）
 *  - 再読み込み時に更新取得
 *  - 更新はユーザー操作で反映（Toast対応）
 ******************************************************/

/**
 * キャッシュのバージョン
 */
const CACHE_NAME = "wsoundanalyzer-v20260228-9";

/**
 * 事前キャッシュする最低限のファイル
 */
const ASSETS_TO_CACHE = [
  "/index.html",
//  "/manifest.json",
//  "/icon-192.png",
//  "/icon-512.png"
];

/* ====================================================
 * install
 * 初回インストール時のみ実行
 * ==================================================== */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

/* ====================================================
 * activate
 * 新SWが有効化されたときに実行
 * 古いキャッシュ削除
 * ==================================================== */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  // 新SWで制御開始
  self.clients.claim();
});

/* ====================================================
 * fetch
 * キャッシュ優先 + 裏で更新
 * ==================================================== */
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // キャッシュを即返す
        return cached;
      }

      // キャッシュに無い場合のみネット取得
      return fetch(event.request)
        .then(response => {
          // 取得できたらキャッシュに保存
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, copy);
          });
          return response;
        })
        .catch(() => {
          // オフライン時など
          return cached;
        });
    })
  );
});

/* ====================================================
 * message
 * クライアントからの指示を受信
 * クライアントから "SKIP_WAITING" を受信したら
 * 新しい Service Worker を即時有効化する
 * ==================================================== */
self.addEventListener("message", event => {
    if (event.data === "SKIP_WAITING") {
        self.skipWaiting();
    }
});
