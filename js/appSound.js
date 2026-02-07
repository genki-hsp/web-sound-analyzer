/******************************************************
 * WebAudioSpectrumEngine
 *
 * WebAudio API を用いてマイク入力から
 * 周波数スペクトルを取得する低レベルエンジン
 *
 * 役割:
 *  - マイク取得
 *  - AudioContext / AnalyserNode 管理
 *  - FFT スペクトル配列の生成
 ******************************************************/

class WebAudioSpectrumEngine {

    /* コンストラクタ */
    constructor() {
        // WebAudioAPI
        this.audioContext = null;
        this.analyser     = null;
        this.mediaStream  = null;

        this.freqData = null;
        this.timeData = null;

        this.currentSampleRate = null;
    }

    /**
     * マイクと AudioContext を初期化する
     * 非同期で必ず1回だけ呼ぶ
     *
     * @returns {Promise<void>}
     */
    async init(sampleRate = 44100) {
        /*
         * [接続図]
         *
         *   【音源：Source】       【加工・解析：Analyser】  【出口：Destination】
         *   (マイク)               (分析器)                 (スピーカーなど)
         *       |                      |                      |
         *   [mediaStream] --------> [analyser] ---- × ----> [Speaker]
         *       |          接続         |
         *       +------- connect -------+
         *   ※この段階では、スピーカーは未接続
         */

        // 音源（マイク）
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        this.audioContext = new AudioContext({
            sampleRate: sampleRate,
            sinkId: {type: 'none'} // 音を再生しない
        });
        this.currentSampleRate = this.audioContext.sampleRate;

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);

        // 分析器
        this.analyser = this.audioContext.createAnalyser();

        // 最低限の初期設定
        this.analyser.smoothingTimeConstant = 0;
        // this.analyser.minDecibels = -100

        source.connect(this.analyser);

        // バッファ確保
        this._reallocBuffers();
    }

    /**
     * バッファ再確保
     * @private
     */
    _reallocBuffers() {
        // 出力先を確保
        this.freqData = new Float32Array(this.analyser.frequencyBinCount);
        this.timeData = new Float32Array(this.analyser.fftSize);
    }

    /**
     * FFTサイズ設定
     * @param {number} fftSize
     */
    setFftSize(fftSize) {
        if (!this.analyser) return;
        if (this.analyser.fftSize !== fftSize) {
            this.analyser.fftSize = fftSize;
            this._reallocBuffers();
        }
    }

    /**
     * サンプリング周波数設定（AudioContext 再生成）
     * @param {number} sampleRate
     */
    async setSamplingRate(sampleRate) {
        if (!this.audioContext) return;

        if (this.currentSampleRate === sampleRate) return;

        // 破棄
        await this.destroy();

        // 再初期化
        await this.init(sampleRate);
    }

    /**
     * FFT 関連設定を更新する
     *
     * @param {Object} config
     */
    async updateConfig(config) {
        if (!this.audioContext) return;

        // サンプリング周波数
        await this.setSamplingRate(config.samplingRate);

        // FFTサイズ
        this.setFftSize(config.fftSize);
    }

    /**
     * FFT スペクトルを取得する
     *
     * MeasurementController から周期的に呼ばれる
     *
     * @returns {Float32Array}
     *   - 周波数ビン配列（dB値）
     */
    getSpectrum() {
        if (!this.analyser) return null;

        this.analyser.getFloatFrequencyData(this.freqData);
        return this.freqData;
    }

    /**
     * 波形データを取得する（最小実装）
     *
     * @returns {Float32Array}
     */
    getWaveform() {
        if (!this.analyser) return null;

        this.analyser.getFloatTimeDomainData(this.timeData);
        return this.timeData;
    }

    /**
     * サンプリング周波数取得
     */
    getSampleRate() {
        return this.audioContext.sampleRate;
    }

    /**
     * FFTサイズ取得
     */
    getFFTSize() {
        return this.analyser.fftSize;
    }

    /**
     * 周波数軸（Hz）を生成・取得
     * @returns {number[]}
     */
    getFrequencyAxis() {
        const sampleRate = this.audioContext.sampleRate;
        const fftSize = this.analyser.fftSize;
        const binCount = fftSize / 2;
        const df = sampleRate / fftSize;

        const axis = new Array(binCount);
        for (let i = 0; i < binCount; i++) {
            axis[i] = i * df;
        }
        return axis;
    }

    /**
     * 時間
     */
    getCurrentTime() {
        return this.audioContext.currentTime;
    }

    /**
     * リソースを破棄する
     */
    destroy() {
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.audioContext = null;
        this.analyser     = null;
        this.mediaStream  = null;
    }
}


