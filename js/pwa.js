/**
 * Service Worker を登録し、更新があれば Toast 通知を出す。
 *
 * ・初回起動時に service-worker.js を登録
 * ・新しい Service Worker が待機状態になったら
 *   「更新あり」と判断して Toast を表示する
 */
export function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", async () => {
        try {
            const reg = await navigator.serviceWorker.register("./service-worker.js");

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

    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    const reloadBtn = document.getElementById("reloadAppBtn");
    reloadBtn.onclick = () => {
        if (reg.waiting) {
            // 新SWを有効化させる
            reg.waiting.postMessage("SKIP_WAITING");
        }
    };
}

// 新しいSWが有効化されたらページをリロード
navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
});