// アプリの外枠。タブ（ホーム／スキン／ショップ／設定）の切り替え、全面オーバーレイ（キャリア・実績・
// ルール説明）の開閉、ヘッダーとナビ、PLAY から対戦画面への受け渡しだけを持つ。
// 各画面の中身は screens/（対戦の外側）と battle/（対戦画面）にある。
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { RADIUS } from "./shared.jsx";
import { initAudioUnlockOnFirstGesture, initVisibilityPause } from "./audio/engine.js";
import { startBgm } from "./audio/bgm.js";
import { playClick, playTabSwitch } from "./audio/sfx.js";
import { getSettings, getChips, addChips, migrateLegacyWallet, grantWelcomeChips, getEquippedSkin, getEquippedTable, checkDailyLogin, getEquippedTitle, isTutorialDone, markTutorialDone } from "./storage.js";
import { getProfileName } from "./battle/profile.js";
import { HomeLobbyScreen, LobbyBackdrop, GameLaunchScreen, lobbyIntroRemainingMs } from "./LobbyScreen.jsx";
import GearIcon from "./icons/GearIcon.jsx";
import HomeIcon from "./icons/HomeIcon.jsx";
import PaletteIcon from "./icons/PaletteIcon.jsx";
import ChipIcon from "./icons/ChipIcon.jsx";
import ShopIcon from "./icons/ShopIcon.jsx";
import { RankingScreen } from "./screens/CareerScreen.jsx";
import { AchievementsScreen } from "./screens/AchievementsScreen.jsx";
import { SkinScreen } from "./screens/SkinScreen.jsx";
import { ShopScreen } from "./screens/ShopScreen.jsx";
import { SettingsScreen } from "./screens/SettingsScreen.jsx";
import { TutorialOverlay } from "./screens/TutorialOverlay.jsx";
import { TitleScreen } from "./screens/TitleScreen.jsx";
import { PlayerPlate, WalletMiniBadges } from "./screens/HeaderStatus.jsx";

// 対戦画面（オンライン／CPU練習）は battle/ にある。three.js を引き連れるので必ず lazy で分ける。
const OnlineBattle = lazy(() => import("./battle/OnlineMatch.jsx"));
const PracticeBattle = lazy(() => import("./battle/PracticeMatch.jsx"));
// 実践チュートリアル。本物の対戦画面(MatchBoard)と本物の状態機械を回すので、
// 実体は battle/ 側に置いてある（ルール説明の TutorialOverlay とは役割が違う。screens/TutorialOverlay.jsx 参照）。
const PracticeTutorial = lazy(() => import("./battle/PracticeTutorial.jsx"));
// PLAY のロード画面が実際に待つ物（LobbyScreen.jsx の GameLaunchScreen）。上の lazy・shared.jsx の
// BattleScene3D と同じ指定子を import するので、読み終われば lazy の側は待たずに描ける。
const LAUNCH_LOADERS = [
  () => import("./battle/PracticeMatch.jsx"),
  () => import("./three/BattleScene3D.jsx"),
];