/******************************************************
 * MeasurementController
 *
 * 計測全体の統括コントローラ
 *
 * 役割:
 *  - WebAudioSpectrumEngine の管理
 *  - 内部データ循環ループ
 *  - GraphManager へ渡すデータ生成
 ******************************************************/

const MeasurementController = (function () {

    /**
     * 内部状態機械
     * @type {string}
     * - STOPPED  : AudioContext が存在しない。ノードもストリームも全破棄済み
     * - STARTING : 非同期初期化中。まだ計測は始まっていない
     * - RUNNING  : マイク → FFT → バッファ生成 が周期実行中
     */
    let state = "STOPPED"; // STOPPED / STARTING / RUNNING

    let engine = null;

    let animationId = null;

    /** 
     * FFT フレーム更新周期（hop）
     * @type {number} ホップ時間 [sec]
     * 
     * 次の式で求められます。
     * 
     *  hopTimeSec = (分析データ長 / サンプリング周波数) * (1.0 - オーバーラップ率);
     * 
     * 補足：
     * この値はあくまで目安として機能します。
     * 指定したホップ時間がそのままデータの更新間隔とイコールになるわけではありません。
     * 長い時間を指定すれば時間当たりのデータ量が減り、小さい時間を指定すれば時間当たりのデータ量が減少するという程度の精度で機能します。
     * また、画像描画の更新頻度（60Hz）を超えて動作させることは出来ません。
    */
    let hopTimeSec = 0;
    let lastFFTTime = 0;

    // 最新のスペクトル
    let latestSpectrum = null;
    let latestWaveform = null;

    // 時間管理
    let measurementStartTime = 0; // 計測開始時刻（AudioContext基準）
    let latestTimeSec = 0;        // 最新フレームの時間 [sec]

    /**
     * 計測を開始する
     *
     * 状態遷移:
     * STOPPED → STARTING → RUNNING
     */
    async function start() {
        if (state !== "STOPPED") return;

        state = "STARTING";

        engine = new WebAudioSpectrumEngine();
        await engine.init(currentConfig.samplingRate);
        engine.updateConfig(currentConfig);

        measurementStartTime = engine.getCurrentTime();
        state = "RUNNING";

        loop();
    }

    /**
     * 計測を停止する
     *
     * 状態遷移:
     * RUNNING → STOPPED
     */
    function stop() {
        if (state === "STOPPED") return;

        cancelAnimationFrame(animationId);

        engine.destroy();
        engine = null;

        state = "STOPPED";
    }

    /**
     * 設定変更を反映する
     *
     * RUNNING 中は一度 stop → start する前提
     *
     * @param {Object} config
     */
    async function updateConfig(config) {
        if (!engine) return;
        await engine.updateConfig(config);

        // FFT フレーム更新周期（hop）
        const fftSize = config.fftSize;
        const sampleRate = engine.getSampleRate();
        const overlap = config.overlap ?? 0.0; // 将来用
        // ホップ時間 [sec]
        hopTimeSec = (fftSize / sampleRate) * (1.0 - overlap);
    }

    /**
     * 内部メインループ
     *
     * RUNNING 中のみ回る
     */
    function loop() {
        if (state !== "RUNNING") return;

        buildGraphData();

        animationId = requestAnimationFrame(loop);
    }

    /**
     * スペクトル取得
     */
    function getSpectrum() {
        return latestSpectrum;
    }

    /**
     * 波形取得
     */
    function getWaveform() {
        return latestWaveform;
    }

    /**
     * サンプリング周波数取得
     */
    function getSampleRate() {
        if (!engine) return;
        return engine.getSampleRate();
    }

    /**
     * FFTサイズ取得
     */
    function getFFTSize() {
        if (!engine) return;
        return engine.getFFTSize();
    }

    /**
     * 周波数軸（Hz）を取得
     * @returns {number[]}
     */
    function getFrequencyAxis() {
        if (!engine) return;
        return engine.getFrequencyAxis();
    }

    /**
     * グラフ描画用データを構築する
     *
     * WebAudio → MeasurementController → GraphManager
     * の結節点
     */
    function buildGraphData() {
        if (!engine) return;

        const now = performance.now() / 1000; // [sec]

        // hopTime 未経過なら何もしない
        if (now - lastFFTTime < hopTimeSec) {
            return;
        }
        lastFFTTime = now;

        // FFT
        // デシベルの補正ゲインで補正。
        // 本来ならデバイスごとに異なるマイクの補正ゲインで補正すべきだが、今回は省略。
        const raw = engine.getSpectrum();
        if (!raw) return;
        latestSpectrum = applyDbOffset(raw, currentConfig.dbCorrectionGain);    // 補正
        // 波形, 時間軸（FFT）
        latestWaveform = engine.getWaveform();
        latestTimeSec  = engine.getCurrentTime() - measurementStartTime;
    }

    /**
     * デシベル値の配列を指定値で増幅する
     * デシベル値の配列にoffsetDbを加算します。
     * 
     * @param {*} rawSpectrum 
     * @param {*} offsetDb 
     * @returns 
     */
    function applyDbOffset(rawSpectrum, offsetDb) {
        const out = new Float32Array(rawSpectrum.length);
        for (let i = 0; i < rawSpectrum.length; i++) {
            out[i] = rawSpectrum[i] + offsetDb;
        }
        return out;
    }

    /**
     * 最新のスペクトログラム用データを取得
     * @returns {{ spectrum: Float32Array, timeSec: number } | null}
     */
    function getGraphData() {
        if (!latestSpectrum) return null;

        return {
            spectrum: latestSpectrum,
            timeSec: latestTimeSec
        };
    }

    return {
        start,
        stop,
        updateConfig,
        getSampleRate,
        getFFTSize,
        getFrequencyAxis,
        getSpectrum,
        getWaveform,
        getGraphData
    };

})();



