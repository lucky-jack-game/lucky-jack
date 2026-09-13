// ビルド前に dist を確実に消す（package.json の prebuild から呼ばれる）。
//
// ── なぜ Vite の emptyOutDir に任せられないのか ──
// **手元の作業フォルダのパスに日本語が入っているから。** 非ASCII文字を含むパスでは、この環境の Node の `fs.rmSync` が**成功を返したまま何も消さない**
// （例外も戻り値も無いので呼び出し側からは成功と見分けがつかない）。実測:
//
//     C:\...\__probe_ascii\p.txt   作成=true 削除=true
//     C:\...\__プローブ\p.txt       作成=true 削除=false   ← 例外は出ない
//
// Vite の emptyOutDir は内部で node の fs 削除を使うので、このリポジトリでは**一度も効いた
// ことがない**。エラーも警告も出ないまま、ビルドのたびに three.js のチャンク(975KB)が積み上がり、
// 実際に 446ファイル・86MB まで育っていた（クリーンビルドは17ファイル・1.9MB）。
// そのまま提出すると40倍を配ることになる。
//
// **だから消えたことを必ず確かめ、消えていなければOSのコマンドに落とす。**
// 「dev サーバーを上げたままビルドしない」という運用注意でしのごうとした時期があるが、
// dev サーバーを止めても再現するので原因ではなかった。運用ではなくビルド手順の側で潰す。
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (!existsSync(dist)) process.exit(0);

try { rmSync(dist, { recursive: true, force: true }); } catch { /* 下で確かめる */ }

if (existsSync(dist)) {
  // node の fs では消えなかった。シェル経由なら非ASCIIパスでも消える。
  if (process.platform === "win32") execFileSync("cmd", ["/c", "rmdir", "/s", "/q", dist], { stdio: "inherit" });
  else execFileSync("rm", ["-rf", dist], { stdio: "inherit" });
}

if (existsSync(dist)) {
  // ここまで来たら黙って進んではいけない——古いチャンクが混ざったまま配ることになる。
  console.error(`clean-dist: ${dist} を消せなかった。手で消してからビルドすること。`);
  process.exit(1);
}
