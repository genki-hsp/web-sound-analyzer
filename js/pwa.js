/**
 * Service Worker を登録し、更新があれば Toast 通知を出す。
 *
 * ・初回起動時に service-worker.js を登録
 * ・新しい Service Worker が待機状態になったら
 *   「更新あり」と判断して Toast を表示する
 * ・ユーザーが「更新」を押すと新SWを有効化
 * ・新SWが有効化されたら自動リロード
 */
export function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", async () => {
        try {
            const reg = await navigator.serviceWorker.register("./service-worker.js");
            // 前回キャンセルされた場合
            if (reg.waiting) {
              showUpdateToast(reg);
            }

            // 新しいSWが見つかった時
            reg.addEventListener("updatefound", () => {
                const newWorker = reg.installing;
                if (!newWorker) return;

                newWorker.addEventListener("statechange", () => {
                    if (newWorker.state === "installed") {
                        // 既にSWが動いている＝更新
                        if (navigator.serviceWorker.controller) {
                            showUpdateToast(reg);
                        }
                    }
                });
            });

        } catch (err) {
            console.error("Service Worker 登録失敗:", err);
        }
    });
}

/**
 * 更新通知Toastを表示する
 * @param {ServiceWorkerRegistration} reg
 */
function showUpdateToast(reg) {
    const toastEl = document.getElementById("updateToast");
    if (!toastEl) return;

    const toast = bootstrap.Toast.getOrCreateInstance(toastEl, {
        autohide: false
    });
    toast.show();

    const reloadBtn = document.getElementById("reloadAppBtn");

    // クリックハンドラを毎回上書き（多重登録防止）
    reloadBtn.onclick = () => {
        if (reg.waiting) {
            // 新SWを有効化させる
            console.log("[PWA] send SKIP_WAITING");
            reg.waiting.postMessage("SKIP_WAITING");
        }
    };
}

// 新しいSWが有効化されたらページをリロード
navigator.serviceWorker.addEventListener("controllerchange", () => {
    console.log("[PWA] controller changed → reload");
    window.location.reload();
});
