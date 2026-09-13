// 画面につき1つだけマウントする共有<Canvas>。旧LayeredSVG3D(client/src/LayeredSVG3D.jsx)は
// 呼ばれるたびに独立したCanvas(WebGLコンテキスト)・ライト一式・環境マップ・ContactShadowsを
// 新規生成していたため、対戦画面で必要な最大15枚前後のカードをそのまま並べるとブラウザの
// WebGLコンテキスト数上限(実装依存、一般に8〜16程度)に抵触するリスクが高かった。
// SceneCanvasはその「土台」を1回だけ作り、子として任意個の<Card3D>/<Table3D>を受け取るだけの器にする。
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";

// contactShadowY: 接地影を落とす床の高さ。対戦画面は卓が中心にあるので既定の-3で良いが、
// ショーケース(three/Showcase3D.jsx)は見せる物の大きさが用途ごとに違うため、影が物の中を
// 突き抜けたり画面外に外れたりしないよう呼び出し側で指定できるようにしてある。
// envIntensity: 自前環境マップの強さ。既定1.6は対戦画面(小さめのカードが多数)向けに決めた値で、
// ショーケースのように1枚のカードを画面いっぱいに大きく映す用途では、環境の輝球の映り込みが
// カード1枚を丸ごと覆う大きさになり面全体が白く飛ぶ（実際にデッキ編成の3D化で踏んだ不具合。
// 平面のカードが全て同じ向きでも、透視投影では位置ごとに視線ベクトルが変わるため、
// 特定の位置のカードだけがハイライトを正面から受けてしまう）。用途ごとに落とせるようにしてある。
// frontFill: 正面補助光の位置と強さ。既定[0,1,9]/0.55はイラスト差し込み(ReliefMesh)を正面から
// 読ませるための対戦画面向けの値だが、ほぼカメラ軸上にあるため「鏡面反射の戻りがちょうどカメラへ
// 向く位置」に置かれた平らなカードだけが白く飛ぶ（実際にデッキ編成の3D化で踏んだ不具合。6枚のうち
// 上段中央の1枚だけが真っ白になった。平面が全て同じ向きでも、透視投影では位置ごとに視線ベクトルが
// 変わるため、R·Vが1に最も近くなる1枚にハイライトが集中する）。カードを大きく並べる画面では
// 補助光を上へ逃がし、ハイライトの落ちる位置を内容の外へ追い出すこと。
// ambient / keyIntensity: 全体の明るさ。既定は対戦画面向けで「盤面全体が均等に読める」値だが、
// トレーラー(client/src/trailer/)は**暗闇に灯りが一つ**という画を作るため、ここを落として
// 卓ごとのpointLightを子として足す。既定値は従来のままなので、これを渡さない画面は一切変わらない。
// frameloop / dpr: 描画の頻度と解像度の上限。既定（毎フレーム・最大2倍）は対戦画面向け。
// ロビーの主卓（Showcase3D.jsx の LobbyTable3D）は**滞在時間が最も長い画面なのに動く物がほぼ無い**ので、
// "demand"（何かが変わった時だけ描く）と1.5倍に落とす。毎フレーム描いたままだと、止まった卓のために
// ContactShadows の影まで毎フレーム描き直し続け、スマホは発熱し、ノートPCはファンが回る。
// rimColor / hemiSky / envAccent: 光の色味。既定は寒色のリム＋紫の天空光＋青い映り込みで、ネオンカジノの
// 対比を作るための値。暖色で組んだロビーの上に置くと卓だけが青く浮くので、暖色へ差し替えられるようにした。
// どれも既定値は従来のままなので、渡さない画面は一切変わらない。
export function SceneCanvas({
  children, cameraZ = 9, background = "transparent", style,
  contactShadowY = -3, envIntensity = 1.6, frontFill = { position: [0, 1, 9], intensity: 0.55 },
  ambient = 0.28, keyIntensity = 1.6, rimIntensity = 0.9, contactShadowOpacity = 0.55,
  frameloop = "always", dpr = [1, 2],
  rimColor = "#5ec8ff", hemiSky = "#3a2a55", envAccent = "#3d8fd6",
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, cameraZ], fov: 45 }}
      style={{ background, ...style }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={dpr}
      frameloop={frameloop}
    >
      {/* 暖色のキーライト(金の質感を引き立てる)+寒色のリムライト(ネオンカジノらしい対比)で
          単なる正面フラット光より陰影に劇的さを出す。アンビエントは控えめにしてコントラストを残す。 */}
      <ambientLight intensity={ambient} />
      <directionalLight position={[6, 9, 6]} intensity={keyIntensity} color="#ffdca8" castShadow />
      <directionalLight position={[-7, 2, -4]} intensity={rimIntensity} color={rimColor} />
      <directionalLight position={[0, -3, 5]} intensity={0.3} color="#ff7a3d" />
      <hemisphereLight args={[hemiSky, "#150a06", 0.35]} />
      {/* イラスト差し込み(ReliefMesh)用の正面補助光。金属パーツ向けの上記リムライト構成だけだと
          カード面を正面から見た時に暗く沈みすぎ、差し込んだイラストの中身がほぼ判別できなかった
          (実際にイラストを差し込んで確認して判明した不具合)。 */}
      <directionalLight position={frontFill.position} intensity={frontFill.intensity} color="#fff4e0" />

      <Suspense fallback={null}>{children}</Suspense>

      <ContactShadows position={[0, contactShadowY, 0]} opacity={contactShadowOpacity} scale={10} blur={2.2} far={4} />
      {/* drei標準のEnvironment presetは外部HDRIをCDNから取得するため使わず、3dsvg自身の内部実装に倣い
          「巨大な球を内側から見る」自前フェイク環境光にする(外部ネットワーク依存を増やさない方針)。 */}
      <Environment background={false} environmentIntensity={envIntensity} frames={1}>
        <mesh scale={50}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color="#050308" side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 25, 8]}>
          <sphereGeometry args={[18, 32, 32]} />
          <meshBasicMaterial color="#fff2d8" />
        </mesh>
        <mesh position={[-22, -4, 12]}>
          <sphereGeometry args={[10, 32, 32]} />
          <meshBasicMaterial color={envAccent} />
        </mesh>
        <mesh position={[18, -10, -10]}>
          <sphereGeometry args={[8, 32, 32]} />
          <meshBasicMaterial color="#2a1810" />
        </mesh>
      </Environment>
    </Canvas>
  );
}
