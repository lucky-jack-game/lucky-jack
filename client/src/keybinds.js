import { useCallback, useEffect, useRef, useState } from "react";

// ─── キーボード操作 ───
//
// 対戦中の選択肢は画面上つねに横1列に並ぶ（操作ドック .kj-action-dock が固定高さのため、
// 2段に折り返すと3Dの卓へ食い込む — index.css の該当コメント参照）。キーもその1列に対応させる。
//
// WASDを採らなかった理由: WはAの上にある逆T字なので、それに合わせるにはボタンも逆T字に
// 並べ直す必要がある。しかしドックは固定高さ（PC 112px/モバイル 124px）でポットのチップの山も
// 同居しており、2段に組んだ時点ではみ出す。ボタンを縦に積む逃げ道が無い以上、
// キーの側を横1列に合わせるほかない。
export const HOME_ROW = ["a", "s", "d", "f"];

// 2択の行は**両端のA/D**を使う。KING/JOKERの2枚は画面の左右に離して置かれ、
// 間にgapを挟む——隣り合うA/Sより、指も離れているA/Dの方が「左のもの/右のもの」と対応する。
export const PAIR_KEYS = ["a", "d"];

// ─── ベット行のアクション定義 ───
// id は BetActionPanel が発行する内部アクションではなく「行に並ぶ操作」の識別子。
// 1つの操作が状況で2つの意味を持つ（pendingRaise の有無でコール⇄チェック、ベット⇄レイズ）のは
// 既存の実装そのままで、キーの側はその分岐を一切知らなくてよい。
export const BET_ACTIONS = {
  fold: { label: "フォールド", hint: "降りる", defaultKey: "a" },
  callCheck: { label: "コール / チェック", hint: "乗る・見送る", defaultKey: "s" },
  raiseHalf: { label: "ベット / レイズ（1/2ポット）", hint: "ポットの半分を積む", defaultKey: "d" },
  raisePot: { label: "ベット / レイズ（1ポット）", hint: "ポットと同額を積む", defaultKey: "f" },
};
export const BET_ACTION_ORDER = ["fold", "callCheck", "raiseHalf", "raisePot"];
export const DEFAULT_BET_KEYS = Object.fromEntries(
  BET_ACTION_ORDER.map((id) => [id, BET_ACTIONS[id].defaultKey]),
);

// フォールドキーの扱い。キー1発でポットを丸ごと渡すことになるため、既定は長押し。
//   hold    … 長押しで発動（既定）
//   instant … 他と同じく1押しで発動
//   off     … キーを割り当てない（ボタン自体は必ず残る — キーを切っただけで
//              降りられなくなるのは別種の事故なので、ここでボタンを消してはいけない）
export const FOLD_GUARDS = ["hold", "instant", "off"];
export const FOLD_HOLD_MS = 450;

// 保存済みの割り当てが壊れていても必ず有効なマップを返す（localStorageは書き換えられうる）。
// 重複したキーは後勝ちを捨てて既定へ戻す——同じキーに2つの操作が乗ると、どちらが出るかが
// 描画順に依存する「説明できない状態」になるため。
export function normalizeBetKeys(map) {
  const out = {};
  const used = new Set();
  const src = map && typeof map === "object" ? map : {};
  for (const id of BET_ACTION_ORDER) {
    const k = typeof src[id] === "string" ? src[id].toLowerCase() : null;
    if (k && isBindableKey(k) && !used.has(k)) { out[id] = k; used.add(k); }
  }
  for (const id of BET_ACTION_ORDER) {
    if (out[id]) continue;
    const d = BET_ACTIONS[id].defaultKey;
    out[id] = used.has(d) ? null : d; // 既定も埋まっていれば未割り当てのままにする
    if (out[id]) used.add(out[id]);
  }
  return out;
}

export function normalizeFoldGuard(v) {
  return FOLD_GUARDS.includes(v) ? v : "hold";
}

// 割り当てを許すキー。修飾キー単体・Tab/Escape等のUI操作用は除く。
// Enter/Space はスキップと確定に予約済みなので割り当てさせない。
const RESERVED = new Set(["enter", " ", "escape", "tab", "shift", "control", "alt", "meta", "capslock"]);
export function isBindableKey(key) {
  if (typeof key !== "string" || !key) return false;
  const k = key.toLowerCase();
  if (RESERVED.has(k)) return false;
  return k.length === 1 || /^(arrow(up|down|left|right)|f\d{1,2})$/.test(k);
}

// 画面に出す表記（"a" → "A"、" " → "Space"）。
export function keyLabel(key) {
  if (!key) return "—";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key.replace(/^Arrow/i, "").replace(/^./, (c) => c.toUpperCase());
}

