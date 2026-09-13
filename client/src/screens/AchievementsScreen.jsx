import { RADIUS, SURFACE, FONT, ScreenAmbientGlow, numeralStyle } from "../shared.jsx";
import { getUnlockedAchievements, visibleAchievements } from "../storage.js";
import MedalIcon from "../icons/MedalIcon.jsx";
import ChevronLeftIcon from "../icons/ChevronLeftIcon.jsx";

// 実績の一覧。ホームの RECORD パネルの「実績」から開く。
// **未達成の行も必ず出し、達成条件(desc)をそこに出すこと**——`0 / 10` という数字だけでは
// 何を数えているのか分からないので、一覧が「次に何を狙うか」を
// 言えなければ開く意味が無い（称号タブの TitleList と同じ考え方）。
// 幕（`.kj-shell-veil`）は App が敷くので、ここは透かすだけでよい（キャリアと同じ）。
export function AchievementsScreen({ onBack }) {
  const shown = visibleAchievements();
  const unlocked = new Set(getUnlockedAchievements());
  const got = shown.filter((a) => unlocked.has(a.id)).length;

  return (
    // **全面オーバーレイに自前の backdrop-filter を持たせないこと。** 幕（`.kj-shell-veil`）が
    // 既に部屋をぼかしており、その上に立つロビーの中身は開いている間だけ App が隠すので、
    // ここで塞ぐ物はもう無い。重ねると全画面のぼかしが2枚になり、しかもその下でロビーの3Dの
    // canvas が生きたままなので、一覧を送るあいだ毎フレーム両方を計算し直すことになる。
    // **縦は flex で積む。`height: 100%` にしないこと**——見出しのぶん下へずれた位置から
    // 全高を取るので、スクロール領域の下端が画面の外へ出る（実測 1280x900 で 48px ぶんの
    // 見えない帯ができ、10行あるのにスクロールできる幅が238pxしか無かった）。
    <div style={{
      position: "relative", height: "100%", overflow: "hidden",
      display: "flex", flexDirection: "column",
      background: "rgba(11,8,6,0.45)",
    }}>
      <ScreenAmbientGlow />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 0", position: "relative", flexShrink: 0 }}>
        <button onClick={onBack} className="kj-pressable" aria-label="戻る" style={{
          background: SURFACE.card, border: "none", borderRadius: RADIUS.sm,
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#f4e7bf", cursor: "pointer", flexShrink: 0,
        }}><ChevronLeftIcon size={18} /></button>
        <div style={{ fontFamily: FONT.display, fontSize: 20, color: "#e8c874", display: "flex", alignItems: "center", gap: 8 }}>
          <MedalIcon size={20} /> 実績
        </div>
        <div style={{ marginLeft: "auto", ...numeralStyle(14, "#e8c874", 800) }}>{got} / {shown.length}</div>
      </div>
      <div className="kj-page-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((a) => {
            const done = unlocked.has(a.id);
            return (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", borderRadius: RADIUS.md,
                background: done ? "#2a1f00" : SURFACE.card,
                border: done ? "1px solid #e8c874" : `1px solid ${SURFACE.hairlineStrong}`,
                opacity: done ? 1 : 0.8,
              }}>
                <MedalIcon size={18} style={{ color: done ? "#e8c874" : "#4a443c", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: done ? "#f4e7bf" : "#8a7f70" }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: SURFACE.textMuted, marginTop: 2 }}>{a.desc}</div>
                </div>
                <div style={{ fontSize: 10, color: done ? "#e8c874" : "#6b6154", flexShrink: 0 }}>
                  {done ? "達成" : "未達成"}
                </div>
              </div>
            );
          })}
        </div>
        {/* 称号として付けられることは、ここでしか繋がらない（称号の一覧はスキン画面にある）。 */}
        <div style={{ marginTop: 14, fontSize: 11, color: "#6b6154", textAlign: "center" }}>
          達成した実績は、スキンの称号タブから名札に付けられる。
        </div>
      </div>
    </div>
  );
}
