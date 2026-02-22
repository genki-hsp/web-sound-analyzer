/******************************************************
 * app.js
 *
 * アプリ全体の制御を行うメインスクリプト
 *
 * 設計原則:
 *  - 設定の正本は currentConfig のみ
 *  - UIは一時編集バッファにすぎない
 *  - 適用時のみ currentConfig を更新する
 ******************************************************/

/* ====================================================
   アプリ状態管理
==================================================== */

/**
 * アプリの状態
 * INIT           : 起動直後
 * RUNNING        : 通常動作中
 * SETTINGS_OPEN  : 設定画面表示中
 */
let currentAppState = "INIT";

/**
 * 実行中の正式な設定（唯一の正本）
 * UIやGraphManagerは必ずこの値を参照する
 */
let currentConfig = null;

/* ====================================================
   UI入力の直前正常値保持用
==================================================== */

/**
 * 設定モーダル内での「直前の正常値」を保持する。
 * 無効入力時のロールバック用。
 *
 * openSettings() 時に currentConfig から初期化される。
 */
let lastValidValues = null;

/* ====================================================
   デフォルト設定
==================================================== */

const DEFAULT_CONFIG = {
    // ディスプレイ
    graphType: 'fftWaterfall',
    autoScale: false,
    dbDisplay: true,
    freqLog:   true,
    maxAmplitudeInput: 100,
    minAmplitudeInput: 0,
    freqMinInput: 0,
    freqMaxInput: 20000,
    recordDurationSec: 60,
    colorScale: 'Standard',
    autoScrollMode: false,
    autoPeakCursor: false,
    // FFT
    samplingRate: 44100,
    fftWindow: 'Blackman',
    fftSize: 2048,
    // アプリ
    dbCorrectionGain: 100.0
};

/* ====================================================
   Config マッピング定義
==================================================== */
// HTMLのIDごとに入力の種類を指定しています。
// 設定モーダルを変更した場合は、ここも変更する必要があります。
// 個々の設定を変更すれば、プログラム内の変更は不要です。

const CONFIG_UI_MAP = {
    // ===== ディスプレイ =====
    autoScale:        { type: "checkbox", id: "autoScale" },
    dbDisplay:        { type: "checkbox", id: "dbDisplay" },
    freqLog:          { type: "checkbox", id: "freqLog" },

    maxAmplitudeInput:{ type: "number",   id: "maxAmplitudeInput" },
    minAmplitudeInput:{ type: "number",   id: "minAmplitudeInput" },
    freqMinInput:     { type: "number",   id: "freqMinInput" },
    freqMaxInput:     { type: "number",   id: "freqMaxInput" },
    recordDurationSec:{ type: "number",   id: "recordDurationSec" },

    autoScrollMode:   { type: "checkbox", id: "autoScrollMode" },
    autoPeakCursor:   { type: "checkbox", id: "autoPeakCursor" },

    // radio グループ
    graphType:  {
        type: "radio",
        name: "graphType",
        valueMap: {
            fftWaterfall:  "fftWaterfall",
            fftColor:      "fftColor",
            waterfallColor:"waterfallColor",
            waveColor:     "waveColor",
            waveFft:       "waveFft",
            fftOnly:       "fftOnly",
            waterfallOnly: "waterfallOnly",
            colorOnly:     "colorOnly",
            waveOnly:      "waveOnly"
        }
    },

    colorScale: {
        type: "radio",
        name: "colorScale",
        valueMap: {
            colorScaleStandard: "Standard",
            colorScaleGreen:    "Green",
            colorScaleWhite:    "White"
        }
    },

    // ===== FFT =====
    samplingRate: { type: "select", id: "samplingRate" },

    fftWindow: {
        type: "radio",
        name: "winFunc",
        valueMap: {
            fftWindowBlackman: "Blackman",
            fftWindowHanning:  "Hanning",
            fftWindowFlatTop:  "FlatTop",
            fftWindowRect:     "Rect"
        }
    },

    fftSize: {
        type: "select",
        id: "fftSizeSelect"
    },

    // ===== アプリ =====
    dbCorrectionGain: { type: "number", id: "dbCorrectionGain" }
};

/* ====================================================
   設定をチェック
==================================================== */
const ConfigManager = (() => {

    let current = null;

    function apply(newConfig) {
        const normalized = normalize(newConfig);
        const derived    = buildDerived(normalized);
        current = derived;
    }

    // 正規化
    function normalize(cfg) {
        const safe = structuredClone(cfg);

        // 物理的に破綻する値だけ防ぐ
        if (safe.samplingRate <= 0) safe.samplingRate = 44100;
        if (safe.fftSize <= 0) safe.fftSize = 1024;

        return safe;
    }

    // 派生値生成
    function buildDerived(cfg) {
        return {
            ...cfg,
            fftBinHz: cfg.samplingRate / cfg.fftSize
        };
    }

    function get() {
        return current;
    }

    return { apply, get };
})();


/* ====================================================
   起動時処理
==================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initializeApp();
});

/**
 * アプリ初期化
 */