// 入力欄にフォーカスがある間はホットキーを発火させない（設定画面の名前入力・賭け額の
// ステッパー等で "a" を打てなくなるため）。
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// ─── ホットキーのフック ───
//
// slots: [{ id, key, onTrigger, disabled, hold }] または null。**キーは位置ではなく各スロットが持つ**
//   （ベット行は設定で自由に割り当てられるため。カードの行は呼び出し元がPAIR_KEYS/HOME_ROWを渡す）。
//   null や disabled のスロットでも他のキーは動かない——選択肢が消えたときに割り当てを詰めると、
//   同じキーが手の途中で別の意味に変わり、レイズのつもりでコールを出す事故になる。
// extraKeys: { Enter, " ", ArrowUp, ArrowDown, ... } → ハンドラ。
//
// **登録は useEffect(..., []) で1回きりだが、参照は必ずrefミラー越しに行う。**
// このリポジトリでは オンライン対戦（battle/OnlineMatch.jsx）のSocket.ioハンドラで同じ stale closure を
// 何度も踏んでいる。keydownリスナーも構造は全く同じ。
export function useSlotKeys(slots, { enabled = true, extraKeys } = {}) {
  const slotsRef = useRef(slots);
  const extraRef = useRef(extraKeys);
  const enabledRef = useRef(enabled);
  slotsRef.current = slots;
  extraRef.current = extraKeys;
  enabledRef.current = enabled;

  const [hold, setHold] = useState(null); // { id, progress } — 長押しの進捗(0〜1)
  const holdRef = useRef(null);

  const cancelHold = useCallback(() => {
    const h = holdRef.current;
    if (!h) return;
    if (h.raf) cancelAnimationFrame(h.raf);
    holdRef.current = null;
    setHold(null);
  }, []);

  useEffect(() => {
    const fire = (slot) => {
      if (!slot || slot.disabled || typeof slot.onTrigger !== "function") return;
      slot.onTrigger();
    };

    const step = () => {
      const h = holdRef.current;
      if (!h) return;
      const p = Math.min(1, (performance.now() - h.start) / FOLD_HOLD_MS);
      setHold({ id: h.id, progress: p });
      if (p >= 1) {
        const slot = (slotsRef.current || []).find((s) => s && s.id === h.id);
        holdRef.current = null;
        setHold(null);
        fire(slot);
        return;
      }
      h.raf = requestAnimationFrame(step);
    };

    const onKeyDown = (e) => {
      if (!enabledRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const extra = extraRef.current;
      if (extra) {
        const fn = extra[e.key] || extra[e.key.toLowerCase()];
        if (typeof fn === "function") {
          e.preventDefault(); // Space のページスクロール・矢印のスクロールを止める
          if (!e.repeat) fn();
          return;
        }
      }

      const k = e.key.toLowerCase();
      const slot = (slotsRef.current || []).find((s) => s && s.key === k);
      if (!slot || slot.disabled) return;
      e.preventDefault();
      // キーリピートは無視する。押しっぱなしでレイズが MAX_RAISES まで一気に走るため。
      if (e.repeat) return;

      if (slot.hold) {
        if (holdRef.current) return;
        holdRef.current = { key: k, id: slot.id, start: performance.now(), raf: 0 };
        holdRef.current.raf = requestAnimationFrame(step);
        return;
      }
      fire(slot);
    };

    const onKeyUp = (e) => {
      const h = holdRef.current;
      if (h && e.key.toLowerCase() === h.key) cancelHold();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // タブ切り替え等でkeyupを取りこぼすと長押しが宙に浮くため、blurでも必ず畳む。
    window.addEventListener("blur", cancelHold);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancelHold);
      cancelHold();
    };
  }, [cancelHold]);

  // 操作できない状態になった瞬間に長押しの進捗が残らないようにする。
  useEffect(() => { if (!enabled) cancelHold(); }, [enabled, cancelHold]);

  return { holdSlotId: hold?.id ?? null, holdProgress: hold?.progress ?? 0 };
}

// 次に押されたキーを1つだけ捕まえる（設定画面の割り当てUI用）。
// Escapeでキャンセル。割り当て不可のキーは無視して待ち続ける。
export function useKeyCapture(active, onCapture, onCancel) {
  const onCaptureRef = useRef(onCapture);
  const onCancelRef = useRef(onCancel);
  onCaptureRef.current = onCapture;
  onCancelRef.current = onCancel;
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { onCancelRef.current?.(); return; }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!isBindableKey(k)) return; // 修飾キー単体や予約キーは待ち続ける
      onCaptureRef.current?.(k);
    };
    // capture段で拾う。対戦中のホットキーやボタンのフォーカス処理より先に食い止めるため。
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active]);
}

// 物理キーボードがある環境かどうか。タッチ専用端末にキーヒントを出しても邪魔なだけなので、
// ヒントの表示だけをこれで絞る（キー自体の受け付けは常に有効のままにする — 外付けキーボードを
// 後から繋いだ場合に効かなくなるのを避けるため）。
export function usePointerFine() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return fine;
}
