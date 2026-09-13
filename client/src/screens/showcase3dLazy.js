// スキン画面とショップが使う3Dプレビューの入口。両方の画面から同じ宣言を読むので、ここに1つだけ置く。
//
// 3Dショーケース(three/Showcase3D.jsx)はthree.js一式を引き連れるため、shared.jsxのBattleScene3Dと
// 同じく必ずReact.lazyで分離する（静的importするとホーム画面しか開かないユーザーのメインバンドルにも
// gzip 260KB超が乗る）。
// 使う側は fallback に常に同じ物の2D版(PlayingCard/TableThemeSwatch)を出し、読み込み中も枠が空にならないようにする。
import { lazy } from "react";

export const CardShowcase3D = lazy(() => import("../three/Showcase3D.jsx").then((m) => ({ default: m.CardShowcase3D })));
export const TableShowcase3D = lazy(() => import("../three/Showcase3D.jsx").then((m) => ({ default: m.TableShowcase3D })));