/******************************************************
 * GraphManager
 *
 * Plotly.js を用いてスペクトログラムを描画
 *
 * 役割:
 *  - グラフ初期化
 *  - レイアウト構築
 *  - requestAnimationFrame による描画更新
 ******************************************************/

const GraphManager = (function () {

    /**
     * グラフパネル管理配列
     *
     * @typedef {Object} GraphPanel
     * @property {string} divId - Plotly を描画する div 要素ID。
     * @property {"spectrogram"|"fft"|"waveform"|"empty"} type - グラフ種別
     *      このパネルが表示するデータ種別。
     *      "spectrogram" : スペクトログラム（周波数×時間）
     *      "fft"         : 周波数スペクトル（1フレーム）
     *      "waveform"    : 時間波形
     *      "empty"       : 何も表示しない（プレースホルダ）
     * @property {number[][]=} spectrogram - スペクトログラム用のバッファ。
     *      配列形式: [time][frequencyBin]
     * @property {number[][]=} fftData - スペクトル
     * @property {number[]=} timeAxis - 横軸用の時間配列 [sec]
     *      spectrogram の time 次元と対応する。
     * @property {number=} measurementStartTime - 計測開始時刻（performance.now() の値）
     *      timeAxis 計算の基準時刻として使用。
     * @property {Float32Array[]} waterfallFrames
     *      waterfall 用スペクトル履歴
     */

    /** @type {GraphPanel[]} */
    const panels = [
        { divId: "graph1", type: "spectrogram" },
        { divId: "graph2", type: "empty" }
    ];

    let isRunning   = false;
    let animationId = null;

    // スペクトログラムバッファ
    const MAX_TIME_FRAMES = 200;
    
    /**
     * 指定したグラフパネルの表示種別を変更する
     *
     * @param {"graph1"|"graph2"} divId
     * @param {"spectrogram"|"fft"|"waveform"|"waterfall"|"empty"} type
     */
    function setGraphType(divId, type) {
        const panel = panels.find(p => p.divId === divId);
        if (!panel) {
            console.warn("Unknown panel:", divId);
            return;
        }

        panel.type = type;
        // Plotly を作り直す
        initPanel(panel);
        // レイアウト更新
        updateAllPanelVisibility();
    }

    /**
     * graph1 の表示モードを切り替える
     * @param {"spectrogram"|"fft"|"waveform"|"waterfall"|"empty"} type
     */
    function setGraph1Type(type) {
        setGraphType("graph1", type);
    }

    /**
     * graph2 の表示モードを切り替える
     * @param {"spectrogram"|"fft"|"waveform"|"waterfall"|"empty"} type
     */
    function setGraph2Type(type) {
        setGraphType("graph2", type);
    }

    /**
     * 初期化（ページロード時に1回だけ）
     * DOM と Plotly の土台を作る
     */
    function init() {
        panels.forEach(panel => {
            initPanel(panel);
        });
    }

    /**
     * パネル単位の初期化
     * @param {GraphPanel} panel
     */
    function initPanel(panel) {
        // 共通状態
        panel.spectrogram = [];
        panel.timeAxis    = [];
        panel.waterfallFrames = [];
        panel.measurementStartTime = 0;

        clearPanel(panel);

        switch (panel.type) {
            case "spectrogram":
                initSpectrogramPanel(panel);
                break;

            case "fft":
                initFFTPanel(panel);
                break;

            case "waveform":
                initWaveformPanel(panel);
                break;

            case "waterfall":
                initWaterfallPanel(panel);
                break;

            case "empty":
            default:
                break;
        }

        // Plotly.jsのイベント
        const div = document.getElementById(panel.divId);
        div.on('plotly_relayouting', () => {
            
        });

        div.on('plotly_relayout', (event) => {
            // FFT以外は、将来の拡張時のためにコメントで残しています。
            
            // オートスケールOFFのときだけ処理
            if (currentConfig.autoScale) return;
            
            // 波形
            // if (panel.type === "waveform") {
            // }

            // FFT
            if (panel.type === "fft") {
                // 振幅レンジ
                if ('yaxis.range[0]' in event && 'yaxis.range[1]' in event) {
                    currentConfig.minAmplitudeInput = event['yaxis.range[0]'];
                    currentConfig.maxAmplitudeInput = event['yaxis.range[1]'];
                    applySpectrogramScale();
                }
            }

            // スペクトログラム
            // if (panel.type === "spectrogram") {
            // }

            // Waterfall
            // if (panel.type === "waterfall") {
            // }

        });
    }

    /**
     * 設定変更通知
     *
     * @param {Object} config
     * 
     * 以下のような変更があった場合に使います。
     * - FFTサイズ変更
     * - サンプリング周波数変更
     * - カラーマップ変更
     * - autoscale ON/OFF
     */
    async function notifyConfigChanged(config) {
        currentConfig = config;
        await applyConfig(config);
    }

    /**
     * スペクトログラムの初期化
     * @param {GraphPanel} panel
     */
    function initSpectrogramPanel(panel) {
        // 周波数軸
        const freqAxis = MeasurementController.getFrequencyAxis();
        const trace = {
            type: "heatmap",
            z: [],  // [freq][time]
            x: [],  // time axis
            y: freqAxis,  // frequency axis
            colorscale: "Jet"
        };

        Plotly.newPlot(
            panel.divId,
            [trace], 
            buildLayout("spectrogram"), 
            { 
                displayModeBar: true, 
                responsive: true 
            }
        );
    }

    /**
     * FFTの初期化
     * @param {GraphPanel} panel
     */
    function initFFTPanel(panel) {
        const freqAxis = MeasurementController.getFrequencyAxis();
        const trace = {
            type: "scatter",
            mode: "lines",
            x: freqAxis,  // frequency axis
            y: []   // [freq]
        };

        const layout = buildLayout("fft");

        Plotly.newPlot(
            panel.divId, 
            [trace], 
            layout,
            {responsive: true}
        );
    }

    /**
     * 波形グラフの初期化
     * @param {GraphPanel} panel
     */
    function initWaveformPanel(panel) {
        const freqAxis = MeasurementController.getFrequencyAxis();

        const trace = {
            type: "scatter",
            mode: "lines",
            x: [],  // time axis
            y: []   // [time]
        };

        const layout = buildLayout("waveform");

        Plotly.newPlot(
            panel.divId,
            [trace], 
            layout,
            {responsive: true}
        );
    }

    /**
     * ウォーターフォールの初期化
     * 3次元スペクトログラム、3Dウォーターフォールプロット
     * 
     * @param {GraphPanel} panel
     */
    function initWaterfallPanel(panel) {
        panel.waterfallFrames = [];

        const trace = {
            type: "scatter3d",
            mode: "lines",
            x: [],
            y: [],
            z: [],
            showlegend: false,
            line: {
                width: 2,
                color: [],
                colorscale: "Jet",
                cmin: 120,
                cmax: 0
            }
        };

        const layout = buildLayout("waterfall");

        Plotly.newPlot(
            panel.divId, 
            [trace], 
            layout, 
            { responsive: true }
        );
    }

    /**
     * emptyの初期化
     * @param {GraphPanel} panel
     */
    function clearPanel(panel) {
        Plotly.purge(panel.divId);   // Plotlyを完全に消す
    }

    /**
     * 軸の再取得・再反映
     * MeasurementController から最新の軸情報を取得して反映
     */
    function resetAxes() {
        const freqAxis = MeasurementController.getFrequencyAxis();

        panels.forEach(panel => {
            if (panel.type === "spectrogram") {
                Plotly.restyle(panel.divId, {
                    y: [freqAxis]
                });
            }

            if (panel.type === "fft") {
                Plotly.restyle(panel.divId, {
                    x: [freqAxis]
                });
            }
        });
    }

    /**
     * 描画開始
     * MeasurementController の設定を元に再構築
     */
    function start() {
        if (isRunning) return;

        // 内部状態リセット
        panels.forEach(panel => {
            resetPanel(panel);
        });

        isRunning = true;
        loop();
    }

    /**
     * パネル単位リセット
     */
    function resetPanel(panel) {
        panel.spectrogram = [];
        panel.timeAxis = [];
        panel.measurementStartTime = performance.now();
    }

    /**
     * 描画停止
     */
    function stop() {
        isRunning = false;
        cancelAnimationFrame(animationId);
    }


    const FIXED_FREQ_RANGE = [0, 10000];
    /**
     * 設定反映
     * graphType に応じて graph1 / graph2 を切り替える
     *
     * @param {Object} config
     */
    async function applyConfig(config) {
        // graphType → graph1 / graph2 対応表
        const graphTypeMap = {
            fftWaterfall:   ["fft",         "waterfall"],
            fftColor:       ["fft",         "spectrogram"],
            waterfallColor: ["waterfall",   "spectrogram"],
            waveColor:      ["waveform",    "spectrogram"],
            waveFft:        ["waveform",    "fft"],
            fftOnly:        ["fft",         "empty"],
            waterfallOnly:  ["waterfall",   "empty"],
            colorOnly:      ["spectrogram", "empty"],
            waveOnly:       ["waveform",    "empty"]
        };

        const types = graphTypeMap[config.graphType];
        if (!types) {
            console.warn("Unknown graphType:", config.graphType);
            return;
        }

        // graph1 / graph2 に反映
        setGraph1Type(types[0]);
        setGraph2Type(types[1]);

        // オートスケール
        const auto = config.autoScale === true;

        panels.forEach(panel => {
            if (panel.type === "empty") return;

            let layoutUpdate = {};

            if (panel.type === "spectrogram") {
                layoutUpdate = auto
                    ? {
                        "yaxis.autorange": true
                    }
                    : {
                        "yaxis.autorange": false,
                        "yaxis.range": FIXED_FREQ_RANGE
                    };
            }

            if (panel.type === "fft") {
                layoutUpdate = auto
                    ? {
                        "xaxis.autorange": true,
                        "yaxis.autorange": true
                    }
                    : {
                        "xaxis.autorange": false,
                        "xaxis.range": FIXED_FREQ_RANGE,
                        "yaxis.autorange": false,
                        "yaxis.range": [config.minAmplitudeInput, config.maxAmplitudeInput]
                    };
            }

            if (panel.type === "waveform") {
                layoutUpdate = auto
                    ? {
                        "yaxis.autorange": true
                    }
                    : {
                        "yaxis.autorange": false,
                        "yaxis.range": [-1, 1]
                    };
            }

            if (panel.type === "waterfall") {
                layoutUpdate = {
                    "scene.xaxis.autorange": auto,
                    "scene.xaxis.range": auto ? undefined : FIXED_FREQ_RANGE,
                    "scene.zaxis.autorange": auto,
                    "scene.zaxis.range": auto 
                        ? undefined 
                        : [config.minAmplitudeInput, config.maxAmplitudeInput]
                };
            }

            Plotly.relayout(panel.divId, layoutUpdate);
        });
        applySpectrogramScale();
        await MeasurementController.updateConfig(config);
    }

    /**
     * パネル表示制御
     * panel.type に応じて DOM の表示／非表示を切り替える。
     * empty の場合は非表示にする。
     * 
     * @param {Object} config
     */
    function updatePanelVisibility(panel) {
        const div = document.getElementById(panel.divId);
        if (!div) return;

        if (panel.type === "empty") {
            div.classList.add("graph-hidden");
        } else {
            div.classList.remove("graph-hidden");
        }
    }

    /**
     * 全パネルの可視状態を更新する
     * graph2 が empty の場合、graph1 が全領域を使用する
     */
    function updateAllPanelVisibility() {
        panels.forEach(panel => updatePanelVisibility(panel));

        // 表示変更後に Plotly にサイズ再計算させる
        requestAnimationFrame(() => {
            panels.forEach(panel => {
                const div = document.getElementById(panel.divId);
                if (!div) return;
                if (panel.type !== "empty") {
                    Plotly.Plots.resize(div);
                }
            });
        });
    }

    /**
     * メイン描画ループ
     */
    function loop() {
        if (!isRunning) return;

        panels.forEach(panel => {
            updatePanel(panel);
        });
        
        animationId = requestAnimationFrame(loop);
    }

    /**
     * パネル単位更新
     * 
     * @param {GraphPanel} panel 
     */
    function updatePanel(panel) {
        if (panel.type === "empty") return;

        switch (panel.type) {
            case "spectrogram": {
                const spectrum = MeasurementController.getSpectrum();
                if (spectrum) updateSpectrogram(panel, spectrum);
                break;
            }

            case "fft": {
                const spectrum = MeasurementController.getSpectrum();
                if (spectrum) updateFFT(panel, spectrum);
                break;
            }

            case "waveform": {
                const waveform = MeasurementController.getWaveform();
                if (waveform) updateWaveform(panel, waveform);
                break;
            }

            case "waterfall": {
                const spectrum = MeasurementController.getSpectrum();
                if (spectrum) updateWaterfall(panel, spectrum);
                break;
            }
        }
    }

    /**
     * スペクトログラムバッファ更新
     *
     * @param {GraphPanel} panel 
     * @param {Float32Array} spectrum
     */
    function updateSpectrogram(panel, spectrum) {
        // 振幅データ作成
        // dB配列を通常配列へ変換
        panel.spectrogram.push(Array.from(spectrum));
        if (panel.spectrogram.length > MAX_TIME_FRAMES) {
            panel.spectrogram.shift();
        }

        // 時間軸データ作成
        const timeSec = (performance.now() - panel.measurementStartTime) / 1000;
        panel.timeAxis.push(timeSec);
        if (panel.timeAxis.length > MAX_TIME_FRAMES) {
            panel.timeAxis.shift();
        }

        // spectrogram : [time][freq] → [freq][time]
        Plotly.restyle(panel.divId, {
            z: [transpose(panel.spectrogram)],
            x: [panel.timeAxis]
        }, [0]);
    }

    /**
     * FFT バッファ更新
     * 
     * @param {GraphPanel} panel 
     * @param {Float32Array} spectrum 
     */
    function updateFFT(panel, spectrum) {
        panel.fftData = Array.from(spectrum);

        Plotly.restyle(panel.divId, {
            y: [panel.fftData]
        });
    }

    /**
     * waveform バッファ更新
     * 
     * @param {GraphPanel} panel 
     * @param {Float32Array} waveform 
     */
    function updateWaveform(panel, waveform) {
        if (!waveform) return;

        // サンプル番号を x 軸にする
        // 後で時間時変える。
        const x = Array.from({ length: waveform.length }, (_, i) => i);

        Plotly.restyle(panel.divId, {
            y: [Array.from(waveform)],
            x: [x]
        });
    }

    let waterfallDrawCounter = 0
    const MAX_WATERFALL_FRAMES = 80;
    /**
     * ウォーターフォール更新
     *
     * @param {GraphPanel} panel 
     * @param {Float32Array} spectrum
     */
    function updateWaterfall(panel, spectrum) {
        if (!panel.waterfallFrames) {
            panel.waterfallFrames = [];
        }

        // フレーム保存
        panel.waterfallFrames.push(spectrum.slice());
        if (panel.waterfallFrames.length > MAX_WATERFALL_FRAMES) {
            panel.waterfallFrames.shift();
        }

        waterfallDrawCounter++;
        if (waterfallDrawCounter % 3 !== 0) return;

        const freqAxis = MeasurementController.getFrequencyAxis();
        const auto = currentConfig.autoScale === true

        const traces = panel.waterfallFrames.map((frame, i) => {
            return {
                type: "scatter3d",
                mode: "lines",
                x: freqAxis,
                y: Array(freqAxis.length).fill(i),
                z: frame,
                line: {
                    width: 2,
                    color: frame,
                    colorscale: "Jet",
                    cmin: auto ? undefined : currentConfig.minAmplitudeInput,
                    cmax: auto ? undefined : currentConfig.maxAmplitudeInput
                },
                showlegend: false
            };
        });

        const layout = document.getElementById(panel.divId).layout;
        if (auto){
            layout.scene.zaxis.autorange = true;
            layout.scene.zaxis.range = undefined;
        } else {
            layout.scene.zaxis.autorange = false;
            layout.scene.zaxis.range = [
                currentConfig.minAmplitudeInput,
                currentConfig.maxAmplitudeInput
            ];
        }
        layout.uirevision = "waterfall";
        Plotly.react(panel.divId, traces, layout);
    }

    /**
     * グラフ種別に応じたレイアウトを構築する
     *
     * @param {"spectrogram"|"fft"|"waveform"|"waterfall"} type
     * @returns {Object} Plotly layout
     */
    function buildLayout(type) {
        switch (type) {
            case "spectrogram":
                return {
                    title: { text: "Spectrogram" },
                    xaxis: { title: { text: "Time (s)" } },
                    yaxis: { title: { text: "Frequency (Hz)" } },
                    margin: { t: 40, l: 60, r: 20, b: 40 },
                    uirevision: "spectrogram"
                };

            case "fft":
                return {
                    title: { text: "FFT Spectrum" },
                    xaxis: { title: { text: "Frequency (Hz)" } },
                    yaxis: { title: { text: "Amplitude" } },
                    margin: { t: 40, l: 60, r: 20, b: 40 },
                    uirevision: "fft"
                };

            case "waveform":
                return {
                    title: { text: "Waveform" },
                    xaxis: { title: { text: "Time (s)" } },
                    yaxis: { title: { text: "Amplitude" } },
                    margin: { t: 40, l: 60, r: 20, b: 40 },
                    uirevision: "waveform"
                };

            case "waterfall":
                return {
                    title: { text: "Waterfall" },
                    scene: {
                        xaxis: { title: { text: "Frequency (Hz)" } },
                        yaxis: { title: { text: "Time" } },
                        zaxis: { title: { text: "Amplitude" } },
                        camera: {
                            eye: { x: 1.6, y: -1.8, z: 1.2 }  // 斜め上から
                        }
                    },
                    uirevision: "waterfall",
                    showlegend: false,
                    margin: { t: 20, l: 0, r: 0, b: 0 }
                };

            default:
                return {};
        }
    }

    /**
     * スペクトログラムのカラースケールを
     * currentConfig に従って設定する
     *
     * - autoScale = true  : Plotly に任せる
     * - autoScale = false : min/max を固定
     */
    function applySpectrogramScale() {
        const panel = panels.find(p => p.type === "spectrogram");
        if (!panel) return;

        if (currentConfig.autoScale) {
            Plotly.restyle(panel.divId, {
                zmin: null,
                zmax: null
            }, [0]);
        } else {
            Plotly.restyle(panel.divId, {
                zmin: currentConfig.minAmplitudeInput,
                zmax: currentConfig.maxAmplitudeInput
            }, [0]);
        }
    }


    /**
     * 2次元配列を転置する
     * @param {number[][]} matrix [time][freq]
     * @returns {number[][]} [freq][time]
     */
    function transpose(matrix) {
        if (matrix.length === 0) return [];

        const rows = matrix.length;
        const cols = matrix[0].length;

        const result = Array.from({ length: cols }, () => new Array(rows));

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                result[j][i] = matrix[i][j];
            }
        }
        return result;
    }

    return {
        init,
        resetAxes,
        start,
        stop,
        applyConfig,
        setGraph1Type,
        setGraph2Type
    };

})();


