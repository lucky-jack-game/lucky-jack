import { useState, useEffect } from "react";
import { outlineBtnStyle, goldBtnStyle, PENALTY_RED, RADIUS, SURFACE, FONT, GILT } from "../shared.jsx";
import { setBgmVolume, setSfxVolume } from "../audio/engine.js";
import { getSettings, saveSettings, resetAllData } from "../storage.js";
import { getProfileName, setProfileName } from "../battle/profile.js";
import { BET_ACTIONS, BET_ACTION_ORDER, DEFAULT_BET_KEYS, FOLD_GUARDS, normalizeBetKeys, normalizeFoldGuard, useKeyCapture, keyLabel } from "../keybinds.js";
import { isFullscreenSupported, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange } from "../fullscreen.js";
import BulbIcon from "../icons/BulbIcon.jsx";
import LightningIcon from "../icons/LightningIcon.jsx";
import CardsIcon from "../icons/CardsIcon.jsx";
import MedalIcon from "../icons/MedalIcon.jsx";
import GearIcon from "../icons/GearIcon.jsx";
import ChevronLeftIcon from "../icons/ChevronLeftIcon.jsx";
import { HowToPlayScreen } from "./HowToPlayScreen.jsx";

// 設定画面。名前と称号・音量や表示・キーボード操作・その他（遊び方／実践チュートリアル／データの消去）を、開閉する節に分けて並べる。
export function SettingsScreen({ profile, setProfile, onOpenTitleSkin, onReplayTutorial, onStartPractice }) {
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState(profile.name);
  const [showHowTo, setShowHowTo] = useState(false);
  const initialSettings = getSettings();
  const [bgmVol, setBgmVolState] = useState(initialSettings.bgmVolume);
  const [seVol, setSeVolState] = useState(initialSettings.seVolume);
  const [reduceMotion, setReduceMotionState] = useState(initialSettings.reduceMotion);
  const [textScale, setTextScaleState] = useState(initialSettings.textScale);
  const [haptics, setHapticsState] = useState(initialSettings.haptics);
  // **保存値ではなく実際の状態を出す。** Esc で全画面を抜けても、保存値だけを見ていると
  // トグルはONのままになり、画面が実態と違うことを言い続ける。
  const [fullscreen, setFullscreenState] = useState(isFullscreen());

  const setBgmVol = (v) => { setBgmVolState(v); setBgmVolume(v); saveSettings({ bgmVolume: v }); };
  const setSeVol = (v) => { setSeVolState(v); setSfxVolume(v); saveSettings({ seVolume: v }); };
  const setReduceMotion = (v) => {
    setReduceMotionState(v); saveSettings({ reduceMotion: v });
    document.documentElement.dataset.reduceMotion = String(v);
  };
  const setTextScale = (v) => {
    setTextScaleState(v); saveSettings({ textScale: v });
    document.documentElement.dataset.textScale = v;
  };
  const setHaptics = (v) => { setHapticsState(v); saveSettings({ haptics: v }); };
  // 押した瞬間に入る／出る（ここもユーザー操作の中なので requestFullscreen が通る）。
  // 保存値は「次にタイトルを押したとき全画面で始めるか」として残る。
  const setFullscreen = (v) => {
    setFullscreenState(v);
    saveSettings({ fullscreen: v });
    if (v) enterFullscreen(); else exitFullscreen();
  };
  // Esc や F11 で状態が変わったときも追従させる。
  useEffect(() => onFullscreenChange(() => setFullscreenState(isFullscreen())), []);

  const handleResetData = () => {
    if (window.confirm("対戦履歴・スキン・ボックス・実績・設定をすべて消す。元に戻せない。")) {
      resetAllData();
      window.location.reload();
    }
  };

  if (showHowTo) {
    return <HowToPlayScreen onBack={() => setShowHowTo(false)} onReplayTutorial={onReplayTutorial} />;
  }

  const rowBtn = (extra = {}) => ({
    width: "100%", padding: "10px 0", borderRadius: RADIUS.sm,
    border: `1px solid ${SURFACE.hairlineStrong}`, background: "transparent",
    color: "#f4e7bf", cursor: "pointer", fontSize: 13,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    ...extra,
  });

  return (
    // **横にも詰める**。PCでは幅いっぱいに
    // 広がって、音量のスライダーが800px超・称号が名前から画面の端まで離れていた。
    // 設定は読んで操作する縦並びの画面なので、列の幅を絞って中央に置く。
    // **JSXのコメントをここに置かないこと**——`return (` の中はルート要素1つしか置けないので、
    // `{/* */}` と <div> が並んだ瞬間に構文エラーになり、画面が真っ白になる（実際に踏んだ）。
    <div className="kj-page-scroll" style={{ height: "100%", overflowY: "auto", maxWidth: 560, margin: "0 auto" }}>
      {/* 名前と称号。**1行に収める**（名前22px・編集ボタン・称号の3段で縦に伸びていた）。
          称号自体はここでは変更できず、押すと SkinScreen の称号タブへ移るだけ
          ——称号を変えられるのは SkinScreen だけ、という仕様を維持する。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {editName ? (
          <>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus
              style={{
                flex: 1, minWidth: 0, background: SURFACE.card, border: "1px solid #e8c874",
                borderRadius: RADIUS.sm, padding: "5px 10px", color: "#fff", fontSize: 14,
              }} />
            {/* **書くのは localStorage の側**（対戦画面が読むのはそちら）。空欄・16字超は
                setProfileName() が正規化するので、画面へ戻すのは書いた後に読み直した値。 */}
            <button onClick={() => {
              setProfileName(nameInput);
              const saved = getProfileName();
              setNameInput(saved);
              setProfile(p => ({ ...p, name: saved }));
              setEditName(false);
            }} style={{ ...goldBtnStyle(), padding: "5px 12px", fontSize: 12 }}>保存</button>
          </>
        ) : (
          <>
            <span style={{
              fontSize: 16, fontWeight: 700, color: "#fff",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{profile.name}</span>
            <button onClick={() => setEditName(true)} className="kj-pressable"
              style={{ ...outlineBtnStyle(), padding: "3px 10px", fontSize: 11, flexShrink: 0 }}>編集</button>
            <button onClick={onOpenTitleSkin} className="kj-pressable" style={{
              marginLeft: "auto", minWidth: 0, display: "flex", alignItems: "center", gap: 5,
              background: "rgba(232,200,116,0.08)", border: "1px solid rgba(232,200,116,0.35)",
              borderRadius: RADIUS.sm, padding: "4px 10px", cursor: "pointer",
            }}>
              <MedalIcon size={12} style={{ color: "#e8c874", flexShrink: 0 }} />
              <span style={{
                fontSize: 11, color: "#e8c874",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{profile.title || "称号未設定"}</span>
            </button>
          </>
        )}
      </div>

      <FoldSection icon={<GearIcon size={14} />} title="設定" defaultOpen>
        {[
          { label: "BGM音量", value: bgmVol, set: setBgmVol },
          { label: "SE音量", value: seVol, set: setSeVol },
        ].map((s, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#cfc3ae", fontSize: 13 }}>{s.label}</span>
              <span style={{ color: "#e8c874", fontSize: 13, fontFamily: "var(--font-display)" }}>{s.value}%</span>
            </div>
            <input type="range" min="0" max="100" value={s.value}
              onChange={e => s.set(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#e8c874" }} />
          </div>
        ))}

        {/* 全画面。**入れない環境（iPhone Safari・iframe）では行ごと出さない**
            ——押しても永久に何も起きないスイッチは、画面に出ている嘘になる。 */}
        {isFullscreenSupported() && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: "#cfc3ae", fontSize: 13 }}>全画面</span>
            <input type="checkbox" checked={fullscreen} onChange={e => setFullscreen(e.target.checked)} style={{ accentColor: "#e8c874", width: 18, height: 18 }} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#cfc3ae", fontSize: 13 }}>振動</span>
          <input type="checkbox" checked={haptics} onChange={e => setHaptics(e.target.checked)} style={{ accentColor: "#e8c874", width: 18, height: 18 }} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#cfc3ae", fontSize: 13 }}>モーション低減</span>
          <input type="checkbox" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)} style={{ accentColor: "#e8c874", width: 18, height: 18 }} />
        </div>

        {/* 文字サイズ。刻みは画面全体の拡大率（index.css の html[data-text-scale]）を動かす。 */}
        <div style={{ color: "#cfc3ae", fontSize: 13, marginBottom: 6 }}>文字サイズ</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "small", label: "小" }, { id: "normal", label: "標準" }, { id: "large", label: "大" }].map(t => (
            <button key={t.id} onClick={() => setTextScale(t.id)} className="kj-pressable" style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              border: textScale === t.id ? "2px solid #e8c874" : `1px solid ${SURFACE.hairlineStrong}`,
              background: textScale === t.id ? "#e8c87422" : "transparent",
              color: textScale === t.id ? "#e8c874" : SURFACE.textMuted, cursor: "pointer", fontSize: 13,
            }}>{t.label}</button>
          ))}
        </div>
      </FoldSection>

      <FoldSection icon={<CardsIcon size={14} />} title="キーボード操作">
        <KeyboardSettingsCard />
      </FoldSection>

      <FoldSection icon={<BulbIcon size={14} />} title="その他">
        {/* **ルール説明の入口は2つまで**。以前はここに「遊び方・ルール」「ルール説明」「実践チュートリアル」の
            3つが並んでいた。読む側の2つ（辞書とカードの案内）を1つの入口にまとめ、
            **打つ側は別に残す**——読む画面と打つ画面は役割が違うので統合しない。 */}
        <button onClick={() => setShowHowTo(true)} className="kj-pressable" style={rowBtn({ marginBottom: 8 })}>
          <BulbIcon size={15} style={{ color: "#e8c874" }} /> 遊び方・ルール
        </button>
        {/* **金で目立たせない**。隣の「遊び方・ルール」と並ぶ
            同格の入口で、どちらかを先に押させたい理由が無い——色を1つだけ強くすると、
            画面は「こちらが本命」と言ってしまう。 */}
        <button onClick={onStartPractice} className="kj-pressable" style={rowBtn({ marginBottom: 8 })}>
          <LightningIcon size={15} style={{ color: "#e8c874" }} /> 実践チュートリアル
        </button>
        <button onClick={handleResetData} className="kj-pressable"
          style={rowBtn({ marginBottom: 10, border: `1px solid ${PENALTY_RED}`, color: PENALTY_RED })}>
          データをリセット
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: SURFACE.textMuted }}>LUCKY JACK v1.0.0</div>
      </FoldSection>
    </div>
  );
}

