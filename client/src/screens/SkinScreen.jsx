import { useState, Suspense } from "react";
import { outlineBtnStyle, goldBtnStyle, RADIUS, SURFACE, TitleList } from "../shared.jsx";
import { playCoin } from "../audio/sfx.js";
import { getOwnedSkins, getEquippedSkin, setEquippedSkin, getOwnedTables, getEquippedTable, setEquippedTable, getOwnedTitles, getUnlockedAchievements, getEquippedTitle, setEquippedTitle, visibleAchievements } from "../storage.js";
import { COSMETIC_TITLES } from "../cosmetics.js";
import { PlayingCard, CARD_THEMES, RARITY_COLOR } from "../CardArt.jsx";
import { TABLE_THEMES, TableThemeSwatch } from "../TableArt.jsx";
import TableIcon from "../icons/TableIcon.jsx";
import LockIcon from "../icons/LockIcon.jsx";
import MedalIcon from "../icons/MedalIcon.jsx";
import PaletteIcon from "../icons/PaletteIcon.jsx";
import { CardShowcase3D, TableShowcase3D } from "./showcase3dLazy.js";



// スキン画面の見本の台。選んだ品を3Dで見せる（読み込み中は fallback の2Dの絵）。所持の状態と装備の操作もここに出す。
function SkinShowcaseStage({ name, rarity, owned, equipped, onEquip, fallback, children }) {
  return (
    <div className="kj-plate kj-gilt" style={{
      borderRadius: RADIUS.lg, padding: "10px 12px 12px", marginBottom: 16,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ height: 208, position: "relative" }}>
        <Suspense fallback={fallback}>{children}</Suspense>
        {!owned && (
          <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 5,
            padding: "4px 9px", borderRadius: 999, background: "rgba(5,5,10,0.72)",
            border: `1px solid ${SURFACE.hairlineWarm}`, fontSize: 10, color: SURFACE.textMuted }}>
            <LockIcon size={11} style={{ color: "#cfc3ae" }} /> 未所持
          </div>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.12em", color: RARITY_COLOR[rarity], fontWeight: 700 }}>
          {rarity.toUpperCase()}
        </div>
        <div style={{ fontSize: 15, color: "var(--ivory)", fontFamily: "var(--font-display)", marginTop: 2 }}>{name}</div>
      </div>
      <button
        onClick={owned && !equipped ? onEquip : undefined}
        disabled={!owned || equipped}
        className={owned && !equipped ? "kj-pressable" : ""}
        style={{
          ...(owned && !equipped ? goldBtnStyle() : outlineBtnStyle()),
          width: "100%", marginTop: 10,
          cursor: owned && !equipped ? "pointer" : "default",
          opacity: owned ? 1 : 0.6,
        }}
      >{equipped ? "装備中" : owned ? "装備する" : "ショップ／報酬ボックスで入手"}</button>
    </div>
  );
}