function initializeApp() {
    // localStorage から設定を読み込む
    const saved = loadConfigFromStorage();

    if (saved) {
        currentConfig = saved;
    } else {
        // 保存が無ければデフォルト設定を使用
        ConfigManager.apply(structuredClone(DEFAULT_CONFIG));
        currentConfig = ConfigManager.get();

        saveConfigToStorage(currentConfig);
    }

    currentAppState = "RUNNING";
    // 設定を各マネージャへ反映
    applyConfigToSystem();

    // 入力値バリデーション管理
    setupInputValidation();

    // グラフ描画処理を初期化
    GraphManager.init(document.getElementById("graph1"), currentConfig);
}


/* ====================================================
   設定画面制御
==================================================== */
const settingsModalEl = document.getElementById("settingsModal");
const settingsModal = new bootstrap.Modal(settingsModalEl);

/**
 * 設定モーダルを開閉した際の状態管理
 */
// 開く
settingsModalEl.addEventListener("shown.bs.modal", () => {
    currentAppState = "SETTINGS_OPEN";
});
// 閉じる
settingsModalEl.addEventListener("hide.bs.modal", () => {
    // モーダルにフォーカスが残っていると警告が出てくるので、フォーカスを外す。
    if (settingsModalEl.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    document.body.focus();
});
settingsModalEl.addEventListener("hidden.bs.modal", () => {
    currentAppState = "RUNNING";
});

/**
 * 設定画面を開く
 */
function openSettings() {
    if (currentAppState !== "RUNNING") return;

    // 現在の設定をUIへ反映
    syncConfigToUI(currentConfig);

    // 直前正常値を currentConfig で初期化
    lastValidValues = structuredClone(currentConfig);

    settingsModal.show();
}

/**
 * 設定を適用
 */
function applySettings() {

    // UIの現在値を読み取り、新しい設定オブジェクトを作成
    const newConfig = readConfigFromUI();

    // 正式設定として更新
    ConfigManager.apply(newConfig);
    currentConfig = ConfigManager.get();

    // 永続化
    saveConfigToStorage(currentConfig);

    // 各マネージャへ反映
    applyConfigToSystem();

    settingsModal.hide();
}




/* ====================================================
   UI同期処理
==================================================== */

/*
    DEFAULT_CONFIG を UI に反映する関数

    設計思想：
    - Config マッピング定義を利用する
    - 設定オブジェクト → UI
    - 設定画面を開いたときに呼ばれる。
    - configの内容を設定UIに反映する。
*/
function syncConfigToUI(config) {
    for (const [key, def] of Object.entries(CONFIG_UI_MAP)) {

        const value = config[key];

        // ===== checkbox / number / select =====
        if (def.type === "checkbox" || def.type === "number" || def.type === "select") {

            const el = document.getElementById(def.id);
            if (!el) {
                console.warn(`syncConfigToUI: 要素が見つかりません。: ${def.id}`);
                continue;
            }

            if (def.type === "checkbox") {
                el.checked = Boolean(value);
            } else {
                el.value = value;
            }
        }

        // ===== radio グループ =====
        else if (def.type === "radio") {

            const radios = document.querySelectorAll(
                `input[type="radio"][name="${def.name}"]`
            );

            radios.forEach(radio => {
                /*
                    valueMap により
                    UI(id) ⇔ 設定値 を明示的に対応付け
                */
                const mappedValue = def.valueMap[radio.id];
                radio.checked = (mappedValue === value);
            });
        }
    }
}

/**
 * UI → 設定値 読み取り
 * 適用ボタンを押したときのみ呼ばれる
 * Config マッピング定義を利用する
 */
function readConfigFromUI() {
    const newConfig = { ...DEFAULT_CONFIG };

    for (const [key, def] of Object.entries(CONFIG_UI_MAP)) {

        // ===== checkbox / number / select =====
        if (def.type === "checkbox" || def.type === "number" || def.type === "select") {

            const el = document.getElementById(def.id);
            if (!el) {
                console.warn(`readConfigFromUI: element not found: ${def.id}`);
                continue;
            }

            if (def.type === "checkbox") {
                newConfig[key] = el.checked;
            } else {
                newConfig[key] = Number(el.value);
            }
        }

        // ===== radio グループ =====
        else if (def.type === "radio") {

            const radios = document.querySelectorAll(
                `input[type="radio"][name="${def.name}"]`
            );

            const checked = Array.from(radios).find(r => r.checked);

            if (checked && def.valueMap[checked.id] !== undefined) {
                newConfig[key] = def.valueMap[checked.id];
            } else {
                /*
                    どれも選ばれていない異常系でも
                    DEFAULT_CONFIG に必ずフォールバック
                */
                newConfig[key] = DEFAULT_CONFIG[key];
            }
        }
    }

    return newConfig;
}


/* ====================================================
   UI入力バリデーション管理
==================================================== */

/**
 * 設定モーダル内の input / select に対して
 * 入力値の正規化のみを行う。
 *
 * 注意:
 * - currentConfig は変更しない
 * - UI(value)を書き換えるだけ
 * - 無効値は lastValidValues にロールバック
 */
function setupInputValidation() {

    const freqMinEl = document.getElementById("freqMinInput");
    const freqMaxEl = document.getElementById("freqMaxInput");
    const samplingRateEl = document.getElementById("samplingRate");
    const fftSizeEl = document.getElementById("fftSizeSelect");

    // 周波数入力
    freqMinEl.addEventListener("change", () => {
        normalizeFrequencyInputsInUI();
    });

    freqMaxEl.addEventListener("change", () => {
        normalizeFrequencyInputsInUI();
    });

    // FFT条件変更時も再正規化
    samplingRateEl.addEventListener("change", () => {
        normalizeFrequencyInputsInUI();
    });

    fftSizeEl.addEventListener("change", () => {
        normalizeFrequencyInputsInUI();
    });
}

/**
 * UI上の freqMinInput / freqMaxInput を
 * FFT条件（samplingRate / fftSize）に基づき正規化する。
 *
 * ・NaN / 無効入力 → lastValidValues にロールバック
 * ・物理範囲 clamp
 * ・逆転防止
 *
 * currentConfig は変更しない。
 */
function normalizeFrequencyInputsInUI() {

    const minEl = document.getElementById("freqMinInput");
    const maxEl = document.getElementById("freqMaxInput");

    // UIの現在値から取得
    const tmpConfig = readConfigFromUI();
    let fMin = tmpConfig.freqMinInput;
    let fMax = tmpConfig.freqMaxInput;
    const sr = tmpConfig.samplingRate;
    const fftSize = tmpConfig.fftSize;

    const df = sr / fftSize; // 周波数分解能
    const ny = sr / 2;       // ナイキスト周波数

    // --- 無効値チェック（NaN / null / undefined）---
    if (!Number.isFinite(fMin)) { rollbackInputs("freqMinInput"); return; }
    if (!Number.isFinite(fMax)) { rollbackInputs("freqMaxInput"); return; }

    const fftConditionChanged =
        (sr !== lastValidValues.samplingRate) ||
        (fftSize !== lastValidValues.fftSize);

    if ((fMin != lastValidValues.freqMinInput) || fftConditionChanged){
        // 物理範囲 → 関係制約 の順で補正
        if (fMin < 0)  fMin = 0;
        if (fMin >= fMax - df) {
            fMin = Math.max(df, fMax - df);
        }
        // UIへ反映
        minEl.value = fMin;
    }
    if ((fMax != lastValidValues.freqMaxInput) || fftConditionChanged){
        // 物理範囲 → 関係制約 の順で補正
        if (fMax > ny) fMax = ny;
        if (fMax <= fMin + df ) {
            fMax = fMin + df;
        }
        // UIへ反映
        maxEl.value = fMax;
    }
   
    // 正常値として保存
    lastValidValues.samplingRate = sr;
    lastValidValues.fftSize = fftSize;
    lastValidValues.freqMinInput = fMin;
    lastValidValues.freqMaxInput = fMax;
}

/**
 * 指定した input 要素の値を lastValidValues に基づきロールバックする。
 *
 * @param {string} idname input要素のid（例: "freqMinInput"）
 */
function rollbackInputs(idname) {
    const el = document.getElementById(idname);
    if (!lastValidValues) return;
    if (!el) return;
    if (!(idname in lastValidValues)) return;

    el.value = lastValidValues[idname];
}




/* ====================================================
   設定反映処理
==================================================== */

/**
 * currentConfig を各マネージャへ反映
 * システム全体を再構成する唯一の入口
 */
function applyConfigToSystem() {
    ConfigManager.apply(currentConfig);
    GraphManager.applyConfig(ConfigManager.get());
}


/* ====================================================
   localStorage 永続化
==================================================== */

const STORAGE_KEY = "appConfig";

/**
 * 設定を localStorage に保存
 */
function saveConfigToStorage(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * 設定を localStorage から読み込み
 */
function loadConfigFromStorage() {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return null;

    try {
        const parsed = JSON.parse(json);
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
        console.warn("設定の読み込みに失敗しました。デフォルト設定を使用します。");
        return null;
    }
}


/* ====================================================
   START / STOP ボタン制御
==================================================== */

const btnStart = document.getElementById("btnStart");
const btnStop  = document.getElementById("btnStop");

btnStart.addEventListener("click", startMeasurement);
btnStop.addEventListener("click", stopMeasurement);

async function startMeasurement() {
    await MeasurementController.start();
    applyConfigToSystem();
    GraphManager.resetAxes();
    GraphManager.start();

    // 表示切替のみ（DOM構造は固定）
    btnStart.classList.add('btn-hidden');
    btnStop.classList.remove('btn-hidden');
}

function stopMeasurement() {
    MeasurementController.stop();
    GraphManager.stop();

    btnStop.classList.add('btn-hidden');
    btnStart.classList.remove('btn-hidden');
}


/* ====================================================
   設定ボタンイベント
==================================================== */

document.getElementById("settingsButton")
        .addEventListener("click", openSettings);

document.getElementById("applySettings")
        .addEventListener("click", applySettings);