// 設定の節。**見出しの行そのものが開閉のボタン**。閉じている時も見出しは必ず出したままにする——節ごと畳んで消すと、
// 探している設定がどの節に入っているのか分からなくなる。
function FoldSection({ icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: SURFACE.card, borderRadius: RADIUS.md, padding: "12px 14px", marginBottom: 10 }}>
      <button type="button" className="kj-fold-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span>{title}</span>
        {/* 回転は index.css の .kj-fold-chev が持つ（ここでも回すと二重に回る）。 */}
        <span className="kj-fold-chev"><ChevronLeftIcon size={14} /></span>
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}

// ─── キーボード操作の設定（client/src/keybinds.js） ───
// **「ボタンの並び順」と「キーの割り当て」は1つの設定にしてある。** この仕組みが覚えやすいのは
// 「画面の並び順 = キーの並び順」という規則が1本だけだからで、2つの設定に分けると片方だけ変えた
// 瞬間にその規則を壊せてしまう（設定した本人にしか説明できない配置が作れる）。
// ここで並べ替えると、対戦画面のボタンの描画順とキーの割り当てが必ず同時に動く。
//
// 設定できるのはベット行の並びとフォールドキーの2つだけ。KING/JOKER選択(2択)は並び順が
// 「画面に出ている物の順序」そのものなので、設定対象にすると意味が変わってしまう
// （カードの並び順を変える設定になる）。
function KeyboardSettingsCard() {
  const init = getSettings();
  const [keys, setKeys] = useState(() => normalizeBetKeys(init.betKeys));
  const [foldGuard, setFoldGuardState] = useState(() => normalizeFoldGuard(init.foldGuard));
  const [capturing, setCapturing] = useState(null); // 割り当て待ちのアクションid

  // 押されたキーをそのアクションへ割り当てる。**既に別のアクションが使っていたら入れ替える**
  // ——弾くと「割り当てたいのに割り当てられない」行き止まりになり、放置すると同じキーに
  // 2つの操作が乗って、どちらが出るかが描画順に依存する説明できない状態になる。
  useKeyCapture(capturing != null, (key) => {
    const next = { ...keys };
    const prevOwner = BET_ACTION_ORDER.find((id) => next[id] === key && id !== capturing);
    if (prevOwner) next[prevOwner] = next[capturing] || null;
    next[capturing] = key;
    setKeys(next);
    saveSettings({ betKeys: next });
    setCapturing(null);
  }, () => setCapturing(null));

  const setFoldGuard = (m) => { setFoldGuardState(m); saveSettings({ foldGuard: m }); };
  const resetKeys = () => { setKeys(DEFAULT_BET_KEYS); saveSettings({ betKeys: DEFAULT_BET_KEYS }); };

  const FOLD_LABEL = { hold: "長押し", instant: "1押し", off: "割り当てない" };

  // 見出しとカードの外枠は FoldSection が持つ（この中では中身だけを並べる）。
  return (
    <div>
      {/* 「Enter と Space は予約済み。」の一文は撤去した。
          予約の実体は keybinds.js の RESERVED で、割り当て待ちにそのキーを押しても何も起きない
          ——**押せば分かることを画面に書かない**。予約されている理由
          （Enter/Space はタイトルとチュートリアルの送りに使う）は、割り当てを試す人には要らない。 */}
      <div style={{ fontSize: 11, color: SURFACE.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
        KING / JOKER は <span style={{ color: GILT.bright, fontFamily: FONT.display }}>A / D</span>、ベットは下の4つ。
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#cfc3ae", fontSize: 14 }}>ベット操作のキー</span>
        <button onClick={resetKeys} style={{ ...outlineBtnStyle(), fontSize: 11, padding: "4px 10px" }}>既定に戻す</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
        {BET_ACTION_ORDER.map((id) => {
          const active = capturing === id;
          return (
            <div key={id} style={{
              display: "flex", alignItems: "center", gap: 10,
              borderRadius: RADIUS.sm, border: `1px solid ${active ? GILT.bright : SURFACE.hairlineStrong}`,
              background: active ? "rgba(232,200,116,0.10)" : "rgba(232,200,116,0.04)", padding: "8px 10px",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#cfc3ae" }}>{BET_ACTIONS[id].label}</div>
                <div style={{ fontSize: 10, color: SURFACE.textMuted }}>{BET_ACTIONS[id].hint}</div>
              </div>
              <button onClick={() => setCapturing(active ? null : id)} className="kj-pressable" style={{
                minWidth: 76, padding: "6px 10px", borderRadius: 6,
                border: `1px solid ${active ? GILT.bright : SURFACE.hairlineStrong}`,
                background: "#0b0806", color: active ? GILT.bright : GILT.ivory,
                fontFamily: FONT.display, fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>{active ? "キーを押す" : keyLabel(keys[id])}</button>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: SURFACE.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
        ボタンを押してから、割り当てたいキーを押す（Escapeで中止）。使用中のキーなら
        その操作と<span style={{ color: "#cfc3ae" }}>入れ替わる</span>。
      </div>

      <div style={{ color: "#cfc3ae", fontSize: 14, marginBottom: 8 }}>フォールドキー</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {FOLD_GUARDS.map((m) => (
          <button key={m} onClick={() => setFoldGuard(m)} className="kj-pressable" style={{
            flex: 1, padding: "8px 0", borderRadius: 8,
            border: foldGuard === m ? `2px solid ${GILT.bright}` : `1px solid ${SURFACE.hairlineStrong}`,
            background: foldGuard === m ? "rgba(232,200,116,0.13)" : "transparent",
            color: foldGuard === m ? GILT.bright : SURFACE.textMuted, cursor: "pointer", fontSize: 13,
          }}>{FOLD_LABEL[m]}</button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: SURFACE.textMuted, lineHeight: 1.5 }}>
        キー1発でポットを丸ごと相手に渡すことになるため、既定は長押し。
        「割り当てない」を選んでもボタン自体は残るので、マウスからはいつでも降りられる。
      </div>
    </div>
  );
}
