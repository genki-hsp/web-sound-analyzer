# web-sound-analyzer
ブラウザベースの音声解析ツールです。
波形、FFT、スペクトログラム、ウォーターフォール表示に対応しています。

Droid Dev.さんの『SoundAnalyser V4.2』がGoogle Playで入手できなくなって久しいですね。このアプリを参考に、Webアプリ開発の練習として制作を始めました。

## 特徴

現在開発中
- ブラウザで動作（インストール不要）
- マイク入力によるリアルタイム解析
- 以下の表示に対応：
  - 波形表示
  - FFT（周波数スペクトル）
  - スペクトログラム
  - ウォーターフォール表示
- PWA 対応（オフライン利用を想定）

## 動作環境

- Google Chrome（推奨）
- Microsoft Edge

※ マイク入力を使用するため、HTTPS環境が必要です。
※ スマホで使用する場合、音声に補正がかかってしまう場合があります。外付けマイクを接続すると症状が改善する場合があります。

## 使い方

1. ページを開きます
2. 「START」ボタンを押します
3. ブラウザのマイク使用許可を与えます
4. グラフ表示を確認します

## 公開ページ

[GitHub Pages](https://genki-hsp.github.io/web-sound-analyzer/) にて公開しています。


## 使用ライブラリ

- Web Audio API
- Plotly.js
- Bootstrap 5.3
- Bootstrap Icons

## ライセンス

MIT License

---

本ツールは学習および研究目的で開発されています。