export default function App() {
  // タイトル画面。サイトを開くたびに1枚挟む。この最初のタップが
  // AudioContextの解放も兼ねるので、ホームに着いた時点でBGMが鳴っている状態になる。
  const [entered, setEntered] = useState(false);
  // 初回チュートリアル。**タイトル画面を抜けてから**出す（タイトルの裏で消化させない）。
  // 設定画面からも同じオーバーレイを開けるので、値の初期化は初回判定だけに使う。
  const [showTutorial, setShowTutorial] = useState(() => !isTutorialDone());
  const [tab, setTab] = useState("home");
  const [battlePhase, setBattlePhase] = useState("menu"); // menu | cpu | online | practice（実践チュートリアル）
  // **オンライン対戦が「いま進行中か」**。battlePhaseだけでは足りない——同じ"online"でも
  // 相手待ちのキュー画面と結果画面では失う物が無く、そこで確認を出すのは邪魔なだけ。
  // 進行中かどうかを知っているのはOnlineMatchの側なので、refへ流してもらう
  // （goTabはレンダーのたびに作り直されるが、refなら常に最新の値が読める）。
  const onlineLiveRef = useRef(false);
  const [showRanking, setShowRanking] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  // PLAY を押した後のロード画面（null | "loading" | "revealing"）。LobbyScreen.jsx の GameLaunchScreen。
  // "loading" の間はロビーを残したまま全面を覆い、読み終わったら対戦画面を裏でマウントして
  // "revealing"（ロード画面が消えていく）へ進む——読み込み中に対戦を始めて、最初の配札を覆いの裏で
  // 消化させないため。
  const [launch, setLaunch] = useState(null);
  const [dailyBonus, setDailyBonus] = useState(null);
  // **名前の正は battle/profile.js（localStorage）。** ここはその写しでしかない。
  // 以前は "プレイヤー" 固定の useState だったので、設定画面で改名しても (a) リロードで消え、
  // (b) 対戦画面（getProfileName() を読む）には最初から一度も届いていなかった。
  const [profile, setProfile] = useState({
    name: getProfileName(), title: getEquippedTitle(), wins: 0, losses: 0,
  });
  // ヘッダーのCHIP残高。残高が動いたとき（報酬の確定・購入・デイリーボーナスなど）に
  // refreshWalletで読み直す
  // （storage.js自体はReact stateを持たないため、表示側はこの単一のstateを経由して同期する）。
  const [chips, setChips] = useState(getChips());
  const refreshWallet = () => setChips(getChips());
  // 設定画面の称号バッジタップ→スキン画面の称号タブへ直接遷移するための初期カテゴリ指定
  // （SkinScreenはtab切り替えのたびに条件レンダーでマウントし直されるため、その都度の
  // useState初期値としてこれを渡すだけで狙ったタブを開ける）。
  const [skinInitialCategory, setSkinInitialCategory] = useState("card");
  // ロビーの TODAY パネルで「報酬ボックス」を押したら、ショップをボックスのタブで開く
  // （skinInitialCategory と同じ作り: ShopScreen はタブを切り替えるたびにマウントし直される）。
  const [shopInitialTab, setShopInitialTab] = useState("shop");

  // ホーム＝モード選択(ロビー)+対戦、スキン=装備、ショップ=購入/ボックス開封、設定=プロフィール編集。
  // ランキングはタブではなく、ランクバッジのタップで開く別画面（みんはやの構成を踏襲）。
  const NAV = [
    { id: "home", Icon: HomeIcon, label: "ホーム" },
    { id: "skin", Icon: PaletteIcon, label: "スキン" },
    { id: "shop", Icon: ShopIcon, label: "ショップ" },
    { id: "settings", Icon: GearIcon, label: "設定" },
  ];

  // **対戦中のナビは投了と同じ意味を持つ。** この下部ナビ/上部ナビは対戦中も出っぱなしで、
  // オンライン対戦で押すとサーバーが相手の勝ちで畳む（＝ランクなら-20RP）。押した本人には
  // 何の予告も出ないので、必ず一度訊く。CPU練習と実践チュートリアルは失う物が無いので訊かない。
  //
  // **「ホーム」だけ battlePhase を戻していなかった**ので、対戦中にホームを押すと何も起きない
  // 死んだボタンになっていた（他の3つは抜けるのに、ホームだけ抜けない）。同じ扱いに揃える。
  const goTab = (id) => {
    if (onlineLiveRef.current && !window.confirm("対戦から抜けると負けになる。抜ける？")) return;
    // 画面が入れ替わったことの音。**同じタブを押した時は鳴らさない**
    // ——何も移っていないのに移った音が出ると、音が状態を表さなくなる。
    if (id !== tab) playTabSwitch();
    // **全面オーバーレイ（キャリア・実績）は必ず全部閉じる。** 実績だけ閉じ忘れていて、実績を開いたまま
    // ナビで移ると、移った先の画面の上に実績が出たまま残っていた。
    // オーバーレイを足したら、ここにも足すこと。
    setTab(id); setShowRanking(false); setShowAchievements(false); setBattlePhase("menu");
  };
  const goToTitleSkin = () => { setSkinInitialCategory("title"); goTab("skin"); };
  const openShop = (sub = "shop") => { setShopInitialTab(sub); goTab("shop"); };

  // 音声システム初期化：自動再生ポリシー対応(初回操作でAudioContext解放)、生成的BGM開始、
  // .kj-pressableクラスを持つボタン全般に共通のクリック音をイベント委譲で1箇所だけ配線する。
  useEffect(() => {
    initVisibilityPause();
    initAudioUnlockOnFirstGesture(() => startBgm("lobby"));
    const onPointerDown = (e) => {
      if (e.target.closest?.(".kj-pressable")) playClick();
    };
    document.addEventListener("pointerdown", onPointerDown);
    // モーション低減・文字サイズ設定をhtml要素のdata属性として反映（index.cssの横断的な上書きに使う）
    const s = getSettings();
    document.documentElement.dataset.reduceMotion = String(s.reduceMotion);
    document.documentElement.dataset.textScale = s.textScale;
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // デイリーログインボーナス（日数消化型、連続必須ではない）。
  // **タイトル画面を抜けてから**判定する: マウント時に出すと、トーストは3.6秒で自動的に消えるのに
  // その間ずっとタイトル画面が全面を覆っているため、ユーザーが見る前に消えてしまう
  // （タイトル画面の追加で生じる回帰。付与自体は起きるので気付かれにくい）。
  //
  // **ロビーの入場の演出が終わってから出す**（lobbyIntroRemainingMs）。暗転の中に「+20 CHIP」だけが
  // 先に浮かぶと、ホールより先に通知が目に入る。付与自体は即座に行い、見せる時刻だけを遅らせる。
  // 判定は ref で1回に固定する——checkDailyLogin は日付を進める副作用を持つので、StrictMode の
  // 二重実行で2回目が「今日はもう済んだ」を返し、トーストが消えないまま残っていた。
  const loginCheckedRef = useRef(false);
  useEffect(() => {
    // チュートリアルが出ている間はログインボーナスの判定自体をしない。トーストは3.6秒で
    // 自動的に消えるので、全面オーバーレイの裏で消化されると付与だけ起きて誰も見ない
    // （タイトル画面の追加で一度踏んだのと同じ回帰。全面オーバーレイを足す時は必ず確認すること）。
    if (!entered || showTutorial || loginCheckedRef.current) return;
    loginCheckedRef.current = true;
    const { isNewDay, loginDays } = checkDailyLogin();
    if (!isNewDay) return;
    addChips(20);
    refreshWallet();
    setDailyBonus({ days: loginDays, delay: lobbyIntroRemainingMs() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, showTutorial]);
  useEffect(() => {
    if (!dailyBonus) return undefined;
    const t = setTimeout(() => setDailyBonus(null), dailyBonus.delay + 3600);
    return () => clearTimeout(t);
  }, [dailyBonus]);

  // 試合終了時に残高表示を更新する。**battlePhaseが"menu"へ戻るのを待たないこと**——
  // 決着画面から「もう一度」で続けている間はずっと"cpu"のままなので、報酬を受け取った後も
  // ヘッダーが試合前の残高を出し続ける（実測: +10 CHIPを受け取った直後も320のままだった）。
  // 確定した瞬間に対戦画面から onWalletChange を呼んでもらう。
  useEffect(() => {
    if (battlePhase === "menu") refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlePhase]);

  // 旧GEM残高の繰り越しと初回の持参金。どちらも**1度だけ**走る（storage側が冪等に作ってある）。
  useEffect(() => { migrateLegacyWallet(); grantWelcomeChips(); refreshWallet(); }, []);

  return (
    <div className="kj-app-root" style={{
      // 幅と高さは index.css の .kj-app-root が持つ（100vh ではなく 100dvh。理由はそちら）。
      background: "#080605",
      // アプリ全体の既定フォント。以前はNoto Sans JP単体だったため、この直下の全画面が
      // (明示的にOrbitron等を指定しない限り)常にNoto Sans JPを継承しており、index.cssに
      // body用のfont-familyルールを足しても、この要素のinline styleに競り負けて無効化されていた
      // （実際に確認して判明: inline styleは常にCSSルールより優先されるため）。
      // Zen Kaku Gothic Newをここで指定し直すことで、サイト全体の本文フォントを実際に切り替える。
      fontFamily: "var(--font-body)", overflow: "hidden",
    }}>
      {/* タイトル画面は`.kj-app-shell`の外側（PC横長のCSS zoomを掛けない全面オーバーレイ）。
          アプリ本体は裏で通常どおりマウントしておき、退出フェードでそのままクロスフェードさせる。 */}
      {!entered && <TitleScreen onEnter={() => setEntered(true)} />}
      {/* PLAY を押した後のロード画面。タイトル画面と同じく .kj-app-shell の外（CSS zoom の外）に置く。 */}
      {launch && (
        <GameLaunchScreen
          loaders={LAUNCH_LOADERS} revealing={launch === "revealing"}
          tableTheme={getEquippedTable()} cardTheme={getEquippedSkin()}
          onReady={() => { setBattlePhase("cpu"); setLaunch("revealing"); }}
          onDone={() => setLaunch(null)}
        />
      )}
      {entered && showTutorial && (
        <TutorialOverlay
          onClose={() => { markTutorialDone(); setShowTutorial(false); }}
          onFinish={() => { markTutorialDone(); setShowTutorial(false); setTab("home"); setBattlePhase("practice"); }}
        />
      )}
      {/* アプリ外枠：モバイル/PCともにフルブリード。PC横長(768px~)は上部ナビバー、
          モバイルは下部タブに転換する（index.cssの.kj-top-nav/.kj-bottom-nav） */}
      <div className="kj-app-shell" style={{
        background: "#0b0806",
        display: "flex", flexDirection: "column", overflow: "hidden",
        position: "relative",
      }}>
        {/* 質感ノイズ（フラットなグラデーションだけで済ませない、AI的な均一さを避ける） */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.05, mixBlendMode: "overlay",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />
        {/* ホーム以外のタブ（スキン・ショップ・設定）にも同じ部屋を敷く。
            ホームに居る間の部屋は HomeLobbyScreen が入場の演出のクラス付きで portal しているので、
            **こちらはホームを離れている間だけ**出す（2枚重ねない）。壁龕の実測値は LobbyScreen が
            モジュールに残しており、比で持ってあるので画面の大きさが変わっても使い回せる。 */}
        {tab !== "home" && <LobbyBackdrop />}
        {/* 幕。**外枠の直下に1枚だけ**敷くので、ナビ（z-index 2）の裏の部屋までぼける
            ——キャリアでナビの帯だけ素の地のまま残っていたのはこれが無かったため。
            全面オーバーレイ（キャリア・実績）はホームの上にも開くので、タブがホームでも出す。 */}
        {(tab !== "home" || showRanking || showAchievements) && (
          <div className="kj-shell-veil" aria-hidden="true" />
        )}
        {/* デイリーログインボーナス（日数消化型：連続でなくてもログイン日数分だけ進行する）。
            top: 70はモバイルの簡易ステータスバー・PC上部ナビ(いずれも高さ約60px)の下に収まる位置
            （top:8まで上げると逆にナビ本体と重なる回帰を確認したため、この値を維持する）。
            whiteSpaceだけnowrapにし、モバイル幅で「（1」と「日目）」の間で不自然に改行されるのを防ぐ。 */}
        {dailyBonus && (
          <div style={{
            // **中央寄せに transform を使わないこと。** 飛び出す演出(chipPop)の transform が
            // translateX(-50%) を上書きし、飛び出している間だけ幅の半分右へずれていた（モバイルでは画面の外へ切れた）。
            position: "absolute", top: 70, left: 0, right: 0, margin: "0 auto", width: "fit-content", zIndex: 60,
            background: "linear-gradient(135deg, #33260c, #140e08)", border: "1px solid #e8c874",
            borderRadius: RADIUS.md, padding: "10px 18px", display: "flex", alignItems: "center", gap: 10,
            // backwards にするのは、ロビーの入場の演出が終わるまでの遅延の間、最初のコマ（透明）で待たせるため。
            boxShadow: "0 0 20px rgba(232,200,116,0.35)",
            animation: `chipPop 0.4s cubic-bezier(.3,1.6,.5,1) ${dailyBonus.delay}ms backwards`,
            whiteSpace: "nowrap",
          }}>
            <ChipIcon size={18} style={{ color: "#e8c874", flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: "#e8c874", fontWeight: 700 }}>ログインボーナス（{dailyBonus.days}日目）+20 CHIP</div>
          </div>
        )}
        {/* モバイル専用の簡易ステータスバー（PC横長では.kj-top-navに統合される） */}
        <div className="kj-status-bar-mobile" style={{
          // 背景は敷かない——ホームでは部屋の絵がこのバーの裏まで続く（lobby.css の .kj-lobby-bg）。
          padding: "10px 20px 6px", justifyContent: "space-between",
          alignItems: "center", background: "transparent", flexShrink: 0, position: "relative", zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="kj-brandmark" style={{ fontSize: 13 }}>
              LUCKY JACK
            </div>
          </div>
          <div className="kj-header-status">
            {/* 押しても反応しない。ショップはナビから、
                キャリアはホームの RECORD パネルから入る。 */}
            <WalletMiniBadges chips={chips} size={14} />
            <PlayerPlate compact name={profile.name} title={profile.title} />
          </div>
        </div>

        {/* PC横長専用の上部ナビ（index.css の .kj-top-nav）。**帯ではなくボタンの列**にしてある
            ——ロビーを空間として作り込んだ後は、平らなバーが1本通っているだけでそこだけWebサイトに
            見えた。背景・境界線・blur は持たせない。
            3列グリッド（ロゴ / タブ / 状態）なので、左右の幅が違ってもタブは画面の中央に来る。 */}
        <div className="kj-top-nav" style={{
          padding: "10px 16px", flexShrink: 0, position: "relative", zIndex: 2,
        }}>
          <div className="kj-brandmark" style={{ fontSize: 15, justifySelf: "start" }}>
            LUCKY JACK
          </div>
          <div className="kj-nav-row">
            {NAV.map(n => (
              <button key={n.id} onClick={() => goTab(n.id)}
                className={`kj-nav-btn${tab === n.id ? " is-active" : ""}`}>
                <span className="kj-nav-ico"><n.Icon size={20} /></span>
                <span className="kj-nav-label">{n.label}</span>
              </button>
            ))}
          </div>
          {/* 残高の横には長らく緑の丸（#4ade80）が常時点いていた。何も測っていないのに「接続中」の
              ランプに見える＝偽の状態表示なので撤去した（モバイルのステータスバーも同じ）。
              接続状態を出すなら、ソケットの状態を実際に読む物として作り直すこと。 */}
          <div className="kj-header-status" style={{ justifySelf: "end" }}>
            {/* 押しても反応しない。ショップはナビから、
                キャリアはホームの RECORD パネルから入る。 */}
            <WalletMiniBadges chips={chips} size={16} />
            <PlayerPlate name={profile.name} title={profile.title} />
          </div>
        </div>

        {/* ナビゲーション＋コンテンツ本体：モバイルは縦積み(コンテンツ→下部ナビ)、
            PC横長は上部ナビバーの下にコンテンツが続く（.kj-shell-body） */}
        <div className="kj-shell-body" style={{ position: "relative", zIndex: 1, minHeight: 0 }}>

          {/* コンテンツ列 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {/* 全面オーバーレイ（キャリア・実績）が開いている間は、ロビーの中身を隠す。
                  **オーバーレイ側に backdrop-filter を重ねて済ませないこと**——幕と二重になるうえ、
                  その下で3Dの卓の canvas が生きたままなので、一覧を送るあいだ毎フレームぼかし直す。
                  隠すのは中身だけで、部屋（`.kj-lobby-bg`）は外枠の直下に居るのでそのまま残る
                  ＝背景は今まで通りぼけて見える。visibility なので押せる物も一緒に無効になる。 */}
              {tab === "home" && battlePhase === "menu" && (
                <div style={{
                  height: "100%",
                  visibility: (showRanking || showAchievements) ? "hidden" : "visible",
                }}>
                  <HomeLobbyScreen
                    introReady={entered && !showTutorial}
                    onPlay={() => setLaunch("loading")}
                    onOpenHowTo={() => setShowTutorial(true)}
                    onOpenCareer={() => setShowRanking(true)}
                    onOpenAchievements={() => setShowAchievements(true)}
                    onOpenShop={openShop}
                  />
                </div>
              )}
              {tab === "home" && battlePhase === "cpu" && (
                <Suspense fallback={null}>
                  <PracticeBattle mode="casual" autoStart onWalletChange={refreshWallet}
                    onExit={() => setBattlePhase("menu")} />
                </Suspense>
              )}
              {tab === "home" && battlePhase === "practice" && (
                <Suspense fallback={null}>
                  <PracticeTutorial onEnd={() => setBattlePhase("menu")} profile={profile} />
                </Suspense>
              )}
              {tab === "home" && battlePhase === "online" && (
                <Suspense fallback={null}>
                  <OnlineBattle
                    onWalletChange={refreshWallet}
                    onLiveChange={(live) => { onlineLiveRef.current = live; }}
                    onExit={() => { onlineLiveRef.current = false; setBattlePhase("menu"); }} />
                </Suspense>
              )}
              {tab === "skin" && <SkinScreen setProfile={setProfile} initialCategory={skinInitialCategory} />}
              {tab === "shop" && <ShopScreen onWalletChange={refreshWallet} initialTab={shopInitialTab} />}
              {tab === "settings" && <SettingsScreen profile={profile} setProfile={setProfile} onOpenTitleSkin={goToTitleSkin} onReplayTutorial={() => setShowTutorial(true)} onStartPractice={() => { setTab("home"); setBattlePhase("practice"); }} />}

              {/* ランキング：どのタブからでもランクバッジタップで開く全面オーバーレイ
                  （みんはやと同様、開いている間はナビも覆って専用の戻るボタンで閉じる） */}
              {showRanking && (
                <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
                  <RankingScreen onBack={() => setShowRanking(false)} />
                </div>
              )}

              {/* 実績一覧：ホームの RECORD パネルの「実績」から開く。キャリアと同じ扱いの
                  全面オーバーレイ（戻るボタンと対なので、こちらの見出しは残す）。 */}
              {showAchievements && (
                <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
                  <AchievementsScreen onBack={() => setShowAchievements(false)} />
                </div>
              )}
            </div>

            {/* ボトムナビゲーション（モバイル縦長のみ表示）。PCの上部ナビと**同じボタン**
                （index.css の .kj-nav-btn）を使う——同じ物が画面の位置で姿を変えないように。 */}
            <div className="kj-bottom-nav">
              {NAV.map(n => (
                <button key={n.id} onClick={() => goTab(n.id)}
                  className={`kj-nav-btn${tab === n.id ? " is-active" : ""}`}>
                  <span className="kj-nav-ico"><n.Icon size={20} /></span>
                  <span className="kj-nav-label">{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        /* 本文の日本語書体。見出し用(--font-display)は index.html の <link> が読み込む。 */
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0b0806; }
        ::-webkit-scrollbar-thumb { background: #2a2a4e; border-radius: 2px; }
        /* めくり演出：中央で薄く潰れて光り、開くと同時に中身が入れ替わる */
        @keyframes cardFlip {
          0% { transform: scaleX(1); filter: brightness(1); }
          45% { transform: scaleX(0.05); filter: brightness(1.9); }
          55% { transform: scaleX(0.05); filter: brightness(1.9); }
          100% { transform: scaleX(1); filter: brightness(1); }
        }
        /* めくる直前の伏せ札の呼吸グロー */
        @keyframes cardBreathe {
          0%, 100% { box-shadow: 0 0 0 rgba(232,200,116,0); }
          50% { box-shadow: 0 0 14px rgba(232,200,116,0.35); }
        }
        /* 残り20%を切ったタイマーの呼吸パルス */
        @keyframes timerBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        /* 加算されたCHIPのバウンド */
        @keyframes chipPop {
          0% { transform: scale(0.4) translateY(4px); opacity: 0; }
          60% { transform: scale(1.15) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        /* 勝利演出：中心から光の粒が飛び散るレイヤー（BattleScreenChrome内で使用） */
        @keyframes winSpark {
          0% { transform: rotate(var(--spark-angle)) translateX(0) scale(1); opacity: 1; }
          100% { transform: rotate(var(--spark-angle)) translateX(72px) scale(0.3); opacity: 0; }
        }
        /* ボックス開封の「間」に出す文字の明滅（index.css の報酬ボックスが使う） */
        @keyframes gachaPulseText {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        /* 報酬ボックス：epic/legendaryめくり時の格上げバースト（コモン/レアは既存のcardFlipのみで控えめに留める） */
        @keyframes epicBurst {
          0% { transform: scale(1); filter: brightness(1); }
          30% { transform: scale(1.08); filter: brightness(1.35); }
          100% { transform: scale(1); filter: brightness(1); }
        }
        @keyframes legendaryBurst {
          0% { transform: scale(1); filter: brightness(1); }
          25% { transform: scale(1.18); filter: brightness(1.8); }
          55% { transform: scale(1.05); filter: brightness(1.3); }
          100% { transform: scale(1); filter: brightness(1); }
        }
        @keyframes legendaryScreenFlash {
          0% { opacity: 0; }
          18% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