export function SkinScreen({ setProfile, initialCategory }) {
  const [category, setCategory] = useState(initialCategory || "card"); // "card" | "table" | "title"
  const [equippedSkinId, setEquippedSkinId] = useState(getEquippedSkin());
  const [equippedTableId, setEquippedTableId] = useState(getEquippedTable());
  const [equippedTitleLabel, setEquippedTitleLabel] = useState(getEquippedTitle());
  // ヒーロー枠に出す1点。一覧をタップすると（未所持でも）ここに映るので、買う前に3Dで確かめられる。
  const [previewSkinId, setPreviewSkinId] = useState(equippedSkinId);
  const [previewTableId, setPreviewTableId] = useState(equippedTableId);

  const ownedSkins = getOwnedSkins();
  const ownedTables = getOwnedTables();
  const ownedTitleIds = getOwnedTitles();
  const unlockedAchievementIds = getUnlockedAchievements();

  const handleEquipSkin = (id) => { setEquippedSkin(id); setEquippedSkinId(id); playCoin(); };
  const handleEquipTable = (id) => { setEquippedTable(id); setEquippedTableId(id); playCoin(); };
  const handleEquipTitle = (label) => {
    setEquippedTitle(label);
    setEquippedTitleLabel(label);
    setProfile?.(p => ({ ...p, title: label }));
  };

  const CATEGORY_TABS = [
    { id: "card", label: "カード", Icon: PaletteIcon },
    { id: "table", label: "テーブル", Icon: TableIcon },
    { id: "title", label: "称号", Icon: MedalIcon },
  ];

  return (
    <div className="kj-page-scroll" style={{ height: "100%", overflowY: "auto" }}>
      {/* カテゴリタブ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {CATEGORY_TABS.map(t => (
          <button key={t.id} onClick={() => setCategory(t.id)} className="kj-pressable" style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 0", borderRadius: RADIUS.sm,
            border: category === t.id ? "2px solid #e8c874" : `1px solid ${SURFACE.hairlineStrong}`,
            background: category === t.id ? "#e8c87422" : SURFACE.card,
            color: category === t.id ? "#e8c874" : "#9a9aa8", cursor: "pointer", fontSize: 12,
          }}>
            <t.Icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {category === "card" && (
        <>
          <SkinShowcaseStage
            name={CARD_THEMES[previewSkinId].label}
            rarity={CARD_THEMES[previewSkinId].rarity}
            owned={ownedSkins.includes(previewSkinId)}
            equipped={equippedSkinId === previewSkinId}
            onEquip={() => handleEquipSkin(previewSkinId)}
            fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <PlayingCard variant="number" number={5} theme={previewSkinId} width={104} />
            </div>}
          >
            <CardShowcase3D theme={previewSkinId} number={5} accentColor={RARITY_COLOR[CARD_THEMES[previewSkinId].rarity]} />
          </SkinShowcaseStage>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 14 }}>
            {Object.entries(CARD_THEMES).map(([id, theme]) => {
              const isOwned = ownedSkins.includes(id);
              const isEquipped = equippedSkinId === id;
              const isPreviewing = previewSkinId === id;
              return (
                <button key={id} onClick={() => setPreviewSkinId(id)} className="kj-pressable" style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  padding: "14px 8px", borderRadius: RADIUS.md,
                  background: isEquipped ? "#2a1f00" : SURFACE.card,
                  border: isPreviewing ? "2px solid #e8c874"
                    : `1px solid ${isOwned ? SURFACE.hairlineStrong : SURFACE.hairlineWarm}`,
                  cursor: "pointer", opacity: isOwned ? 1 : 0.45,
                }}>
                  <div style={{ position: "relative" }}>
                    <PlayingCard variant="number" number={4} theme={id} width={64} />
                    {!isOwned && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: "50%",
                          background: "rgba(5,5,10,0.72)", border: `1px solid ${SURFACE.hairlineStrong}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <LockIcon size={17} style={{ color: "#cfc3ae" }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: isOwned ? "#f4e7bf" : "#8a7f70", textAlign: "center" }}>{theme.label}</div>
                  <div style={{ fontSize: 9, color: RARITY_COLOR[theme.rarity] }}>{theme.rarity.toUpperCase()}</div>
                  {isEquipped && <div style={{ fontSize: 9, color: "#e8c874", fontWeight: 700 }}>装備中</div>}
                </button>
              );
            })}
          </div>
          {Object.keys(CARD_THEMES).length > ownedSkins.length && (
            <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#6b6154" }}>
              未所持のカードは、ショップで買うか報酬ボックスから。
            </div>
          )}
        </>
      )}

      {category === "table" && (
        <>
          <SkinShowcaseStage
            name={TABLE_THEMES[previewTableId].label}
            rarity={TABLE_THEMES[previewTableId].rarity}
            owned={ownedTables.includes(previewTableId)}
            equipped={equippedTableId === previewTableId}
            onEquip={() => handleEquipTable(previewTableId)}
            fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <TableThemeSwatch themeId={previewTableId} width={200} />
            </div>}
          >
            <TableShowcase3D theme={previewTableId} cardTheme={equippedSkinId} />
          </SkinShowcaseStage>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
            {Object.entries(TABLE_THEMES).map(([id, theme]) => {
              const isOwned = ownedTables.includes(id);
              const isEquipped = equippedTableId === id;
              const isPreviewing = previewTableId === id;
              return (
                <button key={id} onClick={() => setPreviewTableId(id)} className="kj-pressable" style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  padding: "14px 8px", borderRadius: RADIUS.md,
                  background: isEquipped ? "#2a1f00" : SURFACE.card,
                  border: isPreviewing ? "2px solid #e8c874"
                    : `1px solid ${isOwned ? SURFACE.hairlineStrong : SURFACE.hairlineWarm}`,
                  cursor: "pointer", opacity: isOwned ? 1 : 0.45,
                }}>
                  <div style={{ position: "relative" }}>
                    <TableThemeSwatch themeId={id} width={112} />
                    {!isOwned && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: "50%",
                          background: "rgba(5,5,10,0.72)", border: `1px solid ${SURFACE.hairlineStrong}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <LockIcon size={17} style={{ color: "#cfc3ae" }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: isOwned ? "#f4e7bf" : "#8a7f70", textAlign: "center" }}>{theme.label}</div>
                  <div style={{ fontSize: 9, color: RARITY_COLOR[theme.rarity] }}>{theme.rarity.toUpperCase()}</div>
                  {isEquipped && <div style={{ fontSize: 9, color: "#e8c874", fontWeight: 700 }}>装備中</div>}
                </button>
              );
            })}
          </div>
          {Object.keys(TABLE_THEMES).length > ownedTables.length && (
            <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#6b6154" }}>
              未所持のテーブルは、ショップで買うか報酬ボックスから。
            </div>
          )}
        </>
      )}

      {category === "title" && (
        <div>
          <div style={{ fontSize: 11, color: "#6b6154", marginBottom: 12 }}>

          </div>
          <TitleList
            equippedTitleLabel={equippedTitleLabel}
            onEquip={handleEquipTitle}
            achievements={visibleAchievements()}
            unlockedAchievementIds={unlockedAchievementIds}
            cosmeticTitles={COSMETIC_TITLES}
            ownedTitleIds={ownedTitleIds}
            rarityColor={RARITY_COLOR}
          />
        </div>
      )}
    </div>
  );
}
