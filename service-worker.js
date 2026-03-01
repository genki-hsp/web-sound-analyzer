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
const CACHE_NAME = "wsoundanalyzer-v20260301-19";

/**
 * 事前キャッシュする最低限のファイル
 */
const ASSETS_TO_CACHE = [
  "./index.html",
  "./manifest.json",
  "./js/app.js",
  "./js/appSound.js",
  "./js/bootstrap.bundle.js",
  "./js/plotly-3.3.0.min.js",
  "./js/pwa.js",
  "./css/bootstrap.css",
  "./icons/apple-touch-icon.png",
  "./icons/bootstrap-icons.css",
  "./icons/bootstrap-icons.json",
  "./icons/favicon.ico",
  "./icons/favicon.svg",
  "./icons/favicon-96x96.png",
  "./icons/web-app-manifest-192x192.png",
  "./icons/web-app-manifest-512x512.png",
  "./icons/fonts/bootstrap-icons.woff2"
];

/* ====================================================
 * install
 * 初回インストール時のみ実行
 * キャッシュに失敗する場合スキップする
 * （失敗原因：通信エラー、ファイルup忘れ、ASSETS_TO_CACHEの記載ミスなど）
 * ==================================================== */
self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const url of ASSETS_TO_CACHE) {
        try {
          const response = await fetch(url, { cache: "no-cache" });

          if (!response || !response.ok) {
            console.warn("[SW] skip (not ok):", url);
            continue;
          }

          await cache.put(url, response.clone());
          // console.log("[SW] cached:", url);

        } catch (err) {
          console.warn("[SW] skip (error):", url, err);
        }
      }
    })()
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
          if (!response || !response.ok) return response;
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
